"""
Demonstration scripts for the Paragrid visualization system.
"""

from fractions import Fraction

from paragrid import (
    CellPosition,
    Concrete,
    Direction,
    Empty,
    Grid,
    GridStore,
    Ref,
    analyze,
    push,
    push_simple,
    render,
    render_with_visits,
    traverse,
)


def demo() -> None:
    """Demonstrate the recursive grid visualization."""
    # Define some grids
    store: GridStore = {
        # A simple 2x2 grid with concrete values
        "simple": Grid(
            "simple",
            (
                (Concrete("a"), Concrete("b")),
                (Concrete("c"), Concrete("d")),
            ),
        ),
        # A grid that references another grid
        "nested": Grid(
            "nested",
            (
                (Ref("simple"), Concrete("x")),
                (Concrete("y"), Empty()),
            ),
        ),
        # A self-referencing grid (cycle!)
        "recursive": Grid(
            "recursive",
            (
                (Concrete("r"), Ref("recursive")),
                (Concrete("s"), Concrete("t")),
            ),
        ),
        # Mutual recursion: A references B, B references A
        "alpha": Grid(
            "alpha",
            (
                (Concrete("X"), Ref("beta")),
                (Concrete("Y"), Concrete("Z")),
            ),
        ),
        "beta": Grid(
            "beta",
            (
                (Ref("alpha"), Concrete("a")),
                (Concrete("b"), Concrete("c")),
            ),
        ),
    }

    print("=" * 40)
    print("Simple 2x2 grid:")
    print("=" * 40)
    tree = analyze(store, "simple", Fraction(1), Fraction(1))
    print(render(tree))
    print()

    print("=" * 40)
    print("Nested grid (top-left contains 'simple'):")
    print("=" * 40)
    tree = analyze(store, "nested", Fraction(1), Fraction(1))
    print(render(tree))
    print()

    print("=" * 40)
    print("Self-recursive grid:")
    print("=" * 40)
    tree = analyze(store, "recursive", Fraction(1), Fraction(1))
    print(render(tree))
    print()

    print("=" * 40)
    print("Mutual recursion (alpha <-> beta):")
    print("=" * 40)
    tree = analyze(store, "alpha", Fraction(1), Fraction(1))
    print(render(tree))


def traversal_demo() -> None:
    """Demonstrate grid traversal with step numbers shown in rendered output."""
    # Main grid with empty cells around refs to show entry/exit clearly
    store: GridStore = {
        "main": Grid(
            "main",
            (
                (Empty(), Empty(), Empty(), Empty()),
                (Empty(), Ref("inner"), Ref("inner"), Empty()),  # Two refs to same grid
                (Empty(), Concrete("X"), Concrete("Y"), Empty()),
                (Empty(), Empty(), Empty(), Empty()),
            ),
        ),
        "inner": Grid(
            "inner",
            (
                (Concrete("A"), Concrete("B")),
                (Concrete("C"), Concrete("D")),
            ),
        ),
    }

    # try_enter: always enter from the edge based on direction
    def try_enter(grid_id: str, direction: Direction) -> CellPosition | None:
        grid = store[grid_id]
        match direction:
            case Direction.N:
                return CellPosition(grid_id, grid.rows - 1, 0)  # Enter from bottom
            case Direction.S:
                return CellPosition(grid_id, 0, 0)  # Enter from top
            case Direction.E:
                return CellPosition(grid_id, 0, 0)  # Enter from left
            case Direction.W:
                return CellPosition(grid_id, 0, grid.cols - 1)  # Enter from right

    print("=" * 60)
    print("Traversal Demo: Main grid with two refs to Inner")
    print("=" * 60)
    print()
    print("Grid structure:")
    print("  Main (4x4):          Inner (2x2):")
    print("  ┌───┬───┬───┬───┐    ┌───┬───┐")
    print("  │ _ │ _ │ _ │ _ │    │ A │ B │")
    print("  ├───┼───┼───┼───┤    ├───┼───┤")
    print("  │ _ │Ref│Ref│ _ │    │ C │ D │")
    print("  │   │(P)│(s)│   │    └───┴───┘")
    print("  ├───┼───┼───┼───┤")
    print("  │ _ │ X │ Y │ _ │")
    print("  ├───┼───┼───┼───┤")
    print("  │ _ │ _ │ _ │ _ │")
    print("  └───┴───┴───┴───┘")
    print()

    # Traverse from (main, 1, 3) going West - should enter inner, traverse, teleport, exit
    start = CellPosition("main", 1, 3)
    print(f"Traversal: start at (main, {start.row}, {start.col}), direction = West")
    print()

    # Collect visits into a map
    visit_map: dict[tuple[str, int, int], list[int]] = {}
    for i, pos in enumerate(traverse(store, start, Direction.W, try_enter)):
        key = (pos.grid_id, pos.row, pos.col)
        if key not in visit_map:
            visit_map[key] = []
        visit_map[key].append(i)
        print(f"  Step {i}: {pos.grid_id}[{pos.row},{pos.col}]")
        if i > 20:  # Safety limit
            print("  ... (truncated)")
            break

    print()
    print("Visualization with visit step numbers:")
    print()

    # Analyze and render with visits
    tree = analyze(store, "main", Fraction(1), Fraction(1))
    output = render_with_visits(tree, visit_map, min_scale=40)
    print(output)


