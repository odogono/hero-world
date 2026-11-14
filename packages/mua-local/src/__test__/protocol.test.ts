// Runs the shared protocol cases in spec/mua/protocol against a Local
// World's host, as packages/mua_server/test/protocol_conformance_test.exs
// runs them against the Channel: what each message's form is replied to,
// before the World sees it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import type { FromWorld, ToWorld } from '../protocol';
import { openTestHost } from '../testing';

const SPEC = join(
  import.meta.dir,
  '../../../../spec/mua/protocol/messages.json'
);

type Case = {
  name: string;
  payload: Record<string, unknown>;
  reply: 'accepted' | { error: string };
  send: string;
};

const { cases } = JSON.parse(readFileSync(SPEC, 'utf8')) as { cases: Case[] };

// every reason the cases give for refusing a message's form
const FORM_REASONS = new Set(
  cases.flatMap(c => (c.reply === 'accepted' ? [] : [c.reply.error]))
);

describe('messages.json', () => {
  for (const c of cases) {
    test(c.name, async () => {
      const sent: FromWorld[] = [];
      const host = openTestHost(message => sent.push(message));
      await host.receive({ name: 'Ada', type: 'join' });
      sent.length = 0;

      await host.receive({ ...c.payload, type: c.send } as unknown as ToWorld);
      const replies = sent.filter(m => m.event === 'reply');
      expect(replies).toHaveLength(1);
      const reply = replies[0] as {
        ok: boolean;
        reason?: string;
        ref?: unknown;
      };

      if (c.reply === 'accepted') {
        // a World's refusal echoes the message's `ref`, and isn't a reason
        // for its form
        const accepted =
          reply.ok ||
          ('ref' in c.payload &&
            reply.ref === c.payload.ref &&
            !FORM_REASONS.has(reply.reason!));
        expect([c.name, accepted, reply]).toEqual([c.name, true, reply]);
      } else {
        expect({ ok: reply.ok, reason: reply.reason }).toEqual({
          ok: false,
          reason: c.reply.error
        });
        // the client matches a Worker's replies by `ref`, where a Channel's
        // reply has its own, so a usable one comes back
        const { ref } = c.payload;
        if (typeof ref === 'string' || typeof ref === 'number') {
          expect(reply.ref).toBe(ref);
        }
      }
    });
  }
});
