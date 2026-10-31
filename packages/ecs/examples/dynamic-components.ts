/**
 * Example demonstrating the new dynamic component system
 *
 * No more declare module statements needed!
 * Components are registered at compile-time using a builder pattern.
 */

import { defineComponent, s } from '@component';
import { healthComponent } from '@component/health';
import { createWorld } from '@world';

export const manaComponent = defineComponent({
  id: 'mana',
  schema: {
    current: s.number(),
    max: s.number(),
    regen: s.number()
  },
  statements: {
    selectLowMana: 'SELECT * FROM tbl_mana WHERE current < max * 0.2'
  }
});

// Usage example with full type safety and no declare module!
export const exampleUsage = async () => {
  // Create world with components using builder pattern
  const world = await createWorld([healthComponent, manaComponent]);

  // Create entity with components - TypeScript knows about 'health' and 'mana'!
  const entity = world.create({
    health: { current: 100, max: 100 },
    mana: { current: 50, max: 100, regen: 5 }
  });

  // TypeScript provides full autocomplete and type safety
  console.log(`Health: ${entity.health.current}/${entity.health.max}`);
  console.log(
    `Mana: ${entity.mana.current}/${entity.mana.max} (regen: ${entity.mana.regen})`
  );

  return { entity, world };
};
