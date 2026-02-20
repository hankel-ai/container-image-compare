/**
 * Comprehensive E2E Test Suite for Container Image Compare
 * Tests all recent fixes and Phase 5 features
 * 
 * Run with: node test-all-fixes.js
 * Requires: npm run dev (server on localhost:5000, frontend on localhost:5173)
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:3000';
const API_URL = 'http://localhost:5000';

// Test images
const TEST_IMAGES = {
  left: 'dctmregistry.duckdns.org/testreg/dctm-tomcat:23.4.0',
  right: 'dctmregistry.duckdns.org/testreg/dctm-tomcat:23.4.1',
  testFile: '/opt/tomcat/BUILDING.txt'
};

let browser;
let page;
let screenshotDir;

// Initialize screenshot directory from API
async function initScreenshotDir() {
  try {
    const response = await fetch(`${API_URL}/api/settings/paths`);
    if (response.ok) {
      const paths = await response.json();
      screenshotDir = path.join(paths.temp, 'e2e-screenshots');
    } else {
      // Fallback
      screenshotDir = path.join(__dirname, '..', 'backend', 'appdata', 'temp', 'e2e-screenshots');
    }
  } catch {
    screenshotDir = path.join(__dirname, '..', 'backend', 'appdata', 'temp', 'e2e-screenshots');
  }
  
  // Ensure directory exists
  fs.mkdirSync(screenshotDir, { recursive: true });
  console.log(`📁 Screenshots will be saved to: ${screenshotDir}`);
}

async function saveScreenshot(name) {
  const filename = `${Date.now()}-${name}.png`;
  const filepath = path.join(screenshotDir, filename);
  await page.screenshot({ path: filepath, fullPage: true });
  console.log(`  📸 Saved: ${filename}`);
  return filepath;
}

async function setup() {
  await initScreenshotDir();
  
  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  
  // Capture console logs
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`  ❌ Console error: ${msg.text()}`);
    }
  });
}

async function teardown() {
  if (browser) {
    await browser.close();
  }
}

// Test Results
const results = [];

function recordResult(name, passed, details = '') {
  results.push({ name, passed, details });
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${name}${details ? `: ${details}` : ''}`);
}

// ============ TEST CASES ============

/**
 * Test 1: File Diff works without re-authentication
 * After comparing images, clicking on a file should NOT trigger auth errors
 */
