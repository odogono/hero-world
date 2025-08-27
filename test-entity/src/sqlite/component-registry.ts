import * as z from "zod";
import type { World } from "./types";

/**
 * Component definition
 */
export interface ComponentDefinition<
  Name extends string,
  Schema extends z.ZodTypeAny
> {
  name: Name;
  schema: Schema;
  statements?: Record<string, string>;
}

/**
 * Creates a component definition
 */
export function defineComponent<
  Name extends string,
  Schema extends z.ZodTypeAny
>(definition: ComponentDefinition<Name, Schema>) {
  return definition;
}

/**
 * World builder that accumulates component types at compile time
 */
export class WorldBuilder<TComponents extends Record<string, any> = {}> {
  private world: any;
  
  constructor() {
    // Import here to avoid circular dependency
    const { createWorld: createWorldInternal } = require('./world');
    this.world = createWorldInternal();
  }
  
  /**
   * Register a component with the world builder
   */
  withComponent<
    Name extends string,
    Schema extends z.ZodTypeAny,
    ComponentType = z.infer<Schema>
  >(
    component: ComponentDefinition<Name, Schema>
  ): WorldBuilder<TComponents & { [K in Name]: ComponentType }> {
    // Import here to avoid circular dependency
    const { registerComponent } = require('./world');
    this.world = registerComponent(this.world, component);
    return this as any;
  }
  
  /**
   * Build the world with all registered components
   */
  build() {
    return this.world as World<TComponents>;
  }
  
  /**
   * Get the component definitions for this builder
   */
  getComponents() {
    return Array.from(this.world.defs.values());
  }
}


/**
 * Entity type for a world with specific components
 */
export type EntityWithComponents<
  TComponents extends Record<string, any>,
  C extends keyof TComponents = never
> = {
  id: number;
  world: World<TComponents>;
} & {
  [K in C]-?: NonNullable<TComponents[K]>;
}

/**
 * Create a new world builder
 */
export function createWorld() {
  return new WorldBuilder();
}