def traversal_options_demo() -> None:
    """Demonstrate auto_enter and auto_exit options."""
    store: GridStore = {
        "main": Grid(
            "main",
            (
                (Empty(), Concrete("M"), Empty()),
                (Concrete("L"), Ref("inner"), Concrete("R")),
                (Empty(), Concrete("B"), Empty()),
            ),
        ),
        "inner": Grid(
            "inner",
            (
                (Concrete("A"), Concrete("B")),
                (Concrete("C"), Concrete("D")),
            ),
        ),
    }

    def try_enter(grid_id: str, direction: Direction) -> CellPosition | None:
        grid = store[grid_id]
        match direction:
            case Direction.E:
                return CellPosition(grid_id, 0, 0)
            case _:
                return None

    print("=" * 60)
    print("Auto-Enter/Exit Demo")
    print("=" * 60)
    print()

    # Test 1: Default (auto_enter=False, auto_exit=True)
    print("Test 1: Default (auto_enter=False, auto_exit=True)")
    print("Traverse East from 'L' - yields Ref, then enters, exits automatically")
    print()
    start = CellPosition("main", 1, 0)
    for i, pos in enumerate(traverse(store, start, Direction.E, try_enter)):
        cell = store[pos.grid_id].cells[pos.row][pos.col]
        cell_str = "Ref" if isinstance(cell, Ref) else (cell.id if isinstance(cell, Concrete) else "Empty")
        print(f"  Step {i}: {pos.grid_id}[{pos.row},{pos.col}] = {cell_str}")
        if i > 10:
            break
    print()

    # Test 2: auto_exit=False
    print("Test 2: auto_exit=False")
    print("Traverse East from 'L' - stops at Ref when exiting inner grid")
    print()
    for i, pos in enumerate(traverse(store, start, Direction.E, try_enter, auto_exit=False)):
        cell = store[pos.grid_id].cells[pos.row][pos.col]
        cell_str = "Ref" if isinstance(cell, Ref) else (cell.id if isinstance(cell, Concrete) else "Empty")
        print(f"  Step {i}: {pos.grid_id}[{pos.row},{pos.col}] = {cell_str}")
        if i > 10:
            break
    print()

    # Test 3: auto_enter=True
    print("Test 3: auto_enter=True")
    print("Traverse East from 'L' - skips yielding Ref on entry")
    print()
    for i, pos in enumerate(traverse(store, start, Direction.E, try_enter, auto_enter=True)):
        cell = store[pos.grid_id].cells[pos.row][pos.col]
        cell_str = "Ref" if isinstance(cell, Ref) else (cell.id if isinstance(cell, Concrete) else "Empty")
        print(f"  Step {i}: {pos.grid_id}[{pos.row},{pos.col}] = {cell_str}")
        if i > 10:
            break
    print()

    # Test 4: Both disabled (auto_enter=False, auto_exit=False)
    print("Test 4: Both disabled (auto_enter=False, auto_exit=False)")
    print("Traverse East from 'L' - stops at both entry and exit Refs")
    print()
    for i, pos in enumerate(traverse(store, start, Direction.E, try_enter, auto_exit=False)):
        cell = store[pos.grid_id].cells[pos.row][pos.col]
        cell_str = "Ref" if isinstance(cell, Ref) else (cell.id if isinstance(cell, Concrete) else "Empty")
        print(f"  Step {i}: {pos.grid_id}[{pos.row},{pos.col}] = {cell_str}")
        if i > 10:
            break
    print()


