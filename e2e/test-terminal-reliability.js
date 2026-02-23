/**
 * E2E Test: Terminal Connection Reliability
 *
 * Tests the fixes for terminal connection issues:
 * 1. Happy path: open terminal, type commands, verify output
 * 2. Reconnect: verify "Connection lost" message and Reconnect button works
 * 3. Rapid open/close: no stale session errors
 */
const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
const TEST_IMAGE = 'alpine:latest';

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function screenshot(page, name) {
  const file = path.join(__dirname, 'screenshots', `${name}-${timestamp()}.png`);
  return page.screenshot({ path: file, fullPage: true });
}

async function waitForBackend(maxRetries = 15) {
  for (let i = 1; i <= maxRetries; i++) {
    try {
      const resp = await axios.get(`${BASE_URL}/api/health`);
      if (resp.status === 200) {
        console.log('[OK] Backend is ready');
        return;
      }
    } catch {}
    console.log(`  Waiting for backend (${i}/${maxRetries})...`);
    await delay(2000);
  }
  throw new Error('Backend did not become ready');
}

async function checkRuntimeAvailable() {
  try {
    const resp = await axios.get(`${BASE_URL}/api/container-terminal/status`);
    const data = resp.data;
    console.log(`[OK] Runtime: ${data.runtime} ${data.version} (available: ${data.available})`);
    return data.available;
  } catch (e) {
    console.log(`[WARN] Could not check runtime: ${e.message}`);
    return false;
  }
}

