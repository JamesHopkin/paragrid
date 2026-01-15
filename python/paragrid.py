"""
Recursive grid structure with cycle-aware visualization.
Two-phase algorithm: analyze (builds CellTree) -> render (ASCII output).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from enum import Enum
from fractions import Fraction
from math import lcm
from typing import Callable, Iterator, Union, assert_never

from ancestor_entry import (
    compute_exit_ancestor_fraction,
    compute_entry_from_ancestor_fraction,
)
from grid_parser import parse_grids, parse_grids_concise
from grid_types import (
    Cell,
    Concrete,
    Direction,
    Empty,
    Grid,
    GridStore,
    Ref,
)

logger = logging.getLogger(__name__)

# Configuration: Sanity check limit for backtracking to prevent hangs
# Should never be reached in practice with finite grids
MAX_BACKTRACK_DEPTH = 10000

# Public API
__all__ = [
    # Imported from grid_types
    "Direction",
    # Strategy types
    "RefStrategyType",
    "RefStrategy",
    "RuleSet",
    # Cell types
    "Empty",
    "Concrete",
    "Ref",
    "Cell",
    # Grid types
    "Grid",
    "GridStore",
    # Node types
    "EmptyNode",
    "CutoffNode",
    "ConcreteNode",
    "NestedNode",
    "RefNode",
    "CellNode",
    # Position and tags
    "CellPosition",
    "TagFn",
    # Failure types
    "PushFailure",
    # Functions
    "analyze",
    "parse_grids",
    "parse_grids_concise",
    "push",
    "pull",
    "push_simple",
    "find_primary_ref",
    "find_tagged_cell",
]


class RefStrategyType(Enum):
    """Individual strategy types for handling Ref cells."""

    PORTAL = "portal"  # Try to enter the Ref (traverse through it)
    SOLID = "solid"  # Treat the Ref as a solid object (push it)
    SWALLOW = "swallow"  # Swallow the target cell (only when start is Ref)


# Type alias for ref strategy ordering
RefStrategyOrder = tuple[RefStrategyType, ...]

# Predefined common strategy orderings
class RefStrategy:
    """Common Ref handling strategy orderings."""

    # Default: try solid (push), then portal (enter), then swallow
    DEFAULT: RefStrategyOrder = (
        RefStrategyType.SOLID,
        RefStrategyType.PORTAL,
        RefStrategyType.SWALLOW,
    )

    # Legacy compatibility
    TRY_ENTER_FIRST: RefStrategyOrder = (
        RefStrategyType.PORTAL,
        RefStrategyType.SOLID,
        RefStrategyType.SWALLOW,
    )

    PUSH_FIRST: RefStrategyOrder = (
        RefStrategyType.SOLID,
        RefStrategyType.PORTAL,
        RefStrategyType.SWALLOW,
    )

    SWALLOW_FIRST: RefStrategyOrder = (
        RefStrategyType.SWALLOW,
        RefStrategyType.PORTAL,
        RefStrategyType.SOLID,
    )


@dataclass(frozen=True)
class RuleSet:
    """Rules governing operation behavior."""

    ref_strategy: RefStrategyOrder = RefStrategy.DEFAULT




# =============================================================================
# Data Structures: Analysis Result (CellTree)
# =============================================================================


@dataclass(frozen=True)
class EmptyNode:
    """Analyzed explicitly empty cell."""

    focus_depth: int | None = None
    focus_offset: tuple[int, int] | None = None


@dataclass(frozen=True)
class CutoffNode:
    """Cell below recursion threshold (had more content)."""

    focus_depth: int | None = None
    focus_offset: tuple[int, int] | None = None


@dataclass(frozen=True)
class ConcreteNode:
    """Analyzed concrete cell."""

    id: str
    grid_id: str  # Which grid this cell belongs to
    focus_depth: int | None = None
    focus_offset: tuple[int, int] | None = None


@dataclass(frozen=True)
class NestedNode:
    """Analyzed nested grid."""

    grid_id: str
    children: tuple[tuple[CellNode, ...], ...]
    focus_depth: int | None = None
    focus_offset: tuple[int, int] | None = None


@dataclass(frozen=True)
class RefNode:
    """A reference to another grid (wraps the nested content)."""

    grid_id: str  # The grid this ref belongs to
    ref_target: str  # The grid being referenced
    is_primary: bool  # Whether this is the primary reference
    content: "CellNode"  # The analyzed content of the referenced grid
    focus_depth: int | None = None
    focus_offset: tuple[int, int] | None = None


CellNode = EmptyNode | CutoffNode | ConcreteNode | NestedNode | RefNode


# =============================================================================
# Phase 1: Analyze
# =============================================================================


def analyze(
    store: GridStore,
    grid_id: str,
    width: Fraction,
    height: Fraction,
    threshold: Fraction = Fraction(1, 10),
    primary_refs: set[str] | None = None,
    focus_path: list[str] | None = None,
    current_path: list[str] | None = None,
    parent_ref_pos: tuple[int, int] | None = None,
) -> CellNode:
    """
    Build a CellTree by DFS traversal with rational dimensions.
    Terminates when cell dimensions fall below threshold.

    Args:
        store: The grid store
        grid_id: The grid to analyze
        width: The width to render this grid at
        height: The height to render this grid at
        threshold: Minimum dimension before cutoff
        primary_refs: Set to track which grids have been referenced (for primary detection)
        focus_path: Optional path to the focused grid (list of grid IDs)
        current_path: Current path during traversal (list of grid IDs)
        parent_ref_pos: Position of the ref cell in the parent grid (for depth -1 offset)
    """
    if primary_refs is None:
        primary_refs = set()

    # Initialize current path if not provided
    if current_path is None:
        current_path = [grid_id]
    else:
        current_path = current_path + [grid_id]

    # Helper function to find ref position for depth -1 offset computation
    def find_focus_ref_position() -> tuple[int, int] | None:
        """Find the position of the ref cell that leads toward the focused grid."""
        # Invariant: current_path is always initialized (lines 218-221)
        # focus_path is checked by caller (compute_focus_metadata line 246)
        assert focus_path is not None and current_path is not None, "unreachable: paths initialized before helper call"

        # Caller guarantees len(current_path) < len(focus_path) (line 253)
        if len(current_path) >= len(focus_path):  # pragma: no cover
            assert False, "Unreachable: caller checks len(current_path) < len(focus_path)"

        # Caller guarantees focus_path[:len(current_path)] == current_path (line 255)
        if focus_path[: len(current_path)] != current_path:  # pragma: no cover
            assert False, "Unreachable: caller checks paths match as prefix"

        # We're an ancestor - find the ref to the next grid in focus_path
        next_grid_id = focus_path[len(current_path)]
        for r, row in enumerate(grid.cells):
            for c, cell in enumerate(row):
                if isinstance(cell, Ref) and cell.grid_id == next_grid_id:
                    return (c, r)
        return None

    # Helper function to compute focus metadata
    def compute_focus_metadata(
        row: int, col: int
    ) -> tuple[int | None, tuple[int, int] | None]:
        """Compute focus_depth and focus_offset for a cell at (row, col)."""
        if focus_path is None:
            return None, None

        # Compare current_path to focus_path
        if current_path == focus_path:
            # Depth 0: inside focused grid
            return 0, (col, row)
        elif len(current_path) < len(focus_path):
            # Check if current_path is a prefix of focus_path
            if focus_path[: len(current_path)] == current_path:
                # We're an ancestor (negative depth)
                depth = -(len(focus_path) - len(current_path))
                # For any ancestor level, compute offset relative to ref position
                ref_pos = find_focus_ref_position()
                if ref_pos is not None:
                    ref_col, ref_row = ref_pos
                    return depth, (col - ref_col, row - ref_row)
                return depth, None
        elif len(current_path) > len(focus_path):
            # Check if focus_path is a prefix of current_path
            if current_path[: len(focus_path)] == focus_path:
                # We're a descendant (positive depth)
                depth = len(current_path) - len(focus_path)
                return depth, None

        # Paths diverged
        return None, None

    if width < threshold or height < threshold:
        depth, offset = compute_focus_metadata(0, 0)
        return CutoffNode(depth, offset)

    grid = store[grid_id]
    cell_width = width / grid.cols
    cell_height = height / grid.rows

    rows: list[tuple[CellNode, ...]] = []
    for r, row in enumerate(grid.cells):
        cols: list[CellNode] = []
        for c, cell in enumerate(row):
            # Compute focus metadata for this cell
            depth, offset = compute_focus_metadata(r, c)

            match cell:
                case Empty():
                    cols.append(EmptyNode(depth, offset))
                case Concrete(id=cell_id):
                    cols.append(ConcreteNode(cell_id, grid_id, depth, offset))
                case Ref(grid_id=ref_id, is_primary=explicit_primary):
                    # Check if this is the primary reference
                    if explicit_primary is True:
                        # Explicitly marked as primary
                        is_primary = True
                        primary_refs.add(ref_id)
                    elif explicit_primary is False:
                        # Explicitly marked as non-primary
                        is_primary = False
                    else:
                        # Auto-determine: first ref to this grid is primary
                        is_primary = ref_id not in primary_refs
                        if is_primary:
                            primary_refs.add(ref_id)

                    # Analyze the referenced grid
                    content = analyze(
                        store,
                        ref_id,
                        cell_width,
                        cell_height,
                        threshold,
                        primary_refs,
                        focus_path,
                        current_path,
                        (c, r),  # Pass ref position for depth -1 offset
                    )

                    # Wrap in RefNode
                    cols.append(RefNode(grid_id, ref_id, is_primary, content, depth, offset))
                case _: # pragma: no cover
                    assert_never(cell)
        rows.append(tuple(cols))

    # Compute focus metadata for the NestedNode itself
    # NestedNode represents the entire grid - use position (0, 0) as representative
    depth, offset = compute_focus_metadata(0, 0)

    return NestedNode(grid_id, tuple(rows), depth, offset)


# =============================================================================
# Traversal
# =============================================================================


@dataclass(frozen=True)
class CellPosition:
    """A position within the grid structure."""

    grid_id: str
    row: int
    col: int


# Type alias for the try_enter callback
TryEnter = Callable[[str, Direction], CellPosition | None]

# Type alias for the tagging function
TagFn = Callable[[Cell], set[str]]


class Navigator:
    """
    Stateful navigator through grid positions in a direction.

    Handles grid traversal with automatic edge detection and entry/exit logic.
    Based on the reference implementation in test_push_sketch.py.
    """

    def __init__(
        self,
        store: GridStore,
        position: CellPosition,
        direction: Direction,
    ):
        self.store = store
        self.current = position
        self.direction = direction
        self.visited_grids: set[str] = set()  # For exit cycle detection

        # Ancestor-based entry tracking
        self.exit_grid_id: str | None = None  # Grid we exited from (for ancestor mapping)
        self.exit_position: tuple[int, int] | None = None  # (row, col) when last exit occurred
        self.ancestor_grid_id_for_entry: str | None = None  # Ancestor grid where we landed after exit
        self.ref_chain_from_ancestor: list[tuple[str, int, int, str]] = []  # (parent_grid_id, ref_row, ref_col, child_grid_id)

        # Direction deltas
        self.deltas = {
            Direction.N: (-1, 0),
            Direction.S: (1, 0),
            Direction.E: (0, 1),
            Direction.W: (0, -1),
        }

    def clone(self) -> "Navigator":
        """Create a copy for backtracking."""
        nav = Navigator(self.store, self.current, self.direction)
        nav.visited_grids = self.visited_grids.copy()
        # Copy ancestor-based entry state
        nav.exit_grid_id = self.exit_grid_id
        nav.exit_position = self.exit_position
        nav.ancestor_grid_id_for_entry = self.ancestor_grid_id_for_entry
        nav.ref_chain_from_ancestor = self.ref_chain_from_ancestor.copy()
        return nav

    def try_advance(self) -> bool:
        """
        Try to move to next position in direction.
        Handles exiting from nested grids back to parent grids.
        Returns False if can't advance (hit root edge or exit cycle).
        Clears visited_grids on any advance.
        """
        # Clear visited grids when advancing
        self.visited_grids.clear()

        dr, dc = self.deltas[self.direction]
        grid = self.store[self.current.grid_id]
        next_row = self.current.row + dr
        next_col = self.current.col + dc

        # Check bounds
        if next_row < 0 or next_row >= grid.rows or next_col < 0 or next_col >= grid.cols:
            # Hit edge - try to exit through cascading parent grids
            # Capture exit position and grid for ancestor-based entry
            self.exit_grid_id = self.current.grid_id
            self.exit_position = (self.current.row, self.current.col)

            # Use iterative approach with cycle detection
            visited_exit_positions: set[tuple[str, int, int]] = set()
            current_grid_id = self.current.grid_id

            while True:
                primary_ref = find_primary_ref(self.store, current_grid_id)
                if primary_ref is None:
                    return False  # Hit root edge

                parent_grid_id, parent_row, parent_col = primary_ref

                # Detect exit cycle
                exit_key = (parent_grid_id, parent_row, parent_col)
                if exit_key in visited_exit_positions:
                    return False  # Exit cycle detected
                visited_exit_positions.add(exit_key)

                parent_grid = self.store[parent_grid_id]

                # Continue in same direction from primary ref
                exit_row = parent_row + dr
                exit_col = parent_col + dc

                # Check if exit position is valid in parent
                if (
                    exit_row >= 0
                    and exit_row < parent_grid.rows
                    and exit_col >= 0
                    and exit_col < parent_grid.cols
                ):
                    # Successfully exited to valid position
                    self.current = CellPosition(parent_grid_id, exit_row, exit_col)
                    # Remember this ancestor for entry calculations
                    self.ancestor_grid_id_for_entry = parent_grid_id
                    # Clear ref chain since we're now at the ancestor level
                    self.ref_chain_from_ancestor = []
                    return True

                # Cascading exit - continue from parent
                current_grid_id = parent_grid_id

        # Normal advance (didn't hit edge) - clear exit info since it's no longer relevant
        self.exit_grid_id = None
        self.exit_position = None
        self.ancestor_grid_id_for_entry = None
        self.current = CellPosition(self.current.grid_id, next_row, next_col)
        return True

    def advance(self) -> None:
        """Move to next position in direction. Asserts if can't advance."""
        success = self.try_advance()
        assert success, f"Navigator.advance() failed at {self.current}"

    def try_enter(self, rules: RuleSet) -> bool:
        """
        Try to enter the Ref at current position from the current direction.
        Uses ancestor-based entry mapping when exit info is available.
        Returns False if can't enter.
        """
        cell = get_cell(self.store, self.current)
        assert isinstance(cell, Ref)

        # Use ancestor-based entry if we have exit information
        if self.exit_grid_id is not None and self.exit_position is not None:
            # Use the ancestor grid where we landed after exit (not current.grid_id which changes with portals)
            assert self.ancestor_grid_id_for_entry is not None, "ancestor_grid_id_for_entry must be set when exit info is available"
            ancestor_grid_id = self.ancestor_grid_id_for_entry

            # Determine dimension based on direction
            # E/W movement: position varies along N-S axis (rows)
            # N/S movement: position varies along E-W axis (cols)
            dimension_attr = 'rows' if self.direction in (Direction.E, Direction.W) else 'cols'
            exit_index = self.exit_position[0] if dimension_attr == 'rows' else self.exit_position[1]

            # Map exit position up to ancestor
            exit_fraction, _ = compute_exit_ancestor_fraction(
                self.store,
                find_primary_ref,
                self.exit_grid_id,
                exit_index,
                dimension_attr,
                stop_at_ancestor=ancestor_grid_id,
            )

            # Build the complete ref chain: existing chain + current ref we're entering
            complete_ref_chain = self.ref_chain_from_ancestor + [
                (self.current.grid_id, self.current.row, self.current.col, cell.grid_id)
            ]

            # Map down from ancestor to target grid using the explicit ref chain
            entry_index = compute_entry_from_ancestor_fraction(
                self.store,
                cell.grid_id,
                exit_fraction,
                dimension_attr,
                ancestor_grid_id=ancestor_grid_id,
                ref_chain=complete_ref_chain,
            )

            # Construct entry position based on direction
            if self.direction == Direction.E:
                entry_row, entry_col = entry_index, 0
            elif self.direction == Direction.W:
                target_grid = self.store[cell.grid_id]
                entry_row, entry_col = entry_index, target_grid.cols - 1
            elif self.direction == Direction.S:
                entry_row, entry_col = 0, entry_index
            else:  # Direction.N
                target_grid = self.store[cell.grid_id]
                entry_row, entry_col = target_grid.rows - 1, entry_index

            entry_pos = CellPosition(cell.grid_id, entry_row, entry_col)
        else:
            # Fall back to standard middle-of-edge entry
            entry_pos = enter(
                self.store,
                cell.grid_id,
                self.direction,
                rules,
            )

        self.visited_grids.add(cell.grid_id)

        # Update ref chain to include the ref we just entered
        # (but only if we used ancestor-based entry - otherwise keep chain as-is for future use)
        if self.exit_grid_id is not None and self.exit_position is not None:
            # Capture current ref position before updating self.current
            self.ref_chain_from_ancestor.append(
                (self.current.grid_id, self.current.row, self.current.col, cell.grid_id)
            )

        self.current = entry_pos
        return True

    def enter(self, rules: RuleSet) -> None:
        """Enter the Ref at current position. Asserts if can't enter."""
        success = self.try_enter(rules)
        assert success, f"Navigator.enter() failed at {self.current}"

    def flip(self) -> None:
        """Reverse direction for swallow operations."""
        flips = {
            Direction.N: Direction.S,
            Direction.S: Direction.N,
            Direction.E: Direction.W,
            Direction.W: Direction.E,
        }
        self.direction = flips[self.direction]


