/**
 * Simplified E2E Test for 6 Fixes
 */

const puppeteer = require('puppeteer');

const BASE_URL = 'http://localhost:5000';
const TEST_IMAGE = 'alpine:latest';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('🧪 Starting E2E tests...\n');
  
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  // Capture errors
  page.on('pageerror', err => console.log('Page error:', err.message));
  page.on('error', err => console.log('Error:', err.message));
  
  const consoleLogs = [];
  page.on('console', msg => {
    consoleLogs.push(msg.text());
    if (msg.type() === 'error') {
      console.log('  [Console Error]:', msg.text().substring(0, 100));
    }
  });

  const results = {};

  try {
    // Step 1: Navigate to app
    console.log('1️⃣ Navigating to app...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await delay(2000);
    console.log('  ✅ App loaded');

    // Step 2: Submit an image to create comparison
    console.log('\n2️⃣ Submitting image...');
    await page.type('input', TEST_IMAGE);
    await delay(500);
    
    // Click submit button
    await page.evaluate(() => {
      const btn = document.querySelector('button[type="submit"]');
      if (btn) btn.click();
    });
    
    console.log('  Waiting for comparison to complete...');
    await delay(15000); // Wait for image pull and comparison
    
    // Navigate to comparison page if not already there
    const url = page.url();
    console.log('  Current URL:', url);
    
    if (!url.includes('/comparison/')) {
      console.log('  Navigating to history to find comparison...');
      await page.goto(`${BASE_URL}/history`, { waitUntil: 'networkidle0' });
      await delay(2000);
      
      const link = await page.$('a[href*="/comparison/"]');
      if (link) {
        await link.click();
        await delay(3000);
      }
    }
    
    console.log('  ✅ On comparison page:', page.url());

    // Step 3: Open terminal
    console.log('\n3️⃣ Opening terminal...');
    const buttons = await page.$$('button');
    let terminalBtn = null;
    for (const btn of buttons) {
      const text = await btn.evaluate(b => b.textContent);
      if (text && text.includes('Terminal')) {
        terminalBtn = btn;
        break;
      }
    }
    
    if (terminalBtn) {
      await terminalBtn.click();
      console.log('  Waiting for terminal to connect...');
      await delay(8000);
      
      // Check terminal state
      const pageText = await page.evaluate(() => document.body.innerText);
      
      // TEST 6: Working directory - should NOT show "/" when opened from Terminal button
      console.log('\n📋 TEST 6: Working directory display...');
      if (pageText.includes('Working directory: /')) {
        results.workingDir = '❌ Shows "/" even when not from Filesystem';
      } else if (pageText.includes('Connected to container terminal')) {
        results.workingDir = '✅ Working dir not shown (correct)';
      } else {
        results.workingDir = '⚠️ Could not verify';
      }
      console.log('  Result:', results.workingDir);
      
      // TEST 2: Shell type - should not mention bash
      console.log('\n📋 TEST 2: Shell type...');
      if (pageText.toLowerCase().includes('bash')) {
        results.shellType = '❌ Bash detected';
      } else {
        results.shellType = '✅ sh shell (no bash)';
      }
      console.log('  Result:', results.shellType);
      
      // TEST 5: cgroup warning
      console.log('\n📋 TEST 5: cgroup warning...');
      const cgroupFound = consoleLogs.some(l => l.toLowerCase().includes('cgroup'));
      results.cgroupWarning = cgroupFound ? '❌ cgroup warning found' : '✅ No cgroup warnings';
      console.log('  Result:', results.cgroupWarning);
      
      // TEST 3: Tab persistence
      console.log('\n📋 TEST 3: Tab persistence...');
      const tabs = await page.$$('[role="tab"]');
      if (tabs.length >= 2) {
        await tabs[1].click(); // Filesystem tab
        await delay(1000);
        await tabs[0].click(); // Back to Metadata
        await delay(1000);
        
        const stillConnected = await page.evaluate(() => document.body.innerText.includes('Connected'));
        results.tabPersistence = stillConnected ? '✅ Terminal persists across tabs' : '❌ Terminal closed';
      } else {
        results.tabPersistence = '⚠️ Could not find tabs';
      }
      console.log('  Result:', results.tabPersistence);
      
      // TEST 4: Reconnect after exit
      console.log('\n📋 TEST 4: Reconnect after exit...');
      const xterm = await page.$('.xterm-screen, .xterm');
      if (xterm) {
        await xterm.click();
        await delay(500);
        await page.keyboard.type('exit');
        await page.keyboard.press('Enter');
        await delay(3000);
        
        // Find and click reconnect button
        const allBtns = await page.$$('button');
        for (const btn of allBtns) {
          const html = await btn.evaluate(b => b.innerHTML);
          if (html.includes('Refresh') || html.includes('Reconnect')) {
            await btn.click();
            console.log('  Clicked reconnect...');
            break;
          }
        }
        await delay(8000);
        
        const reconnected = await page.evaluate(() => {
          const text = document.body.innerText;
          return text.includes('Connected') && !text.includes('Disconnected');
        });
        results.reconnect = reconnected ? '✅ Reconnect works' : '❌ Reconnect failed';
      } else {
        results.reconnect = '⚠️ Could not find terminal';
      }
      console.log('  Result:', results.reconnect);
    } else {
      console.log('  ⚠️ Terminal button not found');
      results.workingDir = '⚠️ No terminal button';
      results.shellType = '⚠️ No terminal button';
      results.cgroupWarning = '⚠️ No terminal button';
      results.tabPersistence = '⚠️ No terminal button';
      results.reconnect = '⚠️ No terminal button';
    }

    // TEST 1: Clear cache
    console.log('\n📋 TEST 1: Clear cache...');
    await page.goto(`${BASE_URL}/settings`, { waitUntil: 'networkidle0' });
    await delay(2000);
    
    // Click Cache tab
    const settingsTabs = await page.$$('button');
    for (const tab of settingsTabs) {
      const text = await tab.evaluate(t => t.textContent);
      if (text && text.includes('Cache')) {
        await tab.click();
        await delay(1000);
        break;
      }
    }
    
    // Click Clear All
    const clearBtns = await page.$$('button');
    for (const btn of clearBtns) {
      const text = await btn.evaluate(b => b.textContent);
      if (text && (text.includes('Clear All') || text.includes('CLEAR ALL'))) {
        await btn.click();
        await delay(3000);
        break;
      }
    }
    
    // Check if cleared
    const cacheContent = await page.evaluate(() => document.body.innerText);
    if (cacheContent.includes('0 entries') || cacheContent.includes('No cached') || cacheContent.includes('empty')) {
      results.clearCache = '✅ Cache cleared';
    } else {
      results.clearCache = '⚠️ Could not verify cache cleared';
    }
    console.log('  Result:', results.clearCache);

  } catch (err) {
    console.error('Test error:', err);
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('RESULTS SUMMARY');
  console.log('='.repeat(60));
  console.log('1. Clear Cache:', results.clearCache || '❓');
  console.log('2. Shell Type:', results.shellType || '❓');
  console.log('3. Tab Persistence:', results.tabPersistence || '❓');
  console.log('4. Reconnect:', results.reconnect || '❓');
  console.log('5. cgroup Warning:', results.cgroupWarning || '❓');
  console.log('6. Working Dir:', results.workingDir || '❓');
  console.log('='.repeat(60));

  const passed = Object.values(results).filter(r => r && r.startsWith('✅')).length;
  console.log(`\nPassed: ${passed}/6`);
  
  console.log('\n⏸️ Browser staying open for 5 minutes for manual verification...');
  console.log('Press Ctrl+C to close\n');
  
  await delay(300000);
  await browser.close();
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
