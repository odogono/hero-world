import { describe, expect, it, mock } from 'bun:test';
import { z } from 'zod';

import { defineComponent } from '@component';
import { executeEDL } from '../edl';
import { queryEntity } from '../entity';
import { createWorld } from '../world';

const thingComponent = defineComponent({
  name: 'thing',
  schema: {
    size: z.number(),
    weight: z.number()
  }
});

describe('EDL command reference helpers', () => {
  it('should resolve component existence for commands', async () => {
    const edl = `
      entity chest {}
      !examine $chest.thing._exists
    `;

    const examine = mock(() => {});
    const world = await createWorld([thingComponent]);
    executeEDL(world, edl, { commands: { '!examine': examine } });

    expect(examine.mock.calls).toEqual([[false]]);
  });

  it('should resolve component row id for commands', async () => {
    const edl = `
      entity chest { thing { size: 1 weight: 2 } }
      !examine $chest.thing.id $chest.thing._row_id $chest._count
    `;

    const examine = mock(() => {});
    const world = await createWorld([thingComponent]);
    executeEDL(world, edl, { commands: { '!examine': examine } });

    const chest = queryEntity(world, { with: ['thing'] })!;
    expect(chest).toBeDefined();
    const rowId = chest.thing.id!;

    expect(typeof rowId).toBe('number');
    expect(examine.mock.calls).toEqual([[rowId, rowId, 1]]);
  });
});
