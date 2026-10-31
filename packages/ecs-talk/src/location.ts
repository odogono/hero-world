import { defineComponent, s } from 'odgn-ecs/component';

/**
 * The standard `location` component: `in` is the id of the entity this one
 * is inside. An entity's Elements are the entities located in it.
 */
export const locationComponent = defineComponent({
  id: 'location' as const,
  schema: {
    in: s.entityId()
  }
});
