import { zodSchemaToSqliteInsert } from "./schema-to-sql";
import { createEntity, registerComponentDef, type World } from "./world";
import * as z from "zod";
import { createLog } from "@helpers/log";
import { isEntity, type Entity } from "./types";

const log = createLog('location');

export const componentSchema = z.object({
  id: z.int().optional().meta({ primaryKey: true, autoIncrement: true }),
  eid: z.int().optional().meta({ foreignKey: 'tbl_entity', cascade: true }),
})

export type Location = z.infer<typeof locationSchema>;
export const locationSchema = componentSchema.extend({
  name: z.string(),
  region: z.string(),
}).meta({ name: 'tbl_locations', id: '/location' });



export const createLocation = (world: World, location: Location) => {
  world = registerComponentDef(world, locationSchema, {
    locationSelectByName: 'SELECT eid as id FROM tbl_locations WHERE name = ?1'
  });

  const e = createEntity(world);

  world.stmts.locationInsert!.run(e.id, location.name, location.region);

  return e;
}


export const getLocationE = (world: World, location: Entity | Partial<Location>): Entity | null => {

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