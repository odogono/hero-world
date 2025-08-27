import type { World } from "../types";
import * as z from "zod";
import { createLog } from "@helpers/log";
import { isEntity, type Entity } from "../types";
import { componentSchema, defineComponent } from "../component";
import { createEntity } from "../entity";

const log = createLog('location');



export type Location = z.infer<typeof locationSchema>;
export const locationSchema = componentSchema.extend({
  name: z.string(),
  region: z.string(),
}).meta({ id: '/location', name: 'tbl_locations' });


export const locationComponent = defineComponent({
  name: 'location' as const,
  schema: locationSchema,
});


export const createLocation = (world: World<any>, location: Location) => {
  
  const e = createEntity(world, {
    location
  });

  // world.stmts.locationInsert!.run(e.id, location.name, location.region);

  return e;
}


export const getLocationE = (world: World<any>, location: Entity | Partial<Location>): Entity | null => {

  if (isEntity(location)) {
    return location;
  }

  const stmt = world.stmts.locationSelectByName;

  if (!stmt) {
    throw new Error('locationSelectByName not found');
  }

  const result = stmt.get(location.name);

  if (!result) {
    return null;
  }

  return result as Entity;
}