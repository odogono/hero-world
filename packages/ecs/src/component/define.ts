import { toSnakeCase } from 'odgn-helpers/string';

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

  // Validate that no schema key is a reserved column name
  for (const key of Object.keys(schema)) {
    const name = toSnakeCase(key) || key;
    if (name === 'id' || name === 'eid') {
      throw new Error(
        `Component '${componentId}' cannot define reserved column '${name}'.`
      );
    }
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
