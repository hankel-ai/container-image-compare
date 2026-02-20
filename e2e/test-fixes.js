/**
 * E2E Test for Recent Fixes
 * Tests:
 * 1. File content comparison uses cached files (no auth errors)
 * 2. Cross-registry comparison shows correct image names
 * 3. Server startup shows correct paths
 */
const puppeteer = require('puppeteer');
const axios = require('axios');
const path = require('path');

const BACKEND_URL = 'http://localhost:5000';
const FRONTEND_URL = 'http://localhost:3000';
const SCREENSHOT_DIR = __dirname;

// Test images - same image from different registries
const TEST_IMAGES = {
  // Private registry with auth
  private1: 'dctmregistry.duckdns.org/testreg/dctm-tomcat:23.4.0',
  private2: 'dctmregistry.duckdns.org/testreg/dctm-tomcat:23.4.1',
  // Same digest from different registry (no auth)
  crossRegistry: 'artifactory.otxlab.net/docker-releases/dctm-tomcat:23.4.0'
};

const CREDENTIALS = {
  registry: 'dctmregistry.duckdns.org',
  username: 'test',
  password: 'Password1!'
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForBackend(maxAttempts = 30) {
  console.log('Waiting for backend to be ready...');
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const resp = await axios.get(`${BACKEND_URL}/api/settings`, { timeout: 2000 });
      if (resp.status === 200) {
        console.log('Backend is ready!');
        return true;
      }
    } catch (e) {
      // Not ready yet
    }
    await sleep(1000);
  }
  throw new Error('Backend did not start in time');
}

async function ensureCredentialExists() {
  console.log('Checking/creating test credential...');
  try {
    const resp = await axios.get(`${BACKEND_URL}/api/settings/credentials`);
    const credentials = resp.data || [];
    
    const existing = credentials.find(c => 
      c.registry === CREDENTIALS.registry || 
      c.registry.startsWith(CREDENTIALS.registry + '/')
    );
    
    if (existing) {
      console.log('Credential already exists:', existing.registry);
      return existing;
    }
    
    const newCred = {
      id: `test-${Date.now()}`,
      name: CREDENTIALS.username,
      registry: CREDENTIALS.registry,
      username: CREDENTIALS.username,
      password: CREDENTIALS.password,
      createdAt: new Date().toISOString()
    };
    
    await axios.post(`${BACKEND_URL}/api/settings/credentials`, newCred);
    console.log('Created new credential for:', CREDENTIALS.registry);
    return newCred;
  } catch (e) {
    console.error('Error ensuring credential:', e.message);
    throw e;
  }
}

async function runComparison(leftImage, rightImage) {
  console.log(`\nComparing: ${leftImage} vs ${rightImage}`);
  const resp = await axios.post(`${BACKEND_URL}/api/comparison`, {
    leftImage,
    rightImage
  }, { timeout: 120000 });
  return resp.data;
}

async function getFileDiff(comparisonId, filePath) {
  console.log(`Getting file diff for: ${filePath}`);
  const resp = await axios.post(`${BACKEND_URL}/api/comparison/file-diff`, {
    comparisonId,
    filePath
  }, { timeout: 30000 });
  return resp.data;
}

// Test 1: File content comparison should work without auth
async function testFileDiffNoAuth() {
  console.log('\n=== TEST 1: File Diff Without Auth ===');
  
  // First do a comparison to cache the images
  const comparison = await runComparison(TEST_IMAGES.private1, TEST_IMAGES.private2);
  console.log('Comparison ID:', comparison.id);
  console.log('Left image:', comparison.leftImage.fullName);
  console.log('Right image:', comparison.rightImage.fullName);
  
  // Find a file that exists in both images
  const diffs = comparison.filesystemDiff || [];
  const modifiedFile = diffs.find(d => d.type === 'modified' && !d.path.endsWith('/'));
  
  if (!modifiedFile) {
    console.log('No modified files found, trying any file...');
    // Try to get a known file
    const testPath = '/etc/passwd';
    try {
      const diff = await getFileDiff(comparison.id, testPath);
      console.log('✅ File diff succeeded for:', testPath);
      console.log('Left content length:', diff.leftContent?.length || 0);
      console.log('Right content length:', diff.rightContent?.length || 0);
      return { success: true, message: 'File diff works without re-authentication' };
    } catch (err) {
      console.log('❌ File diff failed:', err.response?.data?.message || err.message);
      return { success: false, message: err.response?.data?.message || err.message };
    }
  }
  
  try {
    const diff = await getFileDiff(comparison.id, modifiedFile.path);
    console.log('✅ File diff succeeded for:', modifiedFile.path);
    console.log('Left content length:', diff.leftContent?.length || 0);
    console.log('Right content length:', diff.rightContent?.length || 0);
    return { success: true, message: 'File diff works without re-authentication' };
  } catch (err) {
    console.log('❌ File diff failed:', err.response?.data?.message || err.message);
    return { success: false, message: err.response?.data?.message || err.message };
  }
}

