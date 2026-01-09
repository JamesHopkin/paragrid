# Minimal and clean components, encapsulation away grid store

## Components

### Hierarchy helper

Uses grid store
API entirely based on grid _names_

Given grid name:
- get parent
- directly contained references: list/find by grid name
- path to named ancestor

Finds are cycle-aware

### Scale helper

Uses grid store and hierarchy helper

- given path (inwards or outwards), find relative combined scale and offset (i.e. world position if initial grid is scale 1)

### Game camera protocol

For this protocol, a view is represented by list of grid names, that is a path through the grid hierarchy that the scale helper can turn into an offset and scale, i.e. centre and view width.

- provide view on init given player grid position (just grid name initially)
- provide new view on player leaving or entering a grid, with option animation start (defaults to existing view, but there will be cases where we want to provide a different but often visually equivalent view)
- future: provide view when player moves (initially components above do not expose anything about individual cells in grids)

## Dev plan

1. Implement helpers
2. Add controls to demo app to directly set view using view grid paths (see game camera protocol) - disable existing game camera update code when this is enabled
  - just a text box and accompanying status
  - feature enable if textbox is non-empty
  - format is a.b.c, where letters are the case insensitive first letters of grids
3. Reimplement camera controls to use above protocol
4. Define one or more camera control types implementing the protocol

## Future

- Make first path in camera view authoritative and update root grid accordingly
- Possible the navigator could reuse the hierarch helper for some features; likewise rendering and the scale helper, or code could be shared between these systems.
- A future player-aware extension could centre the player but keep the width the same (rather than centering the whole grid)

## Answers to Claude's initial queries

### View Representation & Paths

>  1. View path direction: When you say "a view is represented by list of grid names, that is a path through the grid hierarchy" - is this path:
>    - Always from some root/top-level grid down to the player's current grid?
>    - Or can it be arbitrary (e.g., a path showing a parent grid that contains the player)?
>    - Example: if player is in grid C, which is referenced by grid B, which is referenced by grid A, would the view path be ["A", "B", "C"] or could it be ["B", "C"] to zoom in closer?

A view is absolute - it must start with the root grid.

- in our initial integration with the current code, we'll continue to maintain a root grid, and expect views provide by the web dev tools or game camera control to match
- we may make the first entry in the view authoritative over the root grid to display
 
> 2. Scale helper starting point: When calculating "relative combined scale and offset":
>     - What's the reference frame? Is it always "grid at path[0] has scale 1"?
>     - Does "inwards" mean following Ref cells deeper, while "outwards" means following parent relationships up?

Correct for both. I _think_ the most consistent scale with the current code is for a _cell_ in the path[0] grid to have a width of 1.

### Animation & Teleportation

> 3. Visually equivalent views: You mention wanting "a different but often visually equivalent view" as animation start - can you give a concrete example?
>     - Is this related to teleportation semantics? E.g., when exiting via a secondary ref, the view needs to jump to show the primary ref location?

Cycles produce visually equivalent (perhaps better: equivalent focus) views. E.g. say a and b each contain a reference to each other, a.b and a.b.a.b both focus on b. The only difference is how much of the outer cycle is renderered.

>  4. Current camera behavior: How does the existing camera implementation handle these transitions currently? Does it do anything special for secondary refs?

Unclear - I'm not convinced the current implementation is very consistent.

### Player Position & Scope

>  5. Player representation: "just grid name initially" suggests:
>    - The player's position within a cell isn't tracked by these helpers initially?
>    - Or do you mean the camera view doesn't need sub-cell precision for the MVP?

Correct to both. The player's position is in the grid store of course, but it won't be exposed by these APIs initially.

>  6. Cell-level information: The protocol says "initially components above do not expose anything about individual cells" - does this mean the hierarchy helper won't have APIs like "get cell at position (x,y) in grid"?

Correct.

### Path Finding & Cycles

>  7. Parent relationships: Given cycles and teleportation, when you "get parent" of a grid:
>    - Is this the grid containing the primary reference?
>    - What happens if you ask for parent of a grid that's only referenced as part of a cycle?

I think the notion of parent is unambiguous: it's the grid containing the primary reference to the child, if any. Otherwise there's no parent.

---

## Implementation Progress

### ✅ Phase 1: Helpers Implementation (Complete)

**Location**: `web/src/lib/camera/`

