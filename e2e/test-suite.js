/**
 * Comprehensive E2E Test Suite for Container Image Compare
 * 
 * Test registries:
 * A) Private with auth: dctmregistry.duckdns.org/testreg (username=test, password=Password1!)
 * B) Private no auth: artifactory.otxlab.net/docker-releases
 * C) Public Docker Hub: docker.io (no auth for public images)
 * 
 * Prerequisites:
 * - Backend running on localhost:5000
 * - Frontend running on localhost:3000 or localhost:4173
 */

const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Test configuration
const CONFIG = {
  backend: process.env.BACKEND_URL || 'http://localhost:5000',
  frontend: process.env.FRONTEND_URL || 'http://localhost:3000',
  timeout: 120000, // 2 minutes for large image downloads
  retryAttempts: 10,
  retryDelayMs: 1000,
  
  // Test credentials for private registry
  privateRegistry: {
    host: 'dctmregistry.duckdns.org',
    username: 'test',
    password: 'Password1!'
  },
  
  // Test images by registry type
  testImages: {
    // Artifactory - no auth required
    artifactory: [
      'artifactory.otxlab.net/docker-releases/dctm-tomcat:23.4.0',
      'artifactory.otxlab.net/docker-releases/dctm-tomcat:23.4.5'
    ],
    // Private registry with auth
    private: [
      'dctmregistry.duckdns.org/testreg/dctm-tomcat:23.4.0',
      'dctmregistry.duckdns.org/testreg/dctm-tomcat:23.4.5'
    ],
    // Docker Hub public
    dockerHub: [
      'nginx:1.25.0',
      'nginx:1.26.0'
    ]
  }
};

// Test results storage
const testResults = [];

// Utility functions
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForBackend() {
  console.log(`⏳ Waiting for backend at ${CONFIG.backend}...`);
  for (let attempt = 1; attempt <= CONFIG.retryAttempts; attempt++) {
    try {
      await axios.get(`${CONFIG.backend}/api/settings`);
      console.log('✅ Backend is ready');
      return true;
    } catch (e) {
      if (attempt === CONFIG.retryAttempts) {
        throw new Error(`Backend not available after ${CONFIG.retryAttempts} attempts`);
      }
      console.log(`   Attempt ${attempt}/${CONFIG.retryAttempts} failed, retrying...`);
      await sleep(CONFIG.retryDelayMs);
    }
  }
}

async function clearCredentials() {
  console.log('🧹 Clearing existing credentials...');
  try {
    const res = await axios.get(`${CONFIG.backend}/api/settings/credentials`);
    for (const cred of res.data) {
      await axios.delete(`${CONFIG.backend}/api/settings/credentials/${cred.id}`);
    }
    console.log('✅ Credentials cleared');
  } catch (e) {
    console.log('⚠️ Could not clear credentials:', e.message);
  }
}

async function addCredential(registry, username, password) {
  console.log(`🔐 Adding credential for ${registry}...`);
  try {
    await axios.post(`${CONFIG.backend}/api/settings/credentials`, {
      id: `test-${Date.now()}`,
      name: registry,
      registry: registry,
      username: username,
      password: password,
      createdAt: new Date().toISOString()
    });
    console.log('✅ Credential added');
    return true;
  } catch (e) {
    console.log('❌ Failed to add credential:', e.message);
    return false;
  }
}

async function clearCache() {
  console.log('🧹 Clearing image cache...');
  try {
    await axios.post(`${CONFIG.backend}/api/cache/clear`);
    console.log('✅ Cache cleared');
  } catch (e) {
    console.log('⚠️ Could not clear cache:', e.message);
  }
}

async function runComparison(leftImage, rightImage, expectAuth = false) {
  console.log(`\n📊 Comparing: ${leftImage} vs ${rightImage}`);
  
  const startTime = Date.now();
  try {
    const res = await axios.post(
      `${CONFIG.backend}/api/comparison`,
      { leftImage, rightImage },
      { timeout: CONFIG.timeout }
    );
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Comparison completed in ${duration}s`);
    console.log(`   ID: ${res.data.id}`);
    console.log(`   Files changed: ${res.data.filesystemDiff?.length || 0}`);
    
    return { success: true, data: res.data, duration };
  } catch (e) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    if (e.response?.status === 401) {
      if (expectAuth) {
        console.log(`✅ Got expected 401 (auth required) after ${duration}s`);
        return { success: true, authRequired: true, details: e.response.data.details };
      }
      console.log(`❌ Unexpected 401 error after ${duration}s`);
    } else {
      console.log(`❌ Comparison failed after ${duration}s:`, e.response?.data?.message || e.message);
    }
    
    return { success: false, error: e.response?.data || e.message };
  }
}

async function verifyComparisonInUI(browser, comparisonId) {
  console.log(`🌐 Verifying comparison ${comparisonId} in UI...`);
  
  const page = await browser.newPage();
  const consoleMessages = [];
  page.on('console', msg => consoleMessages.push({ type: msg.type(), text: msg.text() }));
  
  try {
    const url = `${CONFIG.frontend}/comparison/${comparisonId}`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Click Filesystem tab
    await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
      const fsTab = tabs.find(t => /filesystem/i.test(t.textContent || ''));
      if (fsTab) fsTab.click();
    });
    
    // Wait for filesystem view
    await page.waitForSelector('input[placeholder*="Search files"]', { timeout: 15000 });
    
    // Take screenshot
    const screenshotPath = path.join(__dirname, `comparison-${comparisonId.slice(0, 8)}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`   Screenshot: ${screenshotPath}`);
    
    await page.close();
    return { success: true };
  } catch (e) {
    // Save debug info
    const htmlPath = path.join(__dirname, `debug-${comparisonId.slice(0, 8)}.html`);
    try { fs.writeFileSync(htmlPath, await page.content()); } catch {}
    
    await page.close();
    return { success: false, error: e.message };
  }
}

