import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { openTestWorld, type TestConnection } from './helpers';

const FIXTURE = 'src/server/mua-world/__test__/fixtures/objects.edl';

describe('Objects', () => {
  let world: Awaited<ReturnType<typeof openTestWorld>>;
  let bob: TestConnection;

  const send = (text: string) => world.send(bob, text);

  beforeEach(async () => {
    world = await openTestWorld(FIXTURE);
    bob = await world.login('bob');
  });

  afterEach(async () => {
    await world.muaWorld.close();
  });

  describe('examine', () => {
    it('describes a thing by name', async () => {
      expect(await send('examine lamp')).toBe('A brass oil lamp.');
      expect(await send('look at the anvil')).toBe('A very heavy anvil.');
    });

    it('finds a thing by one of its noun words', async () => {
      expect(await send('x lantern')).toBe('A brass oil lamp.');
    });

    it('says when nothing matches', async () => {
      expect(await send('examine sword')).toBe("You can't see any sword here.");
    });

    it('says whether a container is open', async () => {
      expect(await send('examine crate')).toContain('It is closed.');
      await send('open crate');
      expect(await send('look in crate')).toContain('It contains: the coin.');
    });

    it('refers back to the last object with it', async () => {
      await send('examine lamp');
      expect(await send('examine it')).toBe('A brass oil lamp.');
    });
  });

  describe('take and drop', () => {
    it('picks a thing up and puts it down', async () => {
      expect(await send('take lamp')).toBe('Taken.');
      expect(await send('inventory')).toBe('You are carrying: the lamp.');
      expect(await send('take lamp')).toBe('You already have that.');
      expect(await send('drop lamp')).toBe('Dropped.');
      expect(await send('i')).toBe('You are empty-handed.');
    });

    it("only drops what you're carrying", async () => {
      expect(await send('drop lamp')).toBe("You aren't carrying any lamp.");
    });

    it("refuses things that can't be taken", async () => {
      expect(await send('take anvil')).toBe("You can't take that.");
    });

    it('cannot reach into a closed container', async () => {
      expect(await send('take coin')).toBe("You can't see any coin here.");
      expect(await send('take coin from crate')).toBe('The crate is closed.');
    });

    it('takes from an open container', async () => {
      expect(await send('open crate')).toBe(
        'Opening the crate reveals: the coin.'
      );
      expect(await send('take the coin from the crate')).toBe('Taken.');
      expect(await send('look in crate')).toContain('It is empty.');
    });

    it('takes everything it can, one reply per object', async () => {
      const output = await send('take all');

      expect(output).toContain('Brass key: Taken.');
      expect(output).toContain('Iron key: Taken.');
      expect(output).toContain('Lamp: Taken.');
      expect(output).toContain("Anvil: You can't take that.");
    });

    it('leaves what you carry out of take all, and drops it all', async () => {
      await send('take lamp');

      expect(await send('take all')).not.toContain('Lamp');
      expect(await send('drop all')).toContain('Lamp: Dropped.');
      expect(await send('i')).toBe('You are empty-handed.');
    });

    it('takes everything except what is named', async () => {
      const output = await send('get all except lamp and anvil');

      expect(output).toContain('Brass key: Taken.');
      expect(output).not.toContain('Lamp');
      expect(output).not.toContain('Anvil');
    });

    it('takes a list of things', async () => {
      const output = await send('take lamp and brass key');

      expect(output).toBe('Lamp: Taken.\nBrass key: Taken.');
    });

    it('tells others in the room', async () => {
      const alice = await world.login('alice');
      alice.messages.length = 0;

      await send('take lamp');

      expect(alice.messages.join('\n')).toContain('bob takes the lamp.');
    });
  });

  describe('ambiguity', () => {
    it('asks which one, then acts on the answer', async () => {
      expect(await send('take key')).toBe(
        'Which do you mean: the brass key or the iron key?'
      );
      expect(await send('brass')).toBe('Taken.');
      expect(await send('inventory')).toBe('You are carrying: the brass key.');
    });

    it('uses adjectives to tell things apart', async () => {
      expect(await send('take iron key')).toBe('Taken.');
    });

    it('treats an unrelated reply as a new command', async () => {
      await send('take key');
      expect(await send('examine lamp')).toBe('A brass oil lamp.');
      expect(await send('iron')).toBe('Unknown command: "iron"');
    });
  });

  describe('speaking to someone', () => {
    it('treats a player name as the start of say to', async () => {
      const alice = await world.login('alice');
      alice.messages.length = 0;

      expect(await send('alice hello there')).toBe(
        'You say to alice, "hello there"'
      );
      expect(alice.messages.join('\n')).toContain(
        'bob says to alice, "hello there"'
      );
    });

    it('shows other players in the room', async () => {
      await world.login('alice');

      expect(await send('look')).toContain('Also here: alice');
    });
  });
});
