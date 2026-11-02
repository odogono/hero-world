import { defineComponent, s } from 'odgn-ecs/component';
import type { Components } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';

import {
  ScriptError,
  decodeValue,
  encodeValue,
  list,
  timerCapability,
  type Value
} from '@northtalk/ts';

/**
 * A durable timer set by a Script through the standard `timer` Capability,
 * one entity per timer. Register it with the World to offer `timer`.
 * - `owner`   the entity the timer belongs to, and is delivered to
 * - `script`  the Script that set it; names are scoped to owner and Script
 * - `at`      when it is due, in epoch microseconds (as decimal text)
 * - `args`    the message's arguments, in NorthTalk's Value Encoding, as
 *             `{ encoded }` (a plain string column holding JSON reads back as
 *             parsed JSON)
 */
export const talkTimerComponent = defineComponent({
  id: 'talkTimer' as const,
  schema: {
    args: s.json(),
    at: s.string(),
    message: s.string(),
    name: s.string(),
    owner: s.entityId(),
    script: s.string()
  }
});

export const TALK_TIMER = 'talkTimer';

/** How many Deliveries' receivers to remember for timers set by their Runs */
const MAX_RECEIVERS = 10_000;

type TimerRow = {
  args: { encoded: string };
  at: string;
  message: string;
  name: string;
  owner: number;
  script: string;
};

type TimerEntity = { id: number; talkTimer: TimerRow };

/** A timer as stored, handed to the Host's `onTimer` when it falls due */
export type DueTimer = {
  args: Value[];
  at: bigint;
  message: string;
  name: string;
  owner: number;
  script: string;
};

export type TalkTimers = {
  /** The `timer` Capability, granted only when the World has `talkTimer` */
  capability: ReturnType<typeof timerCapability> | undefined;
  /** Delivers every timer due at `now`, oldest first, and removes it */
  fireDue: (now: bigint) => void;
  /** Remembers which entity a Host Delivery went to */
  noteDelivery: (delivery: string, eid: number) => void;
  /**
   * Stores a timer for an entity, replacing one with the same owner, script
   * and name. A Host uses its own `script` name for timers it handles itself
   * in `onTimer`.
   */
  schedule: (timer: Omit<DueTimer, 'args'> & { args?: Value[] }) => void;
};

type TimerHost = {
  /** Delivers a message to an entity; returns the delivery id */
  deliver: (eid: number, message: string, args: Value[]) => string;
  /** The Value an `entity` Host Object reader names, for decoding args */
  entityValue: (eid: number) => Value | undefined;
  /**
   * Called with each timer as it falls due, before it is delivered. Return
   * true when the Host has handled it, and it isn't delivered to Scripts.
   */
  onTimer?: (timer: DueTimer) => boolean;
  /**
   * The name timers are kept under for a Script, given the name it was
   * loaded under, so copies of one Script share their timers
   */
  timerScript?: (scriptName: string) => string;
};

/**
 * Durable timers for the standard `timer` Capability, kept as ECS entities.
 *
 * NorthTalk scopes a timer to the Script that set it, but here one atom's
 * Script serves every entity built from that atom. So a timer belongs to the
 * entity its Run was delivered to: the receiver of the Host Delivery named by
 * the call (`Call.delivery`, odgn-talk ADR 0125). A Run started by a Script's
 * own `send` has no Delivery, so it can't set a timer.
 */
