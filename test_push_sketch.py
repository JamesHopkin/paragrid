"""Test harness for push algorithm sketch with minimal type implementations."""

from dataclasses import dataclass
from typing import Literal

from simple_chalk import chalk

# Helper functions for test output
def test_pass_mark(passed: bool) -> str:
    """Return ✓ for test passed, ✗ for test failed"""
    if passed:
        return chalk.green('✓')
    else:
        return chalk.red('✗')

def highlight_result(result: str) -> str:
    """Highlight push result with color"""
    if result == 'succeed':
        return chalk.green(result)
    else:
        return chalk.red(result)

# Minimal Cell implementation
@dataclass
class Cell:
    grid_id: str
    row: int
    col: int
    content: str  # 'empty', 'concrete:X', 'ref:grid_id', 'stop:X'

    def is_empty(self) -> bool:
        return self.content == 'empty'

    def is_ref(self) -> bool:
        return self.content.startswith('ref:')

    def ref_target(self) -> str:
        """Get referenced grid_id (only valid if is_ref())"""
        return self.content.split(':')[1]

    def has_tag(self, tag: str) -> bool:
        return self.content.startswith(f'{tag}:')

    def __repr__(self) -> str:
        return f"Cell({self.grid_id}[{self.row},{self.col}]={self.content})"


# Minimal GridStore
class GridStore:
    def __init__(self):
        self.grids: dict[str, list[list[Cell]]] = {}

    def add_grid(self, grid_id: str, rows: int, cols: int):
        grid = []
        for r in range(rows):
            row = []
            for c in range(cols):
                row.append(Cell(grid_id, r, c, 'empty'))
            grid.append(row)
        self.grids[grid_id] = grid

    def set_cell(self, grid_id: str, row: int, col: int, content: str):
        self.grids[grid_id][row][col].content = content

    def get_cell(self, grid_id: str, row: int, col: int) -> Cell:
        return self.grids[grid_id][row][col]


# Minimal Navigator
class Navigator:
    def __init__(self, cell: Cell, direction: str, store: GridStore):
        self.store = store
        self.current = cell
        self.direction = direction

        # Direction deltas
        self.deltas = {
            'N': (-1, 0),
            'S': (1, 0),
            'E': (0, 1),
            'W': (0, -1),
        }

    def clone(self) -> 'Navigator':
        """Create a copy for backtracking"""
        nav = Navigator(self.current, self.direction, self.store)
        return nav

    def advance(self) -> bool:
        """Move to next position in direction. Returns False if can't advance (hit edge)."""
        dr, dc = self.deltas[self.direction]
        grid = self.store.grids[self.current.grid_id]
        next_row = self.current.row + dr
        next_col = self.current.col + dc

        # Check bounds
        if next_row < 0 or next_row >= len(grid) or next_col < 0 or next_col >= len(grid[0]):
            return False  # Hit edge

        self.current = self.store.get_cell(self.current.grid_id, next_row, next_col)
        return True

    def enter(self) -> bool:
        """Enter the Ref at current position from the current direction. Returns False if can't enter."""
        if not self.current.is_ref():
            return False

        target_grid = self.current.ref_target()
        if target_grid not in self.store.grids:
            return False

        # Entry point based on direction (middle of edge convention)
        grid = self.store.grids[target_grid]
        rows, cols = len(grid), len(grid[0])

        if self.direction == 'E':  # Entering from left
            entry_row, entry_col = rows // 2, 0
        elif self.direction == 'W':  # Entering from right
            entry_row, entry_col = rows // 2, cols - 1
        elif self.direction == 'S':  # Entering from top
            entry_row, entry_col = 0, cols // 2
        else:  # 'N' - Entering from bottom
            entry_row, entry_col = rows - 1, cols // 2

        entry_cell = self.store.get_cell(target_grid, entry_row, entry_col)
        self.current = entry_cell
        return True

    def flip(self) -> None:
        """Reverse direction for swallow operations"""
        flips = {'N': 'S', 'S': 'N', 'E': 'W', 'W': 'E'}
        self.direction = flips[self.direction]


# State for backtracking
@dataclass
class State:
    path: list[Cell]
    nav: Navigator
    strategies: list[str]
    visited: set[tuple[str, int, int]]  # Track visited positions for cycle detection


