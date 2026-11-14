import type { PreviewReplies, PreviewSource, ToPreview } from 'mua-local';
import { connect } from 'mua-local/endpoint';

/**
 * Talks to a Preview World's Worker (#243). Each request settles with its
 * reply, or rejects with the Worker's error; once the Worker dies or is
 * closed, every request rejects.
 */
export const openPreviewClient = (url = '/local/preview.js') => {
  const { close, request } = connect<ToPreview, PreviewReplies>(
    new Worker(url, { type: 'module' })
  );
  return {
    close,
    command: (text: string) => request({ text, type: 'command' }),
    entity: (eid: number) => request({ eid, type: 'entity' }),
    migrate: (edl: string) => request({ edl, type: 'migrate' }),
    /** Builds a fresh Preview World, from the main World's EDL by default */
    open: (source?: PreviewSource) => request({ source, type: 'open' }),
    reset: () => request({ type: 'reset' })
  };
};

export type PreviewClient = ReturnType<typeof openPreviewClient>;
