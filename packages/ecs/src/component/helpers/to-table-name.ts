import { toSnakeCase } from 'odgn-helpers/string';

export const toTableName = (id: string) => {
  if (id.startsWith('tbl_')) {
    id = id.slice(4);
  }
  return `tbl_${toSnakeCase(id)}`;
};
