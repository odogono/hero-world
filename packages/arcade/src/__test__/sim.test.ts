import { describe, expect, test } from 'bun:test';

import { FRAME_MS, createSim } from '../sim/sim';

const input = (i: number) => ({
  fire: true,
  thrust: i % 120 < 20,
  turn: Math.sin(i / 50)
});

const play = async (seed: number, frames: number) => {
  const sim = await createSim({ seed });
  for (let i = 0; i < frames; i++) {
    sim.frame(input(i));
  }
  return sim.snapshot();
};

describe('arcade sim', () => {
  test('the same seed and input give the same World', async () => {
    expect(await play(7, 300)).toEqual(await play(7, 300));
  });

  test('the first wave arrives on the first Frame', async () => {
    const sim = await createSim({ seed: 1 });
    sim.frame();
    const s = sim.snapshot();
    expect(s.wave).toBe(1);
    expect(s.entities.filter(e => e.kind === 'asteroid')).toHaveLength(4);
  });

  test('a Frame advances World time by one Frame', async () => {
    const sim = await createSim({ seed: 1 });
    sim.frame();
    sim.frame();
    expect(sim.world.time).toBeCloseTo(2 * FRAME_MS);
  });

  test('a bullet that hits an asteroid scores', async () => {
    expect((await play(3, 600)).score).toBeGreaterThan(0);
  });
});
