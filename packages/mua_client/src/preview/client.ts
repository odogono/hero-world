import type { FromPreview, PreviewSource, ToPreview } from 'mua-local';

type Reply<E extends FromPreview['event']> = Extract<FromPreview, { event: E }>;

/**
 * Talks to a Preview World's Worker (#243). Each message gets exactly one
 * reply, in order, so each request waits for the next reply to come back.
 */
export const openPreviewClient = (url = '/local/preview.js') => {
  const worker = new Worker(url, { type: 'module' });
  const waiting: ((reply: FromPreview) => void)[] = [];

  worker.addEventListener('message', ({ data }: MessageEvent<FromPreview>) =>
    waiting.shift()?.(data)
  );
  worker.addEventListener('error', event => {
    for (const fn of waiting.splice(0)) {
      fn({ event: 'error', message: event.message });
    }
  });

  const request = <E extends FromPreview['event']>(
    message: ToPreview,
    event: E
  ) =>
    new Promise<Reply<E>>((resolve, reject) => {
      waiting.push(reply =>
        reply.event === event
          ? resolve(reply as Reply<E>)
          : reject(
              new Error(
                reply.event === 'error'
                  ? reply.message
                  : `Unexpected ${reply.event}`
              )
            )
      );
      worker.postMessage(message);
    });

  let ref = 0;
  return {
    close: () => worker.terminate(),
    command: (text: string) =>
      request({ ref: ++ref, text, type: 'command' }, 'result'),
    entity: (eid: number) => request({ eid, type: 'entity' }, 'entity'),
    migrate: (edl: string) => request({ edl, type: 'migrate' }, 'migrated'),
    /** Builds a fresh Preview World, from the main World's EDL by default */
    open: (source?: PreviewSource) =>
      request({ source, type: 'open' }, 'opened'),
    reset: () => request({ type: 'reset' }, 'opened')
  };
};

export type PreviewClient = ReturnType<typeof openPreviewClient>;
