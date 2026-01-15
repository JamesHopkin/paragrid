/**
 * Stateful navigator through grid positions in a direction.
 * Handles grid traversal with automatic edge detection and entry/exit logic.
 */

import { Direction, flipDirection } from '../core/direction.js';
import { CellPosition } from '../core/position.js';
import type { GridStore } from '../core/types.js';
import { isRef } from '../core/types.js';
import type { RuleSet } from '../operations/rules.js';
import { getCellAtPosition, findPrimaryRef } from '../utils/immutable.js';
import { tryEnter, type AncestorBasedEntryOptions } from './try-enter.js';

/**
 * Type of transition that occurred during the last navigation operation.
 * - 'move': Moved within the same grid
 * - 'exit': Exited from a nested grid to parent
 * - 'enter': Entered a grid through a Ref cell
 * - null: No transition yet (initial state)
 */
export type NavigatorTransition = 'move' | 'exit' | 'enter' | null;

/**
 * Navigator for stateful grid traversal.
 *
 * Handles:
 * - Moving through grids in a direction
 * - Automatic edge detection and exit to parent grids
 * - Entry into referenced grids through Ref cells
 * - Cycle detection for entry and exit
 */
export class Navigator {
  /** Current position in the grid structure */
  public current: CellPosition;

  /** Direction of movement */
  public direction: Direction;

  /** The grid store being navigated */
  private readonly store: GridStore;

  /** Set of visited grids for exit cycle detection */
  private visitedGrids: Set<string>;

  /** Direction deltas for movement */
  private readonly deltas: Record<Direction, [number, number]>;

  /** Type of the last navigation operation performed */
  private lastTransitionType: NavigatorTransition;

  /** For 'enter' transitions, the target grid ID of the last non-primary ref encountered, if any */
  private lastTeleportToGrid: string | null;

  /** Ancestor-based entry tracking: Grid we exited from (for ancestor mapping) */
  private exitGridId: string | null;

  /** Ancestor-based entry tracking: (row, col) when last exit occurred */
  private exitPosition: [number, number] | null;

  /** Ancestor-based entry tracking: Ancestor grid where we landed after exit */
  private ancestorGridIdForEntry: string | null;

  /** Ancestor-based entry tracking: Explicit ref chain from ancestor (parent_grid_id, ref_row, ref_col, child_grid_id) */
  private refChainFromAncestor: Array<[string, number, number, string]>;

  constructor(store: GridStore, position: CellPosition, direction: Direction) {
    this.store = store;
    this.current = position.clone();
    this.direction = direction;
    this.visitedGrids = new Set();
    this.lastTransitionType = null;
    this.lastTeleportToGrid = null;

    // Ancestor-based entry tracking
    this.exitGridId = null;
    this.exitPosition = null;
    this.ancestorGridIdForEntry = null;
    this.refChainFromAncestor = [];

    this.deltas = {
      [Direction.N]: [-1, 0],
      [Direction.S]: [1, 0],
      [Direction.E]: [0, 1],
      [Direction.W]: [0, -1],
    };
  }

  /**
   * Get the type of transition that occurred during the last navigation operation.
   */
  getLastTransition(): NavigatorTransition {
    return this.lastTransitionType;
  }

  /**
   * Get the target grid ID of the last non-primary ref encountered during the last 'enter' transition.
   * Only meaningful when getLastTransition() returns 'enter'.
   * @returns grid ID where the last teleport occurred, or null if no teleport or not applicable
   */
  getLastTeleportToGrid(): string | null {
    return this.lastTeleportToGrid;
  }

  /**
   * Create a copy for backtracking.
   */
  clone(): Navigator {
    const nav = new Navigator(this.store, this.current, this.direction);
    nav.visitedGrids = new Set(this.visitedGrids);
    nav.lastTransitionType = this.lastTransitionType;
    nav.lastTeleportToGrid = this.lastTeleportToGrid;
    // Copy ancestor-based entry state
    nav.exitGridId = this.exitGridId;
    nav.exitPosition = this.exitPosition;
    nav.ancestorGridIdForEntry = this.ancestorGridIdForEntry;
    nav.refChainFromAncestor = [...this.refChainFromAncestor];
    return nav;
  }

