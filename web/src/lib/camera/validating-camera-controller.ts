/**
 * Validating Camera Controller - Wrapper that validates camera outputs.
 *
 * This wrapper implements the CameraController interface and delegates all
 * calls to an underlying implementation, validating the results before
 * returning them. This catches errors close to their source rather than
 * failing downstream in the rendering system.
 *
 * Usage:
 * ```typescript
 * const camera = new AnimatedParentViewCameraController(helper);
 * const validatingCamera = new ValidatingCameraController(camera, store);
 * // Now use validatingCamera - all outputs will be validated
 * ```
 */

import type { CameraController, ViewUpdate } from './camera-protocol.js';
import type { GridStore } from '../core/types.js';
import { assertValidViewUpdate } from './view-validator.js';

/**
 * Camera controller wrapper that validates all outputs.
 *
 * Wraps any CameraController implementation and validates that all returned
 * ViewUpdate objects contain valid view paths that form proper hierarchies.
 */
export class ValidatingCameraController implements CameraController {
  /**
   * @param controller - The underlying camera controller to wrap
   * @param store - The grid store (must be kept in sync with the controller's state)
   */
  constructor(
    private controller: CameraController,
    private store: GridStore
  ) {}

  /**
   * Update the grid store reference.
   * Call this after the store has been modified or replaced.
   */
  setStore(store: GridStore): void {
    this.store = store;
  }

  /**
   * Get the current grid store.
   */
  getStore(): GridStore {
    return this.store;
  }

  /**
   * Get initial view when the game starts.
   * Validates the result before returning.
   */
  getInitialView(playerGridId: string): ViewUpdate {
    const update = this.controller.getInitialView(playerGridId);
    assertValidViewUpdate(
      this.store,
      update,
      `${this.controller.constructor.name}.getInitialView`
    );
    return update;
  }

  /**
   * Get view update when player enters a new grid.
   * Validates the result before returning.
   */
  onPlayerEnter(fromGridId: string, toGridId: string, viaNonPrimaryReference: boolean): ViewUpdate {
    const update = this.controller.onPlayerEnter(fromGridId, toGridId, viaNonPrimaryReference);
    assertValidViewUpdate(
      this.store,
      update,
      `${this.controller.constructor.name}.onPlayerEnter`
    );
    return update;
  }

  /**
   * Get view update when player exits a grid.
   * Validates the result before returning.
   */
  onPlayerExit(fromGridId: string, toGridId: string): ViewUpdate {
    const update = this.controller.onPlayerExit(fromGridId, toGridId);
    assertValidViewUpdate(
      this.store,
      update,
      `${this.controller.constructor.name}.onPlayerExit`
    );
    return update;
  }

  /**
   * Get view update when player moves within the same grid.
   * Validates the result before returning.
   */
  onPlayerMove(gridId: string): ViewUpdate {
    const update = this.controller.onPlayerMove(gridId);
    assertValidViewUpdate(
      this.store,
      update,
      `${this.controller.constructor.name}.onPlayerMove`
    );
    return update;
  }
}
