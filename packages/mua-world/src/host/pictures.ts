import { get, query, type Eid, type Store } from 'odgn-ecs/store';

import type { Picture } from './tables';

/**
 * Places' Pictures (ADR 0027), as `MuaWorld.Pictures`: image files in the
 * `pictures/` directory beside a World's EDL, which a place's `picture`
 * names by its path from there, such as `pictures/harbour_steps.png`.
 *
 * A Worker has no disk to check them against, so a Host given `urls` (each
 * Picture's `src` and the URL it is served at, worked out when the World's
 * files were bundled) checks every place's Picture is among them. One
 * given none, such as a Preview World's, serves each at its path.
 */
export type PictureUrls = Readonly<Record<string, string>>;

// where Pictures live, beside the EDL, and the files they may be
const SRC =
  /^pictures\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\.(png|webp|jpe?g|gif)$/;

type Described = { description?: string; name?: string };

const placeName = (store: Store, eid: Eid) => {
  const name = (get(store, eid, 'described') as Described | undefined)?.name;
  return typeof name === 'string' ? `${name} (${eid})` : `entity ${eid}`;
};

/**
 * Checks every place's Picture, and returns each one's URL. Throws naming
 * every place whose Picture has a `src` that can't be served, or, given
 * `urls`, has no file.
 */
export const loadPictures = (store: Store, urls?: PictureUrls) => {
  const found: Record<string, string> = {};
  const problems: string[] = [];
  for (const eid of query(store, { with: ['picture'] })) {
    const { src } = get(store, eid, 'picture') as { src?: unknown };
    const place = placeName(store, eid);
    if (typeof src !== 'string') {
      problems.push(`${place} has a picture with no src`);
    } else if (!SRC.test(src)) {
      problems.push(
        `${place}'s picture ${JSON.stringify(src)} is not a file in pictures/`
      );
    } else if (urls && urls[src] === undefined) {
      problems.push(`${place}'s picture ${src} has no file`);
    } else {
      found[src] = urls?.[src] ?? `/${src}`;
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `Pictures can't be shown: ${[...new Set(problems)].join('; ')}`
    );
  }
  return found;
};

/** The URL a Picture with `src` is served at, given a hash of its file */
export const pictureUrl = (src: string, hash: string) =>
  `/${src}?vsn=${hash.slice(0, 12)}`;

/** `place`'s Picture, or `undefined` when it has none to show */
export const pictureOf = (
  store: Store,
  place: Eid,
  urls: PictureUrls
): Picture | undefined => {
  const src = (get(store, place, 'picture') as { src?: unknown } | undefined)
    ?.src;
  const url = typeof src === 'string' ? urls[src] : undefined;
  if (typeof src !== 'string' || url === undefined) {
    return undefined;
  }
  const described = (get(store, place, 'described') ?? {}) as Described;
  return {
    alt: described.description ?? '',
    name: described.name ?? '',
    src,
    url
  };
};
