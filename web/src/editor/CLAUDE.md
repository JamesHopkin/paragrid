# Paragrid Level Editor - Implementation Context

**The Paragrid Level Editor** is a web-based visual editor for creating and modifying Paragrid grid structures with direct manipulation, undo/redo, and multi-grid management.

## Code Structure

**Core Files** (located in `/web/src/editor/`):
- **`types.ts`**: Type definitions (`EditorState`, `GridDefinition`, `CellContent`, `PinState`, `GridMetadata`)
- **`state.ts`**: State management (global state, CRUD operations for grids/cells, metadata including zoom)
- **`ui.ts`**: UI rendering and event handlers (grid cards, cell palette, context menus, resize/zoom interaction)
- **`editor.html`**: HTML structure and CSS styling for the editor

**Key Functions**:
- Grid operations: `addGrid()`, `deleteGrid()`, `duplicateGrid()`, `renameGrid()` in `state.ts`
- Cell operations: `setCell()` in `state.ts`
- Grid resize: `resizeGrid()` in `state.ts`, `startResize()` in `ui.ts`
- Visual zoom: `getGridScale()`, `setGridScale()` in `state.ts`
- UI rendering: `renderGrids()`, `createGridCard()`, `createCellElement()` in `ui.ts`
- Palette: `showCellPalette()` in `ui.ts`

## Core Functionality

**Multi-Grid Management**: Card-based flexible layout where each grid is a draggable card. Grid reordering (Super+drag) is NOT part of undo history—it's a layout preference, not data.

**Grid Operations**:
- **Add/Delete/Duplicate**: Via context menus, all undoable except reordering
- **Visual Zoom**: Drag corner handle to change visual size (scale transform, 0.1x to 5.0x)
- **Resize Grid**: Super+drag (Cmd/Ctrl+drag) corner handle to add/remove rows/columns, snapped to cell boundaries
- **Minimum size**: 1×1 (relaxed from spec's 1×2 minimum)

**Cell Interaction**:
- Click cell to open palette (Empty, Concrete IDs, Primary Refs, Non-primary Refs)
- Drag cell A to B: content moves, B's content attempts adjacent empty placement (single level, no cascading)
- Pin system controls positioning during resize operations

## Pin System

**Purpose**: Determines cell behavior during grid resize

**Pin Types**:
- **No pins** (default): Absolute grid position (row N, col M)
- **Edge pins** (Top/Bottom/Left/Right): Offset from edge
- **Center pin**: Proportional position (e.g., 30% from left, 40% from top)

**Precedence**: Edge pins override center pin on their axis. Example: Left + Center = fixed left offset, proportional vertical.

**UI**: Push-pin icons at cell edges/center (5 positions), visible only at sufficient zoom. Pins travel with cell content during drag operations.

## Reference Management

**Primary Reference Rules**:
- Each grid has exactly ONE primary reference
- Self-references allowed
- Primary ref placement enforced through palette availability
- Current grid's primary self-ref: only if not already placed
- Other grids' primary refs: only if not yet placed anywhere

**Delete Cascade**: Deleting a grid automatically removes ALL references to it across all grids (no orphaned refs possible).

**Ref Conversion**: Changing primary to secondary not directly supported—delete and re-add instead.

## Conflict Resolution

**Scenario**: Multiple cells targeting same position (e.g., shrinking 7×7 to 3×3)

**Algorithm**:
1. Collect overlapping target positions
2. Apply winner heuristic (pinned cells prioritized, spatial priority, primary refs over secondary)
3. Losers attempt placement in empty cells adjacent to intended target
4. Remaining losers removed
5. **No cascading**: One level of conflict resolution per operation

## State Management

**Data Model**:
```typescript
interface EditorState {
  grids: Map<string, GridDefinition>;
  gridOrder: string[]; // Layout order (not undoable)
  metadata: Map<string, GridMetadata>;
}

interface GridDefinition {
  id: string;
  rows: number;
  cols: number;
  cells: CellContent[][];
}

interface CellContent {
  type: 'Empty' | 'Concrete' | 'Ref';
  id?: string; // For Concrete and Ref types
  isPrimary?: boolean; // For Ref type only
  pins: PinState;
}

interface PinState {
  top: boolean;
  bottom: boolean;
  left: boolean;
  right: boolean;
  center: boolean;
}
```

**Undo/Redo System**:
- Global scope across all grids
- Command pattern with immutable state snapshots
- Tracks: cell content changes, resize, drag, pin toggles, add/delete/duplicate grid, rename
- **Does NOT track**: Grid card reordering (layout preference only)

## Save & Persistence

**Save Mechanism**:
- Explicit "Save" button POSTs to dev server
- Server updates in-memory grid store
- Writes parseable text format to console/log
- Multi-client sync via polling (last write wins, no conflict resolution)

**Parseable Format**:
- Numbers = Concrete cells
- Letters = References (A-Z mapped to grid IDs)
- Convention documented in main project

## Concrete Cell IDs

**Hardcoded Set**: Numbers `1`, `2`, `3`, ... up to ~20, following parseable format convention where digits = concrete cells. Displayed in palette for selection.

## Initial State

**On Load**:
- Single grid with ID `grid_1`
- Size: 5×5
- All cells Empty
- No pins set

## Implementation Phases

**Phase 1** - Core Editor UI: Multi-grid cards, palette-based cell editing, grid resize without pins, add/delete/duplicate grids, context menus

**Phase 2** - Console Output: Save button writes grid state to console in parseable format, local state only

**Phase 3** - Advanced Manipulation: Pin system, cell dragging, conflict resolution, grid reordering, full undo/redo

**Phase 4** - Server Integration: Save POSTs to dev server, multi-client sync via polling

**Phase 5** - Polish & Integration: Connect with visualization session, import/export, visual refinements

## Technical Stack

**Frontend**: TypeScript + SvelteKit (existing web/ directory), immutable state management (Zustand or similar), command pattern for undo/redo

**Backend**: Dev server extended with save endpoint, WebSocket or polling for multi-client updates, in-memory state with console logging

**Integration**: Reuses existing grid analysis/visualization code. Level editor produces same grid format consumed by visualization.

## Key Design Decisions

- **No confirmation dialogs**: Rely on undo for recovery
- **No cascading displacement**: Single level only for conflict resolution and cell drag
- **Minimum grid size**: 1×1 (more flexible than spec)
- **Grid reordering not undoable**: Layout preference, not data mutation
- **Primary ref enforcement**: Via palette availability, not validation errors
- **Single shared state**: Not yet multi-user collaboration (last write wins)
- **Corner handle interaction**: Simple drag = visual zoom (CSS transform), Super+drag = grid resize (add/remove rows/columns)
- **Zoom range**: 0.1x to 5.0x, clamped in `setGridScale()`
- **Zoom stored in metadata**: Per-grid scale factor in `state.metadata`, not part of grid data
