import { locationComponent } from 'ecs-talk';
import { defineComponent, s } from 'odgn-ecs/component';
import { eventComponent } from 'odgn-ecs/events';
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

/** A NorthTalk Script that an atom or entity owns; `src` is relative to the EDL file */
const scriptDef = defineComponent({
  id: 'script',
  schema: {
    src: s.string()
  }
});

const doorDef = defineComponent({
  id: 'door',
  schema: {
    isLocked: s.boolean().default(false)
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
    name: s.string()
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
    playerId: s.entityId(),
    rawInput: s.string(),
    target: s.string().optional(),
    verb: s.string()
  }
});

const outputEventDef = defineComponent({
  id: 'outputEvent',
  schema: {
    broadcast: s.boolean().default(false),
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
  doorDef,
  scriptDef,
  eventComponent,
  describedDef,
  itemDef
];

export type MuaComponents = InferComponentsFromCDefs<typeof defs>;
