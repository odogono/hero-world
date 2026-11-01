import { locationComponent } from 'ecs-talk';
import { defineComponent, s } from 'odgn-ecs/component';
import type { InferComponentsFromCDefs } from 'odgn-ecs/types';

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

/** The words a player can use to refer to an entity, besides its name */
const nounDef = defineComponent({
  id: 'noun',
  schema: {
    words: s.array('string').optional()
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
    pending: s.json().optional()
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
    rawInput: s.string(),
    target: s.string().optional(),
    targetId: s.entityId().optional(),
    text: s.string().optional(),
    verb: s.string()
  }
});

const outputEventDef = defineComponent({
  id: 'outputEvent',
  schema: {
    broadcast: s.boolean().default(false),
    exclude: s.entityId().optional(),
    message: s.string(),
    roomId: s.entityId().optional(),
    wsId: s.string()
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
  describedDef,
  nounDef,
  itemDef
];

export type MuaComponents = InferComponentsFromCDefs<typeof defs>;
