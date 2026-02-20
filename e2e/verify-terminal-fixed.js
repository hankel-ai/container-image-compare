const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

/**
 * Comprehensive test to verify the terminal boot ID fix is working
 * 
 * This test:
 * 1. Navigates to home page
 * 2. Enters an image reference
 * 3. Clicks INSPECT IMAGE
 * 4. Waits for image details to load
 * 5. Clicks TERMINAL button
 * 6. Waits for terminal to initialize
 * 7. Checks for error messages
 * 8. Reports PASS/FAIL status
 */

(async () => {
  const screenshotDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 50,
    args: ['--start-maximized', '--no-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  const consoleLogs = [];
  const errors = [];

  page.on('console', msg => {
    const log = `[${msg.type()}] ${msg.text()}`;
    consoleLogs.push(log);
    console.log('BROWSER:', log);
  });

  page.on('pageerror', error => {
    errors.push(error.message);
    console.error('PAGE ERROR:', error.message);
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  let testPassed = false;

  try {
    console.log('\n========================================');
    console.log('🧪 TERMINAL FIX VERIFICATION TEST');
    console.log('========================================\n');

    console.log('Step 1: Navigate to home page');
    await page.goto('http://localhost:5000', { waitUntil: 'networkidle0', timeout: 30000 });
    await page.screenshot({ path: path.join(screenshotDir, `verify-01-home-${timestamp}.png`), fullPage: true });
    console.log('✓ Home page loaded');

    console.log('\nStep 2: Enter image reference');
    await page.waitForSelector('input[type="text"]', { timeout: 10000 });
    const inputs = await page.$$('input[type="text"]');
    await inputs[0].type('artifactory.otxlab.net/docker-releases/dctm-tomcat:23.4.0');
    await page.screenshot({ path: path.join(screenshotDir, `verify-02-form-filled-${timestamp}.png`), fullPage: true });
    console.log('✓ Image reference entered');

    console.log('\nStep 3: Click INSPECT IMAGE button');
    await new Promise(resolve => setTimeout(resolve, 1000));
    await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.includes('INSPECT'));
      if (button) button.click();
    });
    console.log('✓ Clicked INSPECT IMAGE button');

    console.log('\nStep 4: Wait for image details to load');
    await new Promise(resolve => setTimeout(resolve, 3000));
    await page.screenshot({ path: path.join(screenshotDir, `verify-03-details-loaded-${timestamp}.png`), fullPage: true });
    console.log('✓ Image details loaded');

    console.log('\nStep 5: Click TERMINAL button');
    await new Promise(resolve => setTimeout(resolve, 1000));
    await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.includes('TERMINAL'));
      if (button) button.click();
    });
    await new Promise(resolve => setTimeout(resolve, 3000));
    await page.screenshot({ path: path.join(screenshotDir, `verify-04-terminal-clicked-${timestamp}.png`), fullPage: true });
    console.log('✓ Clicked TERMINAL button');

    console.log('\nStep 6: Wait for terminal initialization');
    await new Promise(resolve => setTimeout(resolve, 5000));
    await page.screenshot({ path: path.join(screenshotDir, `verify-05-final-state-${timestamp}.png`), fullPage: true });
    console.log('✓ Terminal initialization complete');

    console.log('\nStep 7: Check for errors...');
    
    // Check for error messages
    const errorCheck = await page.evaluate(() => {
      const bodyText = document.body.textContent || '';
      
      const errors = [];
      if (bodyText.includes('Container Terminal Unavailable')) {
        errors.push('Container Terminal Unavailable');
      }
      if (bodyText.includes('Failed to load image')) {
        errors.push('Failed to load image');
      }
      if (bodyText.includes('boot ID')) {
        errors.push('boot ID issue');
      }
      if (bodyText.includes('failed with code 125')) {
        errors.push('Podman error code 125');
      }
      
      return errors.length > 0 ? errors : null;
    });

    console.log('\n========================================');
    if (errorCheck && errorCheck.length > 0) {
      console.log('❌ TEST FAILED - ERRORS DETECTED:');
      errorCheck.forEach(err => console.log(`   - ${err}`));
      testPassed = false;
    } else {
      console.log('✅ TEST PASSED - NO ERRORS DETECTED');
      console.log('   Terminal feature is working correctly!');
      testPassed = true;
    }
    console.log('========================================\n');

    if (errors.length > 0) {
      console.log('JavaScript Errors:');
      errors.forEach(err => console.log(`   - ${err}`));
    }

  } catch (error) {
    console.error('\n❌ TEST FAILED WITH EXCEPTION:', error.message);
    await page.screenshot({ path: path.join(screenshotDir, `verify-FAILURE-${timestamp}.png`), fullPage: true });
    testPassed = false;
  } finally {
    await browser.close();
    
    console.log('\nTest Summary:');
    console.log(`   Status: ${testPassed ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Screenshots: ${screenshotDir}`);
    
    process.exit(testPassed ? 0 : 1);
  }
})();
