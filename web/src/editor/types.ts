/**
 * Type definitions for the Paragrid Level Editor
 */

export type CellType = 'Empty' | 'Concrete' | 'Ref';

export interface PinState {
  top: boolean;
  bottom: boolean;
  left: boolean;
  right: boolean;
  center: boolean;
}

export interface CellContent {
  type: CellType;
  id?: string; // For Concrete and Ref types
  isPrimary?: boolean; // For Ref type only
  pins: PinState;
}

export interface GridDefinition {
  id: string;
  rows: number;
  cols: number;
  cells: CellContent[][];
}

export interface EditorState {
  grids: Map<string, GridDefinition>;
  gridOrder: string[]; // For card layout order (not undoable)
  nextGridId: number; // For auto-generating grid IDs
  metadata: Map<string, GridMetadata>; // UI state per grid
}

export interface GridMetadata {
  scale: number; // Visual zoom level (1.0 = 100%)
}

/**
 * Creates an empty cell with all pins disabled
 */
export function createEmptyCell(): CellContent {
  return {
    type: 'Empty',
    pins: {
      top: false,
      bottom: false,
      left: false,
      right: false,
      center: false,
    },
  };
}

/**
 * Creates a concrete cell with the given ID
 */
export function createConcreteCell(id: string): CellContent {
  return {
    type: 'Concrete',
    id,
    pins: {
      top: false,
      bottom: false,
      left: false,
      right: false,
      center: false,
    },
  };
}

/**
 * Creates a reference cell
 */
export function createRefCell(gridId: string, isPrimary: boolean): CellContent {
  return {
    type: 'Ref',
    id: gridId,
    isPrimary,
    pins: {
      top: false,
      bottom: false,
      left: false,
      right: false,
      center: false,
    },
  };
}

/**
 * Creates an empty grid with the given dimensions
 */
export function createEmptyGrid(id: string, rows: number, cols: number): GridDefinition {
  const cells: CellContent[][] = [];
  for (let r = 0; r < rows; r++) {
    cells[r] = [];
    for (let c = 0; c < cols; c++) {
      cells[r][c] = createEmptyCell();
    }
  }
  return { id, rows, cols, cells };
}

/**
 * Available concrete cell IDs (hardcoded for Phase 1)
 */
export const CONCRETE_IDS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