@dataclass
class State:
    """State for backtracking in push operations."""

    path: list[CellPosition]
    nav: Navigator
    strategies: list[RefStrategyType]
    visited: set[tuple[str, int, int]]  # Track visited positions for cycle detection


@dataclass(frozen=True)
class PushFailure:
    """Information about why a push operation failed."""

    reason: str  # "ENTER_CYCLE" | "EXIT_CYCLE" | "BLOCKED" | "STOP_TAG" | "PATH_CYCLE" | "NO_STRATEGY" | "MAX_DEPTH"
    position: CellPosition  # Where the failure occurred
    details: str | None = None  # Optional human-readable details


def find_primary_ref(store: GridStore, target_grid_id: str) -> tuple[str, int, int] | None:
    """
    Find the primary reference to a grid.
    First looks for explicitly marked primary (is_primary=True), then falls back to first ref found.
    Returns (parent_grid_id, row, col) or None if not found.
    """
    # First pass: look for explicitly marked primary
    for grid in store.values():
        for r, row in enumerate(grid.cells):
            for c, cell in enumerate(row):
                if isinstance(cell, Ref) and cell.grid_id == target_grid_id and cell.is_primary is True:
                    return (grid.id, r, c)

    # Second pass: fall back to first ref found
    for grid in store.values():
        for r, row in enumerate(grid.cells):
            for c, cell in enumerate(row):
                if isinstance(cell, Ref) and cell.grid_id == target_grid_id:
                    return (grid.id, r, c)
    return None


