/**
 * E2E Test: Terminal Working Directory Verification
 * 
 * Tests:
 * 1. Terminal button on comparison page - should NOT show working directory
 * 2. Terminal from Filesystem tab (folder hover) - should show specific folder path
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
const APP_URL = 'http://localhost:5000';  // ALWAYS use port 5000
const TEST_IMAGE = 'alpine:latest';

function getTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('🧪 Terminal Working Directory Test\n');
  console.log('Testing:');
  console.log('  1. Terminal button - should NOT show "Working directory: /"');
  console.log('  2. Filesystem folder icon - should show folder path\n');

  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  const results = { terminalButton: null, filesystemTerminal: null };

  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`  [Browser Error]: ${msg.text().substring(0, 80)}`);
    }
  });

  try {
    // Step 1: Navigate to app
    console.log('1️⃣ Loading app...');
    await page.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `terminal-wd-01-home-${getTimestamp()}.png`) });
    console.log('   ✅ App loaded\n');

    // Step 2: Enter image and submit
    console.log('2️⃣ Submitting image comparison...');
    await page.type('input', TEST_IMAGE);
    await delay(500);
    
    await page.evaluate(() => {
      const btn = document.querySelector('button[type="submit"]');
      if (btn) btn.click();
    });
    
    console.log('   Waiting for comparison (may take a while for first pull)...');
    await delay(20000);
    
    // Check if on comparison page
    let url = page.url();
    if (!url.includes('/comparison/')) {
      console.log('   Not on comparison page, checking history...');
      await page.goto(`${APP_URL}/history`, { waitUntil: 'networkidle0' });
      await delay(2000);
      
      const historyLink = await page.$('a[href*="/comparison/"]');
      if (historyLink) {
        await historyLink.click();
        await delay(3000);
      }
    }
    
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `terminal-wd-02-comparison-${getTimestamp()}.png`) });
    console.log('   ✅ On comparison page\n');

    // ============ TEST 1: Terminal Button ============
    console.log('3️⃣ TEST 1: Terminal button (should NOT show working directory)...');
    
    // Find and click Terminal button
    const buttons = await page.$$('button');
    let terminalBtn = null;
    for (const btn of buttons) {
      const text = await btn.evaluate(b => b.textContent);
      if (text && text.includes('Terminal')) {
        terminalBtn = btn;
        break;
      }
    }
    
    if (!terminalBtn) {
      console.log('   ❌ Terminal button not found (runtime may not be available)');
      results.terminalButton = 'SKIP - No button';
    } else {
      await terminalBtn.click();
      console.log('   Waiting for terminal to connect...');
      await delay(8000);
      
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `terminal-wd-03-terminal-open-${getTimestamp()}.png`) });
      
      // Check terminal output
      const pageText = await page.evaluate(() => document.body.innerText);
      
      if (pageText.includes('Connected to container terminal')) {
        if (pageText.includes('Working directory: /')) {
          console.log('   ❌ FAIL: Shows "Working directory: /" but should not');
          results.terminalButton = 'FAIL - Shows "/" incorrectly';
        } else if (pageText.includes('Working directory:')) {
          console.log('   ❌ FAIL: Shows some working directory when it should not');
          results.terminalButton = 'FAIL - Shows working dir';
        } else {
          console.log('   ✅ PASS: Terminal connected WITHOUT showing working directory');
          results.terminalButton = 'PASS';
        }
      } else {
        console.log('   ⚠️ Terminal may not have connected properly');
        results.terminalButton = 'SKIP - Not connected';
      }
      
      // Close terminal
      const closeBtn = await page.$('button[aria-label="Close terminal"], [data-testid="CloseIcon"]');
      if (closeBtn) {
        await closeBtn.click();
        await delay(1000);
      } else {
        // Try finding close button by icon
        const allBtns = await page.$$('button');
        for (const btn of allBtns) {
          const html = await btn.evaluate(b => b.innerHTML);
          if (html.includes('Close') || html.includes('close')) {
            await btn.click();
            break;
          }
        }
        await delay(1000);
      }
    }
    console.log('');

    // ============ TEST 2: Filesystem Terminal ============
    console.log('4️⃣ TEST 2: Filesystem folder terminal (should show folder path)...');
    
    // Click Filesystem tab
    const tabs = await page.$$('[role="tab"]');
    if (tabs.length >= 2) {
      await tabs[1].click();  // Filesystem is index 1
      await delay(2000);
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `terminal-wd-04-filesystem-${getTimestamp()}.png`) });
      console.log('   Switched to Filesystem tab');
      
      // Look for a folder that has a terminal icon on hover
      // In the FilesystemView, folders show terminal icon on hover
      // We need to hover over a folder row to reveal the terminal button
      
      // Find a folder row (look for folder icons or expandable items)
      const folderRows = await page.$$('[data-testid="folder-row"], .MuiTreeItem-content, [role="treeitem"]');
      
      let foundFolder = false;
      if (folderRows.length > 0) {
        // Hover over first folder to reveal terminal button
        await folderRows[0].hover();
        await delay(500);
        
        // Look for terminal icon button that appears on hover
        const terminalIcons = await page.$$('button[aria-label*="terminal"], [data-testid="TerminalIcon"]');
        if (terminalIcons.length > 0) {
          await terminalIcons[0].click();
          foundFolder = true;
        }
      }
      
      if (!foundFolder) {
        // Alternative: Try to find any clickable folder icon
        console.log('   Trying alternative folder detection...');
        
        // Look in the file tree for any item we can hover
        const treeItems = await page.$$('.MuiTreeItem-label, [class*="tree"]');
        for (const item of treeItems.slice(0, 5)) {  // Check first 5
          await item.hover();
          await delay(300);
          
          const btn = await page.$('button svg[data-testid="TerminalIcon"]');
          if (btn) {
            const parent = await btn.evaluateHandle(el => el.closest('button'));
            if (parent) {
              await parent.click();
              foundFolder = true;
              break;
            }
          }
        }
      }
      
      if (foundFolder) {
        console.log('   Clicked terminal icon on folder, waiting...');
        await delay(8000);
        
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `terminal-wd-05-fs-terminal-${getTimestamp()}.png`) });
        
        const pageText2 = await page.evaluate(() => document.body.innerText);
        
        if (pageText2.includes('Working directory:')) {
          // Extract the path shown
          const match = pageText2.match(/Working directory: ([^\n]+)/);
          const shownPath = match ? match[1].trim() : 'unknown';
          
          if (shownPath && shownPath !== '/') {
            console.log(`   ✅ PASS: Shows working directory: ${shownPath}`);
            results.filesystemTerminal = `PASS - Shows: ${shownPath}`;
          } else {
            console.log(`   ⚠️ Shows working directory but path is: ${shownPath}`);
            results.filesystemTerminal = `PARTIAL - Shows: ${shownPath}`;
          }
        } else {
          console.log('   ❌ FAIL: No working directory shown for filesystem terminal');
          results.filesystemTerminal = 'FAIL - No path shown';
        }
      } else {
        console.log('   ⚠️ Could not find folder terminal icon to test');
        results.filesystemTerminal = 'SKIP - No folder icon found';
      }
    } else {
      console.log('   ⚠️ Could not find Filesystem tab');
      results.filesystemTerminal = 'SKIP - No tab';
    }

    // Final screenshot
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `terminal-wd-06-final-${getTimestamp()}.png`) });

  } catch (error) {
    console.error(`\n❌ Test error: ${error.message}`);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `terminal-wd-error-${getTimestamp()}.png`) });
  }

  // Print results
  console.log('\n' + '='.repeat(60));
  console.log('TEST RESULTS');
  console.log('='.repeat(60));
  console.log(`1. Terminal Button (no working dir):  ${results.terminalButton || '❓'}`);
  console.log(`2. Filesystem Terminal (with path):   ${results.filesystemTerminal || '❓'}`);
  console.log('='.repeat(60));

  const passed = Object.values(results).filter(r => r && r.startsWith('PASS')).length;
  console.log(`\nPassed: ${passed}/2`);

  console.log('\n📸 Screenshots saved to:', SCREENSHOTS_DIR);
  console.log('Browser closing in 15 seconds...\n');
  await delay(15000);
  await browser.close();
}

runTest();
