import { select, type Eid, type Store } from 'odgn-ecs/store';

import type { Perception } from './perception';

/** A row in the shared layout (ADR 0019): a component's fields and its `eid` */
export type MirrorRow = Record<string, unknown> & { eid: Eid };

/**
 * The part of the World a browser may hold, as `MuaWorld.Mirror.snapshot/2`
 * gives it and the server's `mirror` message sends it
 * (packages/mua_server/docs/protocol.md): every perceived entity's shown
 * components, one list of rows per component, each in id order.
 */
export type MirrorSnapshot = {
  character: Eid;
  components: Record<string, MirrorRow[]>;
  place: Eid | null;
};

/**
 * The components a mirror holds, and the fields of each it shows.
 * Everything else, such as Scripts, Accounts, locks and where a portal
 * leads, stays with the Host.
 */
const SHOWN: Record<string, readonly string[]> = {
  container: ['is_closed'],
  described: ['name', 'description'],
  door: ['is_closed'],
  item: ['is_takeable'],
  location: ['in'],
  noun: ['words'],
  npc: [],
  player: ['name'],
  portal: ['dir', 'door']
};

/** The names of the components a mirror holds */
export const mirrorComponents = Object.keys(SHOWN);

/** Every entity in the Perception's shown components, as a snapshot */
export const mirrorSnapshot = (
  store: Store,
  perception: Perception
): MirrorSnapshot => {
  const components: Record<string, MirrorRow[]> = {};
  const eids = [...perception.entities].sort((a, b) => a - b);
  if (eids.length > 0) {
    for (const [eid, data] of select(store, mirrorComponents, { eids })) {
      for (const [name, fields] of Object.entries(data)) {
        const row: MirrorRow = { eid };
        for (const field of SHOWN[name] ?? []) {
          if (field in fields) {
            row[field] = fields[field];
          }
        }
        (components[name] ??= []).push(row);
      }
    }
  }
  for (const rows of Object.values(components)) {
    rows.sort((a, b) => a.eid - b.eid);
  }
  return {
    character: perception.character,
    components,
    place: perception.place
  };
};