def push_demo() -> None:
    """Demonstrate the push operation with before/after visualizations."""

    def try_enter(grid_id: str, direction: Direction) -> CellPosition | None:
        """Standard entry function - enter from the edge based on direction."""
        if grid_id not in store:
            return None
        grid = store[grid_id]
        match direction:
            case Direction.N:
                return CellPosition(grid_id, grid.rows - 1, 0)
            case Direction.S:
                return CellPosition(grid_id, 0, 0)
            case Direction.E:
                return CellPosition(grid_id, 0, 0)
            case Direction.W:
                return CellPosition(grid_id, 0, grid.cols - 1)

    print("=" * 60)
    print("Push Demo: Moving cell contents along a path")
    print("=" * 60)
    print()

    # Example 1: Simple push into empty space
    print("Example 1: Push into empty space (SUCCESS)")
    print("-" * 60)
    store: GridStore = {
        "line": Grid(
            "line",
            (
                (Concrete("A"), Concrete("B"), Concrete("C"), Empty()),
            ),
        ),
    }

    print("BEFORE:")
    tree = analyze(store, "line", Fraction(1), Fraction(1))
    print(render(tree))
    print()

    start = CellPosition("line", 0, 0)
    print(f"Operation: push({start.grid_id}[{start.row},{start.col}], Direction.E)")
    print("Expected: A moves right, creating empty space at start")
    print()

    result = push(store, start, Direction.E, try_enter)

    if result:
        print("AFTER:")
        tree = analyze(result, "line", Fraction(1), Fraction(1))
        print(render(tree))
        print("✓ Push succeeded - contents rotated forward")
    else:
        print("✗ Push failed")
    print()

    # Example 2: Push that fails (hits edge)
    print("Example 2: Push hits edge (FAILURE)")
    print("-" * 60)
    store = {
        "full": Grid(
            "full",
            (
                (Concrete("A"), Concrete("B"), Concrete("C"), Concrete("D")),
            ),
        ),
    }

    print("BEFORE:")
    tree = analyze(store, "full", Fraction(1), Fraction(1))
    print(render(tree))
    print()

    start = CellPosition("full", 0, 0)
    print(f"Operation: push({start.grid_id}[{start.row},{start.col}], Direction.E)")
    print("Expected: Fails because no empty space found")
    print()

    result = push(store, start, Direction.E, try_enter)

    if result:
        print("AFTER:")
        tree = analyze(result, "full", Fraction(1), Fraction(1))
        print(render(tree))
    else:
        print("✗ Push failed - no empty space, grid unchanged")
    print()

    # Example 3: Cyclic push (path loops back to start)
    print("Example 3: Cyclic push in 2×2 grid (SUCCESS)")
    print("-" * 60)
    store = {
        "square": Grid(
            "square",
            (
                (Concrete("A"), Concrete("B")),
                (Concrete("C"), Concrete("D")),
            ),
        ),
    }

    print("BEFORE:")
    tree = analyze(store, "square", Fraction(1), Fraction(1))
    print(render(tree))
    print()

    start = CellPosition("square", 0, 0)
    print(f"Operation: push({start.grid_id}[{start.row},{start.col}], Direction.E)")
    print("Expected: Path goes A→B→(edge, goes down)→(wraps somehow or fails)")
    print("Note: This depends on traversal behavior at edges")
    print()

    result = push(store, start, Direction.E, try_enter)

    if result:
        print("AFTER:")
        tree = analyze(result, "square", Fraction(1), Fraction(1))
        print(render(tree))
        print("✓ Push succeeded")
    else:
        print("✗ Push failed")
    print()

    # Example 4: Push through a portal
    print("Example 4: Push through a Ref portal (SUCCESS)")
    print("-" * 60)
    store = {
        "main": Grid(
            "main",
            (
                (Concrete("A"), Ref("inner"), Empty()),
            ),
        ),
        "inner": Grid(
            "inner",
            (
                (Concrete("X"), Concrete("Y")),
            ),
        ),
    }

    print("BEFORE:")
    print("Main grid:")
    tree = analyze(store, "main", Fraction(1), Fraction(1))
    print(render(tree))
    print()
    print("Inner grid (referenced):")
    tree = analyze(store, "inner", Fraction(1), Fraction(1))
    print(render(tree))
    print()

    start = CellPosition("main", 0, 0)
    print(f"Operation: push({start.grid_id}[{start.row},{start.col}], Direction.E)")
    print("Expected: A pushes through Ref portal, affecting both grids")
    print("Path: A → [enter Inner] → X → Y → [exit Inner] → Empty")
    print("Result: Main[A, Ref, Y], Inner[Empty, X] (rotated)")
    print()

    result = push(store, start, Direction.E, try_enter)

    if result:
        print("AFTER:")
        print("Main grid:")
        tree = analyze(result, "main", Fraction(1), Fraction(1))
        print(render(tree))
        print()
        print("Inner grid (contents shifted):")
        tree = analyze(result, "inner", Fraction(1), Fraction(1))
        print(render(tree))
        print("✓ Push succeeded - contents moved through portal")
    else:
        print("✗ Push failed")
    print()

    # Example 5: Push blocked by inaccessible Ref
    print("Example 5: Push blocked by locked Ref (SUCCESS with Ref as object)")
    print("-" * 60)
    store = {
        "main": Grid(
            "main",
            (
                (Concrete("A"), Ref("locked"), Empty()),
            ),
        ),
        "locked": Grid(
            "locked",
            (
                (Concrete("?"), Concrete("?")),
            ),
        ),
    }

    def try_enter_locked(grid_id: str, direction: Direction) -> CellPosition | None:
        """Entry function that denies access to 'locked' grid."""
        if grid_id == "locked":
            return None  # Deny entry
        return try_enter(grid_id, direction)

    print("BEFORE:")
    tree = analyze(store, "main", Fraction(1), Fraction(1))
    print(render(tree))
    print()

    start = CellPosition("main", 0, 0)
    print(f"Operation: push({start.grid_id}[{start.row},{start.col}], Direction.E)")
    print("Expected: Ref acts as solid object when entry denied")
    print("Result: [Empty, A, Ref(locked)]")
    print()

    result = push(store, start, Direction.E, try_enter_locked)

    if result:
        print("AFTER:")
        tree = analyze(result, "main", Fraction(1), Fraction(1))
        print(render(tree))
        print("✓ Push succeeded - Ref pushed as solid object")
    else:
        print("✗ Push failed")
    print()


if __name__ == "__main__":
    demo()
    print()
    traversal_demo()
    print()
    traversal_options_demo()
    print()
    push_demo()