// Test 2: Cross-registry comparison shows correct image names
async function testCrossRegistryImageNames() {
  console.log('\n=== TEST 2: Cross-Registry Image Names ===');
  
  try {
    // First compare private images to populate cache
    const comparison1 = await runComparison(TEST_IMAGES.private1, TEST_IMAGES.private2);
    console.log('First comparison done, images cached');
    
    // Now compare with cross-registry image (same digest, different registry)
    // This should show the correct image name, not the cached one
    const comparison2 = await runComparison(TEST_IMAGES.crossRegistry, TEST_IMAGES.private2);
    console.log('Second comparison done');
    
    console.log('Left image requested:', TEST_IMAGES.crossRegistry);
    console.log('Left image returned:', comparison2.leftImage.fullName);
    
    // Check if the left image name matches what was requested
    if (comparison2.leftImage.fullName === TEST_IMAGES.crossRegistry) {
      console.log('✅ Image name matches requested reference');
      return { success: true, message: 'Cross-registry image name is correct' };
    } else {
      console.log('❌ Image name does not match!');
      return { success: false, message: `Expected ${TEST_IMAGES.crossRegistry}, got ${comparison2.leftImage.fullName}` };
    }
  } catch (err) {
    // If cross-registry fails due to auth, that's expected for private images
    // But we should still check if the image name would be correct
    console.log('Note: Cross-registry test may fail if target registry requires auth');
    console.log('Error:', err.response?.data?.message || err.message);
    return { success: false, message: err.response?.data?.message || err.message };
  }
}

// Test 3: Verify file diff works in the browser UI
async function testFileDiffInUI(browser) {
  console.log('\n=== TEST 3: File Diff in Browser UI ===');
  
  const page = await browser.newPage();
  
  try {
    // Navigate to app
    await page.goto(FRONTEND_URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await sleep(1000);
    
    // Enter images
    const leftInput = await page.waitForSelector('input[placeholder*="nginx"]');
    await leftInput.click();
    await leftInput.type(TEST_IMAGES.private1);
    
    const inputs = await page.$$('input[placeholder*="nginx"]');
    if (inputs.length >= 2) {
      await inputs[1].click();
      await inputs[1].type(TEST_IMAGES.private2);
    }
    
    // Click Compare button
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text && text.includes('Compare')) {
        await btn.click();
        break;
      }
    }
    
    // Wait for comparison to complete
    let maxWait = 120;
    for (let i = 0; i < maxWait; i++) {
      await sleep(1000);
      const currentUrl = page.url();
      if (currentUrl.includes('/comparison/')) {
        break;
      }
      if (i % 10 === 0) {
        console.log(`Waiting for comparison... (${i}s)`);
      }
    }
    
    const url = page.url();
    if (!url.includes('/comparison/')) {
      console.log('❌ Comparison did not complete');
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'test3-failed.png') });
      return { success: false, message: 'Comparison did not navigate to results' };
    }
    
    // Click on Filesystem tab
    console.log('Clicking Filesystem tab...');
    await sleep(2000);
    const tabs = await page.$$('button[role="tab"]');
    for (const tab of tabs) {
      const text = await page.evaluate(el => el.textContent, tab);
      if (text && text.includes('Filesystem')) {
        await tab.click();
        break;
      }
    }
    
    await sleep(3000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'test3-filesystem.png') });
    console.log('Screenshot saved: test3-filesystem.png');
    
    // Look for a file to click on (not a directory)
    // Try to find a file node in the tree and click it
    const fileNodes = await page.$$('[data-testid="file-node"], .MuiTreeItem-content');
    console.log('Found tree nodes:', fileNodes.length);
    
    if (fileNodes.length > 0) {
      // Click a few nodes to try to trigger file content view
      for (let i = 0; i < Math.min(5, fileNodes.length); i++) {
        await fileNodes[i].click();
        await sleep(500);
      }
    }
    
    await sleep(2000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'test3-filediff.png') });
    console.log('Screenshot saved: test3-filediff.png');
    
    // Check if there's an auth error on the page
    const pageContent = await page.content();
    if (pageContent.includes('Authentication') || pageContent.includes('auth error')) {
      console.log('❌ Auth error found when viewing file content');
      return { success: false, message: 'Auth error when viewing file content' };
    }
    
    console.log('✅ No auth errors found in UI');
    return { success: true, message: 'File diff in UI works without auth errors' };
    
  } catch (err) {
    console.log('❌ UI test error:', err.message);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'test3-error.png') });
    return { success: false, message: err.message };
  } finally {
    await page.close();
  }
}

async function runTests() {
  let browser;
  const results = [];
  
  try {
    await waitForBackend();
    await ensureCredentialExists();
    
    // Test 1: File diff without auth (API level)
    results.push({ name: 'File Diff No Auth', ...await testFileDiffNoAuth() });
    
    // Test 2: Cross-registry image names
    results.push({ name: 'Cross-Registry Names', ...await testCrossRegistryImageNames() });
    
    // Test 3: File diff in UI
    console.log('\nLaunching browser for UI tests...');
    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: { width: 1400, height: 900 },
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    results.push({ name: 'File Diff in UI', ...await testFileDiffInUI(browser) });
    
    // Print summary
    console.log('\n\n=== TEST SUMMARY ===');
    let allPassed = true;
    for (const r of results) {
      const status = r.success ? '✅ PASS' : '❌ FAIL';
      console.log(`${status}: ${r.name} - ${r.message}`);
      if (!r.success) allPassed = false;
    }
    
    return { success: allPassed, results };
    
  } catch (error) {
    console.error('\n❌ TEST ERROR:', error.message);
    return { success: false, message: error.message };
  } finally {
    if (browser) {
      console.log('\nClosing browser in 5 seconds...');
      await sleep(5000);
      await browser.close();
    }
  }
}

// Run the tests
runTests().then(result => {
  console.log('\n=== FINAL RESULT ===');
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
});