def get_cell(store: GridStore, pos: CellPosition) -> Cell:
    """
    Get the cell at a given position in the grid store.

    Args:
        store: The grid store containing all grids
        pos: The position to look up

    Returns:
        The cell at the given position
    """
    grid = store[pos.grid_id]
    return grid.cells[pos.row][pos.col]


def enter(
    store: GridStore,
    grid_id: str,
    direction: Direction,
    rules: RuleSet,
) -> CellPosition:
    """
    Determine entry point when entering a grid via a Ref (standard middle-of-edge).

    Standard Entry Convention:
    - East (from left): (rows // 2, 0) — middle of left edge
    - West (from right): (rows // 2, cols - 1) — middle of right edge
    - South (from top): (0, cols // 2) — middle of top edge
    - North (from bottom): (rows - 1, cols // 2) — middle of bottom edge

    Args:
        store: The grid store containing all grids
        grid_id: ID of the grid to enter
        direction: Direction of entry
        rules: RuleSet governing entry behavior (currently unused)

    Returns:
        CellPosition for entry point
    """
    grid = store[grid_id]
    rows = grid.rows
    cols = grid.cols

    # Standard middle-of-edge entry
    if direction == Direction.E:
        entry_row, entry_col = rows // 2, 0
    elif direction == Direction.W:
        entry_row, entry_col = rows // 2, cols - 1
    elif direction == Direction.S:
        entry_row, entry_col = 0, cols // 2
    else:  # Direction.N
        entry_row, entry_col = rows - 1, cols // 2

    return CellPosition(grid_id, entry_row, entry_col)

