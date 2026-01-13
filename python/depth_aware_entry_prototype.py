"""
Prototype for cross-depth entry with equivalent point transfer.

Goal: When exiting a grid at depth N and entering a grid at depth M,
compute the entry position by mapping through the common ancestor's
coordinate system.

Key insight:
- Exit: Map local cell center in exiting grid → ancestor edge position
- Entry: Map ancestor edge position → nearest cell center in target grid
"""

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
from fractions import Fraction


@dataclass
class Grid:
    """Simple grid for prototype."""
    id: str
    rows: int
    cols: int
    cells: List[List[str]]  # 'E' = Empty, 'C:id' = Concrete, 'R:id' = Ref


@dataclass
class RefLocation:
    """Location of a reference in its parent grid."""
    parent_id: str
    row: int
    col: int


class GridStore:
    """Store of grids with reference tracking."""

    def __init__(self) -> None:
        self.grids: Dict[str, Grid] = {}
        self.primary_refs: Dict[str, RefLocation] = {}  # grid_id -> primary ref location

    def add_grid(self, grid: Grid) -> None:
        self.grids[grid.id] = grid

    def set_primary_ref(self, grid_id: str, parent_id: str, row: int, col: int) -> None:
        self.primary_refs[grid_id] = RefLocation(parent_id, row, col)

    def get_primary_ref(self, grid_id: str) -> Optional[RefLocation]:
        return self.primary_refs.get(grid_id)


def compute_cell_center_fraction(cell_index: int, dimension: int) -> Fraction:
    """
    Compute the fractional position of a cell's center along a dimension.

    Cell centers are evenly spaced within [0, 1], positioned at i/(N+1) for i=1..N.

    Args:
        cell_index: 0-based index of the cell
        dimension: Total number of cells in this dimension

    Returns:
        Fraction in [0, 1] representing center position

    Examples:
        - dimension=1, cell_index=0 → 1/2 = 0.5 (center of only cell)
        - dimension=3, cell_index=0 → 1/4 = 0.25 (first third)
        - dimension=3, cell_index=1 → 2/4 = 0.5 (middle)
        - dimension=3, cell_index=2 → 3/4 = 0.75 (last third)
        - dimension=5, cell_index=2 → 3/6 = 0.5 (middle)
    """
    return Fraction(cell_index + 1, dimension + 1)


def compute_cell_extent(cell_index: int, dimension: int) -> Tuple[Fraction, Fraction]:
    """
    Compute the extent (start, end) of a cell in continuous [0, 1] coordinate space.

    Args:
        cell_index: 0-based cell index
        dimension: Total number of cells

    Returns:
        (start, end) fractions in [0, 1]

    Model: Cells are centered at (i+1)/(N+1), and occupy regions between midpoints.
    - For N=1: Cell 0 centered at 1/2, occupies [0, 1]
    - For N=2: Cells centered at 1/3, 2/3; occupy [0, 0.5], [0.5, 1.0]
    - For N=3: Cells centered at 1/4, 2/4, 3/4; occupy [0, 3/8], [3/8, 5/8], [5/8, 1.0]
    """
    if dimension == 1:
        return (Fraction(0), Fraction(1))

    # Cell centers are at (i+1)/(N+1)
    # Cell boundaries are midpoints between adjacent centers, and edges at 0 and 1
    if cell_index == 0:
        start = Fraction(0)
    else:
        # Midpoint between centers at i/(N+1) and (i+1)/(N+1)
        center_prev = Fraction(cell_index, dimension + 1)
        center_curr = Fraction(cell_index + 1, dimension + 1)
        start = (center_prev + center_curr) / 2

    if cell_index == dimension - 1:
        end = Fraction(1)
    else:
        # Midpoint between centers at (i+1)/(N+1) and (i+2)/(N+1)
        center_curr = Fraction(cell_index + 1, dimension + 1)
        center_next = Fraction(cell_index + 2, dimension + 1)
        end = (center_curr + center_next) / 2

    return (start, end)


def map_fraction_through_parent(
    local_fraction: Fraction,
    parent_cell_index: int,
    parent_dimension: int
) -> Fraction:
    """
    Map a fractional position within a child grid through its parent cell.

    The child grid occupies a single cell in the parent. We need to map
    the local position within the child to a position within the parent's
    coordinate system.

    Uses the cell extent model: child's [0, 1] space maps linearly to
    parent cell's extent.

    Args:
        local_fraction: Position within child (0.0 to 1.0)
        parent_cell_index: Which parent cell contains this child
        parent_dimension: Number of cells in parent along this axis

    Returns:
        Fraction in parent's coordinate system

    Example:
        Child at parent[0] of 2-cell parent, child position = 0.5
        Parent cell [0] spans [0.0, 0.5] in parent coordinates
        Child position 0.5 → 0.0 + 0.5 * (0.5 - 0.0) = 0.25 in parent coordinates
    """
    # Get the extent of the parent cell
    cell_start, cell_end = compute_cell_extent(parent_cell_index, parent_dimension)

    # Linear mapping: parent = start + local * (end - start)
    return cell_start + local_fraction * (cell_end - cell_start)


