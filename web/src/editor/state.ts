/**
 * State management for the Paragrid Level Editor
 */

import JSON5 from 'json5';
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
 * Server sync state
 */
let currentVersion = 0; // Track the version we last saved/loaded
let pollInterval: number | null = null;
let hasUnsavedChanges = false; // Track if there are changes since last save/load

/**
 * Undo/Redo history
 * Note: Metadata (zoom/scale) changes are NOT tracked in history per design.
 */
let undoStack: EditorState[] = [];
let redoStack: EditorState[] = [];
const MAX_HISTORY_SIZE = 50;

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
 * Deep clone the current state (excluding metadata since it's not part of undo history).
 */
function cloneState(): EditorState {
  const clonedGrids = new Map<string, GridDefinition>();

  state.grids.forEach((grid, id) => {
    clonedGrids.set(id, {
      id: grid.id,
      rows: grid.rows,
      cols: grid.cols,
      cells: grid.cells.map(row =>
        row.map(cell => ({
          ...cell,
          pins: { ...cell.pins }
        }))
      )
    });
  });

  return {
    grids: clonedGrids,
    gridOrder: [...state.gridOrder],
    nextGridId: state.nextGridId,
    metadata: new Map(state.metadata) // Clone metadata map
  };
}

/**
 * Save current state to undo stack before performing a mutation.
 * Clears redo stack since we're performing a new action.
 */
function saveStateToUndoStack(): void {
  undoStack.push(cloneState());

  // Limit history size
  if (undoStack.length > MAX_HISTORY_SIZE) {
    undoStack.shift();
  }

  // Clear redo stack on new action
  redoStack = [];

  // Mark as having unsaved changes
  hasUnsavedChanges = true;
}

/**
 * Add a new empty grid
 */
export function addGrid(): void {
  saveStateToUndoStack();

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
  saveStateToUndoStack();

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

  saveStateToUndoStack();

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

  saveStateToUndoStack();

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

  saveStateToUndoStack();

  grid.cells[row][col] = content;
  notifyStateChange();
}

/**
 * Resize a grid (without pin support for Phase 1)
 */
export function resizeGrid(gridId: string, newRows: number, newCols: number): void {
  const grid = state.grids.get(gridId);
  if (!grid) return;

  saveStateToUndoStack();

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
 * Export state to console in parseable format matching demo-iso.ts GRIDS format
 */
export function exportToConsole(): void {
  console.log('=== Paragrid Level Editor Export ===\n');

  // Build the export object
  const exportObj: Record<string, string> = {};

  state.grids.forEach((grid, id) => {
    const rows: string[] = [];

    for (let r = 0; r < grid.rows; r++) {
      const row = grid.cells[r].map(cell => {
        if (cell.type === 'Empty') return '_';
        if (cell.type === 'Concrete') return cell.id || '?';
        if (cell.type === 'Ref') {
          // Primary ref: *gridId, Secondary ref: ~gridId
          const prefix = cell.isPrimary ? '*' : '~';
          return `${prefix}${cell.id || '?'}`;
        }
        return '?';
      });
      rows.push(row.join(' '));
    }

    exportObj[id] = rows.join('|');
  });

  // Output as JavaScript object literal
  console.log('Copy this into your code:\n');
  console.log('const GRIDS = {');
  console.log('  myScene: {');

  state.gridOrder.forEach((id, index) => {
    const isLast = index === state.gridOrder.length - 1;
    const comma = isLast ? '' : ',';
    console.log(`    "${id}": "${exportObj[id]}"${comma}`);
  });

  console.log('  }');
  console.log('};\n');

  // Also output as JSON for programmatic use
  console.log('JSON format (for parseGrids):');
  console.log(JSON.stringify(exportObj, null, 2));

  console.log('\n=== End Export ===');
}

/**
 * Import grids from text format (JSON5)
 * @param jsonText - JSON5 string containing grid definitions (supports unquoted keys, trailing commas, comments)
 * @throws Error if parsing fails
 */
export async function importFromText(jsonText: string): Promise<void> {
  // Parse JSON5 (supports unquoted keys, trailing commas, comments, etc.)
  let definitions: Record<string, string>;
  try {
    definitions = JSON5.parse(jsonText);
  } catch (e) {
    throw new Error(`Invalid JSON5: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Validate that it's an object
  if (typeof definitions !== 'object' || definitions === null || Array.isArray(definitions)) {
    throw new Error('Expected a JSON object mapping grid IDs to grid strings');
  }

  // Import parseGrids from the parser
  const { parseGrids } = await import('../lib/parser/parser.js');

  // Parse grids using the parser
  const gridStore = parseGrids(definitions);

  // Save current state to undo stack
  saveStateToUndoStack();

  // Convert parsed grids to editor format
  const newGrids = new Map<string, GridDefinition>();
  const newGridOrder: string[] = [];
  const newMetadata = new Map<string, { scale: number }>();

  for (const [gridId, grid] of Object.entries(gridStore)) {
    // Convert cells from core types to editor types
    const editorCells: CellContent[][] = [];
    for (let r = 0; r < grid.rows; r++) {
      editorCells[r] = [];
      for (let c = 0; c < grid.cols; c++) {
        const cell = grid.cells[r][c];
        let editorCell: CellContent;

        if (cell.type === 'empty') {
          editorCell = {
            type: 'Empty',
            pins: {
              top: false,
              bottom: false,
              left: false,
              right: false,
              center: false,
            },
          };
        } else if (cell.type === 'concrete') {
          editorCell = {
            type: 'Concrete',
            id: cell.id,
            pins: {
              top: false,
              bottom: false,
              left: false,
              right: false,
              center: false,
            },
          };
        } else {
          // ref cell - preserve isPrimary from parser (will be auto-determined later if null)
          editorCell = {
            type: 'Ref',
            id: cell.gridId,
            isPrimary: cell.isPrimary ?? false, // Temporarily set to false, will update below
            pins: {
              top: false,
              bottom: false,
              left: false,
              right: false,
              center: false,
            },
          };
        }

        editorCells[r][c] = editorCell;
      }
    }

    // Create GridDefinition
    const gridDef: GridDefinition = {
      id: gridId,
      rows: grid.rows,
      cols: grid.cols,
      cells: editorCells,
    };

    newGrids.set(gridId, gridDef);
    newGridOrder.push(gridId);
    newMetadata.set(gridId, { scale: 1.0 });
  }

  // Auto-determine primary references (first occurrence) only for refs that were null in parser
  // Track which refs were explicitly marked as primary
  const explicitPrimaryRefs = new Set<string>();
  const primaryRefSeen = new Set<string>();

  // First pass: identify explicitly marked primary refs
  for (const [gridId, grid] of Object.entries(gridStore)) {
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const cell = grid.cells[r][c];
        if (cell.type === 'ref' && cell.isPrimary === true) {
          explicitPrimaryRefs.add(cell.gridId);
        }
      }
    }
  }

  // Second pass: auto-determine primary refs for refs that had isPrimary === null
  for (const gridId of newGridOrder) {
    const grid = newGrids.get(gridId);
    const sourceGrid = gridStore[gridId];
    if (!grid || !sourceGrid) continue;

    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const cell = grid.cells[r][c];
        const sourceCell = sourceGrid.cells[r][c];

        if (cell.type === 'Ref' && cell.id && sourceCell.type === 'ref') {
          if (sourceCell.isPrimary === true) {
            // Explicitly marked as primary in input
            cell.isPrimary = true;
            primaryRefSeen.add(cell.id);
          } else if (sourceCell.isPrimary === false) {
            // Explicitly marked as secondary in input
            cell.isPrimary = false;
          } else {
            // null = auto-determine based on first occurrence
            if (!primaryRefSeen.has(cell.id)) {
              cell.isPrimary = true;
              primaryRefSeen.add(cell.id);
            } else {
              cell.isPrimary = false;
            }
          }
        }
      }
    }
  }

  // Update state
  state.grids = newGrids;
  state.gridOrder = newGridOrder;
  state.nextGridId = Math.max(...newGridOrder.map(id => {
    const match = id.match(/grid_(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }), 0) + 1;
  state.metadata = newMetadata;

  notifyStateChange();
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
 * Note: Zoom changes are NOT tracked in undo history per design.
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

/**
 * Undo the last action
 */
export function undo(): void {
  if (undoStack.length === 0) {
    return; // Nothing to undo
  }

  // Save current state to redo stack
  redoStack.push(cloneState());

  // Restore previous state
  state = undoStack.pop()!;

  // Mark as having unsaved changes
  hasUnsavedChanges = true;

  notifyStateChange();
}

/**
 * Redo the last undone action
 */
export function redo(): void {
  if (redoStack.length === 0) {
    return; // Nothing to redo
  }

  // Save current state to undo stack
  undoStack.push(cloneState());

  // Restore next state
  state = redoStack.pop()!;

  // Mark as having unsaved changes
  hasUnsavedChanges = true;

  notifyStateChange();
}

/**
 * Get the number of available undo actions
 */
export function getUndoStackSize(): number {
  return undoStack.length;
}

/**
 * Get the number of available redo actions
 */
export function getRedoStackSize(): number {
  return redoStack.length;
}

/**
 * Check if there are unsaved changes since the last save/load
 */
export function getHasUnsavedChanges(): boolean {
  return hasUnsavedChanges;
}

/**
 * Convert EditorState to server-friendly format
 */
function serializeGrids(): Record<string, string> {
  const exportObj: Record<string, string> = {};

  state.grids.forEach((grid, id) => {
    const rows: string[] = [];

    for (let r = 0; r < grid.rows; r++) {
      const row = grid.cells[r].map(cell => {
        if (cell.type === 'Empty') return '_';
        if (cell.type === 'Concrete') return cell.id || '?';
        if (cell.type === 'Ref') {
          // Primary ref: *gridId, Secondary ref: ~gridId
          const prefix = cell.isPrimary ? '*' : '~';
          return `${prefix}${cell.id || '?'}`;
        }
        return '?';
      });
      rows.push(row.join(' '));
    }

    exportObj[id] = rows.join('|');
  });

  return exportObj;
}

/**
 * Save current grid state to the server
 * @returns Promise with the new version number
 */
export async function saveToServer(): Promise<{ success: boolean; version: number; error?: string }> {
  try {
    const grids = serializeGrids();

    const response = await fetch('/api/grids', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ grids }),
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const result = await response.json();
    currentVersion = result.version;

    // Clear unsaved changes flag after successful save
    hasUnsavedChanges = false;

    console.log(`✅ Saved to server (version ${result.version})`);

    return {
      success: true,
      version: result.version,
    };
  } catch (error) {
    console.error('Failed to save to server:', error);
    return {
      success: false,
      version: currentVersion,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Load grid state from the server
 * @returns Promise with success status
 */
export async function loadFromServer(): Promise<{ success: boolean; version: number; error?: string }> {
  try {
    const response = await fetch('/api/grids');

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const result = await response.json();

    // If we already have this version, no need to reload
    if (result.version === currentVersion) {
      // Clear unsaved changes since we're in sync
      hasUnsavedChanges = false;
      return {
        success: true,
        version: result.version,
      };
    }

    // If server has no grids (empty object), skip import and keep default state
    if (!result.grids || Object.keys(result.grids).length === 0) {
      currentVersion = result.version;
      // Clear unsaved changes since we loaded from server
      hasUnsavedChanges = false;
      return {
        success: true,
        version: result.version,
      };
    }

    // Import the grids
    const jsonText = JSON.stringify(result.grids);
    await importFromText(jsonText);

    currentVersion = result.version;

    // Clear unsaved changes since we just loaded from server
    hasUnsavedChanges = false;

    console.log(`✅ Loaded from server (version ${result.version})`);

    return {
      success: true,
      version: result.version,
    };
  } catch (error) {
    console.error('Failed to load from server:', error);
    return {
      success: false,
      version: currentVersion,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check if there's a new version available on the server
 * @returns Promise with version info
 */
export async function checkServerVersion(): Promise<{ version: number; hasUpdate: boolean; error?: string }> {
  try {
    const response = await fetch('/api/grids/version');

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const result = await response.json();

    return {
      version: result.version,
      hasUpdate: result.version > currentVersion,
    };
  } catch (error) {
    console.error('Failed to check server version:', error);
    return {
      version: currentVersion,
      hasUpdate: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Start polling for server updates
 * @param intervalMs - Polling interval in milliseconds (default: 2000ms)
 * @param autoLoad - Automatically load updates when detected (default: true)
 */
export function startPolling(intervalMs: number = 2000, autoLoad: boolean = true): void {
  stopPolling(); // Clear any existing interval

  pollInterval = window.setInterval(async () => {
    const check = await checkServerVersion();

    if (check.hasUpdate) {
      console.log(`🔔 New version available on server (v${check.version})`);

      if (autoLoad) {
        await loadFromServer();
      }
    }
  }, intervalMs);

  console.log(`🔄 Started polling server every ${intervalMs}ms`);
}

/**
 * Stop polling for server updates
 */
export function stopPolling(): void {
  if (pollInterval !== null) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log('⏹️  Stopped polling server');
  }
}

/**
 * Get the current version number
 */
export function getCurrentVersion(): number {
  return currentVersion;
}
