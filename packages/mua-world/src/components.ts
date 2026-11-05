import { defineComponent, s } from 'odgn-ecs/component';

/**
 * mua's components, as `MuaWorld.Components` defines them, with
 * `odgn_ecs_talk`'s `location`. Keys are snake_case, the columns both
 * Hosts store, so a World reads the same from either. `playState` marks
 * those play changes, which a Migration treats differently.
 */

// The columns of `exits`, one per Direction in the Base Verbs
const DIRECTIONS = [
  'north',
  'northeast',
  'east',
  'southeast',
  'south',
  'southwest',
  'west',
  'northwest',
  'up',
  'down',
  'in',
  'out'
] as const;

const location = defineComponent({
  id: 'location',
  playState: true,
  schema: { in: s.entityId() }
});

const container = defineComponent({
  id: 'container',
  playState: true,
  schema: {
    capacity: s.float().default(10).optional(),
    is_closed: s.boolean().default(false).optional()
  }
});

const item = defineComponent({
  id: 'item',
  schema: {
    is_takeable: s.boolean().default(true).optional(),
    weight: s.float().default(1).optional()
  }
});

const meta = defineComponent({
  id: 'meta',
  schema: { props: s.json().default({}).optional() }
});

const portal = defineComponent({
  id: 'portal',
  schema: {
    dir: s.string().optional(),
    door: s.entityId(),
    msg: s.string().optional(),
    to: s.entityId()
  }
});

const door = defineComponent({
  id: 'door',
  playState: true,
  schema: { is_closed: s.boolean().default(true).optional() }
});

const exits = defineComponent({
  id: 'exits',
  schema: Object.fromEntries(
    DIRECTIONS.map(direction => [direction, s.json().optional()])
  )
});

const timers = defineComponent({
  id: 'timers',
  schema: { every: s.json().optional() }
});

const npc = defineComponent({
  id: 'npc',
  playState: true,
  schema: { active: s.boolean().default(true).optional() }
});

const lockable = defineComponent({
  id: 'lockable',
  playState: true,
  schema: {
    is_locked: s.boolean().default(false).optional(),
    lock: s.string().optional()
  }
});

const key = defineComponent({
  id: 'key',
  schema: { opens: s.array('string').optional() }
});

const verbs = defineComponent({
  id: 'verbs',
  schema: { defs: s.json().optional() }
});

const words = defineComponent({
  id: 'words',
  schema: {
    aliases: s.json().optional(),
    articles: s.array('string').optional(),
    directions: s.json().optional()
  }
});

const readable = defineComponent({
  id: 'readable',
  schema: { text: s.string().optional() }
});

const home = defineComponent({
  id: 'home',
  playState: true,
  schema: { in: s.entityId() }
});

const noun = defineComponent({
  id: 'noun',
  schema: { words: s.array('string').optional() }
});

const responses = defineComponent({
  id: 'responses',
  schema: {
    indirect: s.json().optional(),
    room: s.json().optional(),
    target: s.json().optional(),
    veto: s.json().optional()
  }
});

const messages = defineComponent({
  id: 'messages',
  schema: { msg: s.json().optional(), omsg: s.json().optional() }
});

const script = defineComponent({
  id: 'script',
  schema: { src: s.string().optional() }
});

const described = defineComponent({
  id: 'described',
  schema: { description: s.string().optional(), name: s.string().optional() }
});

const account = defineComponent({
  id: 'account',
  playState: true,
  schema: { admin: s.boolean().default(false).optional() }
});

const player = defineComponent({
  id: 'player',
  schema: {
    // the Account that owns the Character
    account: s.entityId(),
    last_input: s.string().optional(),
    // what the player last referred to, gone when that is
    last_target_id: s.entityId().onDelete('nullify'),
    name: s.string().unique(),
    pending: s.json().optional(),
    return_to: s.entityId().onDelete('nullify')
  }
});

/** Every component a mua World defines */
export const components = [
  location,
  container,
  item,
  meta,
  portal,
  door,
  exits,
  timers,
  npc,
  lockable,
  key,
  verbs,
  words,
  readable,
  home,
  noun,
  responses,
  messages,
  script,
  described,
  account,
  player
];
