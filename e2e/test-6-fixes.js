/**
 * E2E Test for 6 Fixes:
 * 1. CLEAR ALL CACHE - removes all folders including subdirectories
 * 2. Shell uses only 'sh' (no bash fallback)
 * 3. Terminal persists across Metadata/Filesystem/History tabs
 * 4. Reconnect button works after typing 'exit'
 * 5. No cgroup warning when creating terminal
 * 6. Working directory only shows when initiated from Filesystem tab
 */

const puppeteer = require('puppeteer');

const BASE_URL = 'http://localhost:5000';
const TEST_IMAGE = 'alpine:latest';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper to find element by text content
async function findByText(page, tag, text) {
  const elements = await page.$$(tag);
  for (const el of elements) {
    const content = await el.evaluate(e => e.textContent);
    if (content && content.includes(text)) {
      return el;
    }
  }
  return null;
}

async function runTests() {
  console.log('🧪 Starting E2E tests for 6 fixes...\n');
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: false,  // Show browser for debugging
      defaultViewport: { width: 1400, height: 900 },
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  } catch (err) {
    console.error('Failed to launch browser:', err);
    process.exit(1);
  }

  const page = await browser.newPage();
  
  // Capture console logs
  const consoleLogs = [];
  page.on('console', msg => {
    consoleLogs.push({ type: msg.type(), text: msg.text() });
    if (msg.type() === 'error') {
      console.log('  [Browser Error]:', msg.text());
    }
  });

  const results = {
    clearCache: { status: '❓', details: '' },
    shellType: { status: '❓', details: '' },
    tabPersistence: { status: '❓', details: '' },
    reconnectButton: { status: '❓', details: '' },
    cgroupWarning: { status: '❓', details: '' },
    workingDirectory: { status: '❓', details: '' }
  };

  try {
    // Navigate to home page
    console.log('1️⃣ Navigating to app...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await delay(2000);

    // === TEST 1: CLEAR ALL CACHE ===
    console.log('\n2️⃣ Testing CLEAR ALL CACHE...');
    try {
      // First, pull an image to create cache
      const imageInput = await page.$('input');
      if (imageInput) {
        await imageInput.click({ clickCount: 3 });
        await imageInput.type(TEST_IMAGE);
        
        // Submit - find button with type=submit
        const buttons = await page.$$('button');
        for (const btn of buttons) {
          const type = await btn.evaluate(b => b.type);
          if (type === 'submit') {
            await btn.click();
            break;
          }
        }
        await delay(5000);
      }
      
      // Go to settings
      await page.goto(`${BASE_URL}/settings`, { waitUntil: 'networkidle0' });
      await delay(2000);
      
      // Click cache tab - find tab with "Cache" text
      const cacheTab = await findByText(page, 'button', 'Cache');
      if (cacheTab) {
        await cacheTab.click();
        await delay(1000);
      }
      
      // Find and click CLEAR ALL CACHE button
      const clearAllBtn = await findByText(page, 'button', 'Clear All');
      if (clearAllBtn) {
        await clearAllBtn.click();
        await delay(3000);
        
        // Check if cache is empty
        const pageContent = await page.content();
        if (pageContent.includes('0 entries') || pageContent.includes('No cache') || pageContent.includes('empty')) {
          results.clearCache.status = '✅';
          results.clearCache.details = 'Cache cleared successfully';
        } else {
          results.clearCache.status = '⚠️';
          results.clearCache.details = 'Cache may not be fully cleared - manual verification needed';
        }
      } else {
        results.clearCache.status = '⚠️';
        results.clearCache.details = 'Clear All button not found - cache may be empty';
      }
    } catch (err) {
      results.clearCache.status = '❌';
      results.clearCache.details = err.message;
    }

    // === TEST 2-6: Terminal tests ===
    console.log('\n3️⃣ Pulling image for terminal tests...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle0' });
    await delay(2000);
    
    // Enter image
    const imageInput2 = await page.$('input');
    if (imageInput2) {
      await imageInput2.click({ clickCount: 3 });
      await imageInput2.type(TEST_IMAGE);
      await delay(500);
    }
    
    // Submit comparison - find submit button
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const type = await btn.evaluate(b => b.type);
      if (type === 'submit') {
        await btn.click();
        break;
      }
    }
    console.log('  Waiting for image pull...');
    await delay(10000); // Wait for image pull
    
    // Check if we're on comparison page
    const currentUrl = page.url();
    if (!currentUrl.includes('/comparison/')) {
      console.log('  ⚠️ Not on comparison page, looking for recent comparison...');
      // Try history page
      await page.goto(`${BASE_URL}/history`, { waitUntil: 'networkidle0' });
      await delay(2000);
      
      const historyLink = await page.$('a[href*="/comparison/"]');
      if (historyLink) {
        await historyLink.click();
        await delay(3000);
      }
    }

    // Open terminal
    console.log('\n4️⃣ Opening terminal...');
    // Find Terminal button
    const terminalBtn = await findByText(page, 'button', 'Terminal');
    if (terminalBtn) {
      await terminalBtn.click();
      await delay(5000);
      
      // Wait for terminal to connect
      await page.waitForFunction(() => {
        const text = document.body.innerText;
        return text.includes('Connected');
      }, { timeout: 30000 }).catch(() => {});
      
      await delay(2000);
      
      // === TEST 2: Shell type (sh not bash) ===
      console.log('\n5️⃣ Testing shell type (should be sh, not bash)...');
      try {
        // The shell prompt in sh is usually $ - we can check the terminal output
        // Since we changed from bash to sh, bash prompt features like colored prompt won't appear
        const pageText = await page.evaluate(() => document.body.innerText);
        
        // If bash isn't mentioned in the connection message or prompt, it's using sh
        if (!pageText.includes('bash')) {
          results.shellType.status = '✅';
          results.shellType.details = 'Shell is sh (no bash detected in output)';
        } else {
          results.shellType.status = '⚠️';
          results.shellType.details = 'Bash may be running - check terminal manually';
        }
      } catch (err) {
        results.shellType.status = '❌';
        results.shellType.details = err.message;
      }
      
      // === TEST 6: Working directory should NOT show '/' ===
      console.log('\n6️⃣ Testing working directory display...');
      try {
        const terminalText = await page.evaluate(() => document.body.innerText);
        
        // When opened from Terminal button (not Filesystem), it should NOT show "Working directory: /"
        if (terminalText.includes('Working directory: /')) {
          results.workingDirectory.status = '❌';
          results.workingDirectory.details = 'Shows "/" even though not from Filesystem tab';
        } else if (terminalText.includes('Connected to container terminal')) {
          results.workingDirectory.status = '✅';
          results.workingDirectory.details = 'Working directory not shown for default path';
        } else {
          results.workingDirectory.status = '⚠️';
          results.workingDirectory.details = 'Could not verify - manual check needed';
        }
      } catch (err) {
        results.workingDirectory.status = '❌';
        results.workingDirectory.details = err.message;
      }
      
      // === TEST 5: Check for cgroup warning ===
      console.log('\n7️⃣ Checking for cgroup warning...');
      try {
        const cgroupWarnings = consoleLogs.filter(l => 
          l.text.toLowerCase().includes('cgroup') || 
          l.text.toLowerCase().includes('conmon')
        );
        
        if (cgroupWarnings.length === 0) {
          results.cgroupWarning.status = '✅';
          results.cgroupWarning.details = 'No cgroup warnings in browser console';
        } else {
          results.cgroupWarning.status = '❌';
          results.cgroupWarning.details = `Found ${cgroupWarnings.length} cgroup warnings`;
        }
      } catch (err) {
        results.cgroupWarning.status = '⚠️';
        results.cgroupWarning.details = 'Could not verify - ' + err.message;
      }
      
      // === TEST 3: Tab persistence ===
      console.log('\n8️⃣ Testing terminal persistence across tabs...');
      try {
        // Terminal is open - switch to Filesystem tab
        const tabs = await page.$$('[role="tab"]');
        if (tabs.length >= 2) {
          // Click Filesystem tab (index 1)
          await tabs[1].click();
          await delay(1000);
          
          // Click back to Metadata tab (index 0)
          await tabs[0].click();
          await delay(1000);
          
          // Check if terminal is still visible (Dialog should still be open)
          const terminalStillVisible = await page.evaluate(() => {
            return document.body.innerText.includes('Connected') || 
                   document.body.innerText.includes('container terminal');
          });
          
          if (terminalStillVisible) {
            results.tabPersistence.status = '✅';
            results.tabPersistence.details = 'Terminal persists across tab switches';
          } else {
            results.tabPersistence.status = '❌';
            results.tabPersistence.details = 'Terminal closed when switching tabs';
          }
        } else {
          results.tabPersistence.status = '⚠️';
          results.tabPersistence.details = 'Could not find tabs to test';
        }
      } catch (err) {
        results.tabPersistence.status = '❌';
        results.tabPersistence.details = err.message;
      }
      
      // === TEST 4: Reconnect after exit ===
      console.log('\n9️⃣ Testing reconnect after exit...');
      try {
        // Type 'exit' in terminal - need to click on xterm to focus it
        const xtermCanvas = await page.$('.xterm-screen, .xterm');
        if (xtermCanvas) {
          await xtermCanvas.click();
          await delay(500);
          await page.keyboard.type('exit');
          await page.keyboard.press('Enter');
          await delay(3000);
          
          // Check for disconnected state
          const disconnectedText = await page.evaluate(() => document.body.innerText);
          const isDisconnected = disconnectedText.includes('Disconnected') || 
                                 disconnectedText.includes('exited') ||
                                 disconnectedText.includes('Container exited');
          
          console.log('  Terminal exit status:', isDisconnected ? 'Disconnected' : 'Still connected');
          
          if (isDisconnected) {
            // Click reconnect button (Refresh icon)
            const refreshBtn = await page.$('[data-testid="RefreshIcon"]');
            let reconnectBtn = refreshBtn ? await refreshBtn.evaluateHandle(el => el.closest('button')) : null;
            
            if (!reconnectBtn) {
              // Try finding by aria-label
              reconnectBtn = await page.$('button[aria-label="Reconnect"]');
            }
            
            if (!reconnectBtn) {
              // Try finding any button with refresh/reconnect
              const allButtons = await page.$$('button');
              for (const btn of allButtons) {
                const inner = await btn.evaluate(b => b.innerHTML);
                if (inner.includes('Refresh') || inner.includes('refresh') || inner.includes('Reconnect')) {
                  reconnectBtn = btn;
                  break;
                }
              }
            }
            
            if (reconnectBtn) {
              await reconnectBtn.click();
              console.log('  Clicked reconnect button, waiting...');
              await delay(8000);
              
              // Check if reconnected
              const reconnectedText = await page.evaluate(() => document.body.innerText);
              if (reconnectedText.includes('Connected') && !reconnectedText.includes('Disconnected')) {
                results.reconnectButton.status = '✅';
                results.reconnectButton.details = 'Reconnect creates new session after exit';
              } else {
                results.reconnectButton.status = '❌';
                results.reconnectButton.details = 'Reconnect did not restore connection';
              }
            } else {
              results.reconnectButton.status = '⚠️';
              results.reconnectButton.details = 'Could not find reconnect button';
            }
          } else {
            results.reconnectButton.status = '⚠️';
            results.reconnectButton.details = 'Terminal did not disconnect after exit';
          }
        } else {
          results.reconnectButton.status = '⚠️';
          results.reconnectButton.details = 'Could not find terminal canvas';
        }
      } catch (err) {
        results.reconnectButton.status = '❌';
        results.reconnectButton.details = err.message;
      }
    } else {
      console.log('  ⚠️ Terminal button not found - runtime may not be available');
      results.shellType.details = 'Terminal button not found';
      results.tabPersistence.details = 'Terminal button not found';
      results.reconnectButton.details = 'Terminal button not found';
      results.cgroupWarning.details = 'Terminal button not found';
      results.workingDirectory.details = 'Terminal button not found';
    }

  } catch (err) {
    console.error('Test error:', err);
  }

  // Print results
  console.log('\n' + '='.repeat(60));
  console.log('TEST RESULTS');
  console.log('='.repeat(60));
  console.log(`1. Clear Cache:        ${results.clearCache.status} - ${results.clearCache.details}`);
  console.log(`2. Shell Type (sh):    ${results.shellType.status} - ${results.shellType.details}`);
  console.log(`3. Tab Persistence:    ${results.tabPersistence.status} - ${results.tabPersistence.details}`);
  console.log(`4. Reconnect Button:   ${results.reconnectButton.status} - ${results.reconnectButton.details}`);
  console.log(`5. cgroup Warning:     ${results.cgroupWarning.status} - ${results.cgroupWarning.details}`);
  console.log(`6. Working Directory:  ${results.workingDirectory.status} - ${results.workingDirectory.details}`);
  console.log('='.repeat(60));

  const passed = Object.values(results).filter(r => r.status === '✅').length;
  const total = Object.keys(results).length;
  console.log(`\nPassed: ${passed}/${total}`);

  console.log('\n⏸️ Browser staying open for manual verification...');
  console.log('Press Ctrl+C to close\n');

  // Keep browser open for manual verification
  await delay(60000 * 5); // 5 minutes

  await browser.close();
  process.exit(passed === total ? 0 : 1);
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
