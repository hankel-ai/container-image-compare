/**
 * E2E Test for Terminal Feature
 * 
 * Tests the interactive container terminal with a real image
 */
const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TEST_IMAGE = 'artifactory.otxlab.net/docker-releases/dctm-tomcat:23.4.0';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5000';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForBackend(maxRetries = 30) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await axios.get(`${BACKEND_URL}/api/health`);
      console.log('✓ Backend is ready');
      return true;
    } catch (e) {
      console.log(`Backend not ready (attempt ${attempt}/${maxRetries}), retrying...`);
      await delay(1000);
    }
  }
  throw new Error('Backend did not become ready');
}

async function waitForFrontend(maxRetries = 30) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await axios.get(`${FRONTEND_URL}/`);
      console.log('✓ Frontend is ready');
      return true;
    } catch (e) {
      console.log(`Frontend not ready (attempt ${attempt}/${maxRetries}), retrying...`);
      await delay(1000);
    }
  }
  throw new Error('Frontend did not become ready');
}

async function findOrCreateComparison() {
  // Check if we have a comparison with this image already
  const histResp = await axios.get(`${BACKEND_URL}/api/history`);
  const history = histResp.data;
  
  if (history.length === 0) {
    throw new Error('No comparisons found in history. Please create one first.');
  }
  
  // Look for existing comparison with our test image
  const existing = history.find(h => 
    h.leftImage?.includes('dctm-tomcat') || h.rightImage?.includes('dctm-tomcat')
  );
  
  if (existing) {
    console.log(`✓ Found dctm-tomcat comparison: ${existing.id}`);
    console.log(`  Left: ${existing.leftImage}`);
    console.log(`  Right: ${existing.rightImage}`);
    return existing.id;
  }
  
  // Use first comparison
  console.log(`✓ Using first comparison: ${history[0].id}`);
  console.log(`  Left: ${history[0].leftImage}`);
  console.log(`  Right: ${history[0].rightImage}`);
  return history[0].id;
}

