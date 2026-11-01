import { locationComponent } from 'ecs-talk';
import { defineComponent, s } from 'odgn-ecs/component';
import { eventComponent } from 'odgn-ecs/events';
import type { InferComponentsFromCDefs } from 'odgn-ecs/types';

import type { DIRECTIONS } from './commands/verbs';

const connectedDef = defineComponent({
  id: 'connected',
  schema: {
    connectedAt: s.datetime(),
    wsId: s.string()
  }
});

const authenticatingDef = defineComponent({
  id: 'authenticating',
  schema: {
    attempts: s.number().default(0)
  }
});

const authenticatedDef = defineComponent({
  id: 'authenticated',
  schema: {
    authenticatedAt: s.datetime()
  }
});

const containerDef = defineComponent({
  id: 'container',
  schema: {
    capacity: s.number().default(10),
    isClosed: s.boolean().default(false)
  }
});

const itemDef = defineComponent({
  id: 'item',
  schema: {
    isTakeable: s.boolean().default(true),
    weight: s.number().optional().default(1)
  }
});

const metaDef = defineComponent({
  id: 'meta',
  schema: {
    props: s.json().default({})
  }
});

const portalDef = defineComponent({
  id: 'portal',
  schema: {
    dir: s.string(),
    msg: s.string().optional(),
    to: s.entityId().optional()
  }
});

/**
 * A room's exits, by direction, expanded into exit entities when the world
 * loads (see world/exits.ts). Each is the room it leads to, or a spec:
 * `exits { north: $hall, south: { msg: "The windows are barred." },
 *          down: { to: $cellar oneWay: true } }`.
 * An exit to a room also makes the way back, unless that room already has an
 * exit in the opposite direction or the exit is `oneWay`.
 */
const exitsDef = defineComponent({
  id: 'exits',
  schema: {
    down: s.json().optional(),
    east: s.json().optional(),
    in: s.json().optional(),
    north: s.json().optional(),
    northeast: s.json().optional(),
    northwest: s.json().optional(),
    out: s.json().optional(),
    south: s.json().optional(),
    southeast: s.json().optional(),
    southwest: s.json().optional(),
    up: s.json().optional(),
    west: s.json().optional()
  } satisfies Record<(typeof DIRECTIONS)[number], unknown>
});

/** Where a thing belongs, so a reset can put it back (see lifecycle.ts) */
const homeDef = defineComponent({
  id: 'home',
  schema: {
    in: s.entityId()
  }
});

/** The words a player can use to refer to an entity, besides its name */
const nounDef = defineComponent({
  id: 'noun',
  schema: {
    words: s.array('string').optional()
  }
});

/**
 * Fixed replies that refuse a command, by the role the entity plays in it
 * and the verb's handler, e.g. `target: { take: "It's bolted down." }`.
 * - `target`   the entity is the thing acted on
 * - `indirect` the entity is the second object (`unlock door with key`)
 * - `room`     the command happens inside the entity
 * - `veto`     answers a veto question asked of the entity, by event
 *              (see actions/vetoes.ts),
 *              e.g. `veto: { beforeEnter: "The vault door is sealed." }`
 */
const responsesDef = defineComponent({
  id: 'responses',
  schema: {
    indirect: s.json().optional(),
    room: s.json().optional(),
    target: s.json().optional(),
    veto: s.json().optional()
  }
});

/**
 * Messages that replace a built-in action's defaults, by who sees them and
 * the verb's handler (see actions/messages.ts), e.g.
 * `messages { msg: { take: "You heft {the target}." } }`.
 * - `msg`  what the actor is told
 * - `omsg` what everyone else in the room is told
 */
const messagesDef = defineComponent({
  id: 'messages',
  schema: {
    msg: s.json().optional(),
    omsg: s.json().optional()
  }
});

/** A NorthTalk Script owned by an atom; `src` is resolved against the EDL */
const scriptDef = defineComponent({
  id: 'script',
  schema: {
    src: s.string()
  }
});

const describedDef = defineComponent({
  id: 'described',
  schema: {
    description: s.string(),
    name: s.string()
  }
});

const playerDef = defineComponent({
  id: 'player',
  schema: {
    connectedId: s.entityId().optional(),
    lastCommandAt: s.datetime().optional(),
    /** The last command typed, repeated by `again` */
    lastInput: s.string().optional(),
    /** The last single object acted on, referred to by `it` */
    lastTargetId: s.entityId().optional(),
    /** A command waiting for the player to say which object they meant */
    name: s.string(),
    pending: s.json().optional(),
    /** The room a player was in when they left, to return them to it */
    returnTo: s.entityId().optional()
  }
});

const inputEventDef = defineComponent({
  id: 'inputEvent',
  schema: {
    text: s.string(),
    timestamp: s.datetime(),
    wsId: s.string()
  }
});

const commandEventDef = defineComponent({
  id: 'commandEvent',
  schema: {
    direction: s.string().optional(),
    indirect: s.string().optional(),
    indirectId: s.entityId().optional(),
    /** Set when one command acts on several objects: prefixes the reply */
    label: s.string().optional(),
    playerId: s.entityId(),
    /** Which receiver dispatch has reached (see actions/index.ts) */
    rawInput: s.string(),
    stage: s.int().default(0),
    target: s.string().optional(),
    targetId: s.entityId().optional(),
    text: s.string().optional(),
    verb: s.string(),
    /** Ticks spent waiting on a Script's reply at the current stage */
    waitTicks: s.int().default(0)
  }
});

/**
 * A message for an entity. Sent to a player's connection when `to` is a
 * player, otherwise to every player inside `to` (so a room hears it). `wsId`
 * addresses a connection directly, for before a player is known.
 */
const outputEventDef = defineComponent({
  id: 'outputEvent',
  schema: {
    /** A player inside `to` who should not hear it */
    exclude: s.entityId().optional(),
    message: s.string(),
    /** What the player can see of a room, for clients to show (see look) */
    room: s.json().optional(),
    to: s.entityId().optional(),
    wsId: s.string().optional()
  }
});

export const defs = [
  connectedDef,
  authenticatingDef,
  authenticatedDef,
  playerDef,
  inputEventDef,
  commandEventDef,
  outputEventDef,
  containerDef,
  metaDef,
  locationComponent,
  portalDef,
  exitsDef,
  homeDef,
  describedDef,
  nounDef,
  responsesDef,
  messagesDef,
  scriptDef,
  eventComponent,
  itemDef
];

export type MuaComponents = InferComponentsFromCDefs<typeof defs>;