def push(
    store: GridStore,
    start: CellPosition,
    direction: Direction,
    rules: RuleSet,
    tag_fn: TagFn | None = None,
    max_depth: int = 1000,
) -> GridStore | PushFailure:
    """
    Push cell contents along a path in the given direction (with backtracking).

    The push operation moves cell contents forward along a path, with the contents
    rotating when the push succeeds. Success occurs when:
    1. The path ends at an Empty cell, OR
    2. The path cycles back to the starting position

    This implementation is based on the reference algorithm in test_push_sketch.py,
    using a Navigator abstraction and decision stack for backtracking.

    Args:
        store: The grid store containing all grids
        start: Starting position for the push
        direction: Direction to push
        rules: RuleSet governing Ref handling behavior
        tag_fn: Optional function to tag cells (e.g., for 'stop' tag)
        max_depth: Maximum traversal depth to prevent infinite loops

    Returns:
        New GridStore with pushed contents if successful, PushFailure with reason if push fails
    """

    def make_new_state(
        path: list[CellPosition], nav: Navigator, visited: set[tuple[str, int, int]]
    ) -> State | str | PushFailure:
        """
        Create new state or return termination status.

        Returns 'succeed' if push succeeds, PushFailure if it fails, or a new State
        to continue processing.
        """
        # Check for empty (success)
        current_cell = get_cell(store, nav.current)
        if isinstance(current_cell, Empty):
            return "succeed"

        # Check for stop tag (failure)
        if tag_fn is not None and "stop" in tag_fn(current_cell):
            return PushFailure("STOP_TAG", nav.current, "Encountered stop-tagged cell")

        # Check for cycle
        current_key = (nav.current.grid_id, nav.current.row, nav.current.col)
        if current_key in visited:
            # Cycle detected - check if cycling back to start (success) or elsewhere (failure)
            if len(path) > 0 and nav.current == start:
                return "succeed"  # Cycled to start
            else:
                return PushFailure("PATH_CYCLE", nav.current, "Path cycled to non-start position")

        # Add current position to visited set for this state
        new_visited = visited | {current_key}

        # Compute applicable strategies
        strategies: list[RefStrategyType] = []

        # Get S (source) and T (target)
        assert path
        S_pos = path[-1]
        S_cell = get_cell(store, S_pos)
        T_cell = current_cell

        # Determine available strategies based on rules order
        for strat_type in rules.ref_strategy:
            match (strat_type, T_cell, S_cell):
                case (RefStrategyType.SOLID, _, _):
                    # Check if we can advance (peek ahead)
                    test_nav = nav.clone()
                    if test_nav.try_advance():
                        strategies.append(strat_type)
                case (RefStrategyType.PORTAL, Ref(), _):
                    strategies.append(strat_type)
                case (RefStrategyType.SWALLOW, _, Ref()):
                    strategies.append(strat_type)

        if not strategies:
            return PushFailure("NO_STRATEGY", nav.current, "No applicable strategy available")

        return State(path, nav, strategies, new_visited)

    # Check if starting cell has stop tag - stop-tagged cells cannot be pushed
    start_cell = get_cell(store, start)
    if tag_fn is not None and "stop" in tag_fn(start_cell):
        return PushFailure("STOP_TAG", start, "Cannot push from stop-tagged cell")

    # Initialize navigator
    nav = Navigator(store, start, direction)

    # Initialize with start cell in visited set
    initial_visited = {(start.grid_id, start.row, start.col)}

    # Try to advance to first position
    if not nav.try_advance():
        return PushFailure("BLOCKED", start, "Cannot advance from start position (hit edge)")

    # Create initial state
    state = make_new_state([start], nav, initial_visited)
    if isinstance(state, PushFailure):
        return state  # Failed immediately
    if isinstance(state, str):
        # Immediate success - pushed directly into empty
        final_path: list[tuple[CellPosition, Cell]] = []
        final_path.append((start, get_cell(store, start)))
        final_path.append((nav.current, get_cell(store, nav.current)))
        return apply_push(store, final_path)

    decision_stack = [state]
    backtrack_count = 0
    last_failure: PushFailure | None = None

    while decision_stack:
        state = decision_stack[-1]
        if not state.strategies:
            decision_stack.pop()
            backtrack_count += 1
            # Sanity check: Should never be reached with finite grids
            assert backtrack_count < MAX_BACKTRACK_DEPTH, (  # pragma: no cover
                f"Exceeded backtrack depth limit ({MAX_BACKTRACK_DEPTH}). "
                "This indicates a bug in the push algorithm."
            )
            continue

        # Clone navigator for this attempt
        nav = state.nav.clone()

        # Handle remaining cases by strategy
        strategy = state.strategies.pop(0)

        new_path = state.path[:]
        match strategy:
            case RefStrategyType.SOLID:
                new_path.append(nav.current)
                nav.advance()

            case RefStrategyType.PORTAL:
                nav.enter(rules)

            case RefStrategyType.SWALLOW:
                new_path.append(nav.current)
                # Swallow: S (last in path) swallows T (current)
                # Move T into S's referenced grid from opposite direction
                nav.flip()
                nav.advance()
                nav.enter(rules)

        new_state = make_new_state(new_path, nav, state.visited)

        if new_state == "succeed":
            # Build final path with cells for apply_push
            path_with_cells: list[tuple[CellPosition, Cell]] = []
            for pos in new_path:
                path_with_cells.append((pos, get_cell(store, pos)))
            path_with_cells.append((nav.current, get_cell(store, nav.current)))
            return apply_push(store, path_with_cells)
        elif isinstance(new_state, PushFailure):
            # Store failure for potential return if all strategies exhausted
            last_failure = new_state
            continue  # Try next strategy
        elif isinstance(new_state, State):
            decision_stack.append(new_state)
            continue

    # All strategies exhausted - last_failure must have been set
    # (guaranteed by finite grids and backtrack assertion above)
    assert last_failure is not None, "Bug: decision_stack empty but no failure recorded"  # pragma: no cover
    return last_failure


