/**
 * Request and reply between the page and a Worker (#310), for the Workers
 * that answer one reply to each request: the preview and the mirror. A
 * Local World's Worker speaks the Channel's messages instead (ADR 0013).
 *
 * The Worker handles one request at a time, in the order they came. Every
 * request settles: with its reply, with the error its handler threw, or
 * with an error when the Worker dies or the page closes it. Nothing times
 * out, so a handler that never settles still leaves its request waiting.
 */

/** A request: its `type` names it in the map of replies */
export type Request<Replies> = { type: keyof Replies & string };

/** What a request of type `T` is answered with */
export type ReplyTo<Replies, T extends Request<Replies>> = Replies[T['type']];

type Envelope<Q> = { id: number; request: Q };

type Answer =
  | { id: number; ok: true; reply: unknown }
  | { id: number; message: string; ok: false };

/** Where `serve` hears requests and posts replies: a Worker's own scope */
export type ServeScope = {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent) => void
  ): void;
  postMessage(message: unknown): void;
};

/** What `connect` talks to: a Worker */
export type WorkerLike = {
  addEventListener(type: string, listener: (event: Event) => void): void;
  postMessage(message: unknown): void;
  terminate(): void;
};

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Answers each request with what `handle` returns, or with the error it
 * throws, one request at a time
 */
export const serve = <Q extends Request<Replies>, Replies>(
  scope: ServeScope,
  handle: (request: Q) => Replies[Q['type']] | Promise<Replies[Q['type']]>
) => {
  let queue: Promise<void> = Promise.resolve();
  scope.addEventListener('message', (event: MessageEvent<Envelope<Q>>) => {
    const { id, request } = event.data;
    queue = queue.then(async () => {
      try {
        const reply = await handle(request);
        scope.postMessage({ id, ok: true, reply } satisfies Answer);
      } catch (error) {
        // a reply that can't be posted becomes an error too
        scope.postMessage({
          id,
          message: messageOf(error),
          ok: false
        } satisfies Answer);
      }
    });
  });
};

export type Endpoint<Q extends Request<Replies>, Replies> = {
  /** Terminates the Worker; whatever is still waiting rejects */
  close: () => void;
  /** Whether the Worker died or was closed: every request now rejects */
  closed: () => boolean;
  request: <T extends Q>(request: T) => Promise<ReplyTo<Replies, T>>;
};

/**
 * Sends requests to a Worker that `serve`s them. An `error` or
 * `messageerror` from the Worker ends it as `close` does; it is never
 * started again.
 */
export const connect = <Q extends Request<Replies>, Replies>(
  worker: WorkerLike
): Endpoint<Q, Replies> => {
  const waiting = new Map<
    number,
    { reject: (error: Error) => void; resolve: (reply: never) => void }
  >();
  let next = 0;
  let ended: Error | undefined;

  const end = (error: Error) => {
    if (ended) {
      return;
    }
    ended = error;
    worker.terminate();
    for (const { reject } of waiting.values()) {
      reject(error);
    }
    waiting.clear();
  };

  worker.addEventListener('message', event => {
    const answer = (event as MessageEvent<Answer>).data;
    const request = waiting.get(answer.id);
    if (!request) {
      return;
    }
    waiting.delete(answer.id);
    if (answer.ok) {
      request.resolve(answer.reply as never);
    } else {
      request.reject(new Error(answer.message));
    }
  });
  worker.addEventListener('error', event => {
    const { message } = event as Partial<ErrorEvent>;
    end(new Error(message || 'the Worker stopped'));
  });
  // a reply that can't be read can't be matched to its request either
  worker.addEventListener('messageerror', () =>
    end(new Error("a reply from the Worker couldn't be read"))
  );

  return {
    close: () => end(new Error('the Worker was closed')),
    closed: () => ended !== undefined,
    request: <T extends Q>(request: T) =>
      new Promise<ReplyTo<Replies, T>>((resolve, reject) => {
        if (ended) {
          reject(ended);
          return;
        }
        const id = ++next;
        waiting.set(id, { reject, resolve });
        worker.postMessage({ id, request } satisfies Envelope<T>);
      })
  };
};
