import {
  hashComponentDefinition,
  type HashComponentDefinitionInput
} from '@schema/component-hash';
import type { CDefWithSchema } from '@types';

import type { DefineComponentProps, DefineComponentSchema } from './types';

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

  const columns = Object.entries(schema).map(([name, schema]) =>
    schema.build({ name })
  );

  // hash the definition using its SQL create statement
  // but without the table name

  const partialDef: HashComponentDefinitionInput = {
    columns,
    id: componentId
  };

  const hash = hashComponentDefinition(partialDef);

  return {
    __schema: schema,
    columns,
    hash,
    id: componentId as Name,
    statements
  } as CDefWithSchema<S, Name>;
};
