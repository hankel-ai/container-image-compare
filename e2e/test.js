const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

(async () => {
  try {
    // Backend must be running on localhost:5000 and frontend on localhost:3000 (dev) or 4173 (preview)
    const backend = process.env.BACKEND_URL || 'http://localhost:5000';
    const frontend = process.env.FRONTEND_URL || 'http://localhost:5000';

    console.log(`Using backend: ${backend}`);
    console.log(`Using frontend: ${frontend}`);

    // Fetch latest history with retries in case the backend is still starting
    const maxRetries = 10;
    const retryDelayMs = 1000;
    let hist;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        hist = await axios.get(`${backend}/api/history`);
        break;
      } catch (e) {
        if (attempt === maxRetries) throw e;
        console.log(`Backend not ready yet (attempt ${attempt}/${maxRetries}), retrying in ${retryDelayMs}ms...`);
        await new Promise(r => setTimeout(r, retryDelayMs));
      }
    }
    if (!Array.isArray(hist.data) || hist.data.length === 0) {
      console.error('No history items found. Create a comparison first.');
      process.exit(1);
    }

    const latest = hist.data[0];
    console.log('Latest comparison id:', latest.id);

    // Try frontend URLs (dev and preview) to be resilient to different dev setups
    const frontendCandidates = [frontend, 'http://localhost:4173'];
    let url;
    let lastError;
    for (const candidate of frontendCandidates) {
      try {
        url = `${candidate.replace(/\/$/, '')}/comparison/${latest.id}`;
        console.log('Opening URL:', url);
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        // navigate and wait for network idle
        const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        if (!resp || resp.status() >= 400) {
          lastError = new Error(`Navigation to ${url} returned status ${resp ? resp.status() : 'no response'}`);
          await browser.close();
          continue;
        }

        const consoleMessages = [];
        page.on('console', msg => {
          consoleMessages.push({ type: msg.type(), text: msg.text() });
        });

    // Wait for Filesystem tab to render - wait for the search input rendered by FilesystemView
        try {
          // Click the Filesystem tab to mount the FilesystemView (tab index 1)
          await page.evaluate(() => {
            const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
            const fsTab = tabs.find(t => /filesystem/i.test(t.textContent || ''));
            if (fsTab && typeof fsTab.click === 'function') fsTab.click();
          });
          await page.waitForSelector('input[placeholder*="Search files"]', { timeout: 30000 });
        } catch (waitErr) {
          // Save debug artifacts to help diagnose why selector was missing
          const debugDir = __dirname;
          const debugHtml = path.resolve(debugDir, 'page.html');
          const debugScreenshot = path.resolve(debugDir, 'comparison.png');
          const debugLog = path.resolve(debugDir, 'console.log.json');
          try { await fs.promises.writeFile(debugHtml, await page.content()); } catch (e) {}
          try { await page.screenshot({ path: debugScreenshot, fullPage: true }); } catch (e) {}
          try { fs.writeFileSync(debugLog, JSON.stringify(consoleMessages, null, 2)); } catch (e) {}
          await browser.close();
          throw new Error(`Timed out waiting for filesystem UI. Saved debug artifacts: ${debugHtml}, ${debugScreenshot}, ${debugLog}`);
        }

        // Capture screenshot
        const screenshotPath = path.resolve(__dirname, 'comparison.png');
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log('Screenshot saved to', screenshotPath);

        // Save console logs
        const logPath = path.resolve(__dirname, 'console.log.json');
        fs.writeFileSync(logPath, JSON.stringify(consoleMessages, null, 2));
        console.log('Console logs saved to', logPath);

        await browser.close();
        console.log('E2E test completed successfully');
        return;
      } catch (err) {
        lastError = err;
        console.error(`Attempt failed for frontend candidate ${candidate}:`, err.message || err);
        // try next candidate
      }
    }

    throw lastError || new Error('Failed to open frontend for testing');
  } catch (err) {
    console.error('E2E test failed:', err);
    process.exit(1);
  }
})();
