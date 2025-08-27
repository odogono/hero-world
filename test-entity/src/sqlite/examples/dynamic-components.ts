/**
 * Example demonstrating the new dynamic component system
 * 
 * No more declare module statements needed!
 * Components are registered at compile-time using a builder pattern.
 */

import { healthComponent } from '../components/health';
import { componentSchema, defineComponent } from '../component';
import { createWorld } from '../world';
import { createEntity } from '../entity';
import * as z from 'zod';

// Example: Create a new component - no declare module needed!
const manaSchema = componentSchema.extend({
  current: z.number(),
  max: z.number(),
  regen: z.number(),
}).meta({ 
  name: 'tbl_mana', 
  id: 'mana' 
});

export const manaComponent = defineComponent({
  name: 'mana' as const,
  schema: manaSchema,
  statements: {
    selectLowMana: 'SELECT * FROM tbl_mana WHERE current < max * 0.2'
  }
});

// Usage example with full type safety and no declare module!
export const exampleUsage = () => {
  // Create world with components using builder pattern
  const world = createWorld()
    .registerComponent(healthComponent)
    .registerComponent(manaComponent)
    .build();
  
  // Create entity with components - TypeScript knows about 'health' and 'mana'!
  const entity = createEntity(world, {
    health: { current: 100, max: 100 },
    mana: { current: 50, max: 100, regen: 5 }
  });
  
  // TypeScript provides full autocomplete and type safety
  console.log(`Health: ${entity.health.current}/${entity.health.max}`);
  console.log(`Mana: ${entity.mana.current}/${entity.mana.max} (regen: ${entity.mana.regen})`);
  
  return { world, entity };
};