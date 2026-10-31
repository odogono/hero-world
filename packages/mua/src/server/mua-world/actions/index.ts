import { createLog } from 'odgn-helpers/log';

import { lookAction } from './look';
import { moveAction } from './move';
import type { ActionContext, ActionResult } from './types';

export * from './types';

const log = createLog('actions');

const actionRegistry: Record<string, (ctx: ActionContext) => ActionResult> = {
  look: lookAction,
  move: moveAction
};

export const executeAction = (ctx: ActionContext): ActionResult => {
  const handler = actionRegistry[ctx.verb];
  if (!handler) {
    return { message: `Command "${ctx.verb}" not implemented yet.` };
  }

  try {
    return handler(ctx);
  } catch (error) {
    log.error('Action error:', error);
    return { message: 'Something went wrong.' };
  }
};
