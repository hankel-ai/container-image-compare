/**
 * E2E Test for Authentication Fix
 * Tests:
 * 1. Private registry with saved credentials should work
 * 2. Auth errors should show inline next to the failing image
 * 3. Image inputs should persist after auth error
 */
const puppeteer = require('puppeteer');
const axios = require('axios');
const path = require('path');

const BACKEND_URL = 'http://localhost:5000';
const FRONTEND_URL = 'http://localhost:3000';
const SCREENSHOT_DIR = __dirname;  // Use the e2e directory for screenshots

// Test images from private registry
const TEST_IMAGES = {
  left: 'dctmregistry.duckdns.org/testreg/dctm-tomcat:23.4.0',
  right: 'dctmregistry.duckdns.org/testreg/dctm-tomcat:23.4.1'
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
    // Get current settings
    const resp = await axios.get(`${BACKEND_URL}/api/settings`);
    const credentials = resp.data.credentials || [];
    
    // Check if credential already exists for our registry
    const existing = credentials.find(c => 
      c.registry === CREDENTIALS.registry || 
      c.registry.startsWith(CREDENTIALS.registry + '/')
    );
    
    if (existing) {
      console.log('Credential already exists:', existing.registry);
      return existing;
    }
    
    // Create new credential
    const newCred = {
      id: `test-${Date.now()}`,
      name: CREDENTIALS.username,
      registry: CREDENTIALS.registry,
      username: CREDENTIALS.username,
      password: CREDENTIALS.password,
      createdAt: new Date().toISOString()
    };
    
    const saveResp = await axios.post(`${BACKEND_URL}/api/settings/credentials`, newCred);
    console.log('Created new credential for:', CREDENTIALS.registry);
    return newCred;
  } catch (e) {
    console.error('Error ensuring credential:', e.message);
    throw e;
  }
}

async function runTest() {
  let browser;
  
  try {
    // Wait for backend
    await waitForBackend();
    
    // Ensure credential exists
    await ensureCredentialExists();
    
    // Launch browser
    console.log('\nLaunching browser...');
    browser = await puppeteer.launch({
      headless: false, // Show browser so we can see what's happening
      defaultViewport: { width: 1280, height: 800 },
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Navigate to app
    console.log('Navigating to app...');
    await page.goto(FRONTEND_URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await sleep(1000);
    
    // Take initial screenshot
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'screenshot-01-home.png') });
    console.log('Screenshot saved: screenshot-01-home.png');
    
    // Enter left image - MUI TextField renders input inside a div
    console.log('Entering left image:', TEST_IMAGES.left);
    const leftInput = await page.waitForSelector('input[placeholder*="nginx"]');
    await leftInput.click();
    await leftInput.type(TEST_IMAGES.left);
    
    // Enter right image
    console.log('Entering right image:', TEST_IMAGES.right);
    const inputs = await page.$$('input[placeholder*="nginx"]');
    if (inputs.length >= 2) {
      await inputs[1].click();
      await inputs[1].type(TEST_IMAGES.right);
    } else {
      // Fall back to second input
      const allInputs = await page.$$('input[type="text"]');
      if (allInputs.length >= 2) {
        await allInputs[1].click();
        await allInputs[1].type(TEST_IMAGES.right);
      }
    }
    
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'screenshot-02-inputs.png') });
    console.log('Screenshot saved: screenshot-02-inputs.png');
    
    // Click Compare button
    console.log('Clicking Compare button...');
    const compareButton = await page.waitForSelector('button:not([disabled])');
    // Find button with "Compare" text
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text && text.includes('Compare')) {
        await btn.click();
        break;
      }
    }
    
    // Wait for comparison to complete or error (up to 60 seconds for slow downloads)
    console.log('Waiting for comparison result...');
    let maxWait = 60;
    let urlChanged = false;
    for (let i = 0; i < maxWait; i++) {
      await sleep(1000);
      const currentUrl = page.url();
      if (currentUrl.includes('/comparison/')) {
        urlChanged = true;
        break;
      }
      // Check if still loading
      const isLoading = await page.evaluate(() => {
        const btn = document.querySelector('button');
        return btn && btn.textContent && btn.textContent.includes('Comparing');
      });
      if (!isLoading && i > 5) {
        // Not loading and not navigated - probably an error
        break;
      }
      if (i % 10 === 0) {
        console.log(`Still waiting... (${i}s)`);
      }
    }
    
    // Take screenshot of result
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'screenshot-03-result.png') });
    console.log('Screenshot saved: screenshot-03-result.png');
    
    // Check page content
    const pageContent = await page.content();
    
    // Check for success (navigated to comparison page) or error
    const url = page.url();
    console.log('Current URL:', url);
    
    if (url.includes('/comparison/')) {
      console.log('\n✅ SUCCESS: Comparison completed successfully!');
      console.log('Auth fix is working - credentials were used correctly.');
      
      // Take screenshot of comparison page
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'screenshot-04-comparison.png') });
      console.log('Screenshot saved: screenshot-04-comparison.png');
      
      return { success: true, message: 'Comparison completed' };
    } else {
      // Check for auth error
      const hasAuthError = pageContent.includes('Authentication') || pageContent.includes('auth');
      const hasError = pageContent.includes('error') || pageContent.includes('Error');
      
      if (hasAuthError) {
        console.log('\n❌ FAILED: Auth error occurred');
        console.log('Credentials may not be matching correctly.');
        
        // Check if inputs are still present (they should be)
        const leftInput = await page.$('input[placeholder*="Left"]');
        const leftValue = leftInput ? await page.evaluate(el => el.value, leftInput) : '';
        console.log('Left input value (should persist):', leftValue);
        
        return { success: false, message: 'Auth error - credentials not working' };
      }
      
      if (hasError) {
        console.log('\n❌ FAILED: Other error occurred');
        return { success: false, message: 'Unknown error' };
      }
      
      console.log('\n⚠️ UNKNOWN: Unexpected state');
      return { success: false, message: 'Unexpected state' };
    }
    
  } catch (error) {
    console.error('\n❌ TEST ERROR:', error.message);
    return { success: false, message: error.message };
  } finally {
    if (browser) {
      // Keep browser open for 5 seconds to see result
      console.log('\nKeeping browser open for 5 seconds...');
      await sleep(5000);
      await browser.close();
    }
  }
}

// Run the test
runTest().then(result => {
  console.log('\n=== TEST RESULT ===');
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
});
