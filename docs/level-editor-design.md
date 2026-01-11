# Paragrid Level Editor - Design Document

## Overview

A web-based visual editor for creating and modifying Paragrid grid structures. The editor provides direct manipulation of grids, cells, and references with full undo/redo support.

## Core UI Components

### Multi-Grid Layout

**Card-based Flexible Flow**
- Each grid is displayed as a draggable card
- Cards flow naturally with wrapping (like CSS flexbox)
- Useful for managing many small sub-grids alongside larger ones

**Grid Reordering**
- Super+drag on grid body (not corner handle) to reorder
- Dragged grid shows tinted preview
- Other cards flow around preview position during drag
- **Note**: Grid reordering is NOT part of undo history (layout preference, not data)

### Individual Grid Editor

**Visual Structure**
- Table of square cells representing grid contents
- Minimum size: 1×1 (relaxed from spec's 1×2 minimum)
- Corner resize handle visible in bottom-right

**Resize Interaction**
- Super+drag corner handle to resize
- Snapped to cell grid boundaries
- Shows preview of resulting grid layout during drag
- Operation only commits on drop
- Pin system determines which cells move/stay during resize (see Pin System section)

**Zoom Behavior**
- Normal zoom: standard viewport zoom
- Super+zoom: reserved for potential add/remove row/column shortcuts (future feature)

### Cell Interaction

**Palette Access**
- Click anywhere on a cell (except pin controls) to open palette
- Palette shows available cell types:
  - **Empty**: Clear the cell
  - **Concrete**: Hardcoded IDs following convention (numbers = concrete in parseable format)
  - **Ref (Primary)**: References to other grids' primary positions
    - Current grid: Only if primary self-ref not already placed
    - Other grids: Only if their primary ref not yet placed anywhere
  - **Ref (Non-primary)**: All non-primary references to all grids

**Cell Dragging**
- Drag cell A to position B
- Cell A content (including pin state) moves to position B
- Cell B content attempts placement in adjacent empty cell
  - Adjacent = orthogonally neighboring cells
  - If no adjacent empty cells, content is removed
- No cascading displacement - single level only

## Pin System

**Purpose**: Control cell positioning behavior during grid resize operations

**Pin Types**:
1. **No pins** (default): Cell maintains absolute grid position (row N, col M)
2. **Edge pins**:
   - Top: Maintains offset from top edge
   - Bottom: Maintains offset from bottom edge
   - Left: Maintains offset from left edge
   - Right: Maintains offset from right edge
3. **Center pin**: Maintains proportional position (e.g., 30% from left, 40% from top)

**Pin Precedence**:
- Edge pins override center pin on their respective axis:
  - Left/Right override horizontal positioning
  - Top/Bottom override vertical positioning
- Example: Left + Center = fixed distance from left edge, proportional vertical position
- Example: Bottom + Right = fixed offset from bottom-right corner

**Pin UI**:
- Classic push-pin icons at cell edges and center (5 total positions per cell)
- Only visible when grid zoomed sufficiently (to avoid clutter)
- Click pin icon to toggle that pin on/off
- Visual state: filled icon = active, outline icon = inactive

**Default State**: All pins disabled for newly created cells

**Pin Behavior During Operations**:
- **Cell drag**: Pin configuration travels with cell content
- **Grid shrink**: Unpinned cells may be lost if their absolute position no longer exists
- **Grid grow**: Unpinned cells stay at absolute position; pinned cells may shift

## Conflict Resolution

**Scenario**: Multiple cells would occupy the same position after an operation (e.g., shrinking 7×7 to 3×3)

**Algorithm**:
1. Collect all cells whose target positions overlap
2. Apply winner selection heuristic (TBD, initial options):
   - Pinned cells have priority
   - Spatial priority (top-left to bottom-right)
   - Primary refs preserved over secondary refs
3. Winners occupy their target positions
4. Losers attempt placement in empty cells adjacent to their intended target
5. Remaining losers are removed

**Constraint**: No cascading displacement - one level of conflict resolution per operation

## Reference Management

**Primary Reference Rules**:
- Each grid has exactly one primary reference
- Self-references allowed (grid can have primary ref to itself)
- Primary ref placement enforced through palette availability

**Reference Operations**:
- **Change primary to secondary**: Not directly supported; delete and re-add
- **Delete grid**: Automatically deletes all references to that grid (including from other grids)
- **Orphaned references**: Not possible due to delete cascade

**Visual Indication** (future enhancement):
- Show which grids reference which (arrows/badges)
- Distinguish primary vs secondary refs in cell display

## State Management

**Data Model**:
```typescript
interface EditorState {
  grids: Map<string, GridDefinition>;
  gridOrder: string[]; // For card layout order (not undoable)
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

interface GridMetadata {
  // UI state, dimensions, etc.
}
```

**Undo/Redo System**:
- **Scope**: Global across all grids
- **Granularity**: Every mutating operation
- **Operations tracked**:
  - Set/clear cell content
  - Resize grid
  - Cell drag
  - Toggle pins
  - Add/delete/duplicate grid
  - Rename grid
- **Not tracked**: Grid card reordering (layout preference only)

**Implementation**: Command pattern with immutable state snapshots

## Operations

### Grid Operations

**Add Grid**:
- Button in UI to create new grid
- Auto-generated ID: `grid_1`, `grid_2`, etc.
- Right-click context menu includes "Rename" option
- Initial state: Empty grid with default size

**Duplicate Grid**:
- Right-click context menu on grid card
- Creates deep copy of grid with all cells, content, and pin states
- Auto-generated ID: next available in sequence (e.g., `grid_3`)
- References in duplicated grid still point to original target grids
- Primary refs in duplicate become non-primary (to avoid duplicate primaries)
- Undoable

**Delete Grid**:
- Right-click context menu on grid card
- Immediately removes grid and all references to it across all grids
- No confirmation dialog (rely on undo for recovery)
- Undoable

**Resize Grid**:
- Super+drag corner handle
- Preview shows resulting layout with pin calculations applied
- Commits on drop
- Minimum size: 1×1
- Undoable

### Cell Operations

**Set Cell Content**:
- Click cell → palette → select type
- Validates primary ref constraints
- Undoable

**Drag Cell**:
- Drag cell A to cell B
- Content swap with displacement rules
- Undoable

**Toggle Pin**:
- Click pin icon at edge/center of cell
- Only visible at sufficient zoom
- Undoable

## Save & Persistence

**Save Mechanism**:
- Explicit "Save" button in UI
- POSTs current state to dev server
- Server updates in-memory grid store
- Writes parseable text format to console/log
- All open browsers polling for updates receive new state

**Format**:
- Parseable text format (existing convention):
  - Numbers = Concrete cells
  - Letters = References (A-Z mapped to grid IDs)
  - Convention documented elsewhere

**Multi-Client Sync**:
- Single shared state (not multi-user collaboration yet)
- Open browsers poll for updates
- Last write wins (no conflict resolution between clients)

## Initial State

**On Load**:
- Single grid with ID `grid_1`
- Size: 5×5
- All cells Empty
- No pins set

**Rationale**: Friendly starting point, demonstrates structure immediately

## Concrete Cell IDs

**Hardcoded Set**:
- Numbers: `1`, `2`, `3`, ... (up to reasonable limit like 20)
- Follows parseable format convention where digits = concrete cells
- Displayed in palette for selection

**Future**: Could be made configurable via settings or per-project

## Context Menus

**Grid Card Right-Click**:
- Rename grid
- Duplicate grid
- Delete grid (with confirmation)

**Cell Right-Click** (future):
- Currently click opens palette
- Could add copy/paste, clear, etc.

## Visual Design Notes

**Grid Cards**:
- Title bar with grid ID
- Clear corner handle indicator (icon + cursor change)
- Border/shadow for card depth

**Cells**:
- Visual distinction for Empty vs Concrete vs Ref
- Color coding for primary vs secondary refs (future)
- Pin icons overlaid when zoom threshold met

**Palette**:
- Modal or popover near clicked cell
- Organized sections: Empty, Concrete list, Primary refs, Secondary refs
- Disabled options grayed out (e.g., duplicate primary ref)

## Future Enhancements

**Near-term**:
- Lines of similar cells (auto-fill during resize)
- Visual reference graph showing grid relationships
- Cell-level select/copy/paste (grid duplication available earlier)
- Keyboard shortcuts for common operations

**Long-term**:
- Multi-user collaboration with CRDT or OT
- Templates and prefabs
- Import/export different formats
- Playback mode integrated with visualization

## Technical Stack

**Frontend**:
- TypeScript + SvelteKit (existing web/ directory)
- Immutable state management (Zustand or similar)
- Command pattern for undo/redo

**Backend**:
- Existing dev server extended with save endpoint
- WebSocket or polling for multi-client updates
- In-memory state with console logging

**Integration**:
- Reuse existing grid analysis/visualization code
- Level editor produces same grid format consumed by visualization

## Open Questions for Implementation

1. **Conflict resolution heuristic**: Which cell wins when positions overlap?
2. **Pin proportional rounding**: How to handle fractional positions for center-pinned cells?
3. **Save confirmation**: Auto-save, manual save, or both?
4. **Error feedback**: Toast notifications or inline errors (no modals - rely on undo)
5. **Mobile support**: Touch interactions for drag/pins/resize?

## Implementation Phases

**Phase 1 - Core Editor UI**:
- Multi-grid card layout
- Basic cell editing (palette, no dragging yet)
- Grid resize without pins
- Add/delete/duplicate grids
- Context menus

**Phase 2 - Console Output**:
- Save button writes grid state to console in parseable format
- Local state management only
- No server communication yet

**Phase 3 - Server Integration**:
- Save button POSTs to dev server
- Server updates in-memory grid store
- Multi-client sync via polling
- Two-window workflow: editor + preview

**Phase 4 - Advanced Manipulation**:
- Pin system
- Cell dragging
- Conflict resolution
- Grid reordering
- Full undo/redo

**Phase 5 - Polish & Integration**:
- Connect with existing visualization session
- Import/export workflows
- Visual refinements
- Testing with complex grid structures
