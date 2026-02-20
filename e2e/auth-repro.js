const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

(async () => {
  try {
    const backend = process.env.BACKEND_URL || 'http://localhost:5000';
    const frontend = process.env.FRONTEND_URL || 'http://localhost:3000';
    console.log('Backend:', backend);
    console.log('Frontend:', frontend);

    // Images chosen to trigger auth on the right side (based on recent logs)
    const left = 'artifactory.otxlab.net/docker-releases/dctm-records:23.4.11';
    const right = 'registry.opentext.com/dctm-records:23.4.13';

    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    const consoleMessages = [];
    page.on('console', msg => consoleMessages.push({ type: msg.type(), text: msg.text() }));

    await page.goto(frontend, { waitUntil: 'networkidle2', timeout: 30000 });

    // Fill the first two visible text inputs with the images
    await page.evaluate((L, R) => {
      const inputs = Array.from(document.querySelectorAll('input'))
        .filter(i => !i.closest('form') || i.type === 'text' || i.type === 'search');
      if (inputs.length >= 2) {
        inputs[0].value = L;
        inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        inputs[1].value = R;
        inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, left, right);

    // Click the Compare Images button
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => /Compare Images/i.test(b.textContent || ''));
      if (btn) btn.click();
    });

    // Wait for either the auth dialog or a navigation to comparison page
    const dialogPromise = page.waitForFunction(() => {
      const h = Array.from(document.querySelectorAll('h2,h3,h4')).find(x => /Registry Authentication Required/i.test(x.textContent || ''));
      const dialog = document.querySelector('div[role="dialog"]');
      return !!h || !!dialog;
    }, { timeout: 30000 }).catch(() => null);

    const navPromise = page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => null);

    const res = await Promise.race([dialogPromise, navPromise]);

    // Save artifacts
    const outDir = __dirname;
    const screenshot = path.resolve(outDir, 'auth-repro.png');
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
    const htmlPath = path.resolve(outDir, 'auth-repro.html');
    fs.writeFileSync(htmlPath, await page.content());
    const logPath = path.resolve(outDir, 'auth-repro.console.json');
    fs.writeFileSync(logPath, JSON.stringify(consoleMessages, null, 2));

    console.log('Saved:', screenshot, htmlPath, logPath);

    // Also fetch backend logs (tail) if backend is available
    try {
      const h = await axios.get(`${backend}/api/history`);
      fs.writeFileSync(path.resolve(outDir, 'auth-repro.history.json'), JSON.stringify(h.data, null, 2));
    } catch (e) {
      // ignore
    }

    await browser.close();
    console.log('Auth repro completed');
  } catch (err) {
    console.error('Auth repro failed:', err);
    process.exit(1);
  }
})();
