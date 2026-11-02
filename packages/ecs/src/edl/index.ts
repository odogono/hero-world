export { parse as parseEDL } from './parser';
export { executeEDL, type ExecuteOptions } from './execute';
export { hashEDL } from './compile';
export {
  adoptDefinitionNames,
  isEDLChanged,
  migrateEDL,
  type EntityMigration,
  type MigrateOptions,
  type MigrationPlan
} from './migrate';
export {
  serializeComponentDef,
  serializeComponentDefs,
  serializeEDL,
  serializeEntities,
  serializeEntity
} from './serialize';
export {
  EDLError,
  EDLExecutionError,
  EDLParseError,
  EDLMissingComponentError,
  EDLMissingPropertyError,
  EDLErrorCodes,
  EDLUnknownEntityReferenceError,
  EDLCircularReferenceError
} from './errors';
