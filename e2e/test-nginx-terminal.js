const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

/**
 * Test terminal functionality with nginx image
 * Following the E2E testing protocol from copilot-instructions.md
 */

(async () => {
  const screenshotDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 50,
    args: [
      '--start-maximized', 
      '--no-sandbox',
      '--disable-popup-blocking'
    ]
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  let mainPage;

  try {
    console.log('\n========================================');
    console.log('🧪 NGINX TERMINAL TEST');
    console.log('========================================\n');

    const pages = await browser.pages();
    mainPage = pages[0];
    await mainPage.setViewport({ width: 1920, height: 1080 });

    // Capture console logs and errors
    mainPage.on('console', msg => console.log('BROWSER:', msg.text()));
    mainPage.on('pageerror', err => console.log('PAGE ERROR:', err.message));

    // Step 1: Navigate to home page
    console.log('Step 1: Navigate to home page');
    await mainPage.goto('http://localhost:5000', { waitUntil: 'networkidle0', timeout: 30000 });
    await mainPage.screenshot({ path: path.join(screenshotDir, `nginx-01-home-${timestamp}.png`), fullPage: true });
    console.log('✓ Home page loaded');

    // Step 2: Type alpine:latest in the Left Image field (smaller than nginx)
    console.log('\nStep 2: Enter alpine:latest in Left Image field');
    await mainPage.waitForSelector('input', { timeout: 10000 });
    
    const inputs = await mainPage.$$('input');
    if (inputs.length > 0) {
      await inputs[0].click();
      await inputs[0].type('alpine:latest', { delay: 20 });
    }
    
    await mainPage.screenshot({ path: path.join(screenshotDir, `nginx-02-form-${timestamp}.png`), fullPage: true });
    console.log('✓ Image reference entered');

    // Step 3: Click Inspect Image button
    console.log('\nStep 3: Click Inspect Image button');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const buttonClicked = await mainPage.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const inspectBtn = buttons.find(btn => 
        btn.textContent.toLowerCase().includes('inspect') && 
        !btn.disabled
      );
      if (inspectBtn) {
        inspectBtn.click();
        return true;
      }
      return false;
    });
    
    if (!buttonClicked) {
      throw new Error('Could not find Inspect Image button');
    }
    console.log('✓ Clicked Inspect Image button');

    // Step 4: Wait for comparison page to load (may take a while to download nginx)
    console.log('\nStep 4: Waiting for image download and comparison page...');
    
    // Wait for navigation to comparison page
    try {
      await Promise.race([
        mainPage.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 }),
        mainPage.waitForFunction(
          () => window.location.pathname.includes('/comparison/'),
          { timeout: 120000 }
        )
      ]);
    } catch (navErr) {
      // Check if we're already on comparison page
      const url = await mainPage.url();
      if (!url.includes('/comparison/')) {
        throw navErr;
      }
    }
    
    const currentUrl = await mainPage.url();
    console.log('Current URL:', currentUrl);
    
    // Wait a bit more for the page to fully render
    await new Promise(resolve => setTimeout(resolve, 5000));
    await mainPage.screenshot({ path: path.join(screenshotDir, `nginx-03-comparison-${timestamp}.png`), fullPage: true });
    console.log('✓ Comparison page loaded');

    // Step 5: Find and click the Terminal button
    console.log('\nStep 5: Looking for Terminal button...');
    
    // Wait for all content to load
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // List all buttons for debugging
    const buttons = await mainPage.evaluate(() => {
      return Array.from(document.querySelectorAll('button')).map(btn => ({
        text: btn.textContent?.trim(),
        disabled: btn.disabled,
        ariaLabel: btn.getAttribute('aria-label')
      }));
    });
    console.log('All buttons found:', JSON.stringify(buttons, null, 2));
    
    const terminalClicked = await mainPage.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const terminalBtn = buttons.find(btn => 
        btn.textContent?.trim() === 'Terminal' && !btn.disabled
      );
      if (terminalBtn) {
        terminalBtn.click();
        return true;
      }
      return false;
    });
    
    if (!terminalClicked) {
      console.log('⚠️ Terminal button not found or disabled');
      await mainPage.screenshot({ path: path.join(screenshotDir, `nginx-04-no-terminal-btn-${timestamp}.png`), fullPage: true });
    } else {
      console.log('✓ Clicked Terminal button');
    }

    // Step 6: Wait for new tab to open
    console.log('\nStep 6: Waiting for terminal tab to open...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const allPages = await browser.pages();
    console.log(`Total browser tabs: ${allPages.length}`);
    
    if (allPages.length > 1) {
      const terminalPage = allPages[allPages.length - 1];
      await terminalPage.bringToFront();
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const terminalTitle = await terminalPage.title();
      console.log(`Terminal tab title: ${terminalTitle}`);
      
      await terminalPage.screenshot({ path: path.join(screenshotDir, `nginx-05-terminal-${timestamp}.png`), fullPage: true });
      
      // Check for errors in the terminal page
      const terminalContent = await terminalPage.evaluate(() => document.body.innerText);
      console.log('Terminal page content (first 500 chars):', terminalContent.substring(0, 500));
      
      // Look for any error alerts
      const hasError = await terminalPage.evaluate(() => {
        const alerts = document.querySelectorAll('[role="alert"]');
        return alerts.length > 0 ? alerts[0].textContent : null;
      });
      
      if (hasError) {
        console.log('❌ ERROR FOUND:', hasError);
      }
    } else {
      console.log('❌ No new terminal tab opened');
      await mainPage.screenshot({ path: path.join(screenshotDir, `nginx-05-no-terminal-tab-${timestamp}.png`), fullPage: true });
    }

    console.log('\n========================================');
    console.log('TEST COMPLETE - Check screenshots folder');
    console.log('========================================\n');

    // Keep browser open for inspection
    console.log('Browser will stay open for 60 seconds for inspection...');
    await new Promise(resolve => setTimeout(resolve, 60000));

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (mainPage) {
      await mainPage.screenshot({ path: path.join(screenshotDir, `nginx-error-${timestamp}.png`), fullPage: true });
    }
  } finally {
    await browser.close();
  }
})();