  /**
   * Try to move to next position in direction.
   * Handles exiting from nested grids back to parent grids.
   *
   * Clears visitedGrids on any advance.
   * Sets lastTransitionType to 'move' or 'exit' based on operation.
   *
   * @returns false if can't advance (hit root edge or exit cycle)
   */
  tryAdvance(): boolean {
    // Clear visited grids and enter metadata when advancing
    this.visitedGrids.clear();
    this.lastTeleportToGrid = null;

    const [dr, dc] = this.deltas[this.direction];
    const grid = this.store[this.current.gridId];
    const nextRow = this.current.row + dr;
    const nextCol = this.current.col + dc;

    // Check bounds
    if (nextRow < 0 || nextRow >= grid.rows || nextCol < 0 || nextCol >= grid.cols) {
      // Hit edge - try to exit through cascading parent grids
      // Capture exit position and grid for ancestor-based entry
      this.exitGridId = this.current.gridId;
      this.exitPosition = [this.current.row, this.current.col];

      // Use iterative approach with cycle detection
      const visitedExitPositions = new Set<string>();
      let currentGridId = this.current.gridId;

      while (true) {
        const primaryRef = findPrimaryRef(this.store, currentGridId);
        if (!primaryRef) {
          return false; // Hit root edge
        }

        const [parentGridId, parentRow, parentCol] = primaryRef;

        // Detect exit cycle
        const exitKey = `${parentGridId},${parentRow},${parentCol}`;
        if (visitedExitPositions.has(exitKey)) {
          return false; // Exit cycle detected
        }
        visitedExitPositions.add(exitKey);

        const parentGrid = this.store[parentGridId];

        // Continue in same direction from primary ref
        const exitRow = parentRow + dr;
        const exitCol = parentCol + dc;

        // Check if exit position is valid in parent
        if (
          exitRow >= 0 &&
          exitRow < parentGrid.rows &&
          exitCol >= 0 &&
          exitCol < parentGrid.cols
        ) {
          // Successfully exited to valid position
          this.current = new CellPosition(parentGridId, exitRow, exitCol);
          this.lastTransitionType = 'exit';
          // Remember this ancestor for entry calculations
          this.ancestorGridIdForEntry = parentGridId;
          // Clear ref chain since we're now at the ancestor level
          this.refChainFromAncestor = [];
          return true;
        }

        // Cascading exit - continue from parent
        currentGridId = parentGridId;
      }
    }

    // Normal advance (didn't hit edge) - clear exit info since it's no longer relevant
    this.exitGridId = null;
    this.exitPosition = null;
    this.ancestorGridIdForEntry = null;
    this.current = new CellPosition(this.current.gridId, nextRow, nextCol);
    this.lastTransitionType = 'move';
    return true;
  }

  /**
   * Move to next position in direction.
   * @throws Error if can't advance
   */
  advance(): void {
    const success = this.tryAdvance();
    if (!success) {
      throw new Error(`Navigator.advance() failed at ${this.current}`);
    }
  }

