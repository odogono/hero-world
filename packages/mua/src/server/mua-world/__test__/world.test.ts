import { describe, expect, it, mock, test } from 'bun:test';
import type { EntityId } from 'odgn-ecs/types';

import { MuaWorld } from '../index';

type MuaEvent = {
  actor: EntityId;
  verb: string;
  target: EntityId;
  args: any[];
};

describe('World', () => {
  it('should create a connection entity on connection opened', async () => {
    const muaWorld = new MuaWorld();
    await muaWorld.open();

    const mockSend = mock((data: any) => {
      console.log('send', data);
    });

    muaWorld.onConnectionOpened({
      id: 'test',
      send: mockSend
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
});
