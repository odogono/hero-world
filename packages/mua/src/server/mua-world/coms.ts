import { defineComponent, s } from 'odgn-ecs/component';

const connectedDef = defineComponent({
  id: 'connected',
  schema: {
    wsId: s.string(),
    connectedAt: s.datetime()
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

const containedDef = defineComponent({
  id: 'contained',
  schema: {
    in: s.entityId().optional()
  }
});

const itemDef = defineComponent({
  id: 'item',
  schema: {
    weight: s.number().optional().default(1),
    isTakeable: s.boolean().default(true)
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
    to: s.entityId().optional(),
    dir: s.string(),
    msg: s.string().optional()
  }
});

const describedDef = defineComponent({
  id: 'described',
  schema: {
    name: s.string(),
    description: s.string()
  }
});

export const defs = [
  connectedDef,
  authenticatingDef,
  authenticatedDef,
  containerDef,
  metaDef,
  containedDef,
  portalDef,
  describedDef,
  itemDef
];
