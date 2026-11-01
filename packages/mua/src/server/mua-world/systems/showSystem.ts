import { TALK_SHOW_EVENT, type TalkShowPayload } from 'ecs-talk';
import { createEventSystem } from 'odgn-ecs/events';
import type { World } from 'odgn-ecs/world';

import type { MuaComponents } from '../coms';
import { tell } from './output';

const parsePayload = (payload: unknown): TalkShowPayload | undefined => {
  const value =
    typeof payload === 'string' ? (JSON.parse(payload) as unknown) : payload;
  if (
    typeof value === 'object' &&
    value !== null &&
    'actor' in value &&
    'text' in value
  ) {
    return value as TalkShowPayload;
  }
  return undefined;
};

/**
 * Delivers a Script's `show actor, text`: to the player if the actor is
 * one, otherwise to every player inside the actor (so a room can speak).
 */
export const showSystem = {
  ...createEventSystem<MuaComponents>(TALK_SHOW_EVENT, ({ payload, world }) => {
    const show = parsePayload(payload);
    if (!show) {
      return;
    }
    tell(world as World<MuaComponents>, show.actor, show.text);
  }),
  // after actions, before output
  priority: 15
};