def pull(
    store: GridStore,
    start: CellPosition,
    direction: Direction,
    rules: RuleSet,
    tag_fn: TagFn | None = None,
    max_depth: int = 1000,
) -> GridStore:
    """
    Pull cell contents from direction into start position.

    The pull operation moves cell contents backward along a path, with the contents
    rotating when complete. Always succeeds (may be a no-op).

    Unlike push, pull:
    - Requires start to be Empty (returns unchanged store if not)
    - Always succeeds (never returns failure)
    - Treats stop tags and cycles as successful termination conditions
    - Does not use backtracking (uses first applicable strategy only)
    - Does not support SWALLOW strategy (skip it)

    Args:
        store: The grid store containing all grids
        start: Starting position for the pull (should be Empty)
        direction: Direction to pull FROM
        rules: RuleSet governing Ref handling behavior
        tag_fn: Optional function to tag cells (stop tags end chain successfully)
        max_depth: Maximum traversal depth to prevent infinite loops

    Returns:
        New GridStore with pulled contents (always returns, never None)
    """
    # 1. Validate start is Empty - if not, return unchanged store (no-op)
    start_cell = get_cell(store, start)
    if not isinstance(start_cell, Empty):
        return store

    # 2. Initialize navigator
    nav = Navigator(store, start, direction)
    path: list[CellPosition] = [start]
    visited: set[tuple[str, int, int]] = {(start.grid_id, start.row, start.col)}
    depth = 0

    # 3. Try first advance - if can't, return unchanged (no-op)
    if not nav.try_advance():
        return store

    # 4. Build path until termination condition
    while depth < max_depth:
        depth += 1
        current_cell = get_cell(store, nav.current)

        # TERMINATION CONDITIONS (all succeed):

        # 4a. Hit Empty - end chain successfully
        if isinstance(current_cell, Empty):
            break

        # 4b. Hit stop tag - end chain successfully
        if tag_fn is not None and "stop" in tag_fn(current_cell):
            break

        # 4c. Hit cycle - end chain successfully
        current_key = (nav.current.grid_id, nav.current.row, nav.current.col)
        if current_key in visited:
            break

        visited.add(current_key)

        # 5. Determine first applicable strategy
        strategy = None
        for strat_type in rules.ref_strategy:
            if strat_type == RefStrategyType.SOLID:
                test_nav = nav.clone()
                if test_nav.try_advance():
                    strategy = "solid"
                    break
            elif strat_type == RefStrategyType.PORTAL and isinstance(current_cell, Ref):
                test_nav = nav.clone()
                if test_nav.try_enter(rules):
                    strategy = "portal"
                    break
            # SWALLOW: Skip (doesn't apply to pull)

        # 6. Execute strategy
        if strategy == "solid":
            path.append(nav.current)
            nav.advance()
        elif strategy == "portal":
            # DON'T add Ref position to path (traverse through it)
            nav.enter(rules)
        else:
            # No strategy available - add current cell and stop
            path.append(nav.current)
            break

    # 7. Apply rotation
    if len(path) <= 1:
        return store  # No-op (only start in path)

    return apply_pull(store, path)


