import type { EntityId } from 'odgn-ecs/types';

/** The command a Script was offered, for it to ask about (`mua`'s `command`) */
export type CommandContext = {
  actor: EntityId;
  direction?: string;
  indirect?: EntityId;
  target?: EntityId;
  text?: string;
  verb: string;
};

/**
 * The command behind each Host Delivery made for it, so a Script handling
 * it can ask for the objects it names. A message keeps its Delivery as it
 * climbs the Message Path, so any Script along the way can ask.
 */
export const createCommandContexts = () => {
  const byDelivery = new Map<string, CommandContext>();
  return {
    drop: (delivery: string) => {
      byDelivery.delete(delivery);
    },
    get: (delivery: string | undefined) =>
      delivery === undefined ? undefined : byDelivery.get(delivery),
    note: (delivery: string, context: CommandContext) => {
      byDelivery.set(delivery, context);
    }
  };
};

export type CommandContexts = ReturnType<typeof createCommandContexts>;
