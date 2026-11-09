import { defineComponent, s } from 'odgn-ecs/component';
import {
  StoreError,
  exists,
  get,
  ident,
  put,
  query,
  remove as removeComponent,
  elements as storeElements,
  type Data,
  type Eid,
  type Store
} from 'odgn-ecs/store';
import type { Components } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';

import {
  ScriptError,
  clockCapability,
  compileLibrary,
  defineCapability,
  defineObjectKind,
  list,
  newGroup,
  nothing,
  num,
  operationDeclarations,
  shape,
  type Call,
  type CapabilityDef,
  type Decided,
  type Grant,
  type Group,
  type HostObject,
  type Library,
  type Limits,
  type ObjectKind,
  type PropDef,
  type PumpResult,
  type Report,
  type SegmentLifecycle,
  type Value
} from '@northtalk/ts';

import { linearize } from './message-path';
import { componentValue, fromScript, type EntityNative } from './values';

export type { EntityNative } from './values';

export const ENTITY_KIND = 'entity';
export const ATOM_KIND = 'atom';

/** The native data behind an atom's, a copy's or a Service's Host Object */
export type AtomNative = { atom: string };

/**
 * The component the adapter needs the World to define, `location`, unless
 * the `location` option names another. As `OdgnEcsTalk.components/0`.
 */
export const location = defineComponent({
  id: 'location',
  playState: true,
  schema: { in: s.entityId() }
});

/** A Script's Grants and Limits, beside the adapter's */
export type ScriptOptions = {
  grants?: Readonly<Record<string, Grant<unknown>>>;
  limits?: Partial<Limits>;
};

export type EcsTalkOptions = ScriptOptions & {
  /**
   * Capabilities every Script is granted under their names, each made from
   * the started adapter, so their Operations may call `delivery`
   */
  capabilities?: readonly ((talk: EcsTalk) => CapabilityDef<void>)[];
  /** `[component, property]` holding an entity's Location */
  location?: readonly [string, string];
  /** The Group's name, `world` by default */
  name?: string;
  /** `[component, path]` naming an Element, `['meta', ['props', 'id']]` by default */
  naming?: readonly [string, readonly string[]];
  /** Called for `show actor, text`, inside the caller's transaction */
  onShow?: (eid: Eid, text: string) => void;
};

/** What a Host sends a Delivery with; `host` is a term of its own */
export type SendOptions = { host?: unknown };

/** The Delivery a Capability call is part of (see `delivery`) */
export type DeliveryEntry = { host: unknown; receiver: Eid | undefined };

/**
 * How a Request or Decision stands: its Handler `replied` with a value,
 * `passed` (no Handler, or a Decision allowed), was `vetoed` with a reason,
 * `failed` with an error, or is still `waiting`.
 */
export type Outcome =
  | { kind: 'replied'; value: Value }
  | { kind: 'passed' }
  | { kind: 'vetoed'; reason: Value | undefined }
  | { error: unknown; kind: 'failed' }
  | { kind: 'waiting' };

/** A Request or Decision the adapter sent, for `outcome` and `abandon` */
export type Pending = {
  /** The Delivery's id */
  readonly delivery: string;
  /** Settles with its outcome once it is anything but `waiting` */
  readonly settled: Promise<Outcome>;
};

type PendingState = {
  done?: Outcome;
  released: boolean;
};

const pendingStates = new WeakMap<Pending, PendingState>();

