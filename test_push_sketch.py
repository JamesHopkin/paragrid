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

    def try_advance(self) -> bool:
        """Try to move to next position in direction. Returns False if can't advance (hit edge)."""
        dr, dc = self.deltas[self.direction]
        grid = self.store.grids[self.current.grid_id]
        next_row = self.current.row + dr
        next_col = self.current.col + dc

        # Check bounds
        if next_row < 0 or next_row >= len(grid) or next_col < 0 or next_col >= len(grid[0]):
            return False  # Hit edge

        self.current = self.store.get_cell(self.current.grid_id, next_row, next_col)
        return True

    def advance(self) -> None:
        """Move to next position in direction. Asserts if can't advance."""
        success = self.try_advance()
        assert success, f"Navigator.advance() failed at {self.current}"

    def try_enter(self) -> bool:
        """Try to enter the Ref at current position from the current direction. Returns False if can't enter."""
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

    def enter(self) -> None:
        """Enter the Ref at current position. Asserts if can't enter."""
        success = self.try_enter()
        assert success, f"Navigator.enter() failed at {self.current}"

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
            if strat == 'solid' and nav.clone().try_advance(): # peek ahead
                strategies.append('solid')  # Only if nav can advance
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

    if not nav.try_advance():
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

        new_path = state.path[:]
        match strategy:
            case 'solid':
                new_path.append(nav.current)
                nav.advance()

            case 'enter':
                nav.enter()

            case 'swallow':
                # print(f"swallow: S={state.path[-1]}, T={nav.current}")
                new_path.append(nav.current)
                # Swallow: S (last in path) swallows T (current)
                # Move T into S's referenced grid from opposite direction
                # print(f"swallow: flipping from {nav.direction}")
                nav.flip()
                # print(f"swallow: flipped to {nav.direction}, advancing from {nav.current}")
                nav.advance()
                # print(f"swallow: advanced to {nav.current}, entering...")
                nav.enter()
                # print(f"swallow: entered to {nav.current}")

        new_state = make_new_state(new_path, nav, state.visited)

        if new_state == 'succeed':
            return new_path + [nav.current], 'succeed'
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

    try:
        path, result = push(start, 'E', rules, store)

        # Should fail to enter (hits stop), then try solid, succeed
        assert result == 'succeed'
        print(f"{test_pass_mark(True)} Test push_ref_as_solid: Result: {highlight_result(result)}")
        print(f"  Path: {[str(c) for c in path]}")
    except AssertionError as e:
        print(f"{test_pass_mark(False)} Test push_ref_as_solid: Result: {highlight_result(result)} (FAILED: {e})")
        raise


def parse_and_push(grids_dict: dict[str, str], rules: dict, stop_cells: set[str] = None, verbose = False) -> tuple[list[Cell], str]:
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

    if verbose:
        print(f"Pushing from {first_grid}[0,0]={start.content} east")
        print(f"Rules: {rules}")
        print(f"Grids:")
        for grid_id in grids_dict:
            print(f"  {grid_id}: {grids_dict[grid_id]}")

    path, result = push(start, 'E', rules, store)

    if verbose:
        print(f"Result: {highlight_result(result)}")
        print(f"Path: {[f'{c.grid_id}[{c.row},{c.col}]={c.content}' for c in path]}")
        print()

    return path, result

def check_parse_and_push(
    grids_dict: dict[str, str],
    rules: dict,
    stop_cells: set[str],
    name: str,
    expected_path_len: int | str,
    expected_result: str = 'succeed') -> tuple[list[Cell], str]:

    path, result = [], None
    try:
        path, result = parse_and_push(grids_dict, rules, stop_cells)

        assert result == expected_result
        if isinstance(expected_path_len, int):
            assert len(path) == expected_path_len
        else:
            print(f"Path: {[f'{c.grid_id}[{c.row},{c.col}]={c.content}' for c in path]}")
        print(f"{test_pass_mark(True)} check_parse_and_push ({name}) ok")
    except AssertionError as e:
        print(f"Result: {highlight_result(result)}")
        print(f"Path: {[f'{c.grid_id}[{c.row},{c.col}]={c.content}' for c in path]}")
        print(f"{test_pass_mark(False)} check_parse_and_push ({name}) FAILED")

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
    parse_and_push(grids, {'ref_strategy': ['swallow', 'enter', 'solid']}, stop_cells={'9'}, verbose=True)
    
    check_parse_and_push(grids, {}, {'9'}, "swallow", 4)

    check_parse_and_push(dict(a='1 b 9', b='c 9', c='d 9', d = '_'), {}, {'9'}, 'nested enter', 2)
    check_parse_and_push(dict(a='1 b', b='c', c='d', d = '_'), {'ref_strategy': ['enter']}, {'9'}, 'nested enter [stops]', 2)
    check_parse_and_push(dict(a='1 b', b='c', c='d', d = '_'), {}, {'9'}, 'nested enter [grid edge]', 2)
    check_parse_and_push(dict(a='b 1', b='c', c='d', d = '_'), {}, {'9'}, 'nested swallow', 3)


    print("\nAll tests complete!")
