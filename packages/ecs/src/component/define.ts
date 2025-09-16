import { toTableName } from './helpers/to-table-name';
import type {
  CDefWithSchema,
  DefineComponentProps,
  DefineComponentSchema
} from './types';

export const defineComponent = <
  S extends DefineComponentSchema,
  Name extends string
>(
  props: DefineComponentProps<S, Name>
): CDefWithSchema<S, Name> => {
  const {
    id: componentId,
    schema,
    statements,
    tableName: tableNameProp
  } = props;

  if (!componentId) {
    throw new Error('id must be provided to defineComponent');
  }

  const tableName = toTableName(tableNameProp ?? componentId);

  const columns = Object.entries(schema).map(([name, schema]) =>
    schema.build({ name })
  );

  return {
    columns,
    id: componentId as Name,
    statements,
    tableName
  } as CDefWithSchema<S, Name>;
};
