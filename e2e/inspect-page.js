const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:5000', { waitUntil: 'networkidle0' });
  
  // Get all buttons
  const buttons = await page.$$eval('button', els => els.map(e => ({ text: e.textContent?.trim(), type: e.type, class: e.className })));
  console.log('Buttons:', JSON.stringify(buttons, null, 2));
  
  // Get all inputs
  const inputs = await page.$$eval('input', els => els.map(e => ({ placeholder: e.placeholder, type: e.type, id: e.id })));
  console.log('Inputs:', JSON.stringify(inputs, null, 2));
  
  await browser.close();
})();
