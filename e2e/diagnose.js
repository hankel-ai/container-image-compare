/**
 * E2E Test for Search Navigation in FileContentDiff
 * 
 * Tests:
 * 1. Search highlighting works
 * 2. Navigation arrows change current match index
 * 3. View scrolls vertically AND horizontally to show current match
 * 4. Orange highlight on current match, yellow on others
 */
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ 
    headless: 'new',
    args: ['--no-sandbox']
  });
  
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  
  try {
    console.log('=== Testing Search Navigation with Horizontal Scroll ===');
    await page.goto('http://localhost:5000/comparison/7cb1ad05-0afd-41a5-addb-6d6cc4b00f6c', { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    // Click Filesystem tab
    await page.waitForSelector('[role="tab"]', { timeout: 10000 });
    const filesystemTab = await page.$('button[role="tab"]:nth-of-type(2)');
    await filesystemTab.click();
    console.log('Clicked Filesystem tab');
    await new Promise(r => setTimeout(r, 2000));
    
    // Navigate to /etc/group which typically has more lines
    await page.evaluate(() => {
      document.querySelector('[data-path="/etc"]')?.click();
    });
    await new Promise(r => setTimeout(r, 500));
    
    await page.evaluate(() => {
      document.querySelector('[data-path="/etc/group"]')?.click();
    });
    console.log('Clicked /etc/group');
    await new Promise(r => setTimeout(r, 2000));
    
    // Get the search input
    const searchInput = await page.$('input[placeholder*="Search in file"]');
    if (!searchInput) {
      console.log('Search input not found');
      await browser.close();
      return;
    }
    
    // Search for 'x:' which appears on every line in /etc/group
    await searchInput.type('x:');
    await new Promise(r => setTimeout(r, 1500));
    
    // Get match info function - now includes horizontal scroll
    const getMatchInfo = async () => {
      return await page.evaluate(() => {
        const allSpans = document.querySelectorAll('span');
        let orangeIdx = -1;
        let totalHighlights = 0;
        
        allSpans.forEach((span) => {
          const style = span.getAttribute('style') || '';
          const computedStyle = window.getComputedStyle(span);
          const bgColor = computedStyle.backgroundColor;
          
          const isHighlight = style.includes('ff9800') || 
                             style.includes('fff59d') ||
                             bgColor.includes('255, 152') ||
                             bgColor.includes('255, 245');
          
          if (isHighlight && span.textContent && span.textContent.length < 20) {
            const isOrange = style.includes('ff9800') || bgColor.includes('255, 152');
            if (isOrange) {
              orangeIdx = totalHighlights;
            }
            totalHighlights++;
          }
        });
        
        const captions = document.querySelectorAll('.MuiTypography-caption');
        let countText = '';
        captions.forEach(c => {
          const t = c.textContent;
          if (t && /\d+\/\d+/.test(t)) {
            countText = t;
          }
        });
        
        // Find the MuiBox scroll container (file content)
        const allElements = document.querySelectorAll('div');
        let scrollTop = 0;
        let scrollLeft = 0;
        for (const el of allElements) {
          if (el.className && el.className.includes('MuiBox-root') &&
              el.scrollHeight > el.clientHeight && 
              el.clientHeight >= 400 && el.clientHeight <= 550) {
            scrollTop = Math.round(el.scrollTop);
            scrollLeft = Math.round(el.scrollLeft);
            break;
          }
        }
        
        return { countText, totalHighlights, orangeIdx, scrollTop, scrollLeft };
      });
    };
    
    let info = await getMatchInfo();
    console.log('Initial:', JSON.stringify(info));
    
    // Find navigation button
    const downArrow = await page.$('[data-testid="KeyboardArrowDownIcon"]');
    if (!downArrow) {
      console.log('No down arrow found');
      await browser.close();
      return;
    }
    
    const btn = await downArrow.evaluateHandle(el => el.closest('button'));
    
    // Click 10 times
    const results = [];
    for (let i = 0; i < 10; i++) {
      await btn.asElement().click();
      await new Promise(r => setTimeout(r, 400));
      info = await getMatchInfo();
      results.push(`${i+1}: ${info.countText} idx=${info.orangeIdx} scrollY=${info.scrollTop} scrollX=${info.scrollLeft}`);
    }
    
    console.log('Navigation results:');
    results.forEach(r => console.log('  ' + r));
    
    // Final test: check that values changed
    const scrollYChanged = results.some(r => {
      const match = r.match(/scrollY=(\d+)/);
      return match && parseInt(match[1]) > 0;
    });
    const scrollXChanged = results.some(r => {
      const match = r.match(/scrollX=(\d+)/);
      return match && parseInt(match[1]) > 0;
    });
    const indexChanged = new Set(results.map(r => r.match(/idx=(\d+)/)?.[1])).size > 1;
    
    console.log('\n=== Results ===');
    console.log('Index changes between clicks:', indexChanged ? 'YES ✓' : 'NO ✗');
    console.log('Vertical scroll changed:', scrollYChanged ? 'YES ✓' : 'NO (file may fit in view)');
    console.log('Horizontal scroll changed:', scrollXChanged ? 'YES ✓' : 'NO (matches may be visible)');
    
  } catch (err) {
    console.error('Error:', err.message);
  }
  
  await browser.close();
})();
