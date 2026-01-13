import type { EntityId, World } from 'odgn-ecs/types';

export const getRoomContents = (world: World<any>, roomId: EntityId) => world.queryAll({
    args: [roomId],
    where: 'contained.in = ?1',
    with: ['contained', 'described'],
    without: ['portal']
  });

export const getRoomExits = (world: World<any>, roomId: EntityId) => world.queryAll({
    args: [roomId],
    where: 'contained.in = ?1',
    with: ['contained', 'portal']
  });

export const findExitByDirection = (
  world: World<any>,
  roomId: EntityId,
  direction: string
) => world.query({
    args: [roomId, direction],
    where: 'contained.in = ?1 AND portal.dir = ?2',
    with: ['contained', 'portal']
  });

export const findRoomByMetaId = (world: World<any>, metaId: string) => world.query({
    args: [metaId],
    where: `json_extract(meta.props, '$.id') = ?1`,
    with: ['described', 'meta']
  });
