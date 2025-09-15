import { toSnakeCase } from 'odgn-helpers/string';

import type { CDef, CDefColumnInfo, CDefColumnType } from '@types';

type DefineComponentSchema = {
  [name: string]: ReturnType<typeof columnBuilder>;
};

type DefineComponentProps = {
  id: string;
  schema: DefineComponentSchema;
  tableName?: string;
};

export const defineComponent = (props: DefineComponentProps): CDef => {
  const { id, schema, tableName: tableNameProp } = props;
  const tableName = toTableName(tableNameProp ?? id);

  const columns = Object.entries(schema).map(([name, schema]) =>
    schema.build({ name })
  );

  return {
    columns,
    id,
    tableName
  };
};

/**
 * Get the default values for a component definition
 * @param def - The component definition
 * @returns The default values for the component
 */
export const getDefaults = (def: CDef) =>
  def.columns.reduce(
    (acc, column) => {
      acc[column.name] = column.default ?? getDefault(column.type);
      return acc;
    },
    {} as Record<string, string | number | boolean>
  );

const columnBuilder = (type: CDefColumnType) => {
  const column: CDefColumnInfo = {
    name: 'unknown',
    optional: false,
    type
  };

  const builder = {
    build: (props: { name: string }) => {
      column.name = props.name;
      return column;
    },
    default: (value?: string | number | boolean | undefined) => {
      column.default = value === undefined ? getDefault(column.type) : value;
      return builder;
    },
    indexed: () => {
      column.isIndexed = true;
      return builder;
    },
    unique: () => {
      column.isUnique = true;
      return builder;
    }
  };

  return builder;
};

export const email = () => columnBuilder('email');
export const string = () => columnBuilder('string');
export const int = () => columnBuilder('int');
export const float = () => columnBuilder('float');
export const boolean = () => columnBuilder('boolean');
export const datetime = () => columnBuilder('datetime');
export const date = () => columnBuilder('date');
export const time = () => columnBuilder('time');
export const timestamp = () => columnBuilder('timestamp');
export const json = () => columnBuilder('json');
export const array = () => columnBuilder('array');
export const now = () => 'current_timestamp';

const getDefault = (type: CDefColumnType) => {
  switch (type) {
    case 'string':
    case 'email':
      return '';
    case 'int':
      return 0;
    case 'float':
      return 0.0;
    case 'boolean':
      return false;
    case 'datetime':
      return 'current_timestamp';
    case 'date':
      return 'current_date';
    case 'time':
      return 'current_time';
    case 'timestamp':
      return 'current_timestamp';
    default:
      return '';
  }
};

const toTableName = (id: string) => {
  if (id.startsWith('tbl_')) {
    id = id.slice(4);
  }
  return `tbl_${toSnakeCase(id)}`;
};
