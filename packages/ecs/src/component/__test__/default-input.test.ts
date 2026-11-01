import { describe, expect, test } from 'bun:test';

import { defineComponent, s } from '..';
import { createWorld } from '../../world';

const counter = defineComponent({
  id: 'counterDefaultTest',
  schema: {
    label: s.string(),
    stage: s.int().default(0),
    tags: s.array('string').default([])
  }
});

describe('fields with a default', () => {
  test('may be left out when creating an entity, and read back', async () => {
    const world = await createWorld([counter]);
    // no `stage` or `tags`: this must typecheck
    const e = world.create({ counterDefaultTest: { label: 'a' } });
    world.flush();

    const found = world.query({
      entity: e,
      with: ['counterDefaultTest']
    })!;
    const stage: number = found.counterDefaultTest.stage;
    expect(stage).toBe(0);
    expect(found.counterDefaultTest.tags).toEqual([]);
  });
});