export const createTalkTimers = <TComponents extends Components>(
  world: World<TComponents>,
  host: TimerHost
): TalkTimers => {
  const receivers = new Map<string, number>();
  const scriptOf = host.timerScript ?? ((scriptName: string) => scriptName);
  const timerWorld = world as unknown as World<
    Components & { talkTimer: TimerRow }
  >;

  const noteDelivery = (delivery: string, eid: number) => {
    receivers.set(delivery, eid);
    if (receivers.size > MAX_RECEIVERS) {
      const oldest = receivers.keys().next().value;
      if (oldest !== undefined) {
        receivers.delete(oldest);
      }
    }
  };

  const all = (): TimerEntity[] =>
    timerWorld.queryAll({ with: [TALK_TIMER] }) as unknown as TimerEntity[];

  const find = (owner: number, script: string, name: string) =>
    all().filter(
      t =>
        t.talkTimer.owner === owner &&
        t.talkTimer.script === script &&
        t.talkTimer.name === name
    );

  const remove = (timers: TimerEntity[]) => {
    for (const timer of timers) {
      timerWorld.delete({ id: timer.id, world: timerWorld } as never);
    }
  };

  const ownerOf = (delivery: string | undefined) => {
    const owner = delivery === undefined ? undefined : receivers.get(delivery);
    if (owner === undefined) {
      throw new ScriptError(
        'invalid value',
        'A timer can only be set by a Run that a Host Delivery started'
      );
    }
    return owner;
  };

  const store = (
    owner: number,
    script: string,
    name: string,
    at: bigint,
    message: string,
    args: Value
  ) => {
    remove(find(owner, script, name));
    timerWorld.create({
      talkTimer: {
        args: { encoded: encodeValue(args) },
        at: at.toString(),
        message,
        name,
        owner,
        script
      }
    } as never);
    timerWorld.flush();
  };

  const schedule: TalkTimers['schedule'] = timer => {
    if (!world.defs.has(TALK_TIMER)) {
      throw new Error('Register talkTimerComponent to schedule timers');
    }
    store(
      timer.owner,
      timer.script,
      timer.name,
      timer.at,
      timer.message,
      list(...(timer.args ?? []))
    );
  };

  const capability = world.defs.has(TALK_TIMER)
    ? timerCapability(
        {
          cancel: (call, name) => {
            remove(
              find(ownerOf(call.delivery), scriptOf(call.scriptName), name)
            );
            timerWorld.flush();
          },
          schedule: (call, name, at, message, args) => {
            const owner = ownerOf(call.delivery);
            const micros = at.asInstant();
            if (micros === undefined) {
              throw new ScriptError('invalid value', 'at must be an Instant');
            }
            store(
              owner,
              scriptOf(call.scriptName),
              name,
              micros,
              message,
              args
            );
          }
        },
        { cancel: { fuel: 1 }, schedule: { fuel: 1 } }
      )
    : undefined;

  const fireDue = (now: bigint) => {
    if (!capability) {
      return;
    }
    const due = all()
      .filter(t => BigInt(t.talkTimer.at) <= now)
      .toSorted((a, b) => {
        const diff = BigInt(a.talkTimer.at) - BigInt(b.talkTimer.at);
        return diff < 0n ? -1 : diff > 0n ? 1 : a.id - b.id;
      });
    if (due.length === 0) {
      return;
    }
    remove(due);
    timerWorld.flush();
    for (const { talkTimer } of due) {
      // a timer whose owner has been deleted goes with it
      if (host.entityValue(talkTimer.owner) === undefined) {
        continue;
      }
      const decoded = decodeValue(talkTimer.args.encoded, (kind, id) =>
        kind === 'entity' ? host.entityValue(Number(id)) : undefined
      );
      // a list's `index` counts from 1, as in NorthTalk
      const args = Array.from({ length: decoded.length }, (_, ii) =>
        decoded.index(ii + 1)
      );
      const due: DueTimer = {
        args,
        at: BigInt(talkTimer.at),
        message: talkTimer.message,
        name: talkTimer.name,
        owner: talkTimer.owner,
        script: talkTimer.script
      };
      if (host.onTimer?.(due)) {
        continue;
      }
      const delivery = host.deliver(talkTimer.owner, talkTimer.message, args);
      noteDelivery(delivery, talkTimer.owner);
    }
  };

  return { capability, fireDue, noteDelivery, schedule };
};
