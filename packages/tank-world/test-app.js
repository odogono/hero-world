import { firefox } from 'playwright';

async function testApp() {
  const browser = await firefox.launch({
    headless: false,
    slowMo: 100 // Slow down operations for better visibility
  });
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
    console.log(
      `[REQUEST FAILED]:`,
      request.url(),
      request.failure().errorText
    );
  });

  // Listen for response events to monitor API calls
  page.on('response', response => {
    if (response.status() >= 400) {
      console.log(`[HTTP ERROR ${response.status()}]:`, response.url());
    }
  });

  try {
    console.log('🚀 Starting browser debugging session...');
    console.log('Navigating to http://localhost:5173...');
    await page.goto('http://localhost:5173');

    console.log('⏳ Waiting for page to load...');
    await page.waitForTimeout(3000);

    // Get performance metrics
    const metrics = await page.evaluate(() => {
      const perfData = performance.getEntriesByType('navigation')[0];
      return {
        domContentLoaded:
          perfData.domContentLoadedEventEnd -
          perfData.domContentLoadedEventStart,
        loadComplete: perfData.loadEventEnd - perfData.loadEventStart,
        domInteractive: perfData.domInteractive,
        pageLoad: perfData.loadEventEnd - perfData.fetchStart
      };
    });

    console.log('📊 Performance Metrics:', metrics);

    // Check for React DevTools
    const hasReactDevTools = await page.evaluate(() => {
      return window.__REACT_DEVTOOLS_GLOBAL_HOOK__ !== undefined;
    });
    console.log('🔧 React DevTools available:', hasReactDevTools);

    // Inspect the DOM structure
    const domInfo = await page.evaluate(() => {
      const root = document.getElementById('root');
      if (!root) return { error: 'Root element not found' };

      return {
        rootChildren: root.children.length,
        hasReactRoot: root.querySelector('[data-reactroot]') !== null,
        bodyChildren: document.body.children.length,
        scripts: document.querySelectorAll('script').length,
        styles: document.querySelectorAll('link[rel="stylesheet"]').length
      };
    });

    console.log('🏗️ DOM Structure:', domInfo);

    // Check for SQLite-related elements or data
    const sqliteInfo = await page.evaluate(() => {
      // Look for any SQLite-related data in the global scope
      const sqliteGlobals = Object.keys(window).filter(
        key =>
          key.toLowerCase().includes('sqlite') ||
          key.toLowerCase().includes('db') ||
          key.toLowerCase().includes('database')
      );

      return {
        sqliteGlobals,
        localStorageKeys: Object.keys(localStorage),
        sessionStorageKeys: Object.keys(sessionStorage)
      };
    });

    console.log('🗄️ SQLite/Database Info:', sqliteInfo);

    console.log('📸 Taking screenshot...');
    await page.screenshot({ path: 'app-screenshot.png' });

    console.log('📄 Page title:', await page.title());

    // Check if React app loaded
    const reactRoot = await page.$('#root');
    if (reactRoot) {
      console.log('✅ React root element found');

      // Get React component tree info
      const reactInfo = await page.evaluate(() => {
        const root = document.getElementById('root');
        if (!root) return null;

        // Try to get React fiber information
        const reactInstance =
          root._reactInternalInstance || root._reactInternalFiber;
        return {
          hasReactInstance: !!reactInstance,
          rootType: reactInstance?.type?.name || 'Unknown',
          childrenCount: root.children.length
        };
      });

      console.log('⚛️ React Info:', reactInfo);
    } else {
      console.log('❌ React root element not found');
    }

    // Check for any errors in the console
    const consoleErrors = await page.evaluate(() => {
      return window.consoleErrors || [];
    });

    if (consoleErrors.length > 0) {
      console.log('⚠️ Console errors captured:', consoleErrors);
    }

    // Wait a bit more to see any async errors
    console.log('⏳ Waiting for async operations...');
    await page.waitForTimeout(2000);

    console.log('✅ Browser debugging session completed successfully!');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
  } finally {
    console.log('🔒 Closing browser...');
    await browser.close();
  }
}

testApp();