#### Hierarchy Helper (`hierarchy-helper.ts`)
Provides clean API for navigating grid hierarchy based on grid names:
- `getParent(store, gridId)` - Returns parent grid ID (via primary ref) or null
- `getDirectlyContainedReferences(store, gridId)` - Lists all grids referenced by a grid (order preserved, deduplicated)
- `findDirectlyContainedReference(store, parentId, childId)` - Boolean check for reference existence
- `getPathToAncestor(store, fromId, toAncestorId)` - Returns path array or null (cycle-aware)
- `getAncestorChain(store, gridId)` - Returns full path to root or null on cycles

All functions are cycle-aware and use the existing `findPrimaryRef` utility to determine parent relationships.

#### Scale Helper (`scale-helper.ts`)
Calculates scale and offset for view paths using plain number arithmetic:
- `getScaleAndOffset(store, path)` - Returns `ScaleAndOffset` with center position and dimensions (all numbers)

**Scale convention**: A cell in `path[0]` has width 1.0

The helper walks the path, tracking cumulative scale and offset as it descends through reference cells. For each step:
1. Finds the reference cell position in the parent grid
2. Calculates cell dimensions based on parent grid size
3. Updates center position to the reference cell's center
4. Updates dimensions to the reference cell's dimensions

#### Tests (`camera-helpers.test.ts`)
Comprehensive test suite with 26 tests covering:
- Parent-child relationships and multi-level nesting
- Reference listing and deduplication
- Path finding with cycles and invalid paths
- Scale calculations for various grid configurations
- Edge cases (empty paths, non-existent grids, cycles)

All tests passing ✅

### ✅ Phase 3: Camera Protocol Implementation (Complete)

**Location**: `web/src/lib/camera/`

#### Camera Protocol (`camera-protocol.ts`)
Defines the interface for game camera controllers:
- `ViewPath` - Type alias for readonly array of grid names representing a path through hierarchy
- `ViewUpdate` - Return type containing target view and optional animation start view
- `CameraController` interface with methods:
  - `getInitialView(store, playerGridId)` - Get initial view when game starts
  - `onPlayerEnter(store, fromGridId, toGridId, viaNonPrimaryReference)` - Handle player entering a grid
  - `onPlayerExit(store, fromGridId, toGridId)` - Handle player exiting a grid
  - `onPlayerMove(store, gridId)` - Handle player moving within same grid

#### Parent View Camera Controller (`parent-view-camera.ts`)
Default implementation that shows parent/ancestor grids for context:
- Priority: highest ancestor → immediate parent → current grid
- Uses `findHighestAncestor` to find ancestor via exit destinations
- Falls back to `getParent` for immediate parent
- Falls back to `getAncestorChain` for building root-to-current path
- Provides view paths that the scale helper can convert to camera position/scale

#### Demo Integration
The demo (`demo-iso.ts`) has been refactored to use the camera protocol:
- Instantiates `ParentViewCameraController` on startup
- Calls appropriate controller methods on player movement (enter/exit/move)
- Uses `currentViewPath` from controller (or `manualViewPath` if manual override is active)
- Both manual and automatic modes now use the same rendering path via `getScaleAndOffset`
- Removed old camera logic (`getRenderGridInfo`, `calculateCameraTransition`, etc.)

The status display now shows "View Path" instead of "Visual Root", displaying the full path from root to focused grid.

**TODO for Phase 4**: Handle animation start views for smooth transitions when entering/exiting grids.

### Implementation Notes

1. **Coordinate System**: The scale helper uses a coordinate system where path[0] is the root with each cell having width/height 1. Centers are calculated at the middle of cells.

2. **Path Validity**: `getScaleAndOffset` validates that each step in the path actually references the next grid, returning null for invalid paths.

3. **Cycle Handling**: Both helpers are cycle-aware. Hierarchy helper returns null on cycles, which prevents infinite loops in ancestor traversal.

4. **Number Arithmetic**: Using plain JavaScript numbers for simplicity. Floating-point precision is sufficient for camera calculations.

5. **No Cell-Level APIs**: As specified, these helpers don't expose individual cell positions or player positions - they work purely with grid names and paths.

### Next Steps (from Dev Plan)

- [x] **Phase 2**: Add controls to demo app to directly set view using grid paths (Complete)
  - Add UI controls to input/select view paths
  - Implement view rendering using scale helper output
  - Disable existing camera update code when manual view control is enabled

- [x] **Phase 3**: Reimplement camera controls to use camera protocol (Complete)
  - Define camera protocol interface (view provider)
  - Refactor existing camera code to implement protocol
  - Handle animation start views for teleportation cases

- [ ] **Phase 4**: Define camera control types
  - Create one or more camera controller implementations
  - Handle player entry/exit events
  - Support visually equivalent views for cycles
