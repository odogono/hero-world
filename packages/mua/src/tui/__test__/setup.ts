/**
 * Test setup for TUI tests
 * Sets up happy-dom for DOM environment in tests
 */
import { Window } from 'happy-dom';

// Create a window instance
const window = new Window();
const document = window.document;

// Set up global DOM variables
Object.assign(global, {
  document,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  navigator: window.navigator,
  window
});

// Add crypto.randomUUID if not available
if (!global.crypto || !global.crypto.randomUUID) {
  global.crypto = {
    ...global.crypto,
    randomUUID: () =>
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replaceAll(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      })
  } as Crypto;
}
