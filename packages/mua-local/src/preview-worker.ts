/// <reference lib="webworker" />
/**
 * A Preview World's Web Worker (#243): a private, in-memory sqlite-wasm
 * World for authors, never saved. The UI posts `ToPreview` messages and
 * hears `FromPreview` ones, one reply to each, in order.
 */
// a macro: the World's files are read and inlined when the Worker is bundled
import { worldFiles } from '../scripts/files' with { type: 'macro' };
import { EDL_PATH } from './files';
import {
  openPreviewWorld,
  type FromPreview,
  type PreviewWorld,
  type ToPreview
} from './preview';

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
const files = worldFiles();

const send = (message: FromPreview) => scope.postMessage(message);

let preview: PreviewWorld | undefined;

const opened = (p: PreviewWorld) =>
  send({
    definitions: p.definitions(),
    edl: p.edl,
    entities: p.entities(),
    event: 'opened',
    origins: p.origins(),
    runs: p.runs()
  });

const loaded = () => {
  if (!preview) {
    throw new Error('No Preview World is open');
  }
  return preview;
};

const receive = async (message: ToPreview) => {
  switch (message.type) {
    case 'open': {
      // built before the old one goes, so EDL that won't build leaves the
      // preview as it was
      const next = await openPreviewWorld({
        database: { path: ':memory:', type: 'wasm' },
        files,
        source: message.source ?? { edl: files[EDL_PATH]! }
      });
      preview?.close();
      preview = next;
      opened(preview);
      break;
    }
    case 'command': {
      const p = loaded();
      const result = await p.command(message.text);
      send({
        ...result,
        entities: p.entities(),
        event: 'result',
        ref: message.ref
      });
      break;
    }
    case 'migrate': {
      const p = loaded();
      const migration = await p.migrate(message.edl);
      send({
        ...migration,
        definitions: p.definitions(),
        entities: p.entities(),
        event: 'migrated'
      });
      break;
    }
    case 'reset': {
      const p = loaded();
      await p.reset();
      opened(p);
      break;
    }
    case 'entity': {
      const p = loaded();
      send({
        components: p.entity(message.eid),
        eid: message.eid,
        event: 'entity'
      });
      break;
    }
  }
};

// Messages are handled one at a time, in the order they came
let queue: Promise<unknown> = Promise.resolve();
scope.addEventListener('message', (event: MessageEvent<ToPreview>) => {
  queue = queue
    .then(() => receive(event.data))
    .catch((error: unknown) =>
      send({
        event: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    );
});
