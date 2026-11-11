import type { Component } from 'odgn-ecs/store';

import {
  Decimal,
  Value,
  bool,
  dec,
  fromValue,
  list,
  map,
  nothing,
  num,
  text,
  type HostObject
} from '@northtalk/ts';

/**
 * Between component data and NorthTalk Values, as `OdgnEcsTalk.Values`.
 * NorthTalk refuses floats, so a number that isn't an integer, or any number
 * in a `float` column, becomes a Decimal; maps are ordered, with a
 * component's in column order and others by key. An entity's Handle stands
 * for its id, both ways: a reference column (`eid`) reaches a Script as the
 * Handle, and a Handle is stored as the id.
 */

const decimal = (n: number) =>
  dec(Number.isInteger(n) ? n.toFixed(1) : String(n));

/** Plain data as a Value */
export const toValue = (v: unknown): Value => {
  if (v === null || v === undefined) {
    return nothing;
  }
  if (typeof v === 'number') {
    return Number.isInteger(v) ? num(v) : decimal(v);
  }
  if (typeof v === 'string') {
    return text(v);
  }
  if (typeof v === 'boolean') {
    return bool(v);
  }
  if (Array.isArray(v)) {
    return list(...v.map(toValue));
  }
  if (typeof v === 'object') {
    return map(
      Object.keys(v)
        .sort()
        .map(k => [k, toValue((v as Record<string, unknown>)[k])])
    );
  }
  throw new TypeError(`No Value for ${String(v)}`);
};

/**
 * Component data for a Script, as a map in column order. `handle` gives the
 * Handle for a reference column's id, or undefined when it has none.
 */
export const componentValue = (
  component: Component,
  data: Record<string, unknown>,
  handle: (eid: number) => HostObject | undefined
): Value =>
  map(
    component.columns.map(column => {
      const v = data[column.name];
      if (column.type === 'eid' && typeof v === 'number') {
        return [column.name, handle(v)?.value ?? nothing];
      }
      if (column.type === 'float' && typeof v === 'number') {
        return [column.name, decimal(v)];
      }
      return [column.name, toValue(v)];
    })
  );

/** The native data behind an entity's Handle */
export type EntityNative = { eid: number };

const isHandle = (v: unknown): v is HostObject<EntityNative> =>
  typeof v === 'object' &&
  v !== null &&
  'native' in v &&
  typeof (v as HostObject<EntityNative>).native?.eid === 'number';

/** Whether a Value is a Decimal */
export const isDecimal = (v: unknown): v is Decimal =>
  typeof v === 'object' && v !== null && v.constructor === Decimal;

const isValue = (v: unknown): v is Value =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as Value).asObject === 'function';

const plain = (v: unknown): unknown => {
  if (isDecimal(v)) {
    return Number(v.toString());
  }
  if (typeof v === 'bigint') {
    return Number(v);
  }
  if (isHandle(v)) {
    return v.native.eid;
  }
  // a Handle inside a list or map stays a Value
  if (isValue(v)) {
    const o = v.asObject();
    return isHandle(o) ? o.native.eid : v;
  }
  if (Array.isArray(v)) {
    return v.map(plain);
  }
  if (v && typeof v === 'object' && v.constructor === Object) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  }
  return v;
};

/** A Script's Value as plain data for a component: a Handle becomes its id */
export const fromScript = (v: Value): unknown =>
  plain(fromValue(v, { maps: 'object', numbers: 'decimal' }));
