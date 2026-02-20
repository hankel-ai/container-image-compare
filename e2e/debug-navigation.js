/**
 * Debug test to understand page navigation
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
const APP_URL = 'http://localhost:5000';
const TEST_IMAGE = 'alpine:latest';

function getTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function debugNavigation() {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 }
  });

  const page = await browser.newPage();
  
  page.on('console', msg => console.log(`PAGE: ${msg.text()}`));

  try {
    // Step 1: Go to home
    await page.goto(APP_URL, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `debug-01-home-${getTimestamp()}.png`) });
    console.log('1. Home page loaded. URL:', page.url());

    // Step 2: Enter image
    const inputs = await page.$$('input[type="text"]');
    await inputs[0].click({ clickCount: 3 });
    await inputs[0].type(TEST_IMAGE);
    console.log('2. Entered test image');

    // Step 3: Click Inspect
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await btn.evaluate(el => el.textContent);
      if (text && text.includes('Inspect')) {
        await btn.click();
        break;
      }
    }
    console.log('3. Clicked Inspect. Waiting for navigation...');
    
    await delay(3000);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `debug-02-after-inspect-${getTimestamp()}.png`) });
    console.log('   URL after inspect:', page.url());

    // Wait for download to complete
    console.log('4. Waiting for image download...');
    await delay(10000);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `debug-03-after-download-${getTimestamp()}.png`) });

    // Step 4: Look for tabs
    console.log('5. Looking for tabs...');
    const allTabs = await page.$$('[role="tab"]');
    console.log(`   Found ${allTabs.length} tabs with role="tab"`);
    
    for (let i = 0; i < allTabs.length; i++) {
      const text = await allTabs[i].evaluate(el => el.textContent);
      console.log(`   Tab ${i}: "${text}"`);
    }

    // Look for anything with "terminal" in it
    const terminalElements = await page.$$eval('*', els => 
      els.filter(el => el.textContent?.toLowerCase().includes('terminal'))
         .map(el => ({ tag: el.tagName, text: el.textContent?.substring(0, 50), classes: el.className }))
         .slice(0, 10)
    );
    console.log('6. Elements mentioning "terminal":', terminalElements);

    // Keep browser open
    console.log('\nBrowser open for inspection. Close manually.');
    await delay(60000);

  } catch (error) {
    console.error('Error:', error.message);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `debug-error-${getTimestamp()}.png`) });
  }
}

debugNavigation();
