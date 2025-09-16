import { s } from './builder';
import { defineComponent } from './define';
import type { InferComponentType } from './types';

export type Health = InferComponentType<typeof healthComponent>;

// Create the component definition
export const healthComponent = defineComponent({
  id: 'health',
  schema: {
    current: s.number(),
    max: s.number()
  },
  statements: {
    // Optional: custom SQL statements
    selectByCurrentHealth: 'SELECT * FROM tbl_health WHERE current = ?'
  }
});
