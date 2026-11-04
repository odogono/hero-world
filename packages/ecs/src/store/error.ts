import { ECSError } from '../error';

/**
 * An error from the store. `code` names the kind, as `OdgnEcs.Error` does:
 * `unknown_component`, `unknown_entity`, `unknown_property`,
 * `invalid_value`, `missing_value`, `invalid_component`, `reserved_column`,
 * `incompatible_change`, `dangling_reference`, `referenced`, `constraint`.
 */
export class StoreError extends ECSError {
  constructor(code: string, message: string) {
    super(message, code);
    this.name = 'StoreError';
    Object.setPrototypeOf(this, StoreError.prototype);
  }
}
