/// <reference lib="webworker" />
/**
 * A Preview World's Web Worker (#243): a private, in-memory sqlite-wasm
 * World for authors, never saved. The UI sends it `ToPreview` requests and
 * hears a reply to each (`endpoint.ts`).
 */
// a macro: the World's files are read and inlined when the Worker is bundled
import { worldFiles } from '../scripts/files' with { type: 'macro' };
import { serve } from './endpoint';
import { EDL_PATH } from './files';
import {
  openPreviewWorld,
  type PreviewOpened,
  type PreviewReplies,
  type PreviewWorld,
  type ToPreview
} from './preview';

const files = worldFiles();

let preview: PreviewWorld | undefined;

const opened = (p: PreviewWorld): PreviewOpened => ({
  definitions: p.definitions(),
  edl: p.edl,
  entities: p.entities(),
  origins: p.origins(),
  runs: p.runs()
});

const loaded = () => {
  if (!preview) {
    throw new Error('No Preview World is open');
  }
  return preview;
};

const handle = async (
  request: ToPreview
): Promise<PreviewReplies[ToPreview['type']]> => {
  switch (request.type) {
    case 'open': {
      // built before the old one goes, so EDL that won't build leaves the
      // preview as it was
      const next = await openPreviewWorld({
        database: { path: ':memory:', type: 'wasm' },
        files,
        source: request.source ?? { edl: files[EDL_PATH]! }
      });
      preview?.close();
      preview = next;
      return opened(preview);
    }
    case 'command': {
      const p = loaded();
      const result = await p.command(request.text);
      return { ...result, entities: p.entities() };
    }
    case 'migrate': {
      const p = loaded();
      const migration = await p.migrate(request.edl);
      return {
        ...migration,
        definitions: p.definitions(),
        entities: p.entities()
      };
    }
    case 'reset': {
      const p = loaded();
      await p.reset();
      return opened(p);
    }
    case 'entity': {
      const p = loaded();
      return { components: p.entity(request.eid), eid: request.eid };
    }
  }
};

serve<ToPreview, PreviewReplies>(
  globalThis as unknown as DedicatedWorkerGlobalScope,
  handle
);
