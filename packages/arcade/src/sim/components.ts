import { defineComponent, s } from 'odgn-ecs/component';
import { eventComponent } from 'odgn-ecs/events';

export const transformComponent = defineComponent({
  id: 'transform' as const,
  schema: { rotation: s.float(), x: s.float(), y: s.float() }
});

export const velocityComponent = defineComponent({
  id: 'velocity' as const,
  schema: { spin: s.float(), x: s.float(), y: s.float() }
});

export const colliderComponent = defineComponent({
  id: 'collider' as const,
  schema: { radius: s.float() }
});

/** `size`: 3 is large, 2 medium, 1 small */
export const asteroidComponent = defineComponent({
  id: 'asteroid' as const,
  schema: { size: s.int() }
});

/** `ttl` in milliseconds of World time */
export const bulletComponent = defineComponent({
  id: 'bullet' as const,
  schema: { ttl: s.float() }
});

export const shipComponent = defineComponent({
  id: 'ship' as const,
  schema: {
    cooldown: s.float(),
    invulnerable: s.boolean(),
    lives: s.int(),
    score: s.int(),
    wave: s.int()
  }
});

/** Written before each Frame, from the keyboard or a scripted source */
export const inputComponent = defineComponent({
  id: 'input' as const,
  schema: { fire: s.boolean(), thrust: s.boolean(), turn: s.float() }
});

export const arcadeComponents = [
  transformComponent,
  velocityComponent,
  colliderComponent,
  asteroidComponent,
  bulletComponent,
  shipComponent,
  inputComponent,
  eventComponent
] as const;
