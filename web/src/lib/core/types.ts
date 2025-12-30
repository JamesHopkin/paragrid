/**
 * Core data structures for Paragrid grids.
 */

// =============================================================================
// Cell Types
// =============================================================================

/**
 * An empty cell.
 */
export interface Empty {
  readonly type: 'empty';
}

/**
 * A cell containing a concrete value.
 */
export interface Concrete {
  readonly type: 'concrete';
  readonly id: string;
}

/**
 * A cell referencing another grid.
 *
 * @property gridId - The ID of the referenced grid
 * @property isPrimary - null = auto-determined (first ref is primary),
 *                       true = explicitly primary, false = explicitly secondary
 */
export interface Ref {
  readonly type: 'ref';
  readonly gridId: string;
  readonly isPrimary: boolean | null;
}

/**
 * Union type for all cell variants.
 */
export type Cell = Empty | Concrete | Ref;

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an Empty cell.
 */
export function Empty(): Empty {
  return Object.freeze({ type: 'empty' });
}

/**
 * Create a Concrete cell with the given ID.
 */
export function Concrete(id: string): Concrete {
  return Object.freeze({ type: 'concrete', id });
}

/**
 * Create a Ref cell referencing the given grid.
 *
 * @param gridId - The ID of the referenced grid
 * @param isPrimary - Primary marker (null = auto, true = primary, false = secondary)
 */
export function Ref(gridId: string, isPrimary: boolean | null = null): Ref {
  return Object.freeze({ type: 'ref', gridId, isPrimary });
}

// =============================================================================
// Type Guards
// =============================================================================

export function isEmpty(cell: Cell): cell is Empty {
  return cell.type === 'empty';
}

export function isConcrete(cell: Cell): cell is Concrete {
  return cell.type === 'concrete';
}

export function isRef(cell: Cell): cell is Ref {
  return cell.type === 'ref';
}

// =============================================================================
// Grid Structure
// =============================================================================

/**
 * A 2D grid of cells with a unique identifier.
 * Grids are immutable - all cells and the structure itself are readonly.
 * Minimum dimensions: 1×2 (either 1 row × 2 cols, or 2 rows × 1 col).
 */
export interface Grid {
  readonly id: string;
  readonly cells: ReadonlyArray<ReadonlyArray<Cell>>;
  readonly rows: number;
  readonly cols: number;
}

/**
 * Create a new Grid from a 2D array of cells.
 *
 * @param id - Unique identifier for this grid
 * @param cells - 2D array of cells (must be rectangular)
 * @returns Frozen Grid object
 * @throws Error if cells array is invalid
 */
export function createGrid(id: string, cells: Cell[][]): Grid {
  if (cells.length === 0) {
    throw new Error('Grid must have at least one row');
  }

  const rows = cells.length;
  const cols = cells[0].length;

  if (cols === 0) {
    throw new Error('Grid must have at least one column');
  }

  // Verify rectangular structure
  for (let i = 0; i < rows; i++) {
    if (cells[i].length !== cols) {
      throw new Error(`Inconsistent row length at row ${i}: expected ${cols}, got ${cells[i].length}`);
    }
  }

  // Freeze the cells array deeply
  const frozenCells = Object.freeze(cells.map(row => Object.freeze(row)));

  return Object.freeze({
    id,
    cells: frozenCells,
    rows,
    cols,
  });
}

/**
 * A collection of grids indexed by their IDs.
 */
export type GridStore = { readonly [gridId: string]: Grid };

/**
 * Create an empty GridStore.
 */
export function emptyStore(): GridStore {
  return Object.freeze({});
}

/**
 * Add or update a grid in the store.
 */
export function setGrid(store: GridStore, grid: Grid): GridStore {
  return Object.freeze({
    ...store,
    [grid.id]: grid,
  });
}

/**
 * Get a grid from the store by ID.
 *
 * @returns The grid, or undefined if not found
 */
export function getGrid(store: GridStore, gridId: string): Grid | undefined {
  return store[gridId];
}

/**
 * Get a cell from a grid at the given position.
 *
 * @returns The cell, or undefined if position is out of bounds
 */
export function getCell(grid: Grid, row: number, col: number): Cell | undefined {
  if (row < 0 || row >= grid.rows || col < 0 || col >= grid.cols) {
    return undefined;
  }
  return grid.cells[row][col];
}
