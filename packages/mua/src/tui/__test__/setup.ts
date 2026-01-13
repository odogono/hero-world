/**
 * Test setup for TUI tests
 * Sets up happy-dom for DOM environment in tests
 */
import { Window } from 'happy-dom';

// Create a window instance
const window = new Window();
const document = window.document;

// Set up global DOM variables
(global as any).window = window;
(global as any).document = document;
(global as any).navigator = window.navigator;
(global as any).HTMLElement = window.HTMLElement;
(global as any).Element = window.Element;

// Add crypto.randomUUID if not available
if (!global.crypto || !global.crypto.randomUUID) {
  global.crypto = {
    ...global.crypto,
    randomUUID: () => {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }
  } as any;
}