def compute_exit_ancestor_fraction(
    store: GridStore,
    grid_id: str,
    cell_index: int,
    dimension_attr: str  # 'rows' or 'cols'
) -> Tuple[Fraction, str]:
    """
    Compute the fractional position of a cell along an edge, in ancestor coordinates.

    Args:
        store: Grid store
        grid_id: ID of the grid we're exiting from
        cell_index: Cell index (row or col) we're exiting from
        dimension_attr: 'rows' or 'cols'

    Returns:
        (fraction in ancestor coordinates, ancestor_grid_id)
    """
    # Start with local position
    current_grid = store.grids[grid_id]
    dimension = getattr(current_grid, dimension_attr)
    fraction = compute_cell_center_fraction(cell_index, dimension)
    current_grid_id = grid_id

    # Cascade up through parents, transforming fraction
    while True:
        ref = store.get_primary_ref(current_grid_id)
        if ref is None:
            # Reached root
            return fraction, current_grid_id

        # Get parent grid
        parent_grid = store.grids[ref.parent_id]
        parent_dimension = getattr(parent_grid, dimension_attr)

        # Transform fraction through parent
        parent_cell_index = ref.row if dimension_attr == 'rows' else ref.col
        fraction = map_fraction_through_parent(
            fraction,
            parent_cell_index,
            parent_dimension
        )

        current_grid_id = ref.parent_id


def find_nearest_cell(
    fraction: Fraction,
    dimension: int
) -> int:
    """
    Find the cell index whose center is nearest to the given fraction.

    Args:
        fraction: Position in [0, 1]
        dimension: Number of cells

    Returns:
        Cell index (0-based)
    """
    if dimension == 1:
        return 0

    # Cell centers are at (i+1)/(N+1)
    # Find nearest
    best_index = 0
    best_distance = abs(fraction - compute_cell_center_fraction(0, dimension))

    for i in range(dimension):
        center = compute_cell_center_fraction(i, dimension)
        distance = abs(fraction - center)
        if distance < best_distance:
            best_distance = distance
            best_index = i

    return best_index


def map_fraction_to_child(
    parent_fraction: Fraction,
    parent_cell_index: int,
    parent_dimension: int
) -> Fraction:
    """
    Inverse of map_fraction_through_parent.
    Map a position in parent coordinate space to child coordinate space.

    Args:
        parent_fraction: Position in parent's coordinate system
        parent_cell_index: Which parent cell contains the child
        parent_dimension: Number of cells in parent along this axis

    Returns:
        Fraction in child's [0, 1] coordinate system
    """
    # Get the extent of the parent cell
    cell_start, cell_end = compute_cell_extent(parent_cell_index, parent_dimension)

    # Inverse linear mapping: local = (parent - start) / (end - start)
    extent = cell_end - cell_start
    if extent == 0:
        # Single point, map to center
        return Fraction(1, 2)

    local = (parent_fraction - cell_start) / extent
    # Clamp to [0, 1] in case of numerical issues
    if local < 0:
        return Fraction(0)
    if local > 1:
        return Fraction(1)
    return local


def compute_entry_from_ancestor_fraction(
    store: GridStore,
    target_grid_id: str,
    ancestor_fraction: Fraction,
    dimension_attr: str  # 'rows' or 'cols'
) -> int:
    """
    Compute entry cell index by mapping from ancestor fraction down to target grid.

    Args:
        store: Grid store
        target_grid_id: Grid to enter
        ancestor_fraction: Position in ancestor's coordinate system
        dimension_attr: 'rows' or 'cols'

    Returns:
        Cell index to enter
    """
    # Build path from target to ancestor
    path = []
    current = target_grid_id
    while True:
        ref = store.get_primary_ref(current)
        if ref is None:
            break
        path.append((current, ref))
        current = ref.parent_id

    # Reverse to go from ancestor down to target
    path.reverse()

    # Transform fraction down through hierarchy
    fraction = ancestor_fraction
    for grid_id, ref in path:
        # Get parent grid to determine dimensions
        parent_grid = store.grids[ref.parent_id]
        parent_dimension = getattr(parent_grid, dimension_attr)

        # Map from parent space to child space
        parent_cell_index = ref.row if dimension_attr == 'rows' else ref.col
        fraction = map_fraction_to_child(fraction, parent_cell_index, parent_dimension)

    # Find nearest cell in target grid
    target_grid = store.grids[target_grid_id]
    dimension = getattr(target_grid, dimension_attr)
    return find_nearest_cell(fraction, dimension)


