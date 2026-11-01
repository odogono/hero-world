import { locationComponent, talkTimerComponent } from 'ecs-talk';
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

/**
 * A connection still logging in (see login.ts): `stage` is what it was last
 * asked for, a `name`, its `password`, or a `newPassword` to choose.
 */
const authenticatingDef = defineComponent({
  id: 'authenticating',
  schema: {
    attempts: s.number().default(0),
    stage: s.string().default('name'),
    username: s.string().optional()
  }
});

/** A player's password, hashed */
const credentialsDef = defineComponent({
  id: 'credentials',
  schema: {
    hash: s.string()
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
    /** A door the exit goes through, shared with the exit back */
    door: s.entityId().optional(),
    msg: s.string().optional(),
    to: s.entityId().optional()
  }
});

/**
 * A door: one entity that the exits on both sides of a doorway point to, so
 * opening, closing or locking it from either side changes both. It needs no
 * location; players refer to it from either room (see queries/scope.ts).
 * Add `lockable` to make it lockable.
 */
const doorDef = defineComponent({
  id: 'door',
  schema: {
    isClosed: s.boolean().default(true)
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

/** The world's clock, kept on the system actor: game time in milliseconds */
const clockDef = defineComponent({
  id: 'clock',
  schema: {
    now: s.number().default(0)
  }
});

/**
 * Messages sent to an entity on a schedule of world time, e.g.
 * `timers { every: { reset: 300 } }` resets a place every five minutes.
 * `every` is the seconds between each message, by message name. When each
 * is next due is kept in ecs-talk's timer store (see world/timers.ts).
 */
const timersDef = defineComponent({
  id: 'timers',
  schema: {
    every: s.json()
  }
});

/**
 * A non-player character: an entity that acts through commands, as a player
 * does, driven by its Scripts (see npcs.ts). Give it `described` and a
 * `location`, and a Script that tells `mua` to `act`.
 */
const npcDef = defineComponent({
  id: 'npc',
  schema: {
    /** Set false to leave it standing still: its commands are ignored */
    active: s.boolean().default(true)
  }
});

/** A command an NPC's Script asked it to carry out, parsed next tick */
const npcInputDef = defineComponent({
  id: 'npcInput',
  schema: {
    actorId: s.entityId(),
    text: s.string()
  }
});

/**
 * Something that can be locked: `lock` names its lock, and any key whose
 * `key.opens` lists that name fits it, e.g. `lockable { lock: "cellar" }`.
 */
const lockableDef = defineComponent({
  id: 'lockable',
  schema: {
    isLocked: s.boolean().default(false),
    lock: s.string()
  }
});

/** A key: the names of the locks it fits, e.g. `key { opens: ["cellar"] }` */
const keyDef = defineComponent({
  id: 'key',
  schema: {
    opens: s.array('string')
  }
});

/**
 * Verbs a world adds, in the shape of commands/verbs.ts's `VERBS`, read when
 * the world loads (see world/verbs.ts). A verb with no built-in action is
 * for Scripts to handle, e.g.
 * `verbs { defs: [{ names: ["pray"] forms: [{ handler: "pray" pattern: "" }] }] }`.
 */
const verbsDef = defineComponent({
  id: 'verbs',
  schema: {
    defs: s.json()
  }
});

/** Something with writing on it, for `read`: `readable { text: "..." }` */
const readableDef = defineComponent({
  id: 'readable',
  schema: {
    text: s.string()
  }
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
    /** What the built-in action did, kept while `after` questions wait */
    outcome: s.json().optional(),
    rawInput: s.string(),
    /** Which question dispatch has reached (see actions/index.ts) */
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
  credentialsDef,
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
  readableDef,
  verbsDef,
  doorDef,
  lockableDef,
  keyDef,
  npcDef,
  npcInputDef,
  talkTimerComponent,
  clockDef,
  timersDef,
  describedDef,
  nounDef,
  responsesDef,
  messagesDef,
  scriptDef,
  eventComponent,
  itemDef
];

export type MuaComponents = InferComponentsFromCDefs<typeof defs>;
