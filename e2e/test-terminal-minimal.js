/**
 * Minimal Terminal Test
 * Opens browser, finds Terminal button, clicks it, checks output
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const COMPARISON_ID = process.argv[2] || 'bcaf11d9-3912-4880-8bab-e1257888c3a3';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5000';

const screenshotsDir = path.join(__dirname, 'screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(path.join(screenshotsDir, 'test-log.txt'), line + '\n');
}

(async () => {
  log('Starting minimal terminal test');
  log(`Frontend URL: ${FRONTEND_URL}`);
  log(`Comparison ID: ${COMPARISON_ID}`);
  
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1400, height: 900 }
  });
  
  const page = await browser.newPage();
  
  // Log browser console messages
  page.on('console', msg => log(`[BROWSER] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => log(`[PAGE ERROR] ${err.message}`));
  
  try {
    const url = `${FRONTEND_URL}/comparison/${COMPARISON_ID}`;
    log(`Navigating to: ${url}`);
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    log('Page loaded');
    
    await page.screenshot({ path: path.join(screenshotsDir, 'min-01-loaded.png'), fullPage: true });
    
    // Wait for page to stabilize
    await new Promise(r => setTimeout(r, 2000));
    
    // Find all buttons with "Terminal" text
    const buttons = await page.$$eval('button', btns => {
      return btns.map(b => ({
        text: b.textContent?.trim(),
        disabled: b.disabled,
        visible: b.offsetParent !== null
      })).filter(b => b.text?.toLowerCase().includes('terminal'));
    });
    
    log(`Found ${buttons.length} Terminal buttons: ${JSON.stringify(buttons)}`);
    
    if (buttons.length === 0) {
      log('ERROR: No Terminal buttons found!');
      
      // Log all buttons on page for debugging
      const allButtons = await page.$$eval('button', btns => {
        return btns.map(b => b.textContent?.trim()).filter(Boolean);
      });
      log(`All buttons on page: ${JSON.stringify(allButtons)}`);
      
      await page.screenshot({ path: path.join(screenshotsDir, 'min-error-no-button.png'), fullPage: true });
      await browser.close();
      process.exit(1);
    }
    
    // Click the first Terminal button
    log('Clicking Terminal button...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const termBtn = btns.find(b => b.textContent?.toLowerCase().includes('terminal'));
      if (termBtn) termBtn.click();
    });
    
    log('Waiting for terminal dialog...');
    await new Promise(r => setTimeout(r, 3000));
    
    await page.screenshot({ path: path.join(screenshotsDir, 'min-02-after-click.png'), fullPage: true });
    
    // Check for terminal/dialog elements
    const terminalState = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"], .MuiDialog-root');
      const xterm = document.querySelector('.xterm, .xterm-screen, [class*="terminal"]');
      const connected = document.body.textContent?.includes('Connected');
      return {
        hasDialog: !!dialog,
        hasXterm: !!xterm,
        hasConnected: connected,
        dialogText: dialog?.textContent?.substring(0, 200)
      };
    });
    
    log(`Terminal state: ${JSON.stringify(terminalState)}`);
    
    if (terminalState.hasXterm || terminalState.hasDialog) {
      log('SUCCESS: Terminal dialog opened!');
      
      // Try typing a command
      log('Typing "pwd" command...');
      await page.keyboard.type('pwd');
      await page.keyboard.press('Enter');
      
      await new Promise(r => setTimeout(r, 2000));
      await page.screenshot({ path: path.join(screenshotsDir, 'min-03-after-command.png'), fullPage: true });
      
      // Get terminal content
      const termOutput = await page.evaluate(() => {
        const xterm = document.querySelector('.xterm-screen');
        return xterm?.textContent || 'No xterm content found';
      });
      log(`Terminal output: ${termOutput.substring(0, 500)}`);
    } else {
      log('WARNING: Terminal may not have opened properly');
    }
    
    log('Test complete! Keeping browser open for 15 seconds...');
    await new Promise(r => setTimeout(r, 15000));
    
  } catch (error) {
    log(`ERROR: ${error.message}`);
    await page.screenshot({ path: path.join(screenshotsDir, 'min-error.png'), fullPage: true });
  } finally {
    await browser.close();
    log('Browser closed');
  }
})();
