import { z } from 'zod';

// Client -> Server
export const HelloSchema = z.object({
  type: z.literal('hello'),
  name: z.string().min(1).max(32).optional()
});

export const ChatSchema = z.object({
  type: z.literal('chat'),
  text: z.string().min(1).max(500),
  name: z.string().min(1).max(32).optional()
});

export const SpawnSchema = z.object({
  type: z.literal('cmd:spawn'),
  team: z.enum(['red', 'blue']).default('red'),
  x: z.number().finite(),
  y: z.number().finite()
});

export const MoveSchema = z.object({
  type: z.literal('cmd:move'),
  id: z.number().int().nonnegative(),
  x: z.number().finite(),
  y: z.number().finite()
});

export const ClientMessageSchema = z.discriminatedUnion('type', [
  HelloSchema,
  ChatSchema,
  SpawnSchema,
  MoveSchema
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// Server -> Client
export const WelcomeSchema = z.object({
  type: z.literal('welcome'),
  playerId: z.number().int().positive(),
  clients: z.number().int().nonnegative(),
  ts: z.number().int().nonnegative()
});

export const ErrorSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
  issues: z.unknown().optional()
});

export const TankStateSchema = z.object({
  id: z.number().int().nonnegative(),
  team: z.enum(['red', 'blue']),
  x: z.number(),
  y: z.number(),
  vx: z.number().default(0),
  vy: z.number().default(0),
  hp: z.number().int().nonnegative().default(100)
});

export const WorldSnapshotSchema = z.object({
  type: z.literal('world:snapshot'),
  tick: z.number().int().nonnegative(),
  tanks: z.array(TankStateSchema)
});

export const WorldUpdateSchema = z.object({
  type: z.literal('world:update'),
  tick: z.number().int().nonnegative(),
  tanks: z.array(TankStateSchema)
});

export const ServerMessageSchema = z.discriminatedUnion('type', [
  WelcomeSchema,
  ErrorSchema,
  WorldSnapshotSchema,
  WorldUpdateSchema,
  ChatSchema // server echoes chat
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export const parseClientMessage = (raw: unknown) => ClientMessageSchema.safeParse(raw);
export const parseServerMessage = (raw: unknown) => ServerMessageSchema.safeParse(raw);

