import type { CDefColumnInfo, CDefColumnType } from '../types';
import { getDefault } from './defaults';
import type { ColumnBuilder, ValueFromType } from './types';

const columnBuilder = <
  TType extends CDefColumnType,
  TValue = ValueFromType<TType>
>(
  type: TType
): ColumnBuilder<TType, false, TValue> => {
  const column: CDefColumnInfo = {
    name: 'unknown',
    optional: false,
    type
  };

  const builder: ColumnBuilder<TType, false, TValue> = {
    build: (props: { name: string }) => {
      column.name = props.name;
      return column;
    },
    default: (value?: unknown) => {
      column.default =
        value === undefined
          ? getDefault(column.type)
          : (value as CDefColumnInfo['default']);
      return builder as unknown as ColumnBuilder<TType, false, TValue, true>;
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
      return builder as unknown as ColumnBuilder<TType, true, TValue>;
    },
    unique: () => {
      column.isUnique = true;
      return builder;
    }
  };

  return builder;
};

/** An array stored as JSON; `type` types the items but isn't checked. */
const array = <TItem extends CDefColumnType>(_type: TItem) =>
  columnBuilder<'array', ValueFromType<TItem>[]>('array');
const boolean = () => columnBuilder('boolean');
const date = () => columnBuilder('date');
const datetime = () => columnBuilder('datetime');
const email = () => columnBuilder('email');
const entityId = () => columnBuilder('int').optional().foreignKey('tbl_entity');
/** A string limited to `values`, typed as their union */
const enumBuilder = <const TValues extends readonly string[]>(
  values: TValues
) => {
  const builder = columnBuilder<'string', TValues[number]>('string');
  const column = builder.build({ name: 'temp' });
  column.enum = [...values];

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
/** A JSON value; pass its type, as in `s.json<PendingCommand>()`. */
const json = <TValue = unknown>() => columnBuilder<'json', TValue>('json');
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
