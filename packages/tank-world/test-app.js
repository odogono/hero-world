import { firefox } from 'playwright';

async function testApp() {
  const browser = await firefox.launch({ headless: false });
  const page = await browser.newPage();
  
  // Listen for console messages
  page.on('console', msg => {
    console.log(`[BROWSER ${msg.type().toUpperCase()}]:`, msg.text());
  });
  
  // Listen for page errors
  page.on('pageerror', error => {
    console.log(`[PAGE ERROR]:`, error.message);
  });
  
  // Listen for request failures
  page.on('requestfailed', request => {
    console.log(`[REQUEST FAILED]:`, request.url(), request.failure().errorText);
  });
  
  try {
    console.log('Navigating to http://localhost:5173...');
    await page.goto('http://localhost:5173');
    
    console.log('Waiting for page to load...');
    await page.waitForTimeout(3000);
    
    console.log('Taking screenshot...');
    await page.screenshot({ path: 'app-screenshot.png' });
    
    console.log('Page title:', await page.title());
    
    // Check if React app loaded
    const reactRoot = await page.$('#root');
    if (reactRoot) {
      console.log('✅ React root element found');
    } else {
      console.log('❌ React root element not found');
    }
    
    // Wait a bit more to see any async errors
    await page.waitForTimeout(2000);
    
  } catch (error) {
    console.error('Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

testApp();