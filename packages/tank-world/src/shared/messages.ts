import { z } from 'zod';

// Client -> Server
export const HelloSchema = z.object({
  name: z.string().min(1).max(32).optional(),
  type: z.literal('hello')
});

export const ChatSchema = z.object({
  name: z.string().min(1).max(32).optional(),
  text: z.string().min(1).max(500),
  type: z.literal('chat')
});

export const SpawnSchema = z.object({
  team: z.enum(['red', 'blue']).default('red'),
  type: z.literal('cmd:spawn'),
  x: z.number().finite(),
  y: z.number().finite()
});

export const MoveSchema = z.object({
  id: z.number().int().nonnegative(),
  type: z.literal('cmd:move'),
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
  clients: z.number().int().nonnegative(),
  playerId: z.number().int().positive(),
  ts: z.number().int().nonnegative(),
  type: z.literal('welcome')
});

export const ErrorSchema = z.object({
  issues: z.unknown().optional(),
  message: z.string(),
  type: z.literal('error')
});

export const TankStateSchema = z.object({
  hp: z.number().int().nonnegative().default(100),
  id: z.number().int().nonnegative(),
  team: z.enum(['red', 'blue']),
  vx: z.number().default(0),
  vy: z.number().default(0),
  x: z.number(),
  y: z.number()
});

export const WorldSnapshotSchema = z.object({
  tanks: z.array(TankStateSchema),
  tick: z.number().int().nonnegative(),
  type: z.literal('world:snapshot')
});

export const WorldUpdateSchema = z.object({
  tanks: z.array(TankStateSchema),
  tick: z.number().int().nonnegative(),
  type: z.literal('world:update')
});

export const ServerMessageSchema = z.discriminatedUnion('type', [
  WelcomeSchema,
  ErrorSchema,
  WorldSnapshotSchema,
  WorldUpdateSchema,
  ChatSchema // server echoes chat
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export const parseClientMessage = (raw: unknown) =>
  ClientMessageSchema.safeParse(raw);
export const parseServerMessage = (raw: unknown) =>
  ServerMessageSchema.safeParse(raw);
