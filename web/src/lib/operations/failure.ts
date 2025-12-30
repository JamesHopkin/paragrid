/**
 * Push operation failure information.
 */

import type { CellPosition } from '../core/position.js';

/**
 * Reasons why a push operation can fail.
 */
export type PushFailureReason =
  | 'ENTER_CYCLE'
  | 'EXIT_CYCLE'
  | 'BLOCKED'
  | 'STOP_TAG'
  | 'PATH_CYCLE'
  | 'NO_STRATEGY'
  | 'MAX_DEPTH';

/**
 * Information about a failed push operation.
 */
export interface PushFailure {
  readonly reason: PushFailureReason;
  readonly position: CellPosition;
  readonly details?: string;
}

/**
 * Type guard to check if a result is a PushFailure.
 */
export function isPushFailure(value: unknown): value is PushFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    'reason' in value &&
    'position' in value
  );
}
