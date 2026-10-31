import { ECSError } from '../error';

export const EDLErrorCodes = {
  EDL_CIRCULAR_REFERENCE: 'EDL_CIRCULAR_REFERENCE',
  EDL_ERROR: 'EDL_ERROR',
  EDL_EXECUTION_ERROR: 'EDL_EXECUTION_ERROR',
  EDL_INVALID_EXTEND: 'EDL_INVALID_EXTEND',
  EDL_MISSING_COMPONENT: 'EDL_MISSING_COMPONENT',
  EDL_MISSING_PROPERTY: 'EDL_MISSING_PROPERTY',
  EDL_PARSE_ERROR: 'EDL_PARSE_ERROR',
  EDL_UNKNOWN_ENTITY_REFERENCE: 'EDL_UNKNOWN_ENTITY_REFERENCE'
} as const;

export class EDLError extends ECSError {
  constructor(
    message: string,
    context?: Record<string, unknown>,
    code: string = EDLErrorCodes.EDL_ERROR
  ) {
    super(message, code, context);
    this.name = 'EDLError';
    Object.setPrototypeOf(this, EDLError.prototype);
  }
}

export class EDLParseError extends EDLError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context, EDLErrorCodes.EDL_PARSE_ERROR);
    this.name = 'EDLParseError';
    Object.setPrototypeOf(this, EDLParseError.prototype);
  }
}

export class EDLUnknownEntityReferenceError extends EDLError {
  constructor(ref: string, context?: Record<string, unknown>) {
    super(
      `Unknown entity reference '${ref}'`,
      { ref, ...context },
      EDLErrorCodes.EDL_UNKNOWN_ENTITY_REFERENCE
    );
    this.name = 'EDLUnknownEntityReferenceError';
    Object.setPrototypeOf(this, EDLUnknownEntityReferenceError.prototype);
  }
}

export class EDLMissingComponentError extends EDLError {
  constructor(entity: string, component: string) {
    super(
      `Component '${component}' not found on entity '${entity}'`,
      {
        component,
        entity
      },
      EDLErrorCodes.EDL_MISSING_COMPONENT
    );
    this.name = 'EDLMissingComponentError';
    Object.setPrototypeOf(this, EDLMissingComponentError.prototype);
  }
}

export class EDLMissingPropertyError extends EDLError {
  constructor(entity: string, path: string) {
    super(
      `Property '${path}' not found`,
      { entity, path },
      EDLErrorCodes.EDL_MISSING_PROPERTY
    );
    this.name = 'EDLMissingPropertyError';
    Object.setPrototypeOf(this, EDLMissingPropertyError.prototype);
  }
}

export class EDLCircularReferenceError extends EDLError {
  constructor(ref: string) {
    super(
      `Circular reference detected for '${ref}'`,
      { ref },
      EDLErrorCodes.EDL_CIRCULAR_REFERENCE
    );
    this.name = 'EDLCircularReferenceError';
    Object.setPrototypeOf(this, EDLCircularReferenceError.prototype);
  }
}

export class EDLExecutionError extends EDLError {
  public readonly errors: EDLError[];
  constructor(errors: EDLError[]) {
    super(
      [
        'EDL execution encountered reference errors:',
        ...errors.map(e => `- ${e.message}`)
      ].join('\n'),
      { count: errors.length },
      EDLErrorCodes.EDL_EXECUTION_ERROR
    );
    this.name = 'EDLExecutionError';
    this.errors = errors;
    Object.setPrototypeOf(this, EDLExecutionError.prototype);
  }
}

export class EDLInvalidExtendError extends EDLError {
  constructor(name: string, base: string) {
    super(
      `'${name}' cannot extend '${base}': only atoms may be extended, and '${base}' is an entity`,
      { base, name },
      EDLErrorCodes.EDL_INVALID_EXTEND
    );
    this.name = 'EDLInvalidExtendError';
    Object.setPrototypeOf(this, EDLInvalidExtendError.prototype);
  }
}
