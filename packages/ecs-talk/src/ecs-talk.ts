import { scheduleEvent, type EventComponent } from 'odgn-ecs/events';
import type { System } from 'odgn-ecs/system';
import type { Components, GenericEntity } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';
import { createLog } from 'odgn-helpers/log';

import {
  Decimal,
  ScriptError,
  defineCapability,
  defineObjectKind,
  fromValue,
  list,
  newGroup,
  nothing,
  num,
  shape,
  toValue,
  type Grant,
  type Group,
  type HostObject,
  type Limits,
  type ObjectKind,
  type PropDef,
  type PumpResult,
  type Script,
  type Value
} from '@northtalk/ts';

import { toComponentShape, type ComponentShape } from './component-shape';

const log = createLog('ecs-talk');

/** The `talk:show` ECS event type `show actor, text` publishes */
export const TALK_SHOW_EVENT = 'talk:show';

export const ENTITY_KIND = 'entity';
export const ATOM_KIND = 'atom';

/** The native data behind an entity Handle */
export type EntityNative = { eid: number };
/** The native data behind an atom's Host Object */
export type AtomNative = { atom: string };

export type TalkShowPayload = { actor: number; text: string };

export type EcsTalkOptions = {
  /** Epoch microseconds for each Pump; must never go backwards */
  clock?: () => bigint;
  /** The Script Group's name */
  name?: string;
  /** Called with each Pump's result */
  onPump?: (result: PumpResult) => void;
  /** Called with Message Path warnings */
  warn?: (message: string) => void;
};

export type LoadAtomScriptOptions = {
  /** Extra Grants, beside the `world` Capability */
  grants?: Readonly<Record<string, Grant<unknown>>>;
  limits?: Partial<Limits>;
};

const COST = { fuel: 1 };
const ELEMENT_COST = { fuel: 2 };

/** The `location` component name that Object Collections read */
const LOCATION = 'location';
/** The component whose `props.id` names an Element */
const META = 'meta';

/** Convert a Value's plain JS form for the ECS: Decimals become numbers */
const toPlain = (value: unknown): unknown => {
  if (value && (value as object).constructor === Decimal) {
    return Number(value);
  }
  if (Array.isArray(value)) {
    return value.map(toPlain);
  }
  if (value && typeof value === 'object' && value.constructor === Object) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, toPlain(v)])
    );
  }
  return value;
};

/** Convert component data for a Script: Dates become text */
const fromPlain = (value: unknown): unknown => {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return (value as Date).toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(fromPlain);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, fromPlain(v)])
    );
  }
  return value;
};

/**
 * A NorthTalk Host Adapter for an odgn-ecs World: one Script Group per World,
 * entities as Host Objects of the `entity` Object Kind, atoms with Scripts on
 * their Message Path, and a `world` Capability.
 */
