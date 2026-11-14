// Request and reply between the page and a Worker (#310), over a
// MessageChannel standing in for the Worker.
import { describe, expect, test } from 'bun:test';

import { connect, serve, type WorkerLike } from '../endpoint';

type Replies = { echo: string; fail: never; wait: number };
type Ask =
  | { text: string; type: 'echo' }
  | { type: 'fail' }
  | { ms: number; type: 'wait' };

/** A Worker on one end of a channel, serving on the other */
const fakeWorker = (
  handle: (request: Ask) => Replies[Ask['type']] | Promise<Replies[Ask['type']]>
) => {
  const { port1: page, port2: inside } = new MessageChannel();
  serve<Ask, Replies>(inside, handle);
  inside.start();

  const events = new EventTarget();
  page.addEventListener('message', event =>
    events.dispatchEvent(new MessageEvent('message', { data: event.data }))
  );
  page.start();
  let terminated = false;
  const worker: WorkerLike & { terminated: () => boolean } = {
    addEventListener: (type, listener) =>
      events.addEventListener(type, listener),
    postMessage: message => page.postMessage(message),
    terminate: () => {
      terminated = true;
      page.close();
      inside.close();
    },
    terminated: () => terminated
  };
  return { events, worker };
};

const handler = async (request: Ask) => {
  switch (request.type) {
    case 'echo':
      return request.text;
    case 'fail':
      throw new Error('no such thing');
    case 'wait':
      await Bun.sleep(request.ms);
      return request.ms;
  }
};

describe('endpoint', () => {
  test('answers requests in the order they were sent', async () => {
    const { worker } = fakeWorker(handler);
    const endpoint = connect<Ask, Replies>(worker);
    const order: unknown[] = [];
    const replies = await Promise.all([
      endpoint.request({ ms: 30, type: 'wait' }).then(r => order.push(r) && r),
      endpoint
        .request({ text: 'hi', type: 'echo' })
        .then(r => order.push(r) && r)
    ]);
    expect(replies).toEqual([30, 'hi']);
    // the slow one was handled first, though the quick one could have won
    expect(order).toEqual([30, 'hi']);
    endpoint.close();
  });

  test('a handler that throws answers with its error, and the next still runs', async () => {
    const { worker } = fakeWorker(handler);
    const endpoint = connect<Ask, Replies>(worker);
    const failed = endpoint.request({ type: 'fail' });
    const next = endpoint.request({ text: 'after', type: 'echo' });
    await expect(failed).rejects.toThrow('no such thing');
    expect(await next).toBe('after');
    expect(endpoint.closed()).toBe(false);
    endpoint.close();
  });

  test('a Worker that dies rejects what is waiting, and every request after', async () => {
    const { events, worker } = fakeWorker(handler);
    const endpoint = connect<Ask, Replies>(worker);
    const waiting = endpoint.request({ ms: 1000, type: 'wait' });
    events.dispatchEvent(
      Object.assign(new Event('error'), { message: 'the script failed' })
    );
    await expect(waiting).rejects.toThrow('the script failed');
    expect(endpoint.closed()).toBe(true);
    expect(worker.terminated()).toBe(true);
    await expect(
      endpoint.request({ text: 'hi', type: 'echo' })
    ).rejects.toThrow('the script failed');
  });

  test('a reply that cannot be read ends the Worker', async () => {
    const { events, worker } = fakeWorker(handler);
    const endpoint = connect<Ask, Replies>(worker);
    const waiting = endpoint.request({ ms: 1000, type: 'wait' });
    events.dispatchEvent(new Event('messageerror'));
    await expect(waiting).rejects.toThrow("couldn't be read");
    expect(endpoint.closed()).toBe(true);
  });

  test('closing rejects what is waiting', async () => {
    const { worker } = fakeWorker(handler);
    const endpoint = connect<Ask, Replies>(worker);
    const waiting = endpoint.request({ ms: 1000, type: 'wait' });
    endpoint.close();
    await expect(waiting).rejects.toThrow('closed');
    await expect(
      endpoint.request({ text: 'hi', type: 'echo' })
    ).rejects.toThrow('closed');
  });
});