def test_simple_same_level() -> None:
    """Test same-level transfer (should work with current logic)."""
    store = GridStore()

    # Root: single row with two refs side-by-side
    root = Grid('root', rows=1, cols=2, cells=[['R:B', 'R:D']])
    store.add_grid(root)

    # B: 5 rows, single column
    b = Grid('B', rows=5, cols=1, cells=[['C:X'], ['C:a'], ['C:b'], ['C:c'], ['C:d']])
    store.add_grid(b)
    store.set_primary_ref('B', 'root', row=0, col=0)

    # D: 5 rows, 2 columns
    d = Grid('D', rows=5, cols=2, cells=[
        ['E', 'C:1'],
        ['E', 'C:2'],
        ['E', 'C:3'],
        ['E', 'C:4'],
        ['E', 'C:5'],
    ])
    store.add_grid(d)
    store.set_primary_ref('D', 'root', row=0, col=1)

    # Exit from B[0] (top row)
    exit_fraction, ancestor = compute_exit_ancestor_fraction(store, 'B', cell_index=0, dimension_attr='rows')
    print(f"Exit from B[0]: fraction={exit_fraction}, ancestor={ancestor}")
    print(f"  B[0] center at 1/6, B occupies Root[0] (center at 1/2), maps to fraction 1/6")

    # Enter D using that fraction
    entry_index = compute_entry_from_ancestor_fraction(store, 'D', exit_fraction, 'rows')
    print(f"Enter D at: row={entry_index}")
    print(f"Expected: row=0 (top, since 1/6 is closest to D[0] at 1/6)")
    print()


def test_cross_level_nested() -> None:
    """Test cross-level transfer: C (depth 2) → E (depth 2)."""
    store = GridStore()

    # Root: [Ref(B), Ref(D)] (single row)
    root = Grid('root', rows=1, cols=2, cells=[['R:B', 'R:D']])
    store.add_grid(root)

    # B: 2 rows, contains C in top row
    b = Grid('B', rows=2, cols=1, cells=[['R:C'], ['E']])
    store.add_grid(b)
    store.set_primary_ref('B', 'root', row=0, col=0)

    # C: 3 rows (depth 2)
    c = Grid('C', rows=3, cols=1, cells=[['C:X'], ['C:Y'], ['C:Z']])
    store.add_grid(c)
    store.set_primary_ref('C', 'B', row=0, col=0)

    # D: 2 rows, contains E in top row
    d = Grid('D', rows=2, cols=1, cells=[['R:E'], ['E']])
    store.add_grid(d)
    store.set_primary_ref('D', 'root', row=0, col=1)

    # E: 5 rows (depth 2)
    e = Grid('E', rows=5, cols=1, cells=[['C:1'], ['C:2'], ['C:3'], ['C:4'], ['C:5']])
    store.add_grid(e)
    store.set_primary_ref('E', 'D', row=0, col=0)

    # Exit from C[1] (middle row of 3)
    exit_fraction, ancestor = compute_exit_ancestor_fraction(store, 'C', cell_index=1, dimension_attr='rows')
    print(f"Exit from C[1]: fraction={exit_fraction}, ancestor={ancestor}")
    print(f"  (C[1] is middle of 3 rows, local fraction = 1/2)")
    print(f"  Transform: C[1]=1/2 in C → ?/? in B → ?/? in Root")

    # Enter E using that fraction
    entry_index = compute_entry_from_ancestor_fraction(store, 'E', exit_fraction, 'rows')
    print(f"Enter E at: row={entry_index}")
    print(f"Expected: row=2 (middle of E)")
    print(f"  (From diagram analysis: C[1] at 0.5 → B at 0.25 → Root at 0.25 → D at 0.25 → E at 0.5 → E[2])")
    print()


def test_cross_level_top_row() -> None:
    """Test cross-level transfer from top row: C[0] → E[?]."""
    store = GridStore()

    # Same setup as test_cross_level_nested
    root = Grid('root', rows=1, cols=2, cells=[['R:B', 'R:D']])
    store.add_grid(root)

    b = Grid('B', rows=2, cols=1, cells=[['R:C'], ['E']])
    store.add_grid(b)
    store.set_primary_ref('B', 'root', row=0, col=0)

    c = Grid('C', rows=3, cols=1, cells=[['C:X'], ['C:Y'], ['C:Z']])
    store.add_grid(c)
    store.set_primary_ref('C', 'B', row=0, col=0)

    d = Grid('D', rows=2, cols=1, cells=[['R:E'], ['E']])
    store.add_grid(d)
    store.set_primary_ref('D', 'root', row=0, col=1)

    e = Grid('E', rows=5, cols=1, cells=[['C:1'], ['C:2'], ['C:3'], ['C:4'], ['C:5']])
    store.add_grid(e)
    store.set_primary_ref('E', 'D', row=0, col=0)

    # Exit from C[0] (top row)
    exit_fraction, ancestor = compute_exit_ancestor_fraction(store, 'C', cell_index=0, dimension_attr='rows')
    print(f"Exit from C[0]: fraction={exit_fraction}, ancestor={ancestor}")

    entry_index = compute_entry_from_ancestor_fraction(store, 'E', exit_fraction, 'rows')
    print(f"Enter E at: row={entry_index}")
    print(f"Expected: row=0 (top of E)")
    print()