async function testFileDiffNoAuth() {
  console.log('\n🧪 Test: File Diff No Auth');
  
  try {
    // Do a FRESH comparison (not from history) to ensure cache is properly initialized
    // This is needed because after server restart, the memory cache is empty
    // and old cache directories don't have refs.json yet
    console.log('  Creating fresh comparison...');
    const compareRes = await fetch(`${API_URL}/api/comparison`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leftImage: TEST_IMAGES.left,
        rightImage: TEST_IMAGES.right
      })
    });
    
    if (!compareRes.ok) {
      const err = await compareRes.json().catch(() => ({ message: compareRes.statusText }));
      recordResult('File Diff No Auth', false, `Comparison failed: ${err.message || err.error}`);
      return;
    }
    
    const comparison = await compareRes.json();
    console.log(`  Comparison created: ${comparison.id}`);
    console.log('  Testing file diff...');
    
    // Now try to get file content using the correct endpoint
    const diffRes = await fetch(`${API_URL}/api/comparison/file-diff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        comparisonId: comparison.id,
        filePath: TEST_IMAGES.testFile
      })
    });
    
    if (!diffRes.ok) {
      const err = await diffRes.json().catch(() => ({ message: diffRes.statusText }));
      if (err.message && err.message.toLowerCase().includes('auth')) {
        recordResult('File Diff No Auth', false, `Auth error: ${err.message}`);
      } else if (err.message && err.message.toLowerCase().includes('not found')) {
        recordResult('File Diff No Auth', false, `File not found: ${err.message}`);
      } else {
        recordResult('File Diff No Auth', false, `Error: ${err.message || diffRes.status}`);
      }
      return;
    }
    
    const diffData = await diffRes.json();
    if (diffData.leftContent !== undefined && diffData.rightContent !== undefined) {
      const leftLen = diffData.leftContent.length;
      const rightLen = diffData.rightContent.length;
      if (leftLen === 0 && rightLen === 0) {
        recordResult('File Diff No Auth', false, `Both contents empty - file may not exist`);
      } else {
        recordResult('File Diff No Auth', true, `Got diff for ${TEST_IMAGES.testFile} (${leftLen} / ${rightLen} chars)`);
      }
    } else {
      recordResult('File Diff No Auth', false, 'Invalid diff response structure');
    }
    
  } catch (err) {
    recordResult('File Diff No Auth', false, err.message);
  }
}

/**
 * Test 2: Cache Stats API works
 */
async function testCacheStats() {
  console.log('\n🧪 Test: Cache Stats API');
  
  try {
    const res = await fetch(`${API_URL}/api/cache/stats`);
    if (!res.ok) {
      recordResult('Cache Stats API', false, `HTTP ${res.status}`);
      return;
    }
    
    const stats = await res.json();
    if (typeof stats.totalSizeGB === 'number' && typeof stats.imageCount === 'number') {
      recordResult('Cache Stats API', true, `${stats.imageCount} images, ${stats.totalSizeGB.toFixed(2)} GB`);
    } else {
      recordResult('Cache Stats API', false, 'Invalid response structure');
    }
  } catch (err) {
    recordResult('Cache Stats API', false, err.message);
  }
}

/**
 * Test 3: App Paths API works
 */
async function testAppPaths() {
  console.log('\n🧪 Test: App Paths API');
  
  try {
    const res = await fetch(`${API_URL}/api/settings/paths`);
    if (!res.ok) {
      recordResult('App Paths API', false, `HTTP ${res.status}`);
      return;
    }
    
    const paths = await res.json();
    if (paths.appData && paths.cache && paths.temp && paths.history && paths.logs) {
      recordResult('App Paths API', true, `temp: ${paths.temp}`);
    } else {
      recordResult('App Paths API', false, 'Missing paths in response');
    }
  } catch (err) {
    recordResult('App Paths API', false, err.message);
  }
}

/**
 * Test 4: Registry Credentials Deduplication
 */
async function testCredentialDeduplication() {
  console.log('\n🧪 Test: Credential Deduplication');
  
  try {
    const testCred = {
      id: 'test-dedup-' + Date.now(),
      name: 'Test Registry',
      registry: 'test-dedup.example.com',
      username: 'testuser',
      password: 'testpass123',
      createdAt: new Date().toISOString()
    };
    
    // Add credential first time
    const res1 = await fetch(`${API_URL}/api/settings/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testCred)
    });
    
    if (!res1.ok) {
      recordResult('Credential Deduplication', false, 'Failed to add first credential');
      return;
    }
    
    // Add same registry/username with different ID (should update, not duplicate)
    const res2 = await fetch(`${API_URL}/api/settings/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...testCred,
        id: 'test-dedup-' + Date.now() + '-2',
        password: 'newpassword'
      })
    });
    
    if (!res2.ok) {
      recordResult('Credential Deduplication', false, 'Failed to add second credential');
      return;
    }
    
    // Check that there's only one entry for this registry/user
    const listRes = await fetch(`${API_URL}/api/settings/credentials`);
    const creds = await listRes.json();
    
    const matches = creds.filter(c => 
      c.registry.toLowerCase() === testCred.registry.toLowerCase() &&
      c.username.toLowerCase() === testCred.username.toLowerCase()
    );
    
    // Clean up test credential
    for (const cred of matches) {
      await fetch(`${API_URL}/api/settings/credentials/${cred.id}`, { method: 'DELETE' });
    }
    
    if (matches.length === 1) {
      recordResult('Credential Deduplication', true, 'Duplicate was merged correctly');
    } else {
      recordResult('Credential Deduplication', false, `Expected 1 credential, found ${matches.length}`);
    }
    
  } catch (err) {
    recordResult('Credential Deduplication', false, err.message);
  }
}

/**
 * Test 5: UI - Settings page loads with cache info
 */
async function testSettingsPageUI() {
  console.log('\n🧪 Test: Settings Page UI');
  
  try {
    await page.goto(`${BASE_URL}/settings`, { waitUntil: 'networkidle0', timeout: 30000 });
    await saveScreenshot('settings-page');
    
    // Check for cache usage display
    const cacheSection = await page.$eval('body', body => {
      return body.textContent.includes('Cache Usage') || body.textContent.includes('Cache Settings');
    });
    
    if (!cacheSection) {
      recordResult('Settings Page UI', false, 'Cache section not found');
      return;
    }
    
    // Check for Clear Cache button
    const clearButton = await page.$('button:has-text("Clear"), button:contains("Clear")');
    const hasClearButton = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.some(b => b.textContent.toLowerCase().includes('clear'));
    });
    
    if (hasClearButton) {
      recordResult('Settings Page UI', true, 'Cache settings and controls present');
    } else {
      recordResult('Settings Page UI', false, 'Clear cache button not found');
    }
    
  } catch (err) {
    await saveScreenshot('settings-page-error');
    recordResult('Settings Page UI', false, err.message);
  }
}

/**
 * Test 6: UI - Comparison and File Diff Flow
 */
async function testComparisonFlowUI() {
  console.log('\n🧪 Test: Comparison Flow UI');
  
  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await saveScreenshot('home-page');
    
    // Enter image names
    const inputs = await page.$$('input[type="text"]');
    if (inputs.length < 2) {
      recordResult('Comparison Flow UI', false, 'Could not find image input fields');
      return;
    }
    
    await inputs[0].click({ clickCount: 3 });
    await inputs[0].type(TEST_IMAGES.left);
    await inputs[1].click({ clickCount: 3 });
    await inputs[1].type(TEST_IMAGES.right);
    
    await saveScreenshot('inputs-filled');
    
    // Click Compare button
    const compareBtn = await page.evaluateHandle(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find(b => b.textContent.toLowerCase().includes('compare'));
    });
    
    if (!compareBtn) {
      recordResult('Comparison Flow UI', false, 'Compare button not found');
      return;
    }
    
    await compareBtn.click();
    
    // Wait for comparison to complete (might take a while for large images)
    console.log('  Waiting for comparison to complete...');
    await page.waitForFunction(
      () => {
        const body = document.body.textContent;
        return body.includes('Filesystem') || body.includes('Metadata') || body.includes('error');
      },
      { timeout: 120000 }
    );
    
    await saveScreenshot('comparison-result');
    
    // Check for errors
    const hasError = await page.evaluate(() => {
      const body = document.body.textContent.toLowerCase();
      return body.includes('authentication') && body.includes('error');
    });
    
    if (hasError) {
      recordResult('Comparison Flow UI', false, 'Authentication error during comparison');
      return;
    }
    
    // Try to click on Filesystem tab
    const fsTab = await page.evaluateHandle(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find(b => b.textContent.includes('Filesystem'));
    });
    
    if (fsTab) {
      await fsTab.click();
      await page.waitForTimeout(2000);
      await saveScreenshot('filesystem-tab');
    }
    
    recordResult('Comparison Flow UI', true, 'Comparison completed successfully');
    
  } catch (err) {
    await saveScreenshot('comparison-flow-error');
    recordResult('Comparison Flow UI', false, err.message);
  }
}

// ============ MAIN ============

async function runAllTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     Container Image Compare - E2E Test Suite               ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  try {
    await setup();
    
    // API Tests (fast)
    await testAppPaths();
    await testCacheStats();
    await testCredentialDeduplication();
    await testFileDiffNoAuth();
    
    // UI Tests (slower)
    await testSettingsPageUI();
    await testComparisonFlowUI();
    
  } catch (err) {
    console.error('\n💥 Test suite error:', err.message);
  } finally {
    await teardown();
  }
  
  // Print summary
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                     TEST SUMMARY                           ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  for (const r of results) {
    const icon = r.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${icon}: ${r.name}${r.details ? ` - ${r.details}` : ''}`);
  }
  
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
  console.log(`📁 Screenshots saved to: ${screenshotDir}`);
  
  // Output JSON result
  const finalResult = {
    success: failed === 0,
    passed,
    failed,
    screenshotDir,
    results
  };
  
  console.log('\n=== FINAL RESULT ===');
  console.log(JSON.stringify(finalResult, null, 2));
  
  process.exit(failed > 0 ? 1 : 0);
}

runAllTests();
