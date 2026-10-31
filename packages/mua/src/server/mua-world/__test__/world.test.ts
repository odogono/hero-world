import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { EntityId } from 'odgn-ecs/types';

import { MuaWorld } from '../index';

type MuaEvent = {
  actor: EntityId;
  args: unknown[];
  target: EntityId;
  verb: string;
};

/*

When a connection is opened, a new entity is opened with the connection component

def connected {
  wsId: string
}

an authentication state component is also added, which is initialised to unauthenticated.

def authenticated {
  attempts: number default 0
  authenticatedAt: date
  identity: eid # points to an entity with a PasswordIdentity component
}

the client must now send a login message to the server, which contains the clients id and password.

if the id or password is incorrect, the server sends an error message. the auth component makes a note of unsuccessful attempts

if the client sends three unsuccessful login attempts, the server closes the connection.

once successful, the auth component is set to authenticated.


user accounts are a separate entity. they have an identity component which stores the username and password.

def PasswordIdentity {
  username: string
  password: string
}


next, the entity to which this connection will 'watch' is determined.

def watched {
  watcher: eid
}

def owned {

}

*/

describe('World', () => {
  let muaWorld: MuaWorld;

  beforeEach(async () => {
    muaWorld = new MuaWorld();
    await muaWorld.open();
  });

  afterEach(async () => {
    await muaWorld.close();
  });

  it('should create a connection entity on connection opened', async () => {
    const mockSend = mock(
      (_data: string | BufferSource) => 1 // Return a number as expected by the send method
    );

    const conn = {
      close: () => {},
      id: 'test',
      send: mockSend
    };

    muaWorld.onConnectionOpened(conn);

    muaWorld.loop?.update(16.67);
    muaWorld.loop?.update(16.67);

    const entities = await muaWorld.world!.queryAll({
      with: ['connected', 'authenticating']
    });

    expect(entities).toHaveLength(1);
    expect(entities[0]?.connected.wsId).toBe('test');
    expect(entities[0]?.authenticating.attempts).toBe(0);

    muaWorld.onConnectionCommand(conn, {
      data: {
        password: 'test',
        username: 'test'
      },
      type: 'login'
    });

    // retrieve all the containers

    // const containers = muaWorld.world?.queryAll({
    //   with: ['container', 'described']
    // });

    // console.log(
    //   'containers:',
    //   containers?.map(c => c.described.name)
    // );

    // const westOfHouse = muaWorld.world?.query({
    //   with: ['described', 'meta'],
    //   where: 'meta.props.id = ?1',
    //   args: ['west_of_house']
    // });
    // console.log('westOfHouse:', westOfHouse?.described.name);

    // const contents = muaWorld.getContents(westOfHouse!.id);
    // console.log(
    //   'contents:',
    //   contents?.map(c => c.described.name)
    // );
    // const dump = muaWorld.world?.db.dump();
    // console.log('dump:', dump);
  });

  it('should start and stop update loop correctly', async () => {
    const muaWorld = new MuaWorld();

    // Initially no interval should be set
    expect(muaWorld.updateLoopInterval).toBeNull();

    // Open should start the update loop
    await muaWorld.open();
    expect(muaWorld.updateLoopInterval).not.toBeNull();

    // Close should stop the update loop
    await muaWorld.close();
    expect(muaWorld.updateLoopInterval).toBeNull();
  });
});
