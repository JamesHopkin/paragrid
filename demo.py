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


if __name__ == "__main__":
    demo()
    print()
    traversal_demo()
    print()
    traversal_options_demo()
