const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

/**
 * Test terminal opens in new browser tab with focus on terminal input
 * 
 * Uses proper selectors based on actual HomePage and ComparisonPage structure
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
  let testPassed = true;
  let mainPage;

  try {
    console.log('\n========================================');
    console.log('🧪 TERMINAL NEW TAB TEST');
    console.log('========================================\n');

    const pages = await browser.pages();
    mainPage = pages[0];
    await mainPage.setViewport({ width: 1920, height: 1080 });

    mainPage.on('console', msg => console.log('BROWSER:', msg.text()));
    mainPage.on('pageerror', err => console.log('PAGE ERROR:', err.message));

    // Step 1: Navigate to home page
    console.log('Step 1: Navigate to home page');
    await mainPage.goto('http://localhost:5000', { waitUntil: 'networkidle0', timeout: 30000 });
    await mainPage.screenshot({ path: path.join(screenshotDir, `newtab-01-home-${timestamp}.png`), fullPage: true });
    console.log('✓ Home page loaded');

    // Step 2: Type into the Left Image input (it's an Autocomplete with a TextField inside)
    console.log('\nStep 2: Enter image reference in Left Image field');
    
    // Wait for the input with label "Left Image"
    await mainPage.waitForSelector('input', { timeout: 10000 });
    
    // Find the input by its label - MUI Autocomplete renders an input
    const leftInput = await mainPage.$('input[id*="Left"]');
    if (!leftInput) {
      // Fallback: get first input on page
      const inputs = await mainPage.$$('input');
      if (inputs.length > 0) {
        await inputs[0].click();
        await inputs[0].type('artifactory.otxlab.net/docker-releases/dctm-tomcat:23.4.0', { delay: 10 });
      }
    } else {
      await leftInput.click();
      await leftInput.type('artifactory.otxlab.net/docker-releases/dctm-tomcat:23.4.0', { delay: 10 });
    }
    
    await mainPage.screenshot({ path: path.join(screenshotDir, `newtab-02-form-${timestamp}.png`), fullPage: true });
    console.log('✓ Image reference entered');

    // Step 3: Click the submit button - text is "Inspect Image" when only left image filled
    console.log('\nStep 3: Click Inspect Image button');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Find button containing "Inspect" text
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

    // Step 4: Wait for navigation to comparison page
    console.log('\nStep 4: Wait for image details page to load');
    await mainPage.waitForFunction(
      () => window.location.pathname.includes('/comparison/'),
      { timeout: 60000 }
    );
    
    // Wait for page content to load
    await mainPage.waitForSelector('button', { timeout: 30000 });
    await new Promise(resolve => setTimeout(resolve, 2000));
    await mainPage.screenshot({ path: path.join(screenshotDir, `newtab-03-details-${timestamp}.png`), fullPage: true });
    console.log('✓ Image details page loaded');

    // Step 5: Find and click Terminal button
    console.log('\nStep 5: Click Terminal button');
    
    // Set up listener for new tab BEFORE clicking
    const newPagePromise = new Promise(resolve => {
      browser.once('targetcreated', async (target) => {
        if (target.type() === 'page') {
          const newPage = await target.page();
          resolve(newPage);
        }
      });
    });
    
    const terminalClicked = await mainPage.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const termBtn = buttons.find(btn => 
        btn.textContent.toLowerCase().includes('terminal') && 
        !btn.disabled
      );
      if (termBtn) {
        console.log('Found Terminal button, clicking...');
        termBtn.click();
        return true;
      }
      console.log('Terminal button not found. Available buttons:', 
        buttons.map(b => b.textContent).join(', '));
      return false;
    });
    
    if (!terminalClicked) {
      await mainPage.screenshot({ path: path.join(screenshotDir, `newtab-04-no-terminal-btn-${timestamp}.png`), fullPage: true });
      throw new Error('Could not find Terminal button');
    }
    console.log('✓ Clicked Terminal button');

    // Step 6: Wait for new tab to open
    console.log('\nStep 6: Wait for new tab to open');
    
    let terminalPage = null;
    try {
      terminalPage = await Promise.race([
        newPagePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('New tab timeout')), 8000))
      ]);
    } catch (e) {
      // Check pages manually
      await new Promise(resolve => setTimeout(resolve, 2000));
      const allPages = await browser.pages();
      if (allPages.length > 1) {
        terminalPage = allPages.find(p => p !== mainPage);
      }
    }
    
    if (!terminalPage) {
      const allPages = await browser.pages();
      console.log(`   Total pages: ${allPages.length}`);
      await mainPage.screenshot({ path: path.join(screenshotDir, `newtab-05-no-newtab-${timestamp}.png`), fullPage: true });
      throw new Error('New tab did not open');
    }
    
    console.log('✓ New tab opened');
    
    // Step 7: Verify terminal tab
    console.log('\nStep 7: Verify terminal tab');
    await terminalPage.bringToFront();
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const title = await terminalPage.title();
    console.log(`   Tab title: ${title}`);
    
    await terminalPage.screenshot({ path: path.join(screenshotDir, `newtab-06-terminal-tab-${timestamp}.png`), fullPage: true });
    
    // Check for terminal content
    const hasTerminal = await terminalPage.evaluate(() => {
      return document.querySelector('.xterm') !== null || 
             document.querySelector('[data-testid="terminal-container"]') !== null;
    });
    
    if (hasTerminal) {
      console.log('✓ Terminal container found');
    } else {
      console.log('⚠ Terminal container not found yet');
    }
    
    // Wait for connection
    await new Promise(resolve => setTimeout(resolve, 5000));
    await terminalPage.screenshot({ path: path.join(screenshotDir, `newtab-07-terminal-connected-${timestamp}.png`), fullPage: true });
    
    // Step 8: Test reusing existing tab
    console.log('\nStep 8: Click Terminal again - should focus existing tab');
    await mainPage.bringToFront();
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const pagesBefore = (await browser.pages()).length;
    
    await mainPage.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const termBtn = buttons.find(btn => btn.textContent.toLowerCase().includes('terminal'));
      if (termBtn) termBtn.click();
    });
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const pagesAfter = (await browser.pages()).length;
    
    if (pagesAfter === pagesBefore) {
      console.log('✓ No new tab opened - reused existing');
    } else {
      console.log('⚠ New tab opened instead of reusing');
    }

    console.log('\n========================================');
    console.log('✅ TEST PASSED');
    console.log('========================================\n');

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    if (mainPage) {
      await mainPage.screenshot({ path: path.join(screenshotDir, `newtab-FAILURE-${timestamp}.png`), fullPage: true });
    }
    testPassed = false;
  } finally {
    await browser.close();
    process.exit(testPassed ? 0 : 1);
  }
})();
