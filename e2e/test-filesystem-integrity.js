/**
 * Puppeteer debug script for filesystem integrity testing
 * Tests that all expected files and directories are present in the file tree
 */
const puppeteer = require('puppeteer');

const TARGET_IMAGE = process.argv[2] || 'artifactory.otxlab.net/docker-releases/dctm-records:23.4.12';
const TARGET_PATHS = [
  '/home',
  '/home/dmadmin',
  '/home/dmadmin/start.sh',
  '/home/dmadmin/documentum'
];

const BASE_URL = 'http://localhost:5000';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForElement(page, selector, timeout = 60000) {
  await page.waitForSelector(selector, { timeout });
  return page.$(selector);
}

async function getApiFileTree(imageRef) {
  // Use fetch to get the file tree directly from API
  const body = JSON.stringify({ leftImage: imageRef, rightImage: imageRef });
  const response = await fetch(`${BASE_URL}/api/comparison`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  return response.json();
}

async function findInFileTree(node, targetPath, depth = 0) {
  const currentPath = node.path || '/';
  
  // Normalize paths for comparison
  const normalizedTarget = targetPath.replace(/\/$/, '');
  const normalizedCurrent = currentPath.replace(/\/$/, '');
  
  if (normalizedCurrent === normalizedTarget) {
    return { found: true, node, depth };
  }
  
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      const result = await findInFileTree(child, targetPath, depth + 1);
      if (result.found) return result;
    }
  }
  
  return { found: false, depth };
}

async function listRootChildren(fileTree) {
  const root = fileTree.left || fileTree;
  if (root && root.children) {
    return root.children.map(c => ({
      name: c.name,
      path: c.path,
      type: c.type,
      childCount: c.children ? c.children.length : 0
    }));
  }
  return [];
}

async function runApiTest() {
  console.log('\n=== API Filesystem Integrity Test ===');
  console.log(`Target image: ${TARGET_IMAGE}`);
  console.log('');

  try {
    console.log('Fetching comparison data from API...');
    const response = await getApiFileTree(TARGET_IMAGE);
    
    if (!response || !response.fileTree) {
      console.error('ERROR: No fileTree in response');
      return false;
    }

    const fileTree = response.fileTree;
    console.log(`Single image mode: ${response.isSingleImageMode}`);
    
    // List root children
    console.log('\n--- Root Directory Contents ---');
    const rootChildren = await listRootChildren(fileTree);
    rootChildren.forEach(c => {
      console.log(`  ${c.name}/ (${c.childCount} children) - path: ${c.path}`);
    });

    // Check for duplicate entries (same name but different paths)
    const duplicates = {};
    rootChildren.forEach(c => {
      if (!duplicates[c.name]) duplicates[c.name] = [];
      duplicates[c.name].push(c.path);
    });
    
    const hasDuplicates = Object.entries(duplicates).some(([name, paths]) => paths.length > 1);
    if (hasDuplicates) {
      console.log('\n⚠️  WARNING: Duplicate entries detected!');
      Object.entries(duplicates).forEach(([name, paths]) => {
        if (paths.length > 1) {
          console.log(`  ${name}: ${paths.join(', ')}`);
        }
      });
    }

    // Check target paths
    console.log('\n--- Target Path Checks ---');
    let allPassed = true;
    
    for (const targetPath of TARGET_PATHS) {
      const tree = fileTree.left || fileTree.merged || fileTree;
      const result = await findInFileTree(tree, targetPath);
      
      if (result.found) {
        console.log(`  ✅ ${targetPath} - FOUND (depth: ${result.depth})`);
        if (result.node.children) {
          console.log(`      Children: ${result.node.children.length}`);
        }
      } else {
        console.log(`  ❌ ${targetPath} - NOT FOUND`);
        allPassed = false;
      }
    }

    console.log('\n--- Summary ---');
    if (allPassed && !hasDuplicates) {
      console.log('✅ All checks passed - filesystem integrity OK');
    } else {
      if (!allPassed) console.log('❌ Some target paths were not found');
      if (hasDuplicates) console.log('⚠️  Duplicate entries exist (path normalization issue)');
    }

    return allPassed && !hasDuplicates;
    
  } catch (err) {
    console.error('Error during API test:', err.message);
    return false;
  }
}

async function runBrowserTest() {
  console.log('\n=== Browser UI Filesystem Test ===');
  console.log(`Target image: ${TARGET_IMAGE}`);
  console.log('');

  const browser = await puppeteer.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    
    // Navigate to the app
    console.log('Loading application...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Enter the image in the left input
    console.log('Entering image reference...');
    const leftInput = await waitForElement(page, 'input[placeholder*="image"]', 10000);
    await leftInput.type(TARGET_IMAGE);
    
    // Find and click compare button
    const compareButton = await page.$('button:has-text("Compare")');
    if (compareButton) {
      await compareButton.click();
    } else {
      // Try finding button by text content
      await page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          if (btn.textContent.includes('Compare')) {
            btn.click();
            break;
          }
        }
      });
    }
    
    console.log('Waiting for image to load (this may take a while for large images)...');
    
    // Wait for loading to complete - look for file tree to appear
    await page.waitForFunction(() => {
      const treeItems = document.querySelectorAll('[role="treeitem"]');
      return treeItems.length > 0;
    }, { timeout: 600000 }); // 10 minute timeout for large images
    
    console.log('Image loaded, checking file tree...');
    
    // Get all tree items
    const treeItems = await page.evaluate(() => {
      const items = document.querySelectorAll('[role="treeitem"]');
      return Array.from(items).map(item => ({
        text: item.textContent,
        ariaLabel: item.getAttribute('aria-label')
      }));
    });
    
    console.log(`Found ${treeItems.length} tree items`);
    
    // Look for /home in tree items
    const homeItem = treeItems.find(item => 
      item.text?.includes('home') || item.ariaLabel?.includes('home')
    );
    
    if (homeItem) {
      console.log('✅ /home directory found in UI tree');
    } else {
      console.log('❌ /home directory NOT found in UI tree');
    }
    
    // Search for start.sh
    console.log('\nSearching for start.sh...');
    const searchInput = await page.$('input[placeholder*="Search"]');
    if (searchInput) {
      await searchInput.type('start.sh');
      await page.keyboard.press('Enter');
      await delay(2000);
      
      // Check for matches
      const matchCount = await page.evaluate(() => {
        const countElements = document.querySelectorAll('[class*="MuiChip"]');
        for (const el of countElements) {
          if (el.textContent.match(/\d+\/\d+/)) {
            return el.textContent;
          }
        }
        return null;
      });
      
      if (matchCount && !matchCount.startsWith('0/')) {
        console.log(`✅ start.sh found in search: ${matchCount}`);
      } else {
        console.log(`❌ start.sh not found in search (matches: ${matchCount || 'none'})`);
      }
    }
    
  } catch (err) {
    console.error('Browser test error:', err.message);
  } finally {
    await browser.close();
  }
}

// Main execution
(async () => {
  console.log('='.repeat(60));
  console.log('Filesystem Integrity Debug Script');
  console.log('='.repeat(60));
  
  // Run API test first (faster)
  const apiSuccess = await runApiTest();
  
  // Optionally run browser test
  if (process.argv.includes('--browser')) {
    await runBrowserTest();
  }
  
  process.exit(apiSuccess ? 0 : 1);
})();
