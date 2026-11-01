import type { EntityId } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';

import type { MuaComponents } from '../coms';

export const getRoomContents = (
  world: World<MuaComponents>,
  roomId: EntityId
) =>
  world.queryAll({
    args: [roomId],
    maybe: ['container', 'item'],
    where: 'location.in = ?1',
    with: ['location', 'described'],
    without: ['portal']
  });

export const getRoomExits = (world: World<MuaComponents>, roomId: EntityId) =>
  world.queryAll({
    args: [roomId],
    where: 'location.in = ?1',
    with: ['location', 'portal']
  });

export const findExitByDirection = (
  world: World<MuaComponents>,
  roomId: EntityId,
  direction: string
) =>
  world.query({
    args: [roomId, direction],
    where: 'location.in = ?1 AND portal.dir = ?2',
    with: ['location', 'portal']
  });

export const findRoomByMetaId = (world: World<MuaComponents>, metaId: string) =>
  world.query({
    args: [metaId],
    where: `json_extract(meta.props, '$.id') = ?1`,
    with: ['described', 'meta']
  });
