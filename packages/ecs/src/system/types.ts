import type { Components, World, Entity } from '../types';

// System Loop Types
export type SystemFunction<TComponents extends Components> = (
  world: World<TComponents>,
  deltaTime: number,
  events: Array<{ entity: Entity<'event'>; payload: any; type: string }>
) => void;

export type SystemOptions = {
  enabled?: boolean;
  frequency?: number; // Run every N frames (1 = every frame)
  priority?: number;
};

export type SystemRegistration<TComponents extends Components> = {
  enabled: boolean;
  fn: SystemFunction<TComponents>;
  frameCount: number; // Internal frame counter for frequency
  id: string;
  options: Required<SystemOptions>;
};

export type SystemPerformance = {
  averageExecutionTime: number;
  executionCount: number;
  id: string;
  lastExecutionTime: number;
  totalExecutionTime: number;
};

export type GameLoop<TComponents extends Components> = {
  addSystem: (
    id: string,
    fn: SystemFunction<TComponents>,
    options?: SystemOptions
  ) => GameLoop<TComponents>;
  disableSystem: (id: string) => GameLoop<TComponents>;
  enableSystem: (id: string) => GameLoop<TComponents>;
  getPerformance: () => SystemPerformance[];
  getSystems: () => SystemRegistration<TComponents>[];
  removeSystem: (id: string) => GameLoop<TComponents>;
  update: (deltaTime: number) => void;
};