# The push algorithm from the sketch
def push(cell: Cell, direction: str, rules: dict, store: GridStore) -> tuple[list[Cell], str]:
    '''Top level algorithm is responsible for:
     - 'decision' stack for back-tracking
     - trying strategies
     - detecting cycles (also empty? maybe they're roughly equivalent)
     '''
    def make_new_state(path: list[Cell], nav: Navigator, visited: set[tuple[str, int, int]]):
        # Check for empty (success)
        if nav.current.is_empty():
            return 'succeed'

        # Check for stop tag (failure)
        if nav.current.has_tag('stop'):
            return 'fail'

        # Check for cycle
        current_key = (nav.current.grid_id, nav.current.row, nav.current.col)
        if current_key in visited:
            # Cycle detected - check if cycling back to start (success) or elsewhere (failure)
            if len(path) > 0 and nav.current.grid_id == path[0].grid_id and \
               nav.current.row == path[0].row and nav.current.col == path[0].col:
                return 'succeed'  # Cycled to start
            else:
                return 'fail'  # Cycled to non-start

        # Add current position to visited set for this state
        new_visited = visited | {current_key}

        # Compute applicable strategies
        strategies = []

        # Get S (source) and T (target)
        S_cell = path[-1] if path else None
        T_cell = nav.current

        # Determine available strategies based on rules order
        for strat in rules.get('ref_strategy', ['solid', 'enter', 'swallow']):
            if strat == 'solid':
                strategies.append('solid')  # Always available
            elif strat == 'enter' and T_cell.is_ref():
                strategies.append('enter')  # Only if T is Ref
            elif strat == 'swallow' and S_cell and S_cell.is_ref():
                strategies.append('swallow')  # Only if S is Ref

        if not strategies:
            return 'fail'

        return State(path, nav, strategies, new_visited)

    nav = Navigator(cell, direction, store)

    # Initialize with start cell in visited set
    initial_visited = {(cell.grid_id, cell.row, cell.col)}

    if not nav.advance():
        return [], 'fail'

    state = make_new_state([cell], nav, initial_visited)
    if isinstance(state, str):
        return [], state

    decision_stack = [state]

    while decision_stack:
        state = decision_stack[-1]
        if not state.strategies:
            decision_stack.pop()
            continue

        # Clone navigator for this attempt
        nav = state.nav.clone()

        # Handle remaining cases by strategy
        strategy = state.strategies.pop(0)

        match strategy:
            case 'solid':
                state.path.append(nav.current)
                if not nav.advance():
                    print("solid: couldn't advance")
                    continue  # Can't advance, try next strategy

            case 'enter':
                if not nav.enter():
                    print("enter: couldn't")
                    continue  # Can't enter, try next strategy

            case 'swallow':
                print(f"swallow: S={state.path[-1]}, T={nav.current}")
                state.path.append(nav.current)
                # Swallow: S (last in path) swallows T (current)
                # Move T into S's referenced grid from opposite direction
                print(f"swallow: flipping from {nav.direction}")
                nav.flip()
                print(f"swallow: flipped to {nav.direction}, advancing from {nav.current}")
                if not nav.advance():
                    print(f"swallow: couldn't advance (at edge)")
                    continue
                print(f"swallow: advanced to {nav.current}, entering...")
                if not nav.enter():
                    print(f"swallow: couldn't enter (current is {nav.current.content})")
                    continue
                print(f"swallow: entered to {nav.current}")

        new_state = make_new_state(state.path, nav, state.visited)

        if new_state == 'succeed':
            return state.path + [nav.current], 'succeed'
        elif new_state == 'fail':
            continue  # Try next strategy
        else:
            decision_stack.append(new_state)

    return [], 'fail'


# Test cases
def test_simple_push():
    """Test: [A, B, Empty] push from A east -> [Empty, A, B]"""
    store = GridStore()
    store.add_grid('main', 1, 3)
    store.set_cell('main', 0, 0, 'concrete:A')
    store.set_cell('main', 0, 1, 'concrete:B')
    store.set_cell('main', 0, 2, 'empty')

    start = store.get_cell('main', 0, 0)
    rules = {'ref_strategy': ['solid']}

    path, result = push(start, 'E', rules, store)

    try:
        assert result == 'succeed'
        assert len(path) == 3
        print(f"{test_pass_mark(True)} Test simple_push: Result: {highlight_result(result)}")
        print(f"  Path: {[str(c) for c in path]}")
    except AssertionError as e:
        print(f"{test_pass_mark(False)} Test simple_push: Result: {highlight_result(result)} (FAILED: {e})")
        raise


def test_push_blocked_by_stop():
    """Test: [A, stop:B, Empty] push from A east -> fails"""
    store = GridStore()
    store.add_grid('main', 1, 3)
    store.set_cell('main', 0, 0, 'concrete:A')
    store.set_cell('main', 0, 1, 'stop:B')
    store.set_cell('main', 0, 2, 'empty')

    start = store.get_cell('main', 0, 0)
    rules = {'ref_strategy': ['solid']}

    path, result = push(start, 'E', rules, store)

    try:
        assert result == 'fail'
        print(f"{test_pass_mark(True)} Test push_blocked_by_stop: Result: {highlight_result(result)} (expected)")
    except AssertionError as e:
        print(f"{test_pass_mark(False)} Test push_blocked_by_stop: Result: {highlight_result(result)} (FAILED: {e})")
        raise


