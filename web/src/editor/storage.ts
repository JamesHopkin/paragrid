/**
 * Storage abstraction for the Paragrid Level Editor
 * Supports both localStorage (standalone) and server (dev) backends
 */

import { EditorState } from './types.js';

/**
 * Storage interface for saving/loading editor state
 */
export interface StorageAdapter {
  save(state: EditorState): Promise<{ success: boolean; version?: number; error?: string }>;
  load(): Promise<{ success: boolean; state?: EditorState; version?: number; error?: string }>;
  onExternalChange?: (callback: (state: EditorState) => void) => void;
}

/**
 * LocalStorage adapter for standalone editor
 * Provides instant cross-tab sync via storage event
 */
export class LocalStorageAdapter implements StorageAdapter {
  private readonly STORAGE_KEY = 'paragrid-editor-state';
  private readonly VERSION_KEY = 'paragrid-editor-version';
  private version: number = 0;

  constructor() {
    // Load initial version from storage
    const storedVersion = localStorage.getItem(this.VERSION_KEY);
    this.version = storedVersion ? parseInt(storedVersion, 10) : 0;
  }

  /**
   * Save state to localStorage
   */
  async save(state: EditorState): Promise<{ success: boolean; version?: number; error?: string }> {
    try {
      // Increment version
      this.version++;

      // Convert state to serializable format
      const serialized = this.serializeState(state);

      // Save to localStorage
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(serialized));
      localStorage.setItem(this.VERSION_KEY, this.version.toString());

      console.log(`💾 Saved to localStorage (version ${this.version})`);

      return {
        success: true,
        version: this.version,
      };
    } catch (error) {
      console.error('Failed to save to localStorage:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Load state from localStorage
   */
  async load(): Promise<{ success: boolean; state?: EditorState; version?: number; error?: string }> {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      const storedVersion = localStorage.getItem(this.VERSION_KEY);

      if (!stored) {
        // No stored state, use default
        return {
          success: true,
          version: 0,
        };
      }

      this.version = storedVersion ? parseInt(storedVersion, 10) : 0;

      const serialized = JSON.parse(stored);
      const state = this.deserializeState(serialized);

      console.log(`📦 Loaded from localStorage (version ${this.version})`);

      return {
        success: true,
        state,
        version: this.version,
      };
    } catch (error) {
      console.error('Failed to load from localStorage:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Register callback for external changes (from other tabs)
   */
  onExternalChange(callback: (state: EditorState) => void): void {
    window.addEventListener('storage', (event) => {
      // Only respond to changes to our storage key from OTHER tabs
      if (event.key === this.STORAGE_KEY && event.newValue) {
        try {
          const serialized = JSON.parse(event.newValue);
          const state = this.deserializeState(serialized);

          // Update our local version
          const storedVersion = localStorage.getItem(this.VERSION_KEY);
          this.version = storedVersion ? parseInt(storedVersion, 10) : 0;

          console.log(`🔔 State updated from another tab (version ${this.version})`);
          callback(state);
        } catch (error) {
          console.error('Failed to process storage event:', error);
        }
      }
    });
  }

  /**
   * Convert EditorState to JSON-serializable format
   */
  private serializeState(state: EditorState): any {
    const grids: Record<string, any> = {};
    state.grids.forEach((grid, id) => {
      grids[id] = grid;
    });

    const metadata: Record<string, any> = {};
    state.metadata.forEach((meta, id) => {
      metadata[id] = meta;
    });

    return {
      grids,
      gridOrder: state.gridOrder,
      nextGridId: state.nextGridId,
      metadata,
    };
  }

  /**
   * Convert JSON format back to EditorState
   */
  private deserializeState(serialized: any): EditorState {
    const grids = new Map<string, any>(Object.entries(serialized.grids));
    const metadata = new Map<string, any>(Object.entries(serialized.metadata));

    return {
      grids,
      gridOrder: serialized.gridOrder,
      nextGridId: serialized.nextGridId,
      metadata,
    };
  }
}

/**
 * Server storage adapter (wraps existing server API)
 */
export class ServerStorageAdapter implements StorageAdapter {
  /**
   * Save state to server
   */
  async save(state: EditorState): Promise<{ success: boolean; version?: number; error?: string }> {
    try {
      const grids = this.serializeGrids(state);

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

      console.log(`✅ Saved to server (version ${result.version})`);

      return {
        success: true,
        version: result.version,
      };
    } catch (error) {
      console.error('Failed to save to server:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Load state from server
   */
  async load(): Promise<{ success: boolean; state?: EditorState; version?: number; error?: string }> {
    try {
      const response = await fetch('/api/grids');

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const result = await response.json();

      // If server has no grids (empty object), skip import and use default state
      if (!result.grids || Object.keys(result.grids).length === 0) {
        return {
          success: true,
          version: result.version,
        };
      }

      // Parse grids from server format
      const state = await this.parseServerGrids(result.grids);

      console.log(`✅ Loaded from server (version ${result.version})`);

      return {
        success: true,
        state,
        version: result.version,
      };
    } catch (error) {
      console.error('Failed to load from server:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Convert EditorState to server-friendly format
   */
  private serializeGrids(state: EditorState): Record<string, string> {
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
   * Parse server grid format into EditorState
   */
  private async parseServerGrids(definitions: Record<string, string>): Promise<EditorState> {
    // Import parseGrids from the parser
    const { parseGrids } = await import('../lib/parser/parser.js');

    // Parse grids using the parser
    const gridStore = parseGrids(definitions);

    // Convert parsed grids to editor format
    const newGrids = new Map<string, any>();
    const newGridOrder: string[] = [];
    const newMetadata = new Map<string, { scale: number }>();

    for (const [gridId, grid] of Object.entries(gridStore)) {
      // Convert cells from core types to editor types
      const editorCells: any[][] = [];
      for (let r = 0; r < grid.rows; r++) {
        editorCells[r] = [];
        for (let c = 0; c < grid.cols; c++) {
          const cell = grid.cells[r][c];
          let editorCell: any;

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
            // ref cell
            editorCell = {
              type: 'Ref',
              id: cell.gridId,
              isPrimary: cell.isPrimary ?? false,
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
      const gridDef: any = {
        id: gridId,
        rows: grid.rows,
        cols: grid.cols,
        cells: editorCells,
      };

      newGrids.set(gridId, gridDef);
      newGridOrder.push(gridId);
      newMetadata.set(gridId, { scale: 1.0 });
    }

    // Auto-determine primary references (first occurrence)
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
              cell.isPrimary = true;
              primaryRefSeen.add(cell.id);
            } else if (sourceCell.isPrimary === false) {
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

    // Calculate nextGridId
    const nextGridId = Math.max(...newGridOrder.map(id => {
      const match = id.match(/grid_(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    }), 0) + 1;

    return {
      grids: newGrids,
      gridOrder: newGridOrder,
      nextGridId,
      metadata: newMetadata,
    };
  }
}

/**
 * Detect if dev server is available
 */
export async function isDevServerAvailable(): Promise<boolean> {
  try {
    const response = await fetch('/api/grids/version', {
      method: 'GET',
      // Don't wait too long
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Create appropriate storage adapter based on environment
 */
export async function createStorageAdapter(forceLocalStorage: boolean = false): Promise<StorageAdapter> {
  if (forceLocalStorage) {
    console.log('🔧 Using localStorage adapter (forced)');
    return new LocalStorageAdapter();
  }

  const hasServer = await isDevServerAvailable();

  if (hasServer) {
    console.log('🔧 Using server storage adapter');
    return new ServerStorageAdapter();
  } else {
    console.log('🔧 Using localStorage adapter (server not available)');
    return new LocalStorageAdapter();
  }
}
