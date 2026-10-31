import type { QueryOptions } from '@entity';
import type { Components, Entity } from '@types';
import type { World } from '@world';

type EventsType = { entity: Entity<'event'>; payload: unknown; type: string };

export type ExecProps<T extends Components> = {
  deltaTime: number;
  flushOnExec?: boolean;
  world: World<T>;
};

export type EntityExecProps<E, T extends Components> = ExecProps<T> & {
  entity: E;
};

export type System<T extends Components> = SystemOptions<T> & {
  exec: (props: ExecProps<T>) => void;
};

export type SystemFunctionOptions = {
  flush?: boolean;
};

export type SystemFunctionProps<TComponents extends Components> =
  SystemFunctionOptions & {
    deltaTime: number;
    world: World<TComponents>;
  };

// System Loop Types
export type SystemFunction<TComponents extends Components> = (
  world: World<TComponents>,
  deltaTime: number,
  events: Array<EventsType>,
  options?: SystemFunctionOptions
) => void;

export type SystemOptions<T extends Components> = QueryOptions<T> & {
  enabled?: boolean;
  frequency?: number; // Run every N frames (1 = every frame)
  priority?: number;
  // withEvents?: string | string[];
};

export type SystemRegistration<TComponents extends Components> = {
  enabled: boolean;
  frameCount: number; // Internal frame counter for frequency
  id: string;
  options: Required<{
    enabled: boolean;
    frequency: number;
    priority: number;
  }>;
  system: System<TComponents>;
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
    system: System<TComponents>,
    options?: SystemOptions<TComponents>
  ) => GameLoop<TComponents>;
  disableSystem: (id: string) => GameLoop<TComponents>;
  enableSystem: (id: string) => GameLoop<TComponents>;
  getPerformance: () => SystemPerformance[];
  getSystems: () => SystemRegistration<TComponents>[];
  removeSystem: (id: string) => GameLoop<TComponents>;
  update: (deltaTime: number) => void;
};
