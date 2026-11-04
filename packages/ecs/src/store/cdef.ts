import type { CDef, CDefColumnInfo } from '../types';
import type { Column, ColumnType, Component } from './component';

const typeOf = (col: CDefColumnInfo): ColumnType => {
  if (col.foreignKey || col.type === 'eid') {
    return 'eid';
  }
  switch (col.type) {
    case 'pk':
      return 'int';
    case 'uuid':
      return 'string';
    case 'bool' as CDefColumnInfo['type']:
      return 'boolean';
    default:
      return col.type;
  }
};

const storedDefault = (value: unknown) =>
  Object.prototype.toString.call(value) === '[object Date]'
    ? (value as Date).toISOString()
    : (value ?? null);

/**
 * The store's definition of a TypeScript Component Definition. A column is
 * optional unless it says `optional: false`, as in `odgn_ecs` and EDL; the
 * `s` builders say so for every column not made `.optional()`.
 */
export const cdefToComponent = (
  cdef: CDef,
  playState = cdef.playState
): Component => ({
  columns: cdef.columns.map((col): Column => ({
    caseInsensitive: false,
    default: storedDefault(col.default),
    index: col.isIndexed === true,
    name: col.name,
    onDelete: col.onDelete ?? 'restrict',
    optional: col.optional !== false,
    type: typeOf(col),
    unique: col.isUnique === true
  })),
  name: cdef.id,
  playState: playState === true
});