export const createEcsTalk = <TComponents extends Components>(
  world: World<TComponents>,
  options: EcsTalkOptions = {}
) => {
  const { name = 'world', onPump, warn = msg => log.warn(msg) } = options;

  let lastNow = 0n;
  const clock =
    options.clock ??
    (() => {
      const now = BigInt(Date.now()) * 1000n;
      lastNow = now > lastNow ? now : lastNow;
      return lastNow;
    });

  const shapes = new Map<string, ComponentShape>();
  for (const [componentName, def] of world.defs) {
    shapes.set(componentName, toComponentShape(def.schema));
  }

  const handles = new Map<number, HostObject<EntityNative>>();
  const atomObjects = new Map<string, HostObject<AtomNative>>();
  const scripts = new Map<string, Script>();

  const ref = (eid: number) =>
    ({ id: eid, world }) as unknown as GenericEntity<TComponents>;

  const isLive = (eid: number) =>
    !world.entitiesToDelete.has(eid) && world.get(eid) !== null;

  /** A component's data, including writes not yet flushed */
  const readComponent = (
    eid: number,
    componentName: string
  ): Record<string, unknown> | undefined => {
    if (world.dirtyEntities.get(eid)?.has(componentName)) {
      const entry = world.entityCache.get(eid)?.[componentName];
      if (entry) {
        return (entry.data as Record<string, unknown> | null) ?? undefined;
      }
    }
    const entity = world.query({
      entity: ref(eid),
      with: [componentName]
    }) as Record<string, unknown> | null;
    return (entity?.[componentName] as Record<string, unknown>) ?? undefined;
  };

  /** Replace a component through the tracked proxy */
  const writeComponent = (
    eid: number,
    componentName: string,
    data: Record<string, unknown>
  ) => {
    const proxy = world.query({
      asProxy: true,
      entity: ref(eid),
      maybe: [componentName]
    }) as Record<string, unknown> | null;
    if (!proxy) {
      throw new ScriptError('object gone', `Entity ${eid} is gone`);
    }
    proxy[componentName] = data;
  };

  const locationOf = (eid: number) => {
    const location = readComponent(eid, LOCATION);
    return typeof location?.in === 'number' ? location.in : undefined;
  };

  const nameOf = (eid: number) => {
    const props = readComponent(eid, META)?.props as
      Record<string, unknown> | undefined;
    return typeof props?.id === 'string' ? props.id : undefined;
  };

  /** The live entities located in `eid`, in id order */
  const elementIds = (eid: number): number[] => {
    const def = world.defs.get(LOCATION);
    if (!def) {
      return [];
    }
    const candidates = new Set<number>();
    const rows = world.db.query(
      `SELECT eid FROM ${def.tableName} WHERE "in" = ?1`,
      eid
    ) as { eid: number }[];
    for (const row of rows) {
      candidates.add(row.eid);
    }
    for (const [dirtyEid, dirty] of world.dirtyEntities) {
      if (dirty.has(LOCATION)) {
        candidates.add(dirtyEid);
      }
    }
    return [...candidates]
      .filter(id => locationOf(id) === eid && isLive(id))
      .sort((a, b) => a - b);
  };

  const componentProp = (
    componentName: string,
    componentShape: ComponentShape
  ): PropDef<EntityNative> => ({
    get: o => {
      const { eid } = o.native;
      if (!isLive(eid)) {
        return nothing;
      }
      const data = readComponent(eid, componentName);
      if (!data) {
        return nothing;
      }
      const out: Record<string, unknown> = {};
      for (const key of componentShape.keys) {
        out[key] = fromPlain(data[key]) ?? null;
      }
      return toValue(out, { numbers: 'decimal' });
    },
    getCost: COST,
    set: (o, value) => {
      const { eid } = o.native;
      if (!isLive(eid)) {
        throw new ScriptError('object gone', `Entity ${eid} is gone`);
      }
      const plain = toPlain(fromValue(value));
      const result = componentShape.validator.safeParse(plain);
      if (!result.success) {
        throw new ScriptError(
          'invalid value',
          `Invalid ${componentName}: ${result.error.message}`
        );
      }
      // Nothing for an omittable field leaves it to the component default
      const data = Object.fromEntries(
        Object.entries(result.data).filter(([, v]) => v !== null)
      );
      writeComponent(eid, componentName, data);
    },
    setCost: COST,
    shape: componentShape.shape
  });

  const props: Record<string, PropDef<EntityNative>> = {};
  for (const [componentName, componentShape] of shapes) {
    props[componentName] = componentProp(componentName, componentShape);
  }

  const elementAt = (o: HostObject<EntityNative>, index: number): Value => {
    const ids = elementIds(o.native.eid);
    const eid = index > 0 ? ids[index - 1] : ids.at(index);
    return eid === undefined ? nothing : handle(eid).value;
  };

  const entityKind: ObjectKind<EntityNative> = defineObjectKind<EntityNative>({
    elements: {
      at: elementAt,
      atCost: ELEMENT_COST,
      count: o => num(elementIds(o.native.eid).length),
      countCost: ELEMENT_COST,
      find: (o, elementName) => {
        const eid = elementIds(o.native.eid).find(
          id => nameOf(id) === elementName
        );
        return eid === undefined ? nothing : handle(eid).value;
      },
      findCost: ELEMENT_COST,
      // a literal Shape: the kind can't name itself before it exists
      shape: { k: 'object', kind: ENTITY_KIND }
    },
    name: ENTITY_KIND,
    parentKinds: [ATOM_KIND],
    props
  });

  const atomKind: ObjectKind<AtomNative> = defineObjectKind<AtomNative>({
    name: ATOM_KIND,
    parentKinds: [ATOM_KIND],
    props: {}
  });

  const entityArg = shape.object(entityKind);

  const worldCapability = defineCapability('world', {
    find: {
      args: [entityArg, shape.text],
      cost: COST,
      do: (_call, place, componentName) => {
        if (!world.defs.has(componentName)) {
          throw new ScriptError(
            'invalid value',
            `Unknown component ${componentName}`
          );
        }
        const found = elementIds(place.native.eid)
          .filter(eid => readComponent(eid, componentName) !== undefined)
          .map(eid => handle(eid).value);
        return list(...found);
      },
      mode: 'immediate',
      result: shape.listOf(entityArg)
    },
    moveTo: {
      args: [entityArg, entityArg],
      command: true,
      cost: COST,
      do: (_call, thing, place) => {
        const { eid } = thing.native;
        const placeEid = place.native.eid;
        if (!isLive(eid) || !isLive(placeEid)) {
          throw new ScriptError(
            'object gone',
            `Entity ${isLive(eid) ? placeEid : eid} is gone`
          );
        }
        writeComponent(eid, LOCATION, { in: placeEid });
        return nothing;
      },
      mode: 'immediate'
    },
    resolve: {
      args: [shape.number],
      cost: COST,
      do: (_call, id) => {
        const eid = Number(id);
        return Number.isInteger(eid) && isLive(eid)
          ? handle(eid).value
          : nothing;
      },
      mode: 'immediate',
      result: shape.optional(entityArg)
    },
    show: {
      args: [entityArg, shape.text],
      command: true,
      cost: COST,
      fire: (_call, actor, line) => {
        const payload: TalkShowPayload = {
          actor: actor.native.eid,
          text: line
        };
        scheduleEvent(
          world as unknown as World<Components & { event: EventComponent }>,
          TALK_SHOW_EVENT,
          payload
        );
      },
      mode: 'fire-and-forget'
    }
  });

  const group: Group = newGroup({ name });

  /** The scripted atom a Message Path climbs to from these bases, if any */
  const scriptedParent = (
    bases: string[],
    from: string,
    seen = new Set<string>()
  ): HostObject<AtomNative> | undefined => {
    const scripted = bases.filter(base => atomObjects.has(base));
    if (scripted.length > 1) {
      warn(
        `${from} has more than one base with a Script (${scripted.join(', ')}); ` +
          `using ${scripted.at(-1)}`
      );
    }
    const direct = scripted.at(-1);
    if (direct) {
      return atomObjects.get(direct);
    }
    // no base has a Script: climb through the bases, rightmost first
    for (const base of [...bases].reverse()) {
      if (seen.has(base)) {
        continue;
      }
      seen.add(base);
      const parent = scriptedParent(
        world.getAtomLineage(base) ?? [],
        from,
        seen
      );
      if (parent) {
        return parent;
      }
    }
    return undefined;
  };

  const parentOfEntity = (eid: number) =>
    scriptedParent(world.getEntityLineage(eid), `entity ${eid}`);

  const parentOfAtom = (atom: string) =>
    scriptedParent(world.getAtomLineage(atom) ?? [], `atom ${atom}`);

  /** The Handle for an entity, made the first time it crosses */
  const handle = (eid: number): HostObject<EntityNative> => {
    const existing = handles.get(eid);
    if (existing) {
      return existing;
    }
    const created = group.object(entityKind, String(eid), { eid });
    handles.set(eid, created);
    const parent = parentOfEntity(eid);
    if (parent) {
      group.setParent(created, parent);
    }
    return created;
  };

  /** Re-link every Message Path, after the set of scripted atoms changes */
  const relink = () => {
    for (const [atom, obj] of atomObjects) {
      group.setParent(obj, parentOfAtom(atom));
    }
    for (const [eid, obj] of handles) {
      group.setParent(obj, parentOfEntity(eid));
    }
  };

  /** Load a Script owned by an atom; entities built from it climb to it */
  const loadAtomScript = (
    atom: string,
    source: string,
    loadOptions: LoadAtomScriptOptions = {}
  ): Script => {
    if (world.getAtomLineage(atom) === undefined) {
      throw new Error(`No such atom: ${atom}`);
    }
    if (atomObjects.has(atom)) {
      throw new Error(`Atom ${atom} already has a Script`);
    }
    const owner = group.object(atomKind, atom, { atom });
    atomObjects.set(atom, owner);
    try {
      const script = group.load({
        grants: {
          world: worldCapability.grant(
            ['find', 'moveTo', 'resolve', 'show'],
            undefined
          ),
          ...loadOptions.grants
        },
        limits: loadOptions.limits,
        name: atom,
        owner,
        source
      });
      scripts.set(atom, script);
      relink();
      return script;
    } catch (error) {
      atomObjects.delete(atom);
      group.dispose(owner);
      throw error;
    }
  };

  /**
   * Drop the Handles of entities whose deletion has been flushed. One only
   * marked for deletion stays, and reads as Nothing until it is dropped.
   *
   * Then make a Handle for every live entity built from a scripted atom.
   * `setParent` is queued Host input that applies when the next Pump admits
   * it, so a Handle first made inside a Run has no Message Path for that
   * Run, and a `send` to it is lost. Making them here, before the Pump,
   * means a Script can always message an entity it reaches.
   */
  const sync = () => {
    for (const [eid, obj] of handles) {
      if (world.get(eid) === null) {
        handles.delete(eid);
        group.dispose(obj);
      }
    }
    if (atomObjects.size === 0) {
      return;
    }
    for (const eid of world.entityLineage.keys()) {
      if (!handles.has(eid) && isLive(eid) && parentOfEntity(eid)) {
        handle(eid);
      }
    }
  };

  /** Pump the Script Group once */
  const pump = (): PumpResult => {
    sync();
    const result = group.pump(clock());
    onPump?.(result);
    return result;
  };

  /**
   * A system for the game loop: it runs after every other system, so each
   * tick runs the systems, then the Pump, then the loop's `world.flush()`.
   */
  const system: System<TComponents> = {
    exec: () => {
      pump();
    },
    priority: Number.MIN_SAFE_INTEGER
  };

  const deliver = (eid: number, message: string, ...args: Value[]) =>
    group.deliver(handle(eid), { args, name: message });

  const request = (eid: number, message: string, ...args: Value[]) =>
    group.request(handle(eid), { args, name: message });

  const decide = (eid: number, message: string, ...args: Value[]) =>
    group.decide(handle(eid), { args, name: message });

  return {
    atomKind,
    decide,
    deliver,
    entityKind,
    group,
    handle,
    loadAtomScript,
    pump,
    request,
    script: (atom: string) => scripts.get(atom),
    /** Atoms and entities whose EDL declares a `script`, with source paths */
    scriptOwners: () => world.getScriptOwners(),
    system,
    worldCapability
  };
};

export type EcsTalk = ReturnType<typeof createEcsTalk>;
