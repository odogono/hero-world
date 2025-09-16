import { toTableName } from './helpers/to-table-name';
import type {
  CDefWithSchema,
  DefineComponentProps,
  DefineComponentSchema
} from './types';

export const defineComponent = <S extends DefineComponentSchema>(
  props: DefineComponentProps<S>
): CDefWithSchema<S> => {
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
    id: componentId,
    statements,
    tableName
  } as CDefWithSchema<S>;
};
