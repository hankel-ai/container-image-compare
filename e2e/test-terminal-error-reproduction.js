const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

(async () => {
  const screenshotDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 100,
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

  try {
    console.log('Step 1: Navigate to home page');
    await page.goto('http://localhost:5000', { waitUntil: 'networkidle0', timeout: 30000 });
    await page.screenshot({ path: path.join(screenshotDir, `terminal-error-01-home-${timestamp}.png`), fullPage: true });

    console.log('Step 2: Enter image details');
    await page.waitForSelector('input[type="text"]', { timeout: 10000 });
    const inputs = await page.$$('input[type="text"]');
    await inputs[0].type('artifactory.otxlab.net/docker-releases/dctm-tomcat:23.4.0');
    await page.screenshot({ path: path.join(screenshotDir, `terminal-error-02-form-filled-${timestamp}.png`), fullPage: true });

    console.log('Step 3: Click INSPECT IMAGE button');
    await new Promise(resolve => setTimeout(resolve, 1000));
    await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.includes('INSPECT'));
      if (button) button.click();
    });
    await new Promise(resolve => setTimeout(resolve, 3000));
    await page.screenshot({ path: path.join(screenshotDir, `terminal-error-03-image-details-${timestamp}.png`), fullPage: true });

    console.log('Step 4: Click TERMINAL button');
    await new Promise(resolve => setTimeout(resolve, 1000));
    await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.includes('TERMINAL'));
      if (button) button.click();
    });
    await new Promise(resolve => setTimeout(resolve, 3000));
    await page.screenshot({ path: path.join(screenshotDir, `terminal-error-04-terminal-clicked-${timestamp}.png`), fullPage: true });

    console.log('Step 5: Wait and observe error state');
    await new Promise(resolve => setTimeout(resolve, 5000));
    await page.screenshot({ path: path.join(screenshotDir, `terminal-error-05-error-visible-${timestamp}.png`), fullPage: true });

    // Check for error messages in the page
    const errorText = await page.evaluate(() => {
      const errorElement = document.querySelector('[class*="error" i], [class*="alert" i], [role="alert"]');
      if (errorElement) return errorElement.textContent;
      
      // Check for specific error messages
      const bodyText = document.body.textContent || '';
      if (bodyText.includes('Container Terminal Unavailable')) return 'ERROR: Container Terminal Unavailable found';
      if (bodyText.includes('Failed to load image')) return 'ERROR: Failed to load image found';
      if (bodyText.includes('boot ID')) return 'ERROR: boot ID issue found';
      
      return null;
    });

    if (errorText) {
      console.log('\n❌ ERROR DETECTED:', errorText);
    } else {
      console.log('\n✅ NO ERRORS - Terminal appears to be working');
    }

    console.log('\n=== CONSOLE LOGS ===');
    consoleLogs.forEach(log => console.log(log));

    console.log('\n=== ERRORS ===');
    errors.forEach(err => console.error(err));

    console.log('\n✅ Test completed - check screenshots');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await page.screenshot({ path: path.join(screenshotDir, `terminal-error-FAILURE-${timestamp}.png`), fullPage: true });
  } finally {
    await browser.close();
  }
})();
