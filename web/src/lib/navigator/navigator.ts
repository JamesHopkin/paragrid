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
import { tryEnter, type DepthAwareEntryOptions } from './try-enter.js';

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

  /** For 'enter' transitions, whether entry was via non-primary reference */
  private lastEnterViaNonPrimary: boolean | null;

  /** Depth-aware entry tracking: net level of nesting (enters - exits) */
  private depth: number;

  /** Depth-aware entry tracking: (row, col) when last exit occurred */
  private exitPosition: [number, number] | null;

  /** Depth-aware entry tracking: depth at which last exit occurred */
  private exitDepth: number | null;

  /** Depth-aware entry tracking: fractional position (0.0-1.0) along edge when exiting */
  private exitFraction: number | null;

  constructor(store: GridStore, position: CellPosition, direction: Direction) {
    this.store = store;
    this.current = position.clone();
    this.direction = direction;
    this.visitedGrids = new Set();
    this.lastTransitionType = null;
    this.lastEnterViaNonPrimary = null;

    // Depth-aware entry tracking
    this.depth = 0;
    this.exitPosition = null;
    this.exitDepth = null;
    this.exitFraction = null;

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
   * Get whether the last 'enter' transition was via a non-primary reference.
   * Only meaningful when getLastTransition() returns 'enter'.
   * @returns true if via non-primary ref, false if via primary ref, null if not applicable
   */
  getLastEnterViaNonPrimary(): boolean | null {
    return this.lastEnterViaNonPrimary;
  }

  /**
   * Create a copy for backtracking.
   */
  clone(): Navigator {
    const nav = new Navigator(this.store, this.current, this.direction);
    nav.visitedGrids = new Set(this.visitedGrids);
    nav.lastTransitionType = this.lastTransitionType;
    nav.lastEnterViaNonPrimary = this.lastEnterViaNonPrimary;
    // Copy depth tracking state
    nav.depth = this.depth;
    nav.exitPosition = this.exitPosition;
    nav.exitDepth = this.exitDepth;
    nav.exitFraction = this.exitFraction;
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
    this.lastEnterViaNonPrimary = null;

    const [dr, dc] = this.deltas[this.direction];
    const grid = this.store[this.current.gridId];
    const nextRow = this.current.row + dr;
    const nextCol = this.current.col + dc;

    // Check bounds
    if (nextRow < 0 || nextRow >= grid.rows || nextCol < 0 || nextCol >= grid.cols) {
      // Hit edge - try to exit through cascading parent grids
      // Capture exit position and fractional position for depth-aware entry
      this.exitPosition = [this.current.row, this.current.col];
      this.exitDepth = this.depth;

      // Calculate fractional position along the edge (0.0 to 1.0)
      let edgeDimension: number;
      let exitOffset: number;
      if (this.direction === Direction.E || this.direction === Direction.W) {
        // Exiting east or west: position is along north-south axis (row)
        edgeDimension = grid.rows;
        exitOffset = this.current.row;
      } else {
        // Exiting north or south: position is along east-west axis (col)
        edgeDimension = grid.cols;
        exitOffset = this.current.col;
      }

      // Calculate fraction (handle single-cell dimension)
      this.exitFraction = edgeDimension > 1 ? exitOffset / (edgeDimension - 1) : 0.5;

      // Use iterative approach with cycle detection
      const visitedExitPositions = new Set<string>();
      let currentGridId = this.current.gridId;

      while (true) {
        const primaryRef = findPrimaryRef(this.store, currentGridId);
        if (!primaryRef) {
          return false; // Hit root edge
        }

        // Exit through primary ref - decrement depth
        this.depth -= 1;

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
          return true;
        }

        // Cascading exit - continue from parent
        currentGridId = parentGridId;
      }
    }

    // Move within same grid
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

    // Pass depth information for depth-aware entry
    const depthOptions: DepthAwareEntryOptions = {
      currentDepth: this.depth + 1, // What depth will be after entering
      exitDepth: this.exitDepth ?? undefined,
      exitFraction: this.exitFraction ?? undefined,
    };

    const entryPos = tryEnter(this.store, cell.gridId, this.direction, rules, depthOptions);
    if (!entryPos) {
      return false;
    }

    this.visitedGrids.add(cell.gridId);
    this.current = entryPos;
    // Increment depth after successful entry
    this.depth += 1;
    this.lastTransitionType = 'enter';
    // Capture whether this was via a non-primary reference
    this.lastEnterViaNonPrimary = cell.isPrimary === false;
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

      // Pass depth information for depth-aware entry
      const depthOptions: DepthAwareEntryOptions = {
        currentDepth: this.depth + 1,
        exitDepth: this.exitDepth ?? undefined,
        exitFraction: this.exitFraction ?? undefined,
      };

      // Try to enter this Ref (call standalone function directly)
      const entryPos = tryEnter(this.store, cell.gridId, this.direction, rules, depthOptions);
      if (!entryPos) {
        return false;
      }

      this.current = entryPos;
      // Increment depth after successful entry
      this.depth += 1;
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
