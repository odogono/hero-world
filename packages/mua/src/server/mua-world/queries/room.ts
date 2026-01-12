import type { EntityId, World } from 'odgn-ecs/types';

export const getRoomContents = (world: World<any>, roomId: EntityId) => {
  return world.queryAll({
    with: ['contained', 'described'],
    without: ['portal'],
    where: 'contained.in = ?1',
    args: [roomId]
  });
};

export const getRoomExits = (world: World<any>, roomId: EntityId) => {
  return world.queryAll({
    with: ['contained', 'portal'],
    where: 'contained.in = ?1',
    args: [roomId]
  });
};

export const findExitByDirection = (
  world: World<any>,
  roomId: EntityId,
  direction: string
) => {
  return world.query({
    with: ['contained', 'portal'],
    where: 'contained.in = ?1 AND portal.dir = ?2',
    args: [roomId, direction]
  });
};

export const findRoomByMetaId = (world: World<any>, metaId: string) => {
  return world.query({
    with: ['described', 'meta'],
    where: `json_extract(meta.props, '$.id') = ?1`,
    args: [metaId]
  });
};
