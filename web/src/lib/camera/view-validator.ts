/**
 * View Validator - Validates camera view paths and updates.
 *
 * Provides validation functions to ensure that view paths returned by camera
 * controllers are structurally valid before being used by the rendering system.
 * This catches errors close to their source rather than failing downstream.
 */

import type { GridStore } from '../core/types.js';
import { getGrid } from '../core/types.js';
import { findPrimaryRef } from '../utils/immutable.js';
import type { ViewPath, ViewUpdate } from './camera-protocol.js';

/**
 * Validation error details.
 */
export interface ValidationError {
  /** Human-readable error message */
  readonly message: string;
  /** The grid ID that caused the error (if applicable) */
  readonly gridId?: string;
  /** The index in the path where the error occurred (if applicable) */
  readonly pathIndex?: number;
}

/**
 * Result of view path validation.
 */
export interface ValidationResult {
  /** Whether the validation passed */
  readonly valid: boolean;
  /** Error details if validation failed */
  readonly error?: ValidationError;
}

/**
 * Validate a view path.
 *
 * Checks that:
 * 1. The path is non-empty
 * 2. All grids in the path exist in the store
 * 3. Each consecutive pair forms a valid parent-child relationship via primary reference
 *
 * @param store - The grid store
 * @param path - The view path to validate
 * @returns Validation result with error details if invalid
 *
 * @example
 * ```typescript
 * const result = validateViewPath(store, ['main', 'inner']);
 * if (!result.valid) {
 *   console.error(`Invalid view path: ${result.error.message}`);
 * }
 * ```
 */
export function validateViewPath(
  store: GridStore,
  path: ViewPath
): ValidationResult {
  // Check path is non-empty
  if (path.length === 0) {
    return {
      valid: false,
      error: {
        message: 'View path is empty',
      },
    };
  }

  // Check all grids exist
  for (let i = 0; i < path.length; i++) {
    const gridId = path[i];
    const grid = getGrid(store, gridId);

    if (!grid) {
      return {
        valid: false,
        error: {
          message: `Grid '${gridId}' does not exist`,
          gridId,
          pathIndex: i,
        },
      };
    }
  }

  // Check each consecutive pair forms a valid parent-child relationship
  for (let i = 0; i < path.length - 1; i++) {
    const parentGridId = path[i];
    const childGridId = path[i + 1];

    // Find the child's primary reference
    const primaryRef = findPrimaryRef(store, childGridId);

    if (!primaryRef) {
      return {
        valid: false,
        error: {
          message: `Grid '${childGridId}' has no primary reference (not referenced by any parent)`,
          gridId: childGridId,
          pathIndex: i + 1,
        },
      };
    }

    const [actualParentId] = primaryRef;

    // Verify the primary reference is in the expected parent
    if (actualParentId !== parentGridId) {
      return {
        valid: false,
        error: {
          message: `Invalid hierarchy: Grid '${childGridId}' is not a child of '${parentGridId}' (primary reference is in '${actualParentId}')`,
          gridId: childGridId,
          pathIndex: i + 1,
        },
      };
    }
  }

  return { valid: true };
}

/**
 * Validate a view update returned by a camera controller.
 *
 * Validates both the target view and optional animation start view.
 *
 * @param store - The grid store
 * @param update - The view update to validate
 * @param context - Optional context string for error messages (e.g., "onPlayerEnter")
 * @returns Validation result with error details if invalid
 *
 * @example
 * ```typescript
 * const update = cameraController.onPlayerEnter('from', 'to');
 * const result = validateViewUpdate(store, update, 'onPlayerEnter');
 * if (!result.valid) {
 *   console.error(`Camera error in onPlayerEnter: ${result.error.message}`);
 * }
 * ```
 */
export function validateViewUpdate(
  store: GridStore,
  update: ViewUpdate,
  context?: string
): ValidationResult {
  const contextPrefix = context ? `${context}: ` : '';

  // Validate target view
  const targetResult = validateViewPath(store, update.targetView);
  if (!targetResult.valid) {
    return {
      valid: false,
      error: {
        message: `${contextPrefix}Invalid targetView - ${targetResult.error!.message}`,
        gridId: targetResult.error!.gridId,
        pathIndex: targetResult.error!.pathIndex,
      },
    };
  }

  // Validate animation start view if present
  if (update.animationStartView) {
    const animStartResult = validateViewPath(store, update.animationStartView);
    if (!animStartResult.valid) {
      return {
        valid: false,
        error: {
          message: `${contextPrefix}Invalid animationStartView - ${animStartResult.error!.message}`,
          gridId: animStartResult.error!.gridId,
          pathIndex: animStartResult.error!.pathIndex,
        },
      };
    }
  }

  return { valid: true };
}

/**
 * Assert that a view path is valid, throwing an error if not.
 *
 * This is a convenience function for cases where you want to fail fast
 * with a clear error message.
 *
 * @param store - The grid store
 * @param path - The view path to validate
 * @param context - Optional context for the error message
 * @throws Error if the path is invalid
 */
export function assertValidViewPath(
  store: GridStore,
  path: ViewPath,
  context?: string
): void {
  const result = validateViewPath(store, path);
  if (!result.valid) {
    const prefix = context ? `${context}: ` : '';
    throw new Error(`${prefix}${result.error!.message}`);
  }
}

/**
 * Assert that a view update is valid, throwing an error if not.
 *
 * @param store - The grid store
 * @param update - The view update to validate
 * @param context - Optional context for the error message
 * @throws Error if the update is invalid
 */
export function assertValidViewUpdate(
  store: GridStore,
  update: ViewUpdate,
  context?: string
): void {
  const result = validateViewUpdate(store, update, context);
  if (!result.valid) {
    throw new Error(result.error!.message);
  }
}