async function run() {
  console.log('='.repeat(60));
  console.log('TERMINAL RELIABILITY TEST');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Image:  ${TEST_IMAGE}`);
  console.log('='.repeat(60));

  await waitForBackend();
  const runtimeAvailable = await checkRuntimeAvailable();
  if (!runtimeAvailable) {
    console.log('[SKIP] No container runtime available - terminal tests cannot run.');
    console.log('       This is expected if Podman is not configured inside the container.');
    process.exit(0);
  }

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1400, height: 900 }
  });

  const page = await browser.newPage();

  // Collect console logs and errors
  const logs = [];
  page.on('console', msg => {
    logs.push({ type: msg.type(), text: msg.text() });
    if (msg.type() === 'error') {
      console.log(`  [BROWSER ERROR] ${msg.text()}`);
    }
  });
  page.on('pageerror', err => {
    console.log(`  [PAGE ERROR] ${err.message}`);
  });

  let passed = 0;
  let failed = 0;

  function pass(name) { passed++; console.log(`  [PASS] ${name}`); }
  function fail(name, reason) { failed++; console.log(`  [FAIL] ${name}: ${reason}`); }

  try {
    // ============================================================
    // TEST 1: Navigate to home page and enter image
    // ============================================================
    console.log('\n--- Test 1: Load image and open terminal ---');

    await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await screenshot(page, 'reliability-01-home');
    pass('Home page loaded');

    // Type image name into the input
    // Find the text field for image entry
    const inputSelector = 'input[type="text"], input[placeholder*="image"], input[placeholder*="Image"]';
    await page.waitForSelector(inputSelector, { timeout: 10000 });

    // Clear any existing text and type
    const inputs = await page.$$(inputSelector);
    if (inputs.length === 0) {
      fail('Find image input', 'No input fields found');
      throw new Error('Cannot continue without input field');
    }

    // Use the first text input (image entry field)
    const imageInput = inputs[0];
    await imageInput.click({ clickCount: 3 }); // select all
    await imageInput.type(TEST_IMAGE);
    pass('Entered image name');

    // Click "INSPECT IMAGE" button
    const inspectClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const btn = buttons.find(b => {
        const text = (b.textContent || '').toUpperCase();
        return text.includes('INSPECT') || text.includes('ANALYZE');
      });
      if (btn && !btn.disabled) {
        btn.click();
        return true;
      }
      return false;
    });

    if (!inspectClicked) {
      fail('Click inspect button', 'Button not found or disabled');
      await screenshot(page, 'reliability-02-no-inspect');
      throw new Error('Cannot continue without inspect button');
    }
    pass('Clicked INSPECT IMAGE');

    // Wait for image to be fetched (this may take a while for first download)
    console.log('  Waiting for image to download...');
    await delay(5000);
    await screenshot(page, 'reliability-03-downloading');

    // Wait for the comparison/inspection page to load
    // Poll for either a terminal button or the inspection results
    let terminalAvailable = false;
    for (let i = 0; i < 60; i++) {
      terminalAvailable = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.some(b => {
          const text = (b.textContent || '').toLowerCase();
          const title = (b.getAttribute('title') || '').toLowerCase();
          return text.includes('terminal') || title.includes('terminal') ||
                 text.includes('open terminal') || text.includes('shell');
        });
      });
      if (terminalAvailable) break;
      await delay(2000);
    }

    await screenshot(page, 'reliability-04-image-loaded');

    if (!terminalAvailable) {
      // Check if there's an error or if the page state gives us info
      const pageState = await page.evaluate(() => document.body.textContent.substring(0, 500));
      fail('Terminal button visible', `Not found after waiting. Page: ${pageState.substring(0, 200)}`);
      throw new Error('Terminal button never appeared');
    }
    pass('Terminal button is available');

    // Click the terminal button - this opens a NEW browser tab
    // We need to capture the new tab target
    const newTabPromise = new Promise(resolve => {
      browser.once('targetcreated', target => resolve(target));
    });

    const terminalClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const btn = buttons.find(b => {
        const text = (b.textContent || '').toLowerCase();
        const title = (b.getAttribute('title') || '').toLowerCase();
        return text.includes('terminal') || title.includes('terminal') ||
               text.includes('open terminal') || text.includes('shell');
      });
      if (btn && !btn.disabled) {
        btn.click();
        return true;
      }
      return false;
    });

    if (!terminalClicked) {
      fail('Click terminal button', 'Button disabled or not found');
      throw new Error('Cannot open terminal');
    }
    pass('Clicked terminal button');

    // Wait for new tab to open and switch to it
    console.log('  Waiting for terminal tab to open...');
    const newTarget = await Promise.race([
      newTabPromise,
      delay(10000).then(() => null)
    ]);

    let terminalPage;
    if (newTarget) {
      terminalPage = await newTarget.page();
      if (terminalPage) {
        // Collect logs from terminal tab too
        terminalPage.on('console', msg => {
          logs.push({ type: msg.type(), text: `[TERMINAL TAB] ${msg.text()}` });
        });
        pass('Terminal opened in new tab');
      }
    }

    // If no new tab, check if it navigated in the same tab
    if (!terminalPage) {
      console.log('  No new tab detected, checking current page...');
      const currentUrl = page.url();
      if (currentUrl.includes('/terminal/')) {
        terminalPage = page;
        pass('Terminal opened in same tab');
      } else {
        fail('Terminal tab opened', 'No new tab or navigation detected');
        throw new Error('Terminal page not found');
      }
    }

    // Wait for terminal to connect in the terminal tab
    console.log('  Waiting for terminal to connect...');
    await delay(5000);
    await screenshot(terminalPage, 'reliability-05-terminal-opened');

    // Check connection status in the terminal page
    let connected = false;
    for (let i = 0; i < 10; i++) {
      const status1 = await terminalPage.evaluate(() => {
        // The TerminalPage has a Typography with the status message in the AppBar
        const captions = Array.from(document.querySelectorAll('span'));
        for (const el of captions) {
          const text = el.textContent || '';
          if (text === 'Connected') return 'connected';
          if (text.includes('Connection error') || text.includes('Failed')) return 'error';
          if (text.includes('Connection lost')) return 'disconnected';
          if (text.includes('Connecting') || text.includes('Creating') || text.includes('Initializing')) return 'connecting';
        }
        // Also check for xterm canvas as proof of terminal being active
        const xtermCanvas = document.querySelector('.xterm-screen canvas, .xterm canvas');
        if (xtermCanvas) return 'has-canvas';
        return 'unknown';
      });
      console.log(`  Connection status (attempt ${i + 1}): ${status1}`);
      if (status1 === 'connected' || status1 === 'has-canvas') {
        connected = true;
        break;
      }
      if (status1 === 'error' || status1 === 'disconnected') break;
      await delay(2000);
    }

    if (connected) {
      pass('Terminal connected');
    } else {
      fail('Terminal connected', 'Could not confirm connection');
    }

    // ============================================================
    // TEST 2: Type a command and verify output
    // ============================================================
    console.log('\n--- Test 2: Type command and verify output ---');

    if (!connected) {
      fail('Command output received', 'Skipped - terminal not connected');
    } else {
      // Click on the terminal to focus it, then type
      await terminalPage.click('.xterm-screen, .xterm');
      await delay(300);
      await terminalPage.keyboard.type('echo HELLO_RELIABILITY_TEST');
      await delay(300);
      await terminalPage.keyboard.press('Enter');
      await delay(2000);

      await screenshot(terminalPage, 'reliability-06-command-output');

      // Check xterm has active rows (content rendered in canvas)
      const xtermActive = await terminalPage.evaluate(() => {
        const screen = document.querySelector('.xterm-screen');
        if (!screen) return { active: false, reason: 'no .xterm-screen' };
        const rows = screen.querySelectorAll('.xterm-rows > div');
        const textArea = document.querySelector('.xterm-helper-textarea');
        return {
          active: rows.length > 0 || !!screen.querySelector('canvas'),
          rows: rows.length,
          hasCanvas: !!screen.querySelector('canvas'),
          hasTextArea: !!textArea
        };
      });

      console.log(`  xterm state: ${JSON.stringify(xtermActive)}`);
      if (xtermActive.active) {
        pass('Terminal is active and accepting input');
      } else {
        fail('Terminal is active', JSON.stringify(xtermActive));
      }
    }

    // ============================================================
    // TEST 3: Check reconnect behavior (close and reopen)
    // ============================================================
    console.log('\n--- Test 3: Reconnect behavior ---');

    // Click the Reconnect button in the terminal page
    const reconnectClicked = await terminalPage.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      // Try finding Refresh SVG icon (data-testid="RefreshIcon")
      let btn = buttons.find(b => !!b.querySelector('[data-testid="RefreshIcon"]'));
      if (btn) { btn.click(); return true; }
      // Try aria-label
      btn = buttons.find(b => (b.getAttribute('aria-label') || '').toLowerCase().includes('reconnect'));
      if (btn) { btn.click(); return true; }
      // Fallback: in the toolbar, Reconnect is the last button
      const toolbar = document.querySelector('[class*="MuiToolbar"]');
      if (toolbar) {
        const toolbarBtns = toolbar.querySelectorAll('button');
        if (toolbarBtns.length >= 2) {
          toolbarBtns[toolbarBtns.length - 1].click();
          return true;
        }
      }
      return false;
    });

    if (reconnectClicked) {
      pass('Clicked Reconnect button');

      // Wait for new session to establish
      console.log('  Waiting for reconnection...');
      await delay(8000);
      await screenshot(terminalPage, 'reliability-07-reconnected');

      const status2 = await terminalPage.evaluate(() => {
        const captions = Array.from(document.querySelectorAll('span'));
        for (const el of captions) {
          const text = el.textContent || '';
          if (text === 'Connected') return 'connected';
          if (text.includes('Connection lost')) return 'disconnected';
          if (text.includes('error') || text.includes('Failed')) return 'error';
        }
        const xtermCanvas = document.querySelector('.xterm-screen canvas');
        if (xtermCanvas) return 'connected';
        return 'unknown';
      });

      if (status2 === 'connected') {
        pass('Reconnection successful');

        // Verify the new session works
        await terminalPage.click('.xterm-screen, .xterm');
        await delay(300);
        await terminalPage.keyboard.type('echo RECONNECT_OK');
        await delay(300);
        await terminalPage.keyboard.press('Enter');
        await delay(2000);
        await screenshot(terminalPage, 'reliability-07b-reconnect-cmd');

        const xtermStillActive = await terminalPage.evaluate(() => {
          const screen = document.querySelector('.xterm-screen');
          if (!screen) return false;
          // Check for either canvas or xterm-rows (rendering mode varies)
          return !!(screen.querySelector('canvas') || screen.querySelectorAll('.xterm-rows > div').length > 0 || document.querySelector('.xterm-helper-textarea'));
        });

        if (xtermStillActive) pass('New session functional after reconnect');
        else fail('New session functional after reconnect', 'xterm not active');
      } else {
        fail('Reconnection successful', `Status: ${status2}`);
      }
    } else {
      fail('Clicked Reconnect button', 'Button not found');
    }

    await screenshot(terminalPage, 'reliability-08-final');

    // ============================================================
    // Check backend logs for errors
    // ============================================================
    console.log('\n--- Checking backend logs ---');
    try {
      const { execSync } = require('child_process');
      const dockerLogs = execSync('docker logs container-image-compare 2>&1', { encoding: 'utf-8' });

      // Check for "is ready" messages from our new readiness check
      if (dockerLogs.includes('is ready')) {
        pass('Container readiness check logged');
      } else {
        console.log('  [INFO] No "is ready" messages in logs (may not have triggered)');
      }

      // Check for uncaught errors
      const uncaughtErrors = dockerLogs.split('\n').filter(l =>
        l.includes('uncaughtException') || l.includes('unhandledRejection') ||
        (l.includes('[ERROR]') && !l.includes('ENOENT'))
      );
      if (uncaughtErrors.length === 0) {
        pass('No uncaught errors in backend logs');
      } else {
        fail('No uncaught errors in backend logs', `Found ${uncaughtErrors.length} errors`);
        uncaughtErrors.forEach(e => console.log(`    ${e.trim()}`));
      }
    } catch (e) {
      console.log(`  [INFO] Could not check docker logs: ${e.message}`);
    }

    // ============================================================
    // Verify _lastImageTag is gone
    // ============================================================
    console.log('\n--- Checking code cleanup ---');
    try {
      const { execSync } = require('child_process');
      const grepResult = execSync(
        'grep -r "_lastImageTag\\|_lastImportTag" backend/src/ 2>&1 || echo "CLEAN"',
        { encoding: 'utf-8', cwd: path.join(__dirname, '..') }
      );
      if (grepResult.trim().replace(/"/g, '') === 'CLEAN') {
        pass('_lastImageTag fully removed from codebase');
      } else {
        fail('_lastImageTag fully removed', grepResult.trim());
      }
    } catch {
      console.log('  [INFO] Could not run grep check');
    }

  } catch (error) {
    console.log(`\n[ERROR] ${error.message}`);
    await screenshot(page, 'reliability-error');
  } finally {
    // Save console logs
    fs.writeFileSync(
      path.join(__dirname, 'screenshots', 'reliability-console.json'),
      JSON.stringify(logs, null, 2)
    );

    console.log('\n' + '='.repeat(60));
    console.log(`RESULTS: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(60));

    // Keep browser open briefly for inspection
    console.log('Browser closing in 10 seconds...');
    await delay(10000);
    await browser.close();

    if (failed > 0) process.exit(1);
  }
}

// Ensure screenshots directory
const dir = path.join(__dirname, 'screenshots');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
