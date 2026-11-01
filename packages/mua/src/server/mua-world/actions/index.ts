import { createLog } from 'odgn-helpers/log';

import { lookAction } from './look';
import { moveAction } from './move';
import {
  closeAction,
  dropAction,
  examineAction,
  inventoryAction,
  openAction,
  takeAction
} from './objects';
import { sayAction, sayToAction } from './say';
import type { ActionContext, ActionResult } from './types';

export * from './types';

const log = createLog('actions');

const actionRegistry: Record<string, (ctx: ActionContext) => ActionResult> = {
  close: closeAction,
  drop: dropAction,
  examine: examineAction,
  inventory: inventoryAction,
  look: lookAction,
  move: moveAction,
  open: openAction,
  say: sayAction,
  sayTo: sayToAction,
  take: takeAction
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