def test_push_through_ref_portal():
    """Test: [A, Ref(inner), Empty] with inner=[X, Empty] - try enter first"""
    store = GridStore()
    store.add_grid('main', 1, 3)
    store.add_grid('inner', 1, 2)

    store.set_cell('main', 0, 0, 'concrete:A')
    store.set_cell('main', 0, 1, 'ref:inner')
    store.set_cell('main', 0, 2, 'empty')

    store.set_cell('inner', 0, 0, 'concrete:X')
    store.set_cell('inner', 0, 1, 'empty')

    start = store.get_cell('main', 0, 0)
    rules = {'ref_strategy': ['enter', 'solid']}  # Try portal first

    path, result = push(start, 'E', rules, store)

    # Should enter ref, but then hit empty in inner grid
    # Path should be: A, X, Empty(inner)
    try:
        assert result == 'succeed'
        print(f"{test_pass_mark(True)} Test push_through_ref_portal: Result: {highlight_result(result)}")
        print(f"  Path: {[str(c) for c in path]}")
    except AssertionError as e:
        print(f"{test_pass_mark(False)} Test push_through_ref_portal: Result: {highlight_result(result)} (FAILED: {e})")
        raise


def test_push_ref_as_solid():
    """Test: [A, Ref(blocked), Empty] where ref can't be entered - push ref as solid"""
    store = GridStore()
    store.add_grid('main', 1, 3)
    store.add_grid('inner', 1, 1)

    store.set_cell('main', 0, 0, 'concrete:A')
    store.set_cell('main', 0, 1, 'ref:inner')
    store.set_cell('main', 0, 2, 'empty')

    store.set_cell('inner', 0, 0, 'stop:BLOCKED')

    start = store.get_cell('main', 0, 0)
    rules = {'ref_strategy': ['enter', 'solid']}  # Try portal first, then solid

    path, result = push(start, 'E', rules, store)

    # Should fail to enter (hits stop), then try solid, succeed
    try:
        assert result == 'succeed'
        print(f"{test_pass_mark(True)} Test push_ref_as_solid: Result: {highlight_result(result)}")
        print(f"  Path: {[str(c) for c in path]}")
    except AssertionError as e:
        print(f"{test_pass_mark(False)} Test push_ref_as_solid: Result: {highlight_result(result)} (FAILED: {e})")
        raise


def parse_and_push(grids_dict: dict[str, str], rules: dict, stop_cells: set[str] = None) -> tuple[list[Cell], str]:
    """
    Parse grids from compact string format and push from (0,0) east.

    Format:
    - Space-separated cells in a row
    - `|` separates rows
    - Letters/numbers are concrete cells
    - Grid names (keys in grids_dict) are refs
    - `_` is empty

    Args:
        grids_dict: Dict mapping grid_id to compact string representation
        rules: Rules dict with 'ref_strategy' list
        stop_cells: Optional set of cell content strings that have 'stop' tag (e.g., {'9'})

    Returns:
        Tuple of (path, result)

    Example:
        grids = {
            'main': '1 inner 2 9',
            'inner': '9 9|9 _|9 9'
        }
        path, result = parse_and_push(grids, {'ref_strategy': ['swallow', 'enter', 'solid']}, {'9'})
    """
    stop_cells = stop_cells or set()
    store = GridStore()

    # First pass: determine grid dimensions
    grid_dims = {}
    for grid_id, grid_str in grids_dict.items():
        rows = grid_str.split('|')
        num_rows = len(rows)
        num_cols = len(rows[0].split())
        grid_dims[grid_id] = (num_rows, num_cols)

    # Second pass: create grids
    for grid_id, (num_rows, num_cols) in grid_dims.items():
        store.add_grid(grid_id, num_rows, num_cols)

    # Third pass: populate cells
    for grid_id, grid_str in grids_dict.items():
        rows = grid_str.split('|')
        for r, row_str in enumerate(rows):
            cells = row_str.split()
            for c, cell_str in enumerate(cells):
                if cell_str == '_':
                    content = 'empty'
                elif cell_str in grids_dict:
                    content = f'ref:{cell_str}'
                elif cell_str in stop_cells:
                    content = f'stop:{cell_str}'
                else:
                    content = f'concrete:{cell_str}'

                store.set_cell(grid_id, r, c, content)

    # Push from first grid's (0,0) east
    first_grid = list(grids_dict.keys())[0]
    start = store.get_cell(first_grid, 0, 0)

    print(f"Pushing from {first_grid}[0,0]={start.content} east")
    print(f"Rules: {rules}")
    print(f"Grids:")
    for grid_id in grids_dict:
        print(f"  {grid_id}: {grids_dict[grid_id]}")

    path, result = push(start, 'E', rules, store)

    print(f"Result: {highlight_result(result)}")
    print(f"Path: {[f'{c.grid_id}[{c.row},{c.col}]={c.content}' for c in path]}")
    print()

    return path, result


if __name__ == '__main__':
    print("Running push algorithm tests...\n")
    test_simple_push()
    print()
    test_push_blocked_by_stop()
    print()
    test_push_through_ref_portal()
    print()
    test_push_ref_as_solid()
    print("\n" + "="*60)
    print("Testing with parse_and_push utility:")
    print("="*60 + "\n")

    # User's bug case
    grids = {
        'main': '1 inner 2 9',
        'inner': '9 9|9 _|9 9'
    }
    parse_and_push(grids, {'ref_strategy': ['swallow', 'enter', 'solid']}, stop_cells={'9'})

    print("\nAll tests complete!")
