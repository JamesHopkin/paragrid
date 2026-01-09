/**
 * Camera Protocol - Interface for game camera view providers.
 *
 * A view provider determines which grid path should be displayed based on
 * the player's current position. Views are represented as paths through the
 * grid hierarchy (array of grid IDs from root to target).
 *
 * Camera controllers use a HierarchyHelper to query the grid hierarchy
 * without direct access to the GridStore.
 *
 * See docs/game-camera-proposal.md for design details.
 */

/**
 * A view is represented by a path of grid names from root to target.
 * The scale helper can convert this path into camera position and scale.
 *
 * Example: ['main', 'inner'] means viewing the 'inner' grid which is
 * referenced by 'main'.
 */
export type ViewPath = readonly string[];

/**
 * View update returned by the camera controller.
 * Contains the target view and optionally an animation start view.
 */
export interface ViewUpdate {
  /**
   * The target view path to display.
   * Must start with a root grid.
   */
  readonly targetView: ViewPath;

  /**
   * Optional animation start view for smooth transitions.
   * If provided, the camera should animate from this view to targetView.
   * If not provided, no animation is performed (instant jump to targetView).
   *
   * This is useful for handling visually equivalent views in cycles.
   * For example, when transitioning from 'a.b' to 'a.b.a.b', both views
   * focus on the same content but the animation provides continuity.
   */
  readonly animationStartView?: ViewPath;

  /**
   * If true, the camera should track any object animations affecting
   * the focused grid. This makes the camera follow the grid if it's
   * being pushed or moved as part of an operation.
   *
   * When enabled, the rendering system applies the same positional
   * animation offsets to the camera that are applied to the focused grid.
   *
   * Typically enabled for cameras that stay locked to a moving player grid.
   * Defaults to false if not specified.
   */
  readonly trackObjectAnimations?: boolean;
}

/**
 * Camera view provider interface.
 *
 * Implementations determine which view path to display based on player position
 * and grid transitions. The view provider protocol cleanly separates camera
 * logic from rendering logic.
 *
 * Camera controllers are constructed with a HierarchyHelper and use it to
 * query the grid hierarchy. The GridStore is not passed to methods.
 */
export interface CameraController {
  /**
   * Get standard steady-state view for a player position.
   * This is the view shown when not animating (initial state, after animations complete).
   *
   * @param playerGridId - The grid containing the player
   * @returns Standard view update
   */
  getStandardView(playerGridId: string): ViewUpdate;

  /**
   * Get view update when player enters a new grid (through a reference cell).
   *
   * @param fromGridId - Grid the player is leaving
   * @param toGridId - Grid the player is entering
   * @param viaNonPrimaryReference - True if entering via a non-primary (secondary) reference
   * @returns View update, potentially with animation start view
   */
  onPlayerEnter(fromGridId: string, toGridId: string, viaNonPrimaryReference: boolean): ViewUpdate;

  /**
   * Get view update when player exits a grid (moving out of a reference cell).
   *
   * @param fromGridId - Grid the player is leaving
   * @param toGridId - Grid the player is entering
   * @returns View update, potentially with animation start view
   */
  onPlayerExit(fromGridId: string, toGridId: string): ViewUpdate;

  /**
   * Get view update when player moves within the same grid (no enter/exit).
   * Most camera controllers will keep the same view for within-grid movement.
   *
   * @param gridId - Grid the player is moving within
   * @returns View update (typically unchanged from previous view)
   */
  onPlayerMove(gridId: string): ViewUpdate;
}