def push_simple(
    store: GridStore,
    start: CellPosition,
    direction: Direction,
    rules: RuleSet,
    tag_fn: TagFn | None = None,
    max_depth: int = 1000,
) -> GridStore | PushFailure:
    """
    Simple push operation without backtracking.

    The push operation moves cell contents forward along a path, with the contents
    rotating when the push succeeds. Success occurs when:
    1. The path ends at an Empty cell, OR
    2. The path cycles back to the starting position

    When a push fails with the initial Ref handling strategy, the entire push fails.
    This is the simpler algorithm without backtracking, using only the first applicable
    strategy at each decision point.

    Args:
        store: The grid store containing all grids
        start: Starting position for the push
        direction: Direction to push
        rules: RuleSet governing Ref handling behavior
        tag_fn: Optional function to tag cells (e.g., for 'stop' tag)
        max_depth: Maximum traversal depth to prevent infinite loops

    Returns:
        New GridStore with pushed contents if successful, PushFailure with reason if push fails
    """
    # Check if starting cell has stop tag - stop-tagged cells cannot be pushed
    start_cell = get_cell(store, start)
    if tag_fn is not None and "stop" in tag_fn(start_cell):
        return PushFailure("STOP_TAG", start, "Cannot push from stop-tagged cell")

    # Initialize navigator
    nav = Navigator(store, start, direction)

    # Initialize path and visited tracking
    path: list[CellPosition] = [start]
    visited: set[tuple[str, int, int]] = {(start.grid_id, start.row, start.col)}

    # Try to advance to first position
    if not nav.try_advance():
        return PushFailure("BLOCKED", start, "Cannot advance from start position (hit edge)")

    # Build path using first applicable strategy at each step
    depth = 0
    while depth < max_depth:
        depth += 1

        # Get current cell
        current_cell = get_cell(store, nav.current)

        # Check for empty (success)
        if isinstance(current_cell, Empty):
            path.append(nav.current)
            # Build final path with cells for apply_push
            final_path: list[tuple[CellPosition, Cell]] = [
                (pos, get_cell(store, pos)) for pos in path
            ]
            return apply_push(store, final_path)

        # Check for stop tag (failure)
        if tag_fn is not None and "stop" in tag_fn(current_cell):
            return PushFailure("STOP_TAG", nav.current, "Encountered stop-tagged cell")

        # Check for cycle
        current_key = (nav.current.grid_id, nav.current.row, nav.current.col)
        if current_key in visited:
            # Cycle detected - check if cycling back to start (success) or elsewhere (failure)
            if nav.current == start:
                path.append(nav.current)
                # Build final path with cells for apply_push
                final_path = [(pos, get_cell(store, pos)) for pos in path]
                return apply_push(store, final_path)
            else:
                return PushFailure("PATH_CYCLE", nav.current, "Path cycled to non-start position")

        # Add current position to visited set
        visited.add(current_key)

        # Get S (source) and T (target)
        assert path  # Path always contains at least start
        S_pos = path[-1]
        S_cell = get_cell(store, S_pos)
        T_cell = current_cell

        # Determine first applicable strategy based on rules order
        selected_strategy: RefStrategyType | None = None
        for strat_type in rules.ref_strategy:
            match (strat_type, T_cell, S_cell):
                case (RefStrategyType.SOLID, _, _):
                    # Check if we can advance (peek ahead)
                    test_nav = nav.clone()
                    if test_nav.try_advance():
                        selected_strategy = strat_type
                        break
                case (RefStrategyType.PORTAL, Ref(), _):
                    selected_strategy = strat_type
                    break
                case (RefStrategyType.SWALLOW, _, Ref()):
                    selected_strategy = strat_type
                    break

        if not selected_strategy:
            return PushFailure("NO_STRATEGY", nav.current, "No applicable strategy available")

        # Execute the selected strategy
        match selected_strategy:
            case RefStrategyType.SOLID:
                path.append(nav.current)
                nav.advance()

            case RefStrategyType.PORTAL:
                nav.enter(rules)

            case RefStrategyType.SWALLOW:
                path.append(nav.current)
                # Swallow: S (last in path) swallows T (current)
                # Move T into S's referenced grid from opposite direction
                nav.flip()
                nav.advance()
                nav.enter(rules)

    # Unreachable with reasonable max_depth: should hit Empty, stop tag, or cycle
    return PushFailure("MAX_DEPTH", nav.current, f"Exceeded maximum depth of {max_depth}")  # pragma: no cover


