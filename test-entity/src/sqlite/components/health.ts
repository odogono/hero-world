import * as z from "zod";
import { componentSchema } from "../component";
import { defineComponent } from "../component";

// Define the component schema extending the base componentSchema
const healthSchema = componentSchema.extend({
  current: z.number(),
  max: z.number(),
}).meta({ 
  name: 'tbl_health', 
  id: 'health'
});

export type Health = z.infer<typeof healthSchema>;

// Create the component definition - no more declare module needed!
export const healthComponent = defineComponent({
  name: 'health' as const,
  schema: healthSchema,
  statements: {
    // Optional: custom SQL statements
    selectByCurrentHealth: 'SELECT * FROM tbl_health WHERE current = ?1'
  }
});