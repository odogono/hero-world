import { toCamelCase, toSnakeCase } from 'odgn-helpers/string';

import type { CDef } from '../types';

export { s } from './builder';
export { type InferComponentType } from './types';
export { addComponent, addComponents } from './add';
export { createComponent } from './create';
export { defineComponent } from './define';
export { removeComponent } from './remove';
export { applyComponentDefaults } from './defaults';

export { makeTrackedComponent } from './helpers/make-tracked';

export const defToTableName = (cdef: CDef): string =>
  `tbl_${toSnakeCase(cdef.id)!}_${cdef.hash}`;

export const toTableName = (
  defId: string,
  hash?: string | undefined
): string =>
  hash ? `tbl_${toSnakeCase(defId)}_${hash}` : `tbl_${toSnakeCase(defId)}`;

export const tableNameToDefId = (tableName: string): string =>
  toCamelCase(
    tableName.slice(0, tableName.lastIndexOf('_')).replace(/^tbl_/, '')
  )!;