def apply_push(
    store: GridStore,
    path: list[tuple[CellPosition, Cell]],
) -> GridStore:
    """
    Apply a push operation by rotating cell contents along the path.

    Rotates cells forward: the last cell's content moves to the first position,
    and all other cells shift forward by one position.

    Args:
        store: The grid store containing all grids
        path: List of (position, original_cell) tuples representing the push path

    Returns:
        New GridStore with updated grids (original store unchanged)
    """
    from collections import defaultdict

    # Extract cells and rotate: [c1, c2, c3] -> [c3, c1, c2]
    cells = [cell for _, cell in path]
    rotated = [cells[-1]] + cells[:-1]

    # Group updates by grid_id: grid_id -> list of (row, col, new_cell)
    updates: dict[str, list[tuple[int, int, Cell]]] = defaultdict(list)
    for i, (pos, _) in enumerate(path):
        updates[pos.grid_id].append((pos.row, pos.col, rotated[i]))

    # Reconstruct affected grids immutably
    new_store = store.copy()
    for grid_id, grid_updates in updates.items():
        grid = store[grid_id]

        # Convert to mutable structure
        mutable_cells = [list(row) for row in grid.cells]

        # Apply all updates for this grid
        for row, col, new_cell in grid_updates:
            mutable_cells[row][col] = new_cell

        # Convert back to immutable tuples
        new_cells = tuple(tuple(row) for row in mutable_cells)

        # Create new Grid instance
        new_grid = Grid(grid.id, new_cells)
        new_store[grid_id] = new_grid

    return new_store


def apply_pull(store: GridStore, path: list[CellPosition]) -> GridStore:
    """
    Apply a pull operation by rotating cell contents along the path.

    Rotates cells: the first cell's content moves to the last position,
    and all other cells shift backward by one position.

    This is the OPPOSITE rotation from push: [c1, c2, c3] -> [c2, c3, c1]
    This maintains the relative order of pulled items, preventing sequences
    from being broken up when pulled through refs or across multiple cells.

    Args:
        store: The grid store containing all grids
        path: List of positions involved in the pull, from Empty start to source

    Returns:
        New GridStore with pulled contents applied
    """
    from collections import defaultdict

    # Extract cells and rotate: [c1, c2, c3] -> [c2, c3, c1]
    # Pull uses opposite rotation from push to maintain order
    cells = [get_cell(store, pos) for pos in path]
    rotated = cells[1:] + [cells[0]]

    # Group updates by grid_id for efficient batch updates
    updates: dict[str, list[tuple[int, int, Cell]]] = defaultdict(list)
    for i, pos in enumerate(path):
        updates[pos.grid_id].append((pos.row, pos.col, rotated[i]))

    # Reconstruct affected grids immutably
    new_store = store.copy()
    for grid_id, grid_updates in updates.items():
        grid = store[grid_id]

        # Convert to mutable structure
        mutable_cells = [list(row) for row in grid.cells]

        # Apply all updates for this grid
        for row, col, new_cell in grid_updates:
            mutable_cells[row][col] = new_cell

        # Convert back to immutable tuples
        new_cells = tuple(tuple(row) for row in mutable_cells)

        # Create new Grid instance
        new_grid = Grid(grid.id, new_cells)
        new_store[grid_id] = new_grid

    return new_store


def find_tagged_cell(
    store: GridStore,
    tag: str,
    tag_fn: TagFn,
) -> CellPosition | None:
    """
    Find the first cell with a specific tag across all grids in the store.

    Iterates through all grids and cells, applying tag_fn to find the first
    cell that contains the specified tag.

    Args:
        store: The grid store to search
        tag: The tag to search for (e.g., "player")
        tag_fn: Function that returns set of tags for a cell

    Returns:
        CellPosition of first tagged cell, or None if not found
    """
    for grid in store.values():
        for row_idx, row in enumerate(grid.cells):
            for col_idx, cell in enumerate(row):
                if tag in tag_fn(cell):
                    return CellPosition(grid.id, row_idx, col_idx)
    return None
