/**
 * Test script to verify the terminal fix
 * Tests that the terminal shows a shell prompt after connecting
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
const APP_URL = 'http://localhost:5000';

// Test image - use a small one for faster testing
const TEST_IMAGE = 'alpine:latest';

function getTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testTerminalFix() {
  // Ensure screenshots directory exists
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  console.log('🚀 Starting terminal fix test...\n');

  const browser = await puppeteer.launch({
    headless: false,  // Watch the test
    defaultViewport: { width: 1920, height: 1080 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Capture console logs
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    
    // Show all ContainerTerminal logs
    if (text.includes('ContainerTerminal') || text.includes('xterm') || text.includes('dimension')) {
      console.log(`📝 BROWSER: ${text}`);
    } else if (type === 'error') {
      console.log(`❌ PAGE ERROR: ${text}`);
    } else if (type === 'warn') {
      console.log(`⚠️  PAGE WARN: ${text}`);
    }
  });

  page.on('pageerror', err => {
    console.log(`❌ PAGE EXCEPTION: ${err.message}`);
  });

  try {
    // Step 1: Navigate to app
    console.log('1️⃣  Navigating to app...');
    await page.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `terminal-test-01-home-${getTimestamp()}.png`) });
    console.log('   ✅ App loaded\n');

    // Step 2: Enter a test image for comparison (we just need one side)
    console.log('2️⃣  Entering test image...');
    
    // Find the first image input field
    const imageInputs = await page.$$('input[type="text"]');
    if (imageInputs.length < 1) {
      throw new Error('Could not find image input fields');
    }
    
    await imageInputs[0].click({ clickCount: 3 }); // Select all
    await imageInputs[0].type(TEST_IMAGE);
    console.log(`   Entered: ${TEST_IMAGE}\n`);

    // Step 3: Click Inspect Image button
    console.log('3️⃣  Starting image inspection...');
    
    // Find Inspect Image button by text content
    const buttons = await page.$$('button');
    let inspectClicked = false;
    for (const btn of buttons) {
      const text = await btn.evaluate(el => el.textContent);
      if (text && text.includes('Inspect')) {
        // Check if button is disabled
        const isDisabled = await btn.evaluate(el => el.disabled || el.classList.contains('Mui-disabled'));
        if (isDisabled) {
          console.log('   Button is disabled, waiting for image to be entered...');
          await delay(1000);
        }
        await btn.click();
        inspectClicked = true;
        break;
      }
    }
    
    if (!inspectClicked) {
      throw new Error('Could not find Inspect Image button');
    }

    // Wait for comparison to complete (loading indicator disappears)
    console.log('   Waiting for image download...');
    await delay(5000); // Initial wait
    
    // Wait for any loading spinners to disappear
    try {
      await page.waitForFunction(() => {
        const spinners = document.querySelectorAll('[role="progressbar"], .MuiCircularProgress-root');
        return spinners.length === 0;
      }, { timeout: 120000 }); // 2 min timeout for large images
    } catch (e) {
      console.log('   ⚠️  Timeout waiting for loading - continuing anyway');
    }

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `terminal-test-02-comparison-${getTimestamp()}.png`) });
    console.log('   ✅ Comparison complete\n');

    // Step 4: Click Filesystem tab (Terminal icon is on folder hover)
    console.log('4️⃣  Clicking Filesystem tab...');
    
    const tabs = await page.$$('[role="tab"]');
    for (const tab of tabs) {
      const text = await tab.evaluate(el => el.textContent);
      if (text && text.toLowerCase().includes('filesystem')) {
        await tab.click();
        console.log('   Clicked Filesystem tab');
        break;
      }
    }
    
    await delay(2000);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `terminal-test-03-filesystem-${getTimestamp()}.png`) });

    // Step 5: Find a folder and hover to show terminal icon
    console.log('5️⃣  Looking for folder with terminal icon...');
    
    // Wait for tree to load - FileTree uses data-path attribute
    await page.waitForSelector('[data-path]', { timeout: 15000 });
    await delay(1000);
    
    // Look for folder items in the file tree (they have data-path attributes)
    const folderItems = await page.$$('[data-path]');
    console.log(`   Found ${folderItems.length} tree items with data-path`);
    
    if (folderItems.length === 0) {
      throw new Error('No tree items found in filesystem view');
    }
    
    // Filter to find directory items (they have folder icons)
    // Pick the second one (first might be the root special case)
    const targetItem = folderItems.length > 1 ? folderItems[1] : folderItems[0];
    const itemPath = await targetItem.evaluate(el => el.getAttribute('data-path'));
    console.log(`   Hovering over item: ${itemPath}`);
    
    await targetItem.hover();
    await delay(1000);
    
    // Take screenshot while hovering
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `terminal-test-hover-${getTimestamp()}.png`) });
    
    // Look for terminal button that appears on hover
    // It has class 'terminal-btn' which becomes visible on hover
    let terminalBtnClicked = false;
    
    // Find button with Terminal icon within the hovered item or nearby
    const terminalBtns = await page.$$('[class*="terminal-btn"], button:has(svg[data-testid="TerminalIcon"])');
    console.log(`   Found ${terminalBtns.length} potential terminal buttons`);
    
    for (const btn of terminalBtns) {
      const isVisible = await btn.evaluate(el => {
        const style = window.getComputedStyle(el);
        return style.visibility !== 'hidden' && style.display !== 'none';
      });
      if (isVisible) {
        console.log('   Found visible terminal button, clicking...');
        await btn.click();
        terminalBtnClicked = true;
        break;
      }
    }
    
    if (!terminalBtnClicked) {
      // Try clicking the Terminal icon directly using evaluate
      const clicked = await page.evaluate(() => {
        const terminalIcons = document.querySelectorAll('svg[data-testid="TerminalIcon"]');
        for (const icon of terminalIcons) {
          const btn = icon.closest('button');
          if (btn) {
            btn.click();
            return true;
          }
        }
        return false;
      });
      
      if (clicked) {
        console.log('   Clicked terminal icon via evaluate');
        terminalBtnClicked = true;
      }
    }
    
    if (!terminalBtnClicked) {
      console.log('   ⚠️  Could not find terminal button - terminal might not be available');
      // Check if runtimeInfo shows available
      const runtimeStatus = await page.evaluate(() => {
        // @ts-ignore
        return window.__CONTAINER_TERMINAL_STATUS__ || 'unknown';
      });
      console.log(`   Runtime status: ${runtimeStatus}`);
    }
    
    await delay(2000);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `terminal-test-04-terminal-opening-${getTimestamp()}.png`) });

    // Step 6: Wait for terminal dialog to appear and xterm to initialize
    console.log('6️⃣  Waiting for terminal dialog...');
    
    // Wait longer for the dialog and terminal to appear
    await delay(3000);
    
    // First wait for MUI Dialog to open
    await page.waitForSelector('.MuiDialog-root, [role="dialog"]', { timeout: 10000 });
    console.log('   ✅ Dialog opened');
    
    // Wait for xterm terminal element inside the dialog
    const terminalSelectors = ['[data-testid="terminal-container"]', '.xterm-screen', '.xterm', '.xterm-helper-textarea', '[data-testid="container-terminal"]'];
    let terminalFound = false;
    
    for (const selector of terminalSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        console.log(`   ✅ Terminal element found with selector: ${selector}`);
        terminalFound = true;
        break;
      } catch {
        console.log(`   - Selector ${selector} not found`);
      }
    }
    
    if (!terminalFound) {
      // Check dialog content for debugging
      const dialogContent = await page.evaluate(() => {
        const dialog = document.querySelector('.MuiDialog-root, [role="dialog"]');
        return dialog ? dialog.innerHTML : 'No dialog found';
      });
      console.log('   Dialog content preview:', dialogContent.substring(0, 2000));
      
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `terminal-test-debug-dialog-${getTimestamp()}.png`) });
      
      // Wait a bit more and try again
      console.log('   Waiting 5 more seconds for xterm to initialize...');
      await delay(5000);
      
      for (const selector of terminalSelectors) {
        const found = await page.$(selector);
        if (found) {
          console.log(`   ✅ Found ${selector} after additional wait`);
          terminalFound = true;
          break;
        }
      }
      
      if (!terminalFound) {
        throw new Error('Terminal element not found in dialog');
      }
    }

    // Wait a bit for connection
    await delay(5000);
    
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `terminal-test-04-terminal-connected-${getTimestamp()}.png`) });

    // Debug: dump terminal container contents
    const containerContents = await page.evaluate(() => {
      const containers = document.querySelectorAll('[data-testid="terminal-container"]');
      console.log('[TEST] Found', containers.length, 'terminal-container elements');
      
      const results = [];
      containers.forEach((container, i) => {
        results.push({
          index: i,
          innerHTML: container.innerHTML.substring(0, 500),
          childCount: container.children.length,
          classList: Array.from(container.classList || []),
          dimensions: container.getBoundingClientRect(),
          hasXterm: container.querySelector('.xterm') !== null
        });
      });
      return results;
    });
    console.log('   Terminal container debug:', JSON.stringify(containerContents, null, 2));

    // Step 6: Check for shell prompt in terminal
    console.log('6️⃣  Checking for shell prompt...');
    
    // Get terminal content
    const terminalContent = await page.evaluate(() => {
      const terminalEl = document.querySelector('.xterm-screen');
      if (!terminalEl) return '';
      return terminalEl.textContent || '';
    });

    console.log(`   Terminal content (first 500 chars):\n   "${terminalContent.substring(0, 500).replace(/\n/g, '\\n')}"\n`);

    // Check for common shell prompt indicators
    const hasPrompt = terminalContent.includes('#') || 
                      terminalContent.includes('$') || 
                      terminalContent.includes('~') ||
                      terminalContent.includes('/ #') ||
                      terminalContent.includes('bash') ||
                      terminalContent.includes('sh-');

    const hasConnectedMessage = terminalContent.toLowerCase().includes('connected');

    // Step 7: Try typing a command
    console.log('7️⃣  Attempting to type a command...');
    
    // Focus the terminal
    await page.click('.xterm-screen, .xterm');
    await delay(500);
    
    // Type a simple command
    await page.keyboard.type('echo "TERMINAL_TEST_SUCCESS"');
    await page.keyboard.press('Enter');
    
    await delay(2000);
    
    // Get updated content
    const terminalContentAfter = await page.evaluate(() => {
      const terminalEl = document.querySelector('.xterm-screen');
      if (!terminalEl) return '';
      return terminalEl.textContent || '';
    });

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `terminal-test-05-after-command-${getTimestamp()}.png`) });

    const commandWorked = terminalContentAfter.includes('TERMINAL_TEST_SUCCESS');

    // Step 8: Report results
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST RESULTS');
    console.log('='.repeat(60));
    console.log(`   Connected message: ${hasConnectedMessage ? '✅ YES' : '❌ NO'}`);
    console.log(`   Shell prompt visible: ${hasPrompt ? '✅ YES' : '❌ NO'}`);
    console.log(`   Command executed: ${commandWorked ? '✅ YES' : '❌ NO'}`);
    console.log('='.repeat(60));

    if (hasPrompt && commandWorked) {
      console.log('\n✅ TERMINAL FIX VERIFIED - Shell prompt is working!\n');
    } else if (hasConnectedMessage && !hasPrompt) {
      console.log('\n❌ TERMINAL STILL BROKEN - Shows "Connected" but no prompt\n');
      console.log('   This is the bug we were trying to fix.\n');
    } else {
      console.log('\n⚠️  INCONCLUSIVE - Check screenshots for details\n');
    }

    console.log(`📸 Screenshots saved to: ${SCREENSHOTS_DIR}\n`);

    // Keep browser open for manual inspection
    console.log('Browser will close in 10 seconds...');
    await delay(10000);

  } catch (error) {
    console.error(`\n❌ TEST FAILED: ${error.message}\n`);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `terminal-test-error-${getTimestamp()}.png`) });
  } finally {
    await browser.close();
  }
}

testTerminalFix().catch(console.error);