/** A Script that failed to load, with the path of its source */
export class ScriptLoadError extends Error {
  constructor(
    readonly path: string,
    override readonly cause: unknown
  ) {
    super(`${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'ScriptLoadError';
  }
}

const COST = { fuel: 1 };

// Each Segment is a SAVEPOINT inside the caller's transaction (ADR 0015)
const savepoint = (segmentId: string) =>
  ident(`talk_${segmentId.replaceAll(/\W/g, '_')}`);

const samePath = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((atom, i) => atom === b[i]);
const ELEMENT_COST = { fuel: 2 };
const OK = { status: 'ok' } as const;

const failed = (error: unknown) => ({
  detail: error instanceof Error ? error.message : String(error),
  status: 'failed' as const
});

const fromReply = (value: Value): Outcome => ({ kind: 'replied', value });

const fromRejection = (error: unknown): Outcome =>
  error instanceof ScriptError && error.reason === 'unhandled'
    ? { kind: 'passed' }
    : { error, kind: 'failed' };

const fromDecided = (decided: Decided): Outcome => {
  switch (decided.verdict) {
    case 'allowed':
      return { kind: 'passed' };
    case 'vetoed':
      return { kind: 'vetoed', reason: decided.vetoes[0]?.reason };
    default:
      return { error: decided, kind: 'failed' };
  }
};

const track = (delivery: string, settled: Promise<Outcome>): Pending => {
  const state: PendingState = { released: false };
  const pending = {
    delivery,
    settled: settled.then(outcome => {
      state.done = outcome;
      return outcome;
    })
  };
  pendingStates.set(pending, state);
  return pending;
};

/**
 * A NorthTalk Host Adapter for an `odgn-ecs` World: one Script Group per
 * World, entities as Host Objects of the `entity` Object Kind, atoms with
 * Scripts on their Message Path, and the `world` and `clock` Capabilities.
 * The TypeScript twin of `odgn_ecs_talk` (ADR 0021): see its README.
 *
 * The caller drives it: `pump` with a Clock reading (epoch microseconds),
 * inside its own transaction. Every write goes through the World's Store, so
 * a Segment's writes are a SAVEPOINT that its rollback undoes.
 */
export const createEcsTalk = <TComponents extends Components>(
  world: World<TComponents>,
  options: EcsTalkOptions = {}
) => {
  const store: Store = world.store;
  const [locationName, locationField] = options.location ?? ['location', 'in'];
  const [namingName, namingPath] = options.naming ?? ['meta', ['props', 'id']];
  const onShow = options.onShow ?? (() => {});

  const handles = new Map<Eid, HostObject<EntityNative>>();
  const atomObjects = new Map<string, HostObject<AtomNative>>();
  const atomSources = new Map<
    string,
    { options: ScriptOptions; source: string }
  >();
  /** Host Objects at a position on a Message Path, by the path from there */
  const positions = new Map<string, HostObject<AtomNative>>();
  /** The atom each copy of a Script was loaded for, by the copy's name */
  const copies = new Map<string, string>();
  const services = new Map<string, HostObject<AtomNative>>();
  const entityScripts = new Set<Eid>();
  const deliveries = new Map<string, DeliveryEntry>();

  const atomLineage = (atom: string) => world.getAtomLineage(atom);

  // -- Handles --------------------------------------------------------------

  /** A callback's Handle: only one already made, of an entity that exists */
  const existingHandle = (eid: Eid) => {
    const obj = handles.get(eid);
    return obj && exists(store, eid) ? obj : undefined;
  };

  const live = (thing: HostObject<EntityNative>) => {
    const { eid } = thing.native;
    if (!exists(store, eid)) {
      throw new ScriptError('object gone', `Entity ${eid} is gone`);
    }
    return eid;
  };

  const write = (eid: Eid, name: string, data: Data) => {
    try {
      put(store, eid, name, data);
    } catch (error) {
      if (error instanceof StoreError) {
        throw new ScriptError('invalid value', error.message);
      }
      throw error;
    }
  };

  // -- Elements -------------------------------------------------------------

  /** The entities whose Location is `eid`, in id order */
  const elementIds = (eid: Eid): Eid[] =>
    storeElements(store, eid, { location: [locationName, locationField] });

  /** An Element's name, from the naming field, or undefined */
  const elementName = (eid: Eid): unknown => {
    if (!store.components.has(namingName)) {
      return undefined;
    }
    let value: unknown = get(store, eid, namingName);
    for (const key of namingPath) {
      value =
        value && typeof value === 'object'
          ? (value as Record<string, unknown>)[key]
          : undefined;
    }
    return value;
  };

  // -- The entity and atom Object Kinds -------------------------------------

  const props: Record<string, PropDef<EntityNative>> = {};
  for (const [name, component] of store.components) {
    props[name] = {
      get: o => {
        const { eid } = o.native;
        const data = exists(store, eid) ? get(store, eid, name) : undefined;
        return data ? componentValue(component, data, existingHandle) : nothing;
      },
      getCost: COST
    };
  }

  const elementAt = (eid: Eid, index: number): Value => {
    const ids = elementIds(eid);
    const member = index > 0 ? ids[index - 1] : ids.at(index);
    return (member !== undefined && existingHandle(member)?.value) || nothing;
  };

  const entityKind: ObjectKind<EntityNative> = defineObjectKind<EntityNative>({
    elements: {
      at: (o, index) => elementAt(o.native.eid, index),
      atCost: ELEMENT_COST,
      count: o => num(elementIds(o.native.eid).length),
      countCost: ELEMENT_COST,
      find: (o, name) => {
        const member = elementIds(o.native.eid).find(
          id => elementName(id) === name
        );
        return (
          (member !== undefined && existingHandle(member)?.value) || nothing
        );
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

  // -- Capabilities ---------------------------------------------------------

  const segment =
    (sql: (name: string) => string[]) => (context: { segmentId: string }) => {
      try {
        for (const statement of sql(savepoint(context.segmentId))) {
          store.db.exec(statement);
        }
        return OK;
      } catch (error) {
        return failed(error);
      }
    };

  const segments: SegmentLifecycle<void> = {
    begin: segment(name => [`SAVEPOINT ${name}`]),
    commit: segment(name => [`RELEASE ${name}`]),
    rollback: segment(name => [`ROLLBACK TO ${name}`, `RELEASE ${name}`])
  };

  const entity = shape.object(entityKind);

  const worldCapability = defineCapability(
    'world',
    {
      change: {
        args: [entity, shape.text, shape.any],
        command: true,
        cost: COST,
        do: (_call, thing, name, value) => {
          write(live(thing), name, fromScript(value) as Data);
          return nothing;
        },
        mode: 'immediate',
        segmentBound: true
      },
      find: {
        args: [entity, shape.text],
        cost: COST,
        do: (_call, place, name) => {
          if (!store.components.has(name)) {
            throw new ScriptError('invalid value', `Unknown component ${name}`);
          }
          const found = elementIds(place.native.eid)
            .filter(eid => get(store, eid, name) !== undefined)
            .map(eid => existingHandle(eid)?.value)
            .filter(v => v !== undefined);
          return list(...found);
        },
        mode: 'immediate',
        result: shape.listOf(entity)
      },
      moveTo: {
        args: [entity, entity],
        command: true,
        cost: COST,
        do: (_call, thing, place) => {
          const eid = live(thing);
          write(eid, locationName, { [locationField]: live(place) });
          return nothing;
        },
        mode: 'immediate',
        segmentBound: true
      },
      named: {
        args: [shape.text],
        cost: COST,
        do: (_call, name) => {
          const [eid] = query(store, {
            where: [['edl_definition', 'name', name]]
          });
          return (eid !== undefined && existingHandle(eid)?.value) || nothing;
        },
        mode: 'immediate',
        result: shape.optional(entity)
      },
      remove: {
        args: [entity, shape.text],
        command: true,
        cost: COST,
        do: (_call, thing, name) => {
          const eid = live(thing);
          try {
            removeComponent(store, eid, name);
          } catch (error) {
            if (error instanceof StoreError) {
              throw new ScriptError('invalid value', error.message);
            }
            throw error;
          }
          return nothing;
        },
        mode: 'immediate',
        segmentBound: true
      },
      resolve: {
        args: [shape.number],
        cost: COST,
        do: (_call, id) => {
          const eid = Number(id);
          return (
            (Number.isInteger(eid) && existingHandle(eid)?.value) || nothing
          );
        },
        mode: 'immediate',
        result: shape.optional(entity)
      },
      show: {
        args: [entity, shape.text],
        command: true,
        cost: COST,
        fire: (_call, actor, line) => onShow(actor.native.eid, line),
        mode: 'fire-and-forget'
      }
    },
    segments
  );

  /** `clock`'s `now` reads the Pump's Clock */
  const clock = clockCapability({ now: COST });

  const group: Group = newGroup({ name: options.name ?? 'world' });

  // filled in once the adapter exists, since each is made from it
  const hostCapabilities: CapabilityDef<void>[] = [];

  const grants = (extra: ScriptOptions['grants']) => ({
    clock: clock.grant('all', undefined),
    world: worldCapability.grant('all', undefined),
    ...Object.fromEntries(
      hostCapabilities.map(c => [c.name, c.grant('all', undefined)])
    ),
    ...options.grants,
    ...extra
  });

  // -- Scripts --------------------------------------------------------------

  const loadOwned = (
    name: string,
    owner: HostObject,
    source: string,
    scriptOptions: ScriptOptions = {}
  ) =>
    group.load({
      grants: grants(scriptOptions.grants),
      limits: { ...options.limits, ...scriptOptions.limits },
      name,
      owner,
      source
    });

  const scriptedPath = (bases: readonly string[]) =>
    linearize(bases, atomLineage).filter(atom => atomObjects.has(atom));

  const atomPath = (atom: string) => scriptedPath(atomLineage(atom) ?? []);

  /**
   * The Host Object at the head of a path of scripted atoms. The atom's own
   * Object serves the path above the atom itself; any other position gets an
   * Object of its own, owning a copy of the atom's Script, `atom@path`.
   */
  const objectFor = (
    path: readonly string[]
  ): HostObject<AtomNative> | undefined => {
    const [atom, ...rest] = path;
    if (atom === undefined) {
      return undefined;
    }
    if (samePath(rest, atomPath(atom))) {
      return atomObjects.get(atom);
    }
    const key = path.join(' ');
    const existing = positions.get(key);
    if (existing) {
      return existing;
    }
    const loaded = atomSources.get(atom)!;
    const obj = group.object(
      atomKind,
      `${atom} (${key})`,
      { atom },
      { parent: objectFor(rest) }
    );
    const script = `${atom}@${key}`;
    loadOwned(script, obj, loaded.source, loaded.options);
    positions.set(key, obj);
    copies.set(script, atom);
    return obj;
  };

  const parentOfEntity = (eid: Eid) =>
    objectFor(scriptedPath(world.getEntityLineage(eid)));

  /** The Handle of an entity, made the first time it is asked for */
  const handle = (eid: Eid): HostObject<EntityNative> => {
    const existing = handles.get(eid);
    if (existing) {
      return existing;
    }
    const obj = group.object(
      entityKind,
      String(eid),
      { eid },
      { parent: parentOfEntity(eid) }
    );
    handles.set(eid, obj);
    return obj;
  };

  /** Disposes of the Handle of an entity that has been deleted */
  const dropHandle = (eid: Eid) => {
    const obj = handles.get(eid);
    if (obj) {
      handles.delete(eid);
      group.dispose(obj);
    }
  };

  // Every path, after the set of scripted atoms changes
  const relink = () => {
    for (const [atom, obj] of atomObjects) {
      group.setParent(obj, objectFor(atomPath(atom)));
    }
    for (const [key, obj] of new Map(positions)) {
      group.setParent(obj, objectFor(key.split(' ').slice(1)));
    }
    for (const [eid, obj] of handles) {
      group.setParent(obj, parentOfEntity(eid));
    }
  };

  /** Loads a Script owned by an atom; entities built from it climb to it */
  const loadAtomScript = (
    atom: string,
    source: string,
    scriptOptions: ScriptOptions = {}
  ) => {
    if (atomLineage(atom) === undefined) {
      throw new Error(`No such atom: ${atom}`);
    }
    if (atomObjects.has(atom)) {
      throw new Error(`Atom ${atom} already has a Script`);
    }
    const obj = group.object(atomKind, atom, { atom });
    atomObjects.set(atom, obj);
    try {
      loadOwned(atom, obj, source, scriptOptions);
    } catch (error) {
      atomObjects.delete(atom);
      group.dispose(obj);
      throw error;
    }
    atomSources.set(atom, { options: scriptOptions, source });
    relink();
  };

  /** Loads a Script owned by an entity's Handle */
  const loadEntityScript = (
    eid: Eid,
    source: string,
    scriptOptions: ScriptOptions = {}
  ) => {
    loadOwned(`entity:${eid}`, handle(eid), source, scriptOptions);
    entityScripts.add(eid);
  };

  /**
   * Loads a Service Script: one owned by a Host Object of its own, so no
   * entity's Message Path reaches it. Send to it with `requestService` and
   * `decideService`.
   */
  const loadServiceScript = (
    service: string,
    source: string,
    scriptOptions: ScriptOptions = {}
  ) => {
    if (services.has(service)) {
      throw new Error(`Service ${service} already has a Script`);
    }
    // A Script that fails to load keeps its Object for the next try: an
    // Object's id can't be reused, even once it is disposed
    const id = `service:${service}`;
    const obj =
      (group.objectById(ATOM_KIND, id) as HostObject<AtomNative> | undefined) ??
      group.object(atomKind, id, { atom: service });
    loadOwned(id, obj, source, scriptOptions);
    services.set(service, obj);
  };

  /**
   * Loads a Service Script, or replaces its code if it is loaded already,
   * keeping its Host Object. A Script that fails to load is left as it was.
   */
  const putServiceScript = (
    service: string,
    source: string,
    scriptOptions: ScriptOptions = {}
  ) => {
    if (!services.has(service)) {
      loadServiceScript(service, source, scriptOptions);
      return;
    }
    forgetEnded(
      group.script(`service:${service}`)!.reload(source, 'reset variables')
    );
  };

  /**
   * Loads the Script of every atom and entity whose EDL declares one,
   * reading each source with `read`, a function of its path. Stops at the
   * first that fails, throwing a `ScriptLoadError` naming its path.
   */
  const loadScripts = (
    read: (path: string) => string,
    scriptOptions: ScriptOptions = {}
  ) => {
    for (const owner of world.getScriptOwners()) {
      try {
        const source = read(owner.src);
        if (owner.kind === 'atom') {
          loadAtomScript(owner.name, source, scriptOptions);
        } else {
          loadEntityScript(owner.eid, source, scriptOptions);
        }
      } catch (error) {
        throw new ScriptLoadError(owner.src, error);
      }
    }
  };

  /**
   * Compiles a Library and adds it to the Group, for Scripts loaded after
   * it. Its functions may call every Capability Scripts are granted, with
   * their caller's Grants, and those in `capabilities`, which Scripts must be
   * granted under their names.
   */
  const addLibrary = (
    name: string,
    source: string,
    imports: readonly Library[] = [],
    capabilities: readonly CapabilityDef<void>[] = []
  ): Library => {
    const library = compileLibrary(
      { name, source, version: '1' },
      imports,
      operationDeclarations([
        worldCapability,
        clock,
        ...hostCapabilities,
        ...capabilities
      ] as CapabilityDef<unknown>[])
    );
    group.addLibrary(library);
    return library;
  };

  /**
   * Whether a Script sits on an entity's Message Path, or the entity owns
   * one, so that sending it a message can be answered
   */
  const isScripted = (eid: Eid) =>
    entityScripts.has(eid) ||
    scriptedPath(world.getEntityLineage(eid)).length > 0;

  /**
   * The name a Script's timers and the like are scoped by: the Script's own,
   * or, for a copy of an atom's Script (`atom@path`), the atom's
   */
  const scriptName = (script: string) => copies.get(script) ?? script;

  // -- Sending --------------------------------------------------------------

  const note = (id: string, receiver: Eid | undefined, send: SendOptions) =>
    deliveries.set(id, { host: send.host, receiver });

  // A Delivery is done with once its causal work has ended
  const forgetEnded = (reports: readonly Report[]) => {
    for (const report of reports) {
      if (
        report.kind === 'causal work' &&
        report.liveRuns === 0 &&
        report.queuedMessages === 0
      ) {
        deliveries.delete(report.rootDelivery);
      }
    }
  };

  /** Pumps the Group once, with the Clock at `now` (epoch microseconds) */
  const pump = (now: bigint): PumpResult => {
    const result = group.pump(now);
    forgetEnded(result.reports);
    return result;
  };

  /**
   * Pumps the Group with the Clock at `now` until it is idle: no Run is
   * sliced, and `between`, called after each Pump, sent no more work.
   * Returns when NorthTalk next needs pumping, or undefined.
   */
  const pumpUntilIdle = (
    now: bigint,
    pumpOptions: { between?: () => boolean } = {}
  ): bigint | undefined => {
    const between = pumpOptions.between ?? (() => false);
    for (;;) {
      const result = pump(now);
      const more = between();
      if (result.state !== 'sliced' && !more) {
        return result.nextDeadline;
      }
    }
  };

  const serviceObject = (service: string) => {
    const obj = services.get(service);
    if (!obj) {
      throw new Error(`No Service Script named ${service}`);
    }
    return obj;
  };

  // The Request is noted before its first Pump, so its Run can find it
  const sendRequest = (
    to: HostObject,
    receiver: Eid | undefined,
    message: string,
    args: readonly Value[],
    now: bigint,
    send: SendOptions
  ): Pending => {
    const requested = group.request(to, { args: [...args], name: message });
    note(requested.id, receiver, send);
    const pending = track(
      requested.id,
      requested.result.then(fromReply, fromRejection)
    );
    pump(now);
    return pending;
  };

  const sendDecision = (
    to: HostObject,
    receiver: Eid | undefined,
    message: string,
    args: readonly Value[],
    send: SendOptions
  ): Pending => {
    const deciding = group.decide(to, { args: [...args], name: message });
    note(deciding.id, receiver, send);
    return track(
      deciding.id,
      deciding.decided.then(fromDecided, fromRejection)
    );
  };

  /** Delivers a message to an entity. Returns its delivery id */
  const deliver = (
    eid: Eid,
    message: string,
    args: readonly Value[] = [],
    send: SendOptions = {}
  ) => {
    const id = group.deliver(handle(eid), { args: [...args], name: message });
    note(id, eid, send);
    return id;
  };

  /** Sends a Request to an entity and Pumps once at `now` */
  const request = (
    eid: Eid,
    message: string,
    args: readonly Value[],
    now: bigint,
    send: SendOptions = {}
  ) => sendRequest(handle(eid), eid, message, args, now, send);

  /** Asks an entity's Message Path by a Decision */
  const decide = (
    eid: Eid,
    message: string,
    args: readonly Value[] = [],
    send: SendOptions = {}
  ) => sendDecision(handle(eid), eid, message, args, send);

  /** A Request to a Service Script, Pumped once at `now` */
  const requestService = (
    service: string,
    message: string,
    args: readonly Value[],
    now: bigint,
    send: SendOptions = {}
  ) => sendRequest(serviceObject(service), undefined, message, args, now, send);

  /** A Decision asked of a Service Script */
  const decideService = (
    service: string,
    message: string,
    args: readonly Value[] = [],
    send: SendOptions = {}
  ) => sendDecision(serviceObject(service), undefined, message, args, send);

  /**
   * The Delivery whose work a Capability call is part of, or undefined for
   * one the adapter didn't send or has forgotten. `receiver` is undefined for
   * a Service Script, and `host` is what it was sent with.
   */
  const delivery = (call: Pick<Call<unknown>, 'delivery'>) =>
    call.delivery === undefined ? undefined : deliveries.get(call.delivery);

  const talk = {
    addLibrary,
    atomKind,
    decide,
    decideService,
    deliver,
    delivery,
    dropHandle,
    elementIds,
    elementName,
    entityKind,
    group,
    handle,
    isScripted,
    loadAtomScript,
    loadEntityScript,
    loadScripts,
    loadServiceScript,
    pump,
    pumpUntilIdle,
    putServiceScript,
    request,
    requestService,
    scriptName,
    worldCapability
  };

  for (const make of options.capabilities ?? []) {
    hostCapabilities.push(make(talk as EcsTalk));
  }

  for (const eid of query(store)) {
    handle(eid);
  }

  return talk;
};

/** The adapter `createEcsTalk` returns */
export type EcsTalk = ReturnType<typeof createEcsTalk>;

/**
 * The outcome of a Request or Decision as the Group stands now, without
 * Pumping. Once it is anything but `waiting`, the adapter is done with it,
 * and asking again is an error. NorthTalk settles its promise as the Pump
 * answers it, so this waits only for that to be seen.
 */
export const outcome = async (pending: Pending): Promise<Outcome> => {
  const state = pendingStates.get(pending);
  if (!state || state.released) {
    throw new Error(`Delivery ${pending.delivery} has been released`);
  }
  // the promise chain `track` built settles within a few microtasks
  for (let i = 0; i < 4 && !state.done; i++) {
    await Promise.resolve();
  }
  if (!state.done) {
    return { kind: 'waiting' };
  }
  state.released = true;
  return state.done;
};

/**
 * Gives up on a Request or Decision still waiting, so the adapter holds
 * nothing for it. Its Run carries on unless its Script is replaced.
 */
export const abandon = (pending: Pending) => {
  const state = pendingStates.get(pending);
  if (state) {
    state.released = true;
  }
};

export { storeElements as elements };
