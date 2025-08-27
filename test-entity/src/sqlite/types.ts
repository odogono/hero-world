import * as z from "zod";
import type { Location } from "./location";
import type { World } from "./world";

export type EntitySchema = z.infer<typeof entitySchema>;


export type Components = {
  location?: Location;
}

export type Entity<C extends keyof Components = never> = EntitySchema & {
  world: World;
} & {
  [K in C]: Components[K];
}


export const entitySchema = z.object({
  id: z.number().meta({ primaryKey: true, autoIncrement: true }),
  // createdAt: z.iso.datetime().meta({ default: 'CURRENT_TIMESTAMP'}),
  // updatedAt: z.iso.datetime().meta({ default: 'CURRENT_TIMESTAMP'}),
}).meta({ name: 'tbl_entity' });

export type ComponentDef = z.infer<typeof componentDefSchema>;
export const componentDefSchema = z.object({
  id: z.string().meta({ primaryKey: true, autoIncrement: true }),
  url: z.string().meta({ unique: true }),
}).meta({ name: 'tbl_component_def' });


export const isEntity = (val: unknown): val is Entity => {
  if (typeof val !== 'object' || val === null) return false;
  const entity = val as Partial<Entity>;
  return typeof entity.id === 'number';
}