import type { Entity, Component } from '@types';
import type { World } from '@/world';

export type Stats = Component & {
  charisma: number;
  constitution: number;
  dexterity: number;
  intelligence: number;
  strength: number;
  wisdom: number;
}

export type HitPoints = Component & {
  current: number;
  max: number;
}


export const setEntityStats = (world: World, entity: Entity, stats: Partial<Stats>) => {
  const existingStats = world.entityStats.get(entity) ?? createStats(world);
  world.entityStats.set(entity, {
    ...existingStats,
    ...stats,
  });
}

export const createStats = (world: World): Stats => {
  const id = world.components.length;
  const com = {
    charisma: 10,
    constitution: 10,
    dexterity: 10,
    id,
    intelligence: 10,
    strength: 10,
    wisdom: 10,
  };
  world.components[id] = com;
  return com;
}

export const setEntityHitPoints = (world: World, entity: Entity, hitPoints: Partial<HitPoints>) => {
  const existingHitPoints = world.entityHitPoints.get(entity) ?? createHitPoints(world);
  world.entityHitPoints.set(entity, {
    ...existingHitPoints,
    ...hitPoints,
  });
}

export const createHitPoints = (world: World): HitPoints => {
  const id = world.components.length;
  const com = {
    current: 10,
    id,
    max: 10,
  };
  world.components[id] = com;
  return com;
}