  /**
   * Try to enter the Ref at current position from the current direction.
   * Sets lastTransitionType to 'enter' on success.
   *
   * @param rules - Rules governing entry behavior
   * @returns false if can't enter
   */
  tryEnter(rules: RuleSet): boolean {
    const cell = getCellAtPosition(this.store, this.current);
    if (!isRef(cell)) {
      return false;
    }

    // Pass ancestor-based entry information
    const ancestorOptions: AncestorBasedEntryOptions = {
      exitGridId: this.exitGridId ?? undefined,
      exitPosition: this.exitPosition ?? undefined,
      // Use the ancestor grid where we landed after exit (not current.gridId which changes with portals)
      ancestorGridId: this.ancestorGridIdForEntry ?? undefined,
      // Pass the current ref chain and the ref we're about to enter
      refChainFromAncestor: this.refChainFromAncestor,
      currentRefPosition: [this.current.gridId, this.current.row, this.current.col],
    };

    const entryPos = tryEnter(this.store, cell.gridId, this.direction, rules, ancestorOptions);
    if (!entryPos) {
      return false;
    }

    this.visitedGrids.add(cell.gridId);

    // Update ref chain to include the ref we just entered
    // (but only if we used ancestor-based entry - otherwise keep chain as-is for future use)
    if (this.exitGridId !== null && this.exitPosition !== null) {
      // Capture current ref position before updating this.current
      this.refChainFromAncestor.push([
        this.current.gridId,
        this.current.row,
        this.current.col,
        cell.gridId,
      ]);
    }

    this.current = entryPos;
    this.lastTransitionType = 'enter';
    // Track the last non-primary ref target in the chain
    if (cell.isPrimary === false) {
      this.lastTeleportToGrid = cell.gridId;
    }
    return true;
  }

  /**
   * Enter the Ref at current position.
   * @throws Error if can't enter
   */
  enter(rules: RuleSet): void {
    const success = this.tryEnter(rules);
    if (!success) {
      throw new Error(`Navigator.enter() failed at ${this.current}`);
    }
  }

  /**
   * Try to enter the Ref at current position, following Ref chains.
   * Continues entering nested Refs until landing on a non-Ref cell.
   * Clears visitedGrids on success (non-cyclic completion).
   *
   * @param rules - Rules governing entry behavior
   * @returns false if can't enter or if a cycle is detected
   */
  tryEnterMulti(rules: RuleSet): boolean {
    const visitedGrids = new Set<string>();

    while (true) {
      const cell = getCellAtPosition(this.store, this.current);
      if (!isRef(cell)) {
        // Landed on non-Ref, success - clear Navigator's visited
        this.visitedGrids.clear();
        return true;
      }

      // Check for cycle before entering
      if (visitedGrids.has(cell.gridId)) {
        // Cycle detected - don't clear Navigator's visited
        return false;
      }

      visitedGrids.add(cell.gridId);

      // Pass ancestor-based entry information
      const ancestorOptions: AncestorBasedEntryOptions = {
        exitGridId: this.exitGridId ?? undefined,
        exitPosition: this.exitPosition ?? undefined,
        // Use the ancestor grid where we landed after exit (not current.gridId which changes with portals)
        ancestorGridId: this.ancestorGridIdForEntry ?? undefined,
        // Pass the current ref chain and the ref we're about to enter
        refChainFromAncestor: this.refChainFromAncestor,
        currentRefPosition: [this.current.gridId, this.current.row, this.current.col],
      };

      // Try to enter this Ref (call standalone function directly)
      const entryPos = tryEnter(this.store, cell.gridId, this.direction, rules, ancestorOptions);
      if (!entryPos) {
        return false;
      }

      // Update ref chain to include the ref we just entered
      // (but only if we used ancestor-based entry)
      if (this.exitGridId !== null && this.exitPosition !== null) {
        this.refChainFromAncestor.push([
          this.current.gridId,
          this.current.row,
          this.current.col,
          cell.gridId,
        ]);
      }

      this.current = entryPos;
    }
  }

  /**
   * Enter the Ref at current position, following chains.
   * @throws Error if can't enter
   */
  enterMulti(rules: RuleSet): void {
    const success = this.tryEnterMulti(rules);
    if (!success) {
      throw new Error(`Navigator.enterMulti() failed at ${this.current}`);
    }
  }

  /**
   * Reverse direction for swallow operations.
   */
  flip(): void {
    this.direction = flipDirection(this.direction);
  }
}