async function testTerminal() {
  console.log('='.repeat(60));
  console.log('TERMINAL E2E TEST');
  console.log('='.repeat(60));
  console.log(`Backend: ${BACKEND_URL}`);
  console.log(`Frontend: ${FRONTEND_URL}`);
  console.log(`Test Image: ${TEST_IMAGE}`);
  console.log('='.repeat(60));
  
  // Wait for backend
  await waitForBackend();
  
  // Wait for frontend
  await waitForFrontend();
  
  // Find or create comparison
  const comparisonId = await findOrCreateComparison();
  
  // Launch browser
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: false, // Show browser for debugging
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1400, height: 900 }
  });
  
  const page = await browser.newPage();
  
  // Collect console messages
  const consoleMessages = [];
  page.on('console', msg => {
    const text = msg.text();
    consoleMessages.push({ type: msg.type(), text });
    if (msg.type() === 'error') {
      console.log(`[BROWSER ERROR] ${text}`);
    }
  });
  
  // Collect network errors
  page.on('requestfailed', request => {
    console.log(`[REQUEST FAILED] ${request.url()}: ${request.failure()?.errorText}`);
  });
  
  try {
    // Navigate to comparison page
    const url = `${FRONTEND_URL}/comparison/${comparisonId}`;
    console.log(`Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // Take screenshot of initial page
    await page.screenshot({ path: path.join(__dirname, 'screenshots', 'terminal-test-01-initial.png'), fullPage: true });
    console.log('✓ Page loaded');
    
    // Wait for page to fully render
    await delay(2000);
    
    // Find Terminal button - look for button with terminal icon or text
    console.log('Looking for Terminal button...');
    
    // First, let's see what's on the page
    const pageContent = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.map(b => ({
        text: b.textContent?.trim(),
        ariaLabel: b.getAttribute('aria-label'),
        title: b.getAttribute('title'),
        classes: b.className
      }));
    });
    console.log('Buttons found:', JSON.stringify(pageContent, null, 2));
    
    // Try to find and click Terminal button
    const terminalButtonClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      // Look for button with Terminal text or terminal-related attributes
      const terminalBtn = buttons.find(b => {
        const text = (b.textContent || '').toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const title = (b.getAttribute('title') || '').toLowerCase();
        return text.includes('terminal') || aria.includes('terminal') || title.includes('terminal');
      });
      
      if (terminalBtn) {
        terminalBtn.click();
        return true;
      }
      return false;
    });
    
    if (!terminalButtonClicked) {
      // Try looking for an icon button (MUI IconButton)
      const iconButtonClicked = await page.evaluate(() => {
        // Look for SVG icons that might be terminal icons
        const svgButtons = Array.from(document.querySelectorAll('button svg, [role="button"] svg'));
        console.log('Found SVG buttons:', svgButtons.length);
        
        // Just click the first button that looks like it could be terminal
        const allButtons = Array.from(document.querySelectorAll('button'));
        for (const btn of allButtons) {
          const svg = btn.querySelector('svg');
          if (svg) {
            // Check if it has terminal-like path data
            const paths = svg.querySelectorAll('path');
            for (const p of paths) {
              const d = p.getAttribute('d') || '';
              // Terminal icons often have specific patterns
              if (d.includes('M20') || d.includes('M2')) {
                btn.click();
                return 'clicked icon button';
              }
            }
          }
        }
        return false;
      });
      
      console.log('Icon button result:', iconButtonClicked);
    }
    
    console.log(`Terminal button clicked: ${terminalButtonClicked}`);
    
    // Wait for terminal dialog to appear
    await delay(2000);
    await page.screenshot({ path: path.join(__dirname, 'screenshots', 'terminal-test-02-after-click.png'), fullPage: true });
    
    // Look for terminal dialog or terminal element
    const terminalState = await page.evaluate(() => {
      // Check for dialog
      const dialogs = document.querySelectorAll('[role="dialog"], .MuiDialog-root');
      // Check for xterm container
      const xterm = document.querySelector('.xterm, .xterm-screen, [class*="terminal"]');
      // Check for "Connected" text
      const connected = document.body.textContent?.includes('Connected');
      
      return {
        dialogCount: dialogs.length,
        hasXterm: !!xterm,
        hasConnected: connected,
        bodyText: document.body.textContent?.substring(0, 500)
      };
    });
    
    console.log('Terminal state:', JSON.stringify(terminalState, null, 2));
    
    // If terminal opened, try typing a command
    if (terminalState.hasXterm || terminalState.dialogCount > 0) {
      console.log('Terminal appears to be open, trying to type...');
      await delay(1000);
      
      // Type 'ls' and press Enter
      await page.keyboard.type('ls -la');
      await delay(500);
      await page.keyboard.press('Enter');
      
      // Wait for output
      await delay(2000);
      
      await page.screenshot({ path: path.join(__dirname, 'screenshots', 'terminal-test-03-after-command.png'), fullPage: true });
      
      // Check for output
      const terminalOutput = await page.evaluate(() => {
        const xterm = document.querySelector('.xterm-screen');
        return xterm ? xterm.textContent : 'No xterm found';
      });
      
      console.log('Terminal output:', terminalOutput?.substring(0, 500));
    }
    
    // Save console logs
    fs.writeFileSync(
      path.join(__dirname, 'screenshots', 'terminal-test-console.json'),
      JSON.stringify(consoleMessages, null, 2)
    );
    
    console.log('\n' + '='.repeat(60));
    console.log('TEST COMPLETE - Check screenshots folder');
    console.log('='.repeat(60));
    
    // Keep browser open for manual inspection
    console.log('\nBrowser will stay open for 30 seconds for inspection...');
    await delay(30000);
    
  } catch (error) {
    console.error('TEST FAILED:', error.message);
    await page.screenshot({ path: path.join(__dirname, 'screenshots', 'terminal-test-error.png'), fullPage: true });
    throw error;
  } finally {
    await browser.close();
  }
}

// Ensure screenshots directory exists
const screenshotsDir = path.join(__dirname, 'screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

testTerminal().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
