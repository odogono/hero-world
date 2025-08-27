import * as z from "zod";
import { defineComponent } from "../component";

export type Health = z.infer<typeof healthSchema>;

// Create the component definition
export const healthComponent = defineComponent({
  name: 'health' as const,
  schema: {
    current: z.number(),
    max: z.number(),
  },
  statements: {
    // Optional: custom SQL statements
    selectByCurrentHealth: 'SELECT * FROM tbl_health WHERE current = ?1'
  }
});

// Define the component schema for type inference
const healthSchema = healthComponent.schema;