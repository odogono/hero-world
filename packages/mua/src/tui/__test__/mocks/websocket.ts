/**
 * Mock WebSocket for testing
 * Simulates WebSocket behavior for unit tests
 */
type Listener = (data: unknown) => void;

export type MockWebSocketConstructor = typeof WebSocket & {
  clearInstances: () => void;
  getLastInstance: () => MockWebSocket | undefined;
  instances: MockWebSocket[];
};

export class MockWebSocket {
  url: string;
  readyState: number = 0; // CONNECTING
  listeners: Map<string, Listener[]> = new Map();
  sentMessages: string[] = [];

  // WebSocket ready states
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  constructor(url: string) {
    this.url = url;
  }

  /**
   * Add event listener
   */
  addEventListener(event: string, handler: Listener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }

  /**
   * Remove event listener
   */
  removeEventListener(event: string, handler: Listener) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Send data (captures sent messages for testing)
   */
  send(data: string) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    this.sentMessages.push(data);
  }

  /**
   * Close connection
   */
  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.trigger('close', new Event('close'));
  }

  /**
   * Trigger an event (for testing)
   */
  trigger(event: string, data: unknown) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach(h => h(data));
    }
  }

  /**
   * Simulate receiving a message
   */
  simulateMessage(data: unknown) {
    const event = new MessageEvent('message', {
      data: JSON.stringify(data)
    });
    this.trigger('message', event);
  }

  /**
   * Simulate connection opening
   */
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.trigger('open', new Event('open'));
  }

  /**
   * Simulate connection error
   */
  simulateError(error?: unknown) {
    this.trigger('error', error || new Event('error'));
  }

  /**
   * Simulate connection close
   */
  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.trigger('close', new Event('close'));
  }

  /**
   * Get all sent messages
   */
  getSentMessages(): string[] {
    return [...this.sentMessages];
  }

  /**
   * Clear sent messages
   */
  clearSentMessages() {
    this.sentMessages = [];
  }
}

/**
 * Create a mock WebSocket constructor for global replacement
 */
export const createMockWebSocketConstructor = (): MockWebSocketConstructor => {
  const instances: MockWebSocket[] = [];

  const MockWSConstructor = class extends MockWebSocket {
    constructor(url: string) {
      super(url);
      instances.push(this);
    }

    static instances = instances;

    static clearInstances() {
      instances.length = 0;
    }

    static getLastInstance(): MockWebSocket | undefined {
      return instances.at(-1);
    }
  };

  return MockWSConstructor as unknown as MockWebSocketConstructor;
};
