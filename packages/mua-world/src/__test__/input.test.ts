import { describe, expect, it } from 'bun:test';

import { fromWorld } from '../commands/verbs';
import { readNpc } from '../input';
import { buildWorld } from './world';

const HALL = `
entity hall {}
entity guard {
  described { name: "Guard" }
  npc { active: true }
  location { in: $hall }
}
entity brass_key {
  described { name: "Brass key" }
  noun { words: ["key"] }
  location { in: $hall }
}
entity iron_key {
  described { name: "Iron key" }
  noun { words: ["key"] }
  location { in: $hall }
}
`;

describe('readNpc', () => {
  it('takes the first match of an ambiguous object', async () => {
    const { id, store } = await buildWorld(HALL);
    const commands = readNpc(store, fromWorld(store), id('guard'), 'take key');

    expect(commands?.map(c => [c.verb, c.targetId])).toEqual([
      ['take', id('brass_key')]
    ]);
  });

  it('drops a command it cannot read', async () => {
    const { id, store } = await buildWorld(HALL);
    const vocabulary = fromWorld(store);

    expect(readNpc(store, vocabulary, id('guard'), 'dance')).toBeNull();
    expect(readNpc(store, vocabulary, id('guard'), 'take banana')).toBeNull();
  });
});
