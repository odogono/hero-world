import { afterEach, describe, expect, it } from 'bun:test';

import { MuaWorld } from '../index';

type Client = { id: string; sent: string[] };

const settle = async (muaWorld: MuaWorld, ticks = 12) => {
  for (let ii = 0; ii < ticks; ii++) {
    muaWorld.loop!.update(16);
    // let Decision verdicts and Run results resolve between ticks
    await new Promise(resolve => setTimeout(resolve, 0));
  }
};

const connect = async (muaWorld: MuaWorld, name: string): Promise<Client> => {
  const client: Client = { id: `ws-${name}`, sent: [] };
  const conn = {
    close: () => {},
    id: client.id,
    send: (data: string | BufferSource) => {
      client.sent.push(JSON.parse(data as string).data);
      return 1;
    }
  };
  muaWorld.onConnectionOpened(conn);
  muaWorld.onConnectionCommand(conn, {
    data: { username: name },
    type: 'login'
  });
  await settle(muaWorld);
  client.sent.length = 0;
  (client as Client & { conn: typeof conn }).conn = conn;
  return client;
};

const command = async (muaWorld: MuaWorld, client: Client, text: string) => {
  const { conn } = client as Client & {
    conn: Parameters<MuaWorld['onConnectionCommand']>[0];
  };
  muaWorld.onConnectionCommand(conn, text);
  await settle(muaWorld);
  const out = [...client.sent];
  client.sent.length = 0;
  return out;
};

const WEST_OF_HOUSE =
  '\nWest of house\nThis is an open field west of a white house, with a boarded front door.\n' +
  '\nThere is: Mailbox' +
  '\n\nExits: north, south';

const NORTH_OF_HOUSE =
  '\nNorth of house\nYou are facing the north side of a white house.  There is no door here, and all the windows are barred.\n' +
  '\n\nExits: east, south';

describe('mua Scripts', () => {
  let muaWorld: MuaWorld;

  const open = async () => {
    muaWorld = new MuaWorld();
    await muaWorld.open();
    clearInterval(muaWorld.updateLoopInterval!);
  };

  afterEach(async () => {
    await muaWorld.close();
  });

  it('looks at the room through room.talk', async () => {
    await open();
    const ann = await connect(muaWorld, 'ann');
    expect(await command(muaWorld, ann, 'look')).toEqual([WEST_OF_HOUSE]);
  });

  it('moves through an exit with exit.talk and looks at the new room', async () => {
    await open();
    const ann = await connect(muaWorld, 'ann');
    expect(await command(muaWorld, ann, 'north')).toEqual([NORTH_OF_HOUSE]);
    expect(await command(muaWorld, ann, 'look')).toEqual([NORTH_OF_HOUSE]);
  });

  it("shows an exit's message when it leads nowhere", async () => {
    await open();
    const ann = await connect(muaWorld, 'ann');
    await command(muaWorld, ann, 'north');
    expect(await command(muaWorld, ann, 'south')).toEqual([
      'The windows are all barred'
    ]);
    expect(await command(muaWorld, ann, 'west')).toEqual([
      "You can't go west from here."
    ]);
  });

  it('vetoes a locked door with door.talk', async () => {
    await open();
    const ann = await connect(muaWorld, 'ann');
    await command(muaWorld, ann, 'north');
    await command(muaWorld, ann, 'east');
    expect(await command(muaWorld, ann, 'west')).toEqual([
      'The window is closed'
    ]);
    // still behind the house
    const [view] = await command(muaWorld, ann, 'look');
    expect(view).toStartWith('\nBehind House\n');
  });

  it('tells the players already in a room that someone arrives', async () => {
    await open();
    const ann = await connect(muaWorld, 'ann');
    const bob = await connect(muaWorld, 'bob');
    await command(muaWorld, ann, 'north');

    expect(await command(muaWorld, bob, 'north')).toEqual([NORTH_OF_HOUSE]);
    expect(ann.sent).toEqual(['bob arrives.']);
  });
});
