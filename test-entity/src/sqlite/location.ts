import { zodSchemaToSqliteInsert } from "./schema-to-sql";
import { createEntity, isEntity, registerComponentDef, type Entity, type World } from "./world";
import * as z from "zod";
import { createLog } from "@helpers/log";

const log = createLog('location');

export type Location = z.infer<typeof locationSchema>;
const locationSchema = z.object({
  id: z.int().optional().meta({ primaryKey: true, autoIncrement: true }),
  eid: z.int().optional(),
  name: z.string(),
  region: z.string(),
}).meta({ name: 'tbl_locations', id: '/location' });



export const createLocation = (world: World, location: Location) => {
  world = registerComponentDef(world, locationSchema, {
    locationSelectByName: 'SELECT eid as id FROM tbl_locations WHERE name = ?1'
  });

  const eid = createEntity(world);

  world.stmts.locationInsert!.run(eid, location.name, location.region);

  return eid;
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