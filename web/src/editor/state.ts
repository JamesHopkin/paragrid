/**
 * State management for the Paragrid Level Editor
 */

import { EditorState, GridDefinition, CellContent, createEmptyGrid } from './types.js';

/**
 * Creates the initial editor state with a single 5x5 empty grid
 */
export function createInitialState(): EditorState {
  const initialGrid = createEmptyGrid('grid_1', 5, 5);
  return {
    grids: new Map([['grid_1', initialGrid]]),
    gridOrder: ['grid_1'],
    nextGridId: 2,
    metadata: new Map([['grid_1', { scale: 1.0 }]]),
  };
}

/**
 * Global state instance
 */
let state: EditorState = createInitialState();
let stateChangeCallbacks: Array<(state: EditorState) => void> = [];

/**
 * Register a callback to be called when state changes
 */
export function onStateChange(callback: (state: EditorState) => void): void {
  stateChangeCallbacks.push(callback);
}

/**
 * Notify all listeners that state has changed
 */
function notifyStateChange(): void {
  stateChangeCallbacks.forEach(cb => cb(state));
}

/**
 * Get the current state
 */
export function getState(): EditorState {
  return state;
}

/**
 * Add a new empty grid
 */
export function addGrid(): void {
  const newId = `grid_${state.nextGridId}`;
  const newGrid = createEmptyGrid(newId, 5, 5);

  state.grids.set(newId, newGrid);
  state.gridOrder.push(newId);
  state.metadata.set(newId, { scale: 1.0 });
  state.nextGridId++;

  notifyStateChange();
}

/**
 * Delete a grid and all references to it
 */
export function deleteGrid(gridId: string): void {
  // Remove the grid itself
  state.grids.delete(gridId);
  state.gridOrder = state.gridOrder.filter(id => id !== gridId);
  state.metadata.delete(gridId);

  // Remove all references to this grid from other grids
  state.grids.forEach(grid => {
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const cell = grid.cells[r][c];
        if (cell.type === 'Ref' && cell.id === gridId) {
          grid.cells[r][c] = {
            type: 'Empty',
            pins: cell.pins, // Preserve pins
          };
        }
      }
    }
  });

  notifyStateChange();
}

/**
 * Duplicate a grid (creates a deep copy)
 */
export function duplicateGrid(gridId: string): void {
  const original = state.grids.get(gridId);
  if (!original) return;

  const newId = `grid_${state.nextGridId}`;
  state.nextGridId++;

  // Deep copy the grid
  const newGrid: GridDefinition = {
    id: newId,
    rows: original.rows,
    cols: original.cols,
    cells: original.cells.map(row =>
      row.map(cell => {
        // If this is a primary ref, make it non-primary in the duplicate
        if (cell.type === 'Ref' && cell.isPrimary) {
          return {
            ...cell,
            isPrimary: false,
            pins: { ...cell.pins },
          };
        }
        // Otherwise, deep copy the cell
        return {
          ...cell,
          pins: { ...cell.pins },
        };
      })
    ),
  };

  state.grids.set(newId, newGrid);
  state.gridOrder.push(newId);

  // Copy metadata from original
  const originalMetadata = state.metadata.get(gridId);
  state.metadata.set(newId, {
    scale: originalMetadata?.scale ?? 1.0
  });

  notifyStateChange();
}

/**
 * Rename a grid
 */
export function renameGrid(oldId: string, newId: string): void {
  const grid = state.grids.get(oldId);
  if (!grid || state.grids.has(newId)) return;

  // Update the grid's ID
  grid.id = newId;

  // Update the grids map
  state.grids.delete(oldId);
  state.grids.set(newId, grid);

  // Update the order array
  const index = state.gridOrder.indexOf(oldId);
  if (index !== -1) {
    state.gridOrder[index] = newId;
  }

  // Update all references to this grid
  state.grids.forEach(g => {
    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        const cell = g.cells[r][c];
        if (cell.type === 'Ref' && cell.id === oldId) {
          cell.id = newId;
        }
      }
    }
  });

  notifyStateChange();
}

/**
 * Set the content of a cell
 */
export function setCell(gridId: string, row: number, col: number, content: CellContent): void {
  const grid = state.grids.get(gridId);
  if (!grid) return;

  grid.cells[row][col] = content;
  notifyStateChange();
}

/**
 * Resize a grid (without pin support for Phase 1)
 */
export function resizeGrid(gridId: string, newRows: number, newCols: number): void {
  const grid = state.grids.get(gridId);
  if (!grid) return;

  // Create new cells array
  const newCells: CellContent[][] = [];
  for (let r = 0; r < newRows; r++) {
    newCells[r] = [];
    for (let c = 0; c < newCols; c++) {
      // Copy existing cell if within bounds, otherwise create empty cell
      if (r < grid.rows && c < grid.cols) {
        newCells[r][c] = grid.cells[r][c];
      } else {
        newCells[r][c] = {
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
    }
  }

  grid.rows = newRows;
  grid.cols = newCols;
  grid.cells = newCells;

  notifyStateChange();
}

/**
 * Get all grids that can have primary references added
 * (i.e., grids that don't already have a primary ref placed)
 */
export function getGridsAvailableForPrimaryRef(): Set<string> {
  const available = new Set(state.gridOrder);

  // Check all cells in all grids
  state.grids.forEach(grid => {
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const cell = grid.cells[r][c];
        if (cell.type === 'Ref' && cell.isPrimary && cell.id) {
          available.delete(cell.id);
        }
      }
    }
  });

  return available;
}

/**
 * Export state to console in parseable format
 */
export function exportToConsole(): void {
  console.log('=== Paragrid Level Editor State ===');
  console.log('Grid Order:', state.gridOrder);
  console.log('\nGrids:');
  state.grids.forEach((grid, id) => {
    console.log(`\n${id} (${grid.rows}x${grid.cols}):`);
    for (let r = 0; r < grid.rows; r++) {
      const row = grid.cells[r].map(cell => {
        if (cell.type === 'Empty') return '.';
        if (cell.type === 'Concrete') return cell.id || '?';
        if (cell.type === 'Ref') return `[${cell.id}${cell.isPrimary ? '*' : ''}]`;
        return '?';
      });
      console.log(`  ${row.join(' ')}`);
    }
  });
  console.log('\n=== End State ===');
}

/**
 * Get the scale (zoom) of a grid
 */
export function getGridScale(gridId: string): number {
  const metadata = state.metadata.get(gridId);
  return metadata?.scale ?? 1.0;
}

/**
 * Set the scale (zoom) of a grid
 */
export function setGridScale(gridId: string, scale: number): void {
  const metadata = state.metadata.get(gridId);
  if (metadata) {
    metadata.scale = Math.max(0.1, Math.min(5.0, scale)); // Clamp between 0.1 and 5.0
  } else {
    state.metadata.set(gridId, { scale: Math.max(0.1, Math.min(5.0, scale)) });
  }
  notifyStateChange();
}