// Test cases
async function testPublicRegistry() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: Public Registry (Docker Hub)');
  console.log('='.repeat(60));
  
  const [left, right] = CONFIG.testImages.dockerHub;
  const result = await runComparison(left, right);
  
  testResults.push({
    name: 'Public Registry (Docker Hub)',
    images: [left, right],
    ...result
  });
  
  return result.success;
}

async function testPrivateNoAuth() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: Private Registry (No Auth - Artifactory)');
  console.log('='.repeat(60));
  
  const [left, right] = CONFIG.testImages.artifactory;
  const result = await runComparison(left, right);
  
  testResults.push({
    name: 'Private Registry (No Auth)',
    images: [left, right],
    ...result
  });
  
  return result.success;
}

async function testPrivateWithAuth() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: Private Registry (With Auth)');
  console.log('='.repeat(60));
  
  const [left, right] = CONFIG.testImages.private;
  
  // First attempt without credentials - should fail with 401
  console.log('\n📌 Step 1: Attempt without credentials (expect 401)');
  await clearCredentials();
  const noAuthResult = await runComparison(left, right, true);
  
  if (!noAuthResult.authRequired) {
    console.log('⚠️ Expected 401 but got different result');
    testResults.push({
      name: 'Private Registry (Auth Check)',
      images: [left, right],
      success: false,
      error: 'Expected 401 but registry did not require auth'
    });
    return false;
  }
  
  // Add credentials and retry
  console.log('\n📌 Step 2: Add credentials and retry');
  await addCredential(CONFIG.privateRegistry.host, CONFIG.privateRegistry.username, CONFIG.privateRegistry.password);
  const withAuthResult = await runComparison(left, right);
  
  testResults.push({
    name: 'Private Registry (With Auth)',
    images: [left, right],
    ...withAuthResult
  });
  
  return withAuthResult.success;
}

async function testCrossRegistryComparison() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: Cross-Registry Comparison (Same Image)');
  console.log('='.repeat(60));
  
  // Compare same image from different registries
  // This tests the digest-based deduplication
  const left = CONFIG.testImages.artifactory[0];
  const right = CONFIG.testImages.private[0];
  
  // Need auth for private registry
  await addCredential(CONFIG.privateRegistry.host, CONFIG.privateRegistry.username, CONFIG.privateRegistry.password);
  
  const result = await runComparison(left, right);
  
  testResults.push({
    name: 'Cross-Registry Comparison',
    images: [left, right],
    ...result
  });
  
  return result.success;
}

async function testCacheHit() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: Cache Hit Performance');
  console.log('='.repeat(60));
  
  const [left, right] = CONFIG.testImages.dockerHub;
  
  // First run - cache miss (already run in testPublicRegistry)
  console.log('📌 Running comparison again (should use cache)...');
  const cachedResult = await runComparison(left, right);
  
  if (cachedResult.success && parseFloat(cachedResult.duration) < 5) {
    console.log('✅ Cache hit confirmed - fast response');
  }
  
  testResults.push({
    name: 'Cache Hit Performance',
    images: [left, right],
    ...cachedResult,
    cacheHit: parseFloat(cachedResult.duration || '999') < 5
  });
  
  return cachedResult.success;
}

// Main test runner
async function runTests() {
  console.log('🚀 Container Image Compare E2E Test Suite');
  console.log('=========================================\n');
  
  let browser;
  
  try {
    // Setup
    await waitForBackend();
    browser = await puppeteer.launch({ headless: true });
    
    // Run test cases
    const tests = [
      { name: 'Public Registry', fn: testPublicRegistry },
      { name: 'Private No Auth', fn: testPrivateNoAuth },
      { name: 'Private With Auth', fn: testPrivateWithAuth },
      { name: 'Cache Hit', fn: testCacheHit },
      // { name: 'Cross Registry', fn: testCrossRegistryComparison }, // Disabled - requires same images in both registries
    ];
    
    let passed = 0;
    let failed = 0;
    
    for (const test of tests) {
      try {
        const success = await test.fn();
        if (success) passed++;
        else failed++;
      } catch (e) {
        console.log(`❌ Test "${test.name}" threw error:`, e.message);
        failed++;
        testResults.push({
          name: test.name,
          success: false,
          error: e.message
        });
      }
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📊 Total:  ${tests.length}`);
    
    // Save results
    const resultsPath = path.join(__dirname, 'test-results.json');
    fs.writeFileSync(resultsPath, JSON.stringify(testResults, null, 2));
    console.log(`\n📄 Results saved to: ${resultsPath}`);
    
    await browser.close();
    
    process.exit(failed > 0 ? 1 : 0);
    
  } catch (e) {
    console.error('\n💥 Test suite failed:', e.message);
    if (browser) await browser.close();
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  runTests();
}

module.exports = { runTests, CONFIG };
