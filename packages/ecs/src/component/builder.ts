import type { CDefColumnInfo, CDefColumnType } from '@types';

import { getDefault } from './defaults';
import type { ColumnBuilder } from './types';

const columnBuilder = <TType extends CDefColumnType>(
  type: TType
): ColumnBuilder<TType, false> => {
  const column: CDefColumnInfo = {
    name: 'unknown',
    optional: false,
    type
  };

  const builder: ColumnBuilder<TType, false> = {
    build: (props: { name: string }) => {
      column.name = props.name;
      return column;
    },
    default: (
      value?:
        string | number | boolean | Array<string | number | boolean> | undefined
    ) => {
      column.default = value === undefined ? getDefault(column.type) : value;
      return builder;
    },
    foreignKey: (foreignKey: string) => {
      column.foreignKey = foreignKey;
      return builder;
    },
    indexed: () => {
      column.isIndexed = true;
      return builder;
    },
    optional: () => {
      column.optional = true;
      return builder as unknown as ColumnBuilder<TType, true>;
    },
    unique: () => {
      column.isUnique = true;
      return builder;
    }
  };

  return builder;
};

const array = (type: CDefColumnType) => columnBuilder('array');
const boolean = () => columnBuilder('boolean');
const date = () => columnBuilder('date');
const datetime = () => columnBuilder('datetime');
const email = () => columnBuilder('email');
const entityId = () => columnBuilder('int').optional().foreignKey('tbl_entity');
const enumBuilder = (values: string[]) => {
  const builder = columnBuilder('string');
  const column = builder.build({ name: 'temp' });
  column.enum = values;

  const modifiedBuilder = {
    ...builder,
    build: (props: { name: string }) => {
      column.name = props.name;
      return column;
    }
  };

  return modifiedBuilder;
};
const float = () => columnBuilder('float');
const int = () => columnBuilder('int');
const json = () => columnBuilder('json');
const now = () => 'current_timestamp';
const number = () => columnBuilder('float');
const pk = () => columnBuilder('pk');
const string = () => columnBuilder('string');
const time = () => columnBuilder('time');
const timestamp = () => columnBuilder('timestamp');
const uuid = () => columnBuilder('uuid');

export const s = {
  array,
  boolean,
  date,
  datetime,
  email,
  entityId,
  enum: enumBuilder,
  float,
  int,
  json,
  now,
  number,
  pk,
  string,
  time,
  timestamp,
  uuid
};
