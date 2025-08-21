import { zodSchemaToSqliteInsert } from "./schema-to-sql";
import { createEntity, registerComponentDef, type World } from "./world";
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
  world = registerComponentDef(world, locationSchema);

  const eid = createEntity(world);

  world.stmts.insertLocation!.run(eid, location.name, location.region);

  return eid;
}