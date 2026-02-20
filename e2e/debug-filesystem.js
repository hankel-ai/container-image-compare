const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto('http://localhost:5000');
  
  // Enter image
  const inputs = await page.$$('input[type="text"]');
  await inputs[0].type('alpine:latest');
  
  // Click Inspect
  const buttons = await page.$$('button');
  for (const btn of buttons) {
    const text = await btn.evaluate(el => el.textContent);
    if (text && text.includes('Inspect')) { await btn.click(); break; }
  }
  
  // Wait for load
  await new Promise(r => setTimeout(r, 10000));
  
  // Click Filesystem tab
  const tabs = await page.$$('[role="tab"]');
  for (const tab of tabs) {
    const text = await tab.evaluate(el => el.textContent);
    if (text && text.includes('Filesystem')) { await tab.click(); break; }
  }
  
  await new Promise(r => setTimeout(r, 3000));
  
  // Get page structure
  const structure = await page.evaluate(() => {
    // Find all elements with tree-related classes or roles
    const treeItems = document.querySelectorAll('[class*="Tree"], [role*="tree"], [class*="file"], [class*="folder"]');
    return Array.from(treeItems).map(el => ({
      tag: el.tagName,
      class: el.className,
      role: el.getAttribute('role'),
      text: el.textContent?.substring(0, 50)
    })).slice(0, 20);
  });
  console.log('Tree elements:', JSON.stringify(structure, null, 2));
  
  // Also get the main content area
  const mainContent = await page.evaluate(() => {
    const paper = document.querySelector('.MuiPaper-root');
    return paper ? paper.innerHTML.substring(0, 2000) : 'No paper found';
  });
  console.log('\nMain content preview:', mainContent.substring(0, 1000));
  
  await new Promise(r => setTimeout(r, 30000));
  await browser.close();
})();