def test_cross_level_bottom_row() -> None:
    """Test cross-level transfer from bottom row: C[2] → E[?]."""
    store = GridStore()

    # Same setup as test_cross_level_nested
    root = Grid('root', rows=1, cols=2, cells=[['R:B', 'R:D']])
    store.add_grid(root)

    b = Grid('B', rows=2, cols=1, cells=[['R:C'], ['E']])
    store.add_grid(b)
    store.set_primary_ref('B', 'root', row=0, col=0)

    c = Grid('C', rows=3, cols=1, cells=[['C:X'], ['C:Y'], ['C:Z']])
    store.add_grid(c)
    store.set_primary_ref('C', 'B', row=0, col=0)

    d = Grid('D', rows=2, cols=1, cells=[['R:E'], ['E']])
    store.add_grid(d)
    store.set_primary_ref('D', 'root', row=0, col=1)

    e = Grid('E', rows=5, cols=1, cells=[['C:1'], ['C:2'], ['C:3'], ['C:4'], ['C:5']])
    store.add_grid(e)
    store.set_primary_ref('E', 'D', row=0, col=0)

    # Exit from C[2] (bottom row)
    exit_fraction, ancestor = compute_exit_ancestor_fraction(store, 'C', cell_index=2, dimension_attr='rows')
    print(f"Exit from C[2]: fraction={exit_fraction}, ancestor={ancestor}")

    entry_index = compute_entry_from_ancestor_fraction(store, 'E', exit_fraction, 'rows')
    print(f"Enter E at: row={entry_index}")
    print(f"Expected: row=4 (bottom of E)")
    print(f"  (C[2] at 1.0 → B at 0.5 → Root at 0.5 → D at 0.5 → E at 1.0 → E[4])")
    print()


def test_depth_mismatch_1_to_2() -> None:
    """Test depth 1 → depth 2 transfer: B → E."""
    store = GridStore()

    root = Grid('root', rows=1, cols=2, cells=[['R:B', 'R:D']])
    store.add_grid(root)

    # B is at depth 1, has 3 rows
    b = Grid('B', rows=3, cols=1, cells=[['C:X'], ['C:Y'], ['C:Z']])
    store.add_grid(b)
    store.set_primary_ref('B', 'root', row=0, col=0)

    d = Grid('D', rows=2, cols=1, cells=[['R:E'], ['E']])
    store.add_grid(d)
    store.set_primary_ref('D', 'root', row=0, col=1)

    # E is at depth 2, has 5 rows
    e = Grid('E', rows=5, cols=1, cells=[['C:1'], ['C:2'], ['C:3'], ['C:4'], ['C:5']])
    store.add_grid(e)
    store.set_primary_ref('E', 'D', row=0, col=0)

    # Exit from B[1] (middle row of 3)
    exit_fraction, ancestor = compute_exit_ancestor_fraction(store, 'B', cell_index=1, dimension_attr='rows')
    print(f"Exit from B[1]: fraction={exit_fraction}, ancestor={ancestor}")

    entry_index = compute_entry_from_ancestor_fraction(store, 'E', exit_fraction, 'rows')
    print(f"Enter E at: row={entry_index}")
    print(f"Expected: row=2 (middle of E)")
    print(f"  (B at depth 1, E at depth 2: B[1] at 0.5 → Root at 0.5 → D at 0.5 → E at 1.0)")
    print(f"  Wait, that doesn't seem right. Let me recalculate...")
    print()


if __name__ == '__main__':
    print("=== Test 1: Same-level transfer ===")
    test_simple_same_level()

    print("=== Test 2: Cross-level transfer (C → E, both depth 2) ===")
    test_cross_level_nested()

    print("=== Test 3: Cross-level from top row ===")
    test_cross_level_top_row()

    print("=== Test 4: Cross-level from bottom row ===")
    test_cross_level_bottom_row()

    print("=== Test 5: Depth mismatch (1 → 2) ===")
    test_depth_mismatch_1_to_2()
