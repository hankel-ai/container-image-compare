/**
 * Manual Terminal Verification - Opens browser and waits for manual testing
 */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
const APP_URL = 'http://localhost:5000';
const TEST_IMAGE = 'alpine:latest';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('🧪 Terminal Manual Verification\n');
  
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 900 },
    args: ['--no-sandbox']
  });

  const page = await browser.newPage();

  // Navigate to app
  console.log('Loading app...');
  await page.goto(APP_URL, { waitUntil: 'networkidle0' });
  console.log('✅ App loaded at', APP_URL);

  // Enter image
  console.log('Entering test image:', TEST_IMAGE);
  const input = await page.$('input');
  if (input) {
    await input.type(TEST_IMAGE);
    
    // Submit
    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) {
      await submitBtn.click();
      console.log('Submitted - waiting for comparison...');
    }
  }

  // Wait for navigation or timeout
  console.log('\n⏳ Waiting 30 seconds for comparison to complete...');
  await delay(30000);

  // Take screenshot
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `manual-verify-${ts}.png`) });
  console.log('📸 Screenshot saved');

  // Check URL
  console.log('\nCurrent URL:', page.url());

  if (page.url().includes('/comparison/')) {
    console.log('✅ On comparison page!');
    
    // Take another screenshot
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `manual-comparison-${ts}.png`) });
    
    // Find Terminal button
    console.log('\nLooking for Terminal button...');
    const buttons = await page.$$eval('button', btns => 
      btns.map(b => ({ text: b.textContent, disabled: b.disabled }))
    );
    
    const termBtn = buttons.find(b => b.text && b.text.includes('Terminal'));
    if (termBtn) {
      console.log('Terminal button found:', termBtn.disabled ? 'DISABLED' : 'ENABLED');
    } else {
      console.log('Terminal button NOT found');
    }
  }

  console.log('\n========================================');
  console.log('MANUAL VERIFICATION INSTRUCTIONS:');
  console.log('========================================');
  console.log('1. Click the Terminal button on the comparison page');
  console.log('2. Verify terminal does NOT show "Working directory: /"');
  console.log('3. Close terminal, go to Filesystem tab');
  console.log('4. Hover over a folder and click the terminal icon');
  console.log('5. Verify terminal DOES show "Working directory: /path/..."');
  console.log('========================================\n');

  console.log('Browser will stay open for 5 minutes for manual testing...');
  console.log('Press Ctrl+C in terminal when done.\n');

  // Keep alive for 5 minutes
  await delay(300000);
  
  await browser.close();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
