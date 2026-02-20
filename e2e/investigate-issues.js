const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');

// Ensure screenshots directory exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

function getTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function investigateIssues() {
  console.log('Starting FIXED verification...');
  
  const browser = await puppeteer.launch({ 
    headless: true,
    defaultViewport: { width: 1280, height: 900 }  // Smaller viewport to check for scroll
  });
  
  const page = await browser.newPage();
  
  // Capture console messages
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  
  try {
    // Wait for app to be ready
    console.log('Waiting for app to be ready...');
    await page.goto('http://localhost:5000', { waitUntil: 'networkidle0', timeout: 30000 });
    
    // Go to Settings and click on Cache tab
    console.log('\n=== Issue 1: Cache Explorer Horizontal Scrollbar ===');
    await page.goto('http://localhost:5000/settings', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 1000));
    
    // Click on Cache tab
    const tabs = await page.$$('[role="tab"]');
    if (tabs.length >= 2) {
      await tabs[1].click();  // Click "Cache" tab
      await new Promise(r => setTimeout(r, 1000));
    }
    
    // Take after screenshot
    const timestamp = getTimestamp();
    const cacheScreenshot = `cache-explorer-fixed-${timestamp}.png`;
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, cacheScreenshot),
      fullPage: true 
    });
    console.log(`Screenshot saved: ${cacheScreenshot}`);
    
    // Check for horizontal scrollbar on the Cache Explorer table
    const scrollInfo = await page.evaluate(() => {
      const results = [];
      
      // Find the table container inside Cache Explorer
      const tableContainers = document.querySelectorAll('.MuiTableContainer-root');
      tableContainers.forEach((container, idx) => {
        results.push({
          element: `TableContainer ${idx + 1}`,
          scrollWidth: container.scrollWidth,
          clientWidth: container.clientWidth,
          hasHorizontalScroll: container.scrollWidth > container.clientWidth
        });
      });
      
      // Check body
      results.push({
        element: 'body',
        scrollWidth: document.body.scrollWidth,
        clientWidth: document.body.clientWidth,
        windowWidth: window.innerWidth,
        hasHorizontalScroll: document.body.scrollWidth > window.innerWidth
      });
      
      return results;
    });
    
    console.log('Scroll analysis:', JSON.stringify(scrollInfo, null, 2));
    
    // Issue 2: Check Settings for registry credential duplicate
    console.log('\n=== Issue 2: Registry Credential Duplicate ===');
    
    // Go back to Main tab
    const mainTab = await page.$('[role="tab"]:first-child');
    if (mainTab) {
      await mainTab.click();
      await new Promise(r => setTimeout(r, 1000));
    }
    
    const settingsScreenshot = `settings-after-${timestamp}.png`;
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, settingsScreenshot),
      fullPage: true 
    });
    console.log(`Screenshot saved: ${settingsScreenshot}`);
    
    // List current credentials
    const credentialItems = await page.$$('.MuiList-root .MuiListItem-root');
    console.log(`Found ${credentialItems.length} credential entries`);
    
    console.log('\nInvestigation complete. Check screenshots folder for visual evidence.');
    
  } catch (error) {
    console.error('Error during investigation:', error.message);
  }
  
  await browser.close();
}

investigateIssues();
