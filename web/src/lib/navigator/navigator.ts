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
import { tryEnter } from './try-enter.js';

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

  /** Set of visited grids for entry cycle detection */
  private visitedGrids: Set<string>;

  /** Direction deltas for movement */
  private readonly deltas: Record<Direction, [number, number]>;

  constructor(store: GridStore, position: CellPosition, direction: Direction) {
    this.store = store;
    this.current = position.clone();
    this.direction = direction;
    this.visitedGrids = new Set();

    this.deltas = {
      [Direction.N]: [-1, 0],
      [Direction.S]: [1, 0],
      [Direction.E]: [0, 1],
      [Direction.W]: [0, -1],
    };
  }

  /**
   * Create a copy for backtracking.
   */
  clone(): Navigator {
    const nav = new Navigator(this.store, this.current, this.direction);
    nav.visitedGrids = new Set(this.visitedGrids);
    return nav;
  }

  /**
   * Try to move to next position in direction.
   * Handles exiting from nested grids back to parent grids.
   *
   * Clears visitedGrids on any advance.
   *
   * @returns false if can't advance (hit root edge or exit cycle)
   */
  tryAdvance(): boolean {
    // Clear visited grids when advancing
    this.visitedGrids.clear();

    const [dr, dc] = this.deltas[this.direction];
    const grid = this.store[this.current.gridId];
    const nextRow = this.current.row + dr;
    const nextCol = this.current.col + dc;

    // Check bounds
    if (nextRow < 0 || nextRow >= grid.rows || nextCol < 0 || nextCol >= grid.cols) {
      // Hit edge - try to exit through cascading parent grids
      // Use iterative approach with cycle detection
      const visitedExitPositions = new Set<string>();
      let currentGridId = this.current.gridId;

      while (true) {
        const primaryRef = findPrimaryRef(this.store, currentGridId);
        if (!primaryRef) {
          return false; // Hit root edge
        }

        // Exit through primary ref
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
          return true;
        }

        // Cascading exit - continue from parent
        currentGridId = parentGridId;
      }
    }

    this.current = new CellPosition(this.current.gridId, nextRow, nextCol);
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
   * Uses visitedGrids to detect entry cycles.
   *
   * @param rules - Rules governing entry behavior
   * @returns false if can't enter or if cycle detected
   */
  tryEnter(rules: RuleSet): boolean {
    const cell = getCellAtPosition(this.store, this.current);
    if (!isRef(cell)) {
      return false;
    }

    // Check for cycle before entering
    if (this.visitedGrids.has(cell.gridId)) {
      return false; // Cycle detected
    }

    const entryPos = tryEnter(this.store, cell.gridId, this.direction, rules);
    if (!entryPos) {
      return false;
    }

    this.visitedGrids.add(cell.gridId);
    this.current = entryPos;
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

      // Try to enter this Ref (call standalone function directly)
      const entryPos = tryEnter(this.store, cell.gridId, this.direction, rules);
      if (!entryPos) {
        return false;
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
