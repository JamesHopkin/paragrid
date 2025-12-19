"""
Comprehensive test suite for the Paragrid visualization system.
"""

from fractions import Fraction

import pytest

from paragrid import (
    CellNode,
    CellPosition,
    Concrete,
    ConcreteNode,
    CutoffNode,
    Direction,
    Empty,
    EmptyNode,
    Grid,
    GridStore,
    NestedNode,
    Ref,
    analyze,
    collect_denominators,
    collect_grid_ids,
    compute_scale,
    find_primary_ref,
    render,
    traverse,
)


# =============================================================================
# Test Grid Data Structures
# =============================================================================


class TestGridStructures:
    """Tests for basic grid data structures."""

    def test_empty_cell_creation(self) -> None:
        """Test creating an empty cell."""
        cell = Empty()
        assert isinstance(cell, Empty)

    def test_concrete_cell_creation(self) -> None:
        """Test creating a concrete cell."""
        cell = Concrete("test")
        assert isinstance(cell, Concrete)
        assert cell.id == "test"

    def test_ref_cell_creation(self) -> None:
        """Test creating a reference cell."""
        cell = Ref("grid_id")
        assert isinstance(cell, Ref)
        assert cell.grid_id == "grid_id"

    def test_grid_creation(self) -> None:
        """Test creating a grid."""
        grid = Grid(
            "test_grid",
            (
                (Concrete("a"), Concrete("b")),
                (Concrete("c"), Concrete("d")),
            ),
        )
        assert grid.id == "test_grid"
        assert grid.rows == 2
        assert grid.cols == 2

    def test_grid_dimensions(self) -> None:
        """Test grid dimension properties."""
        grid = Grid(
            "test",
            (
                (Concrete("a"), Concrete("b"), Concrete("c")),
                (Concrete("d"), Concrete("e"), Concrete("f")),
            ),
        )
        assert grid.rows == 2
        assert grid.cols == 3


# =============================================================================
# Test Analysis Phase
# =============================================================================


class TestAnalyze:
    """Tests for the analyze function."""

    def test_analyze_simple_grid(self) -> None:
        """Test analyzing a simple grid with concrete cells."""
        store: GridStore = {
            "simple": Grid(
                "simple",
                (
                    (Concrete("a"), Concrete("b")),
                    (Concrete("c"), Concrete("d")),
                ),
            )
        }
        result = analyze(store, "simple", Fraction(1), Fraction(1))
        assert isinstance(result, NestedNode)
        assert result.grid_id == "simple"
        assert len(result.children) == 2
        assert len(result.children[0]) == 2

    def test_analyze_with_empty_cells(self) -> None:
        """Test analyzing a grid with empty cells."""
        store: GridStore = {
            "test": Grid(
                "test",
                (
                    (Empty(), Concrete("a")),
                    (Concrete("b"), Empty()),
                ),
            )
        }
        result = analyze(store, "test", Fraction(1), Fraction(1))
        assert isinstance(result, NestedNode)
        children = result.children
        assert isinstance(children[0][0], EmptyNode)
        assert isinstance(children[0][1], ConcreteNode)
        assert isinstance(children[1][0], ConcreteNode)
        assert isinstance(children[1][1], EmptyNode)

    def test_analyze_with_reference(self) -> None:
        """Test analyzing a grid that references another grid."""
        store: GridStore = {
            "inner": Grid("inner", ((Concrete("x"),),)),
            "outer": Grid("outer", ((Ref("inner"),),)),
        }
        result = analyze(store, "outer", Fraction(1), Fraction(1))
        assert isinstance(result, NestedNode)
        assert result.grid_id == "outer"
        # The referenced grid should be nested
        nested = result.children[0][0]
        assert isinstance(nested, NestedNode)
        assert nested.grid_id == "inner"

    def test_analyze_with_threshold_cutoff(self) -> None:
        """Test that analysis stops below threshold."""
        store: GridStore = {
            "test": Grid("test", ((Concrete("a"),),)),
        }
        # Set threshold higher than the cell dimensions
        result = analyze(store, "test", Fraction(1, 100), Fraction(1, 100), threshold=Fraction(1, 10))
        assert isinstance(result, CutoffNode)

    def test_analyze_self_referencing_grid(self) -> None:
        """Test analyzing a grid that references itself (cycle)."""
        store: GridStore = {
            "recursive": Grid(
                "recursive",
                (
                    (Concrete("a"), Ref("recursive")),
                ),
            )
        }
        # Should terminate due to threshold
        result = analyze(store, "recursive", Fraction(1), Fraction(1))
        assert isinstance(result, NestedNode)
        # The reference should eventually cutoff
        ref_cell = result.children[0][1]
        # May be nested multiple times before cutoff
        assert isinstance(ref_cell, (NestedNode, CutoffNode))


# =============================================================================
# Test Traversal
# =============================================================================


class TestFindPrimaryRef:
    """Tests for finding primary references."""

    def test_find_primary_ref_simple(self) -> None:
        """Test finding a primary reference."""
        store: GridStore = {
            "inner": Grid("inner", ((Concrete("x"),),)),
            "outer": Grid("outer", ((Ref("inner"),),)),
        }
        result = find_primary_ref(store, "inner")
        assert result is not None
        assert result == ("outer", 0, 0)

    def test_find_primary_ref_none(self) -> None:
        """Test finding primary ref for root grid."""
        store: GridStore = {
            "root": Grid("root", ((Concrete("x"),),)),
        }
        result = find_primary_ref(store, "root")
        assert result is None

    def test_find_primary_ref_first_occurrence(self) -> None:
        """Test that first occurrence is treated as primary."""
        store: GridStore = {
            "inner": Grid("inner", ((Concrete("x"),),)),
            "outer": Grid(
                "outer",
                (
                    (Ref("inner"), Ref("inner")),
                ),
            ),
        }
        result = find_primary_ref(store, "inner")
        assert result == ("outer", 0, 0)  # First ref should be primary


class TestTraverse:
    """Tests for grid traversal."""

    def test_traverse_simple_east(self) -> None:
        """Test simple eastward traversal."""
        store: GridStore = {
            "test": Grid(
                "test",
                (
                    (Concrete("a"), Concrete("b"), Concrete("c")),
                ),
            )
        }
        start = CellPosition("test", 0, 0)

        def try_enter(grid_id: str, direction: Direction) -> CellPosition | None:
            return None

        positions = list(traverse(store, start, Direction.E, try_enter))
        assert len(positions) == 3
        assert positions[0] == CellPosition("test", 0, 0)
        assert positions[1] == CellPosition("test", 0, 1)
        assert positions[2] == CellPosition("test", 0, 2)

    def test_traverse_simple_south(self) -> None:
        """Test simple southward traversal."""
        store: GridStore = {
            "test": Grid(
                "test",
                (
                    (Concrete("a"),),
                    (Concrete("b"),),
                    (Concrete("c"),),
                ),
            )
        }
        start = CellPosition("test", 0, 0)

        def try_enter(grid_id: str, direction: Direction) -> CellPosition | None:
            return None

        positions = list(traverse(store, start, Direction.S, try_enter))
        assert len(positions) == 3
        assert positions[0] == CellPosition("test", 0, 0)
        assert positions[1] == CellPosition("test", 1, 0)
        assert positions[2] == CellPosition("test", 2, 0)

    def test_traverse_stops_at_edge(self) -> None:
        """Test that traversal stops at grid edge when no parent."""
        store: GridStore = {
            "test": Grid("test", ((Concrete("a"), Concrete("b")),)),
        }
        start = CellPosition("test", 0, 1)

        def try_enter(grid_id: str, direction: Direction) -> CellPosition | None:
            return None

        positions = list(traverse(store, start, Direction.E, try_enter))
        assert len(positions) == 1  # Can't go further east

    def test_traverse_with_auto_enter(self) -> None:
        """Test traversal with automatic entry into references."""
        store: GridStore = {
            "inner": Grid("inner", ((Concrete("x"), Concrete("y")),)),
            "outer": Grid("outer", ((Concrete("a"), Ref("inner"), Concrete("b")),)),
        }
        start = CellPosition("outer", 0, 0)

        def try_enter(grid_id: str, direction: Direction) -> CellPosition | None:
            grid = store[grid_id]
            if direction == Direction.E:
                return CellPosition(grid_id, 0, 0)
            return None

        # With auto_enter=True, should skip yielding the Ref cell
        positions = list(traverse(store, start, Direction.E, try_enter, auto_enter=True))

        # Should visit: a -> (enter inner at x) -> x -> y -> (exit to b) -> b
        assert CellPosition("outer", 0, 0) in positions  # a
        assert CellPosition("inner", 0, 0) in positions  # x
        assert CellPosition("inner", 0, 1) in positions  # y
        assert CellPosition("outer", 0, 2) in positions  # b

    def test_traverse_without_auto_exit(self) -> None:
        """Test traversal without automatic exit stops at Ref."""
        store: GridStore = {
            "inner": Grid("inner", ((Concrete("x"),),)),
            "outer": Grid("outer", ((Ref("inner"), Concrete("a")),)),
        }
        start = CellPosition("inner", 0, 0)

        def try_enter(grid_id: str, direction: Direction) -> CellPosition | None:
            grid = store[grid_id]
            return CellPosition(grid_id, 0, 0)

        # Start inside and traverse east (should exit to outer)
        positions = list(traverse(store, start, Direction.E, try_enter, auto_exit=False))

        # Should stop at the Ref cell
        assert positions[-1] == CellPosition("outer", 0, 0)


# =============================================================================
# Test Rendering Utilities
# =============================================================================


class TestRenderingUtilities:
    """Tests for rendering utility functions."""

    def test_collect_denominators_simple(self) -> None:
        """Test collecting denominators from a simple tree."""
        node = NestedNode(
            "test",
            (
                (ConcreteNode("a", "test"), ConcreteNode("b", "test")),
                (ConcreteNode("c", "test"), ConcreteNode("d", "test")),
            ),
        )
        denoms = collect_denominators(node)
        assert 2 in denoms  # 1/2 from dividing by 2 rows/cols

    def test_collect_denominators_nested(self) -> None:
        """Test collecting denominators with nested grids."""
        inner = NestedNode(
            "inner",
            (
                (ConcreteNode("x", "inner"), ConcreteNode("y", "inner")),
            ),
        )
        outer = NestedNode(
            "outer",
            (
                (inner, ConcreteNode("a", "outer")),
                (ConcreteNode("b", "outer"), ConcreteNode("c", "outer")),
            ),
        )
        denoms = collect_denominators(outer)
        # Should have denominators from both levels
        assert 2 in denoms

    def test_compute_scale_simple(self) -> None:
        """Test computing scale for a simple grid."""
        node = NestedNode(
            "test",
            (
                (ConcreteNode("a", "test"), ConcreteNode("b", "test")),
            ),
        )
        w, h = compute_scale(node)
        assert w >= 1
        assert h >= 1
        # Should be divisible by denominators
        assert w % 2 == 0  # 2 columns

    def test_collect_grid_ids(self) -> None:
        """Test collecting grid IDs from a tree."""
        inner = NestedNode(
            "inner",
            ((ConcreteNode("x", "inner"),),),
        )
        outer = NestedNode(
            "outer",
            ((inner, ConcreteNode("a", "outer")),),
        )
        ids = collect_grid_ids(outer)
        assert "inner" in ids
        assert "outer" in ids

    def test_collect_grid_ids_with_empty(self) -> None:
        """Test collecting grid IDs with empty nodes."""
        node = NestedNode(
            "test",
            (
                (EmptyNode(), ConcreteNode("a", "test")),
                (CutoffNode(), ConcreteNode("b", "test")),
            ),
        )
        ids = collect_grid_ids(node)
        assert ids == {"test"}


# =============================================================================
# Test Rendering
# =============================================================================


class TestRender:
    """Tests for the render function."""

    def test_render_simple_grid(self) -> None:
        """Test rendering a simple grid."""
        store: GridStore = {
            "test": Grid(
                "test",
                ((Concrete("a"), Concrete("b")),),
            )
        }
        tree = analyze(store, "test", Fraction(1), Fraction(1))
        result = render(tree)

        # Should produce some output
        assert isinstance(result, str)
        assert len(result) > 0
        # Should contain newlines (multi-line output)
        assert "\n" in result

    def test_render_with_empty_cells(self) -> None:
        """Test rendering a grid with empty cells."""
        store: GridStore = {
            "test": Grid(
                "test",
                (
                    (Empty(), Concrete("a")),
                    (Concrete("b"), Empty()),
                ),
            )
        }
        tree = analyze(store, "test", Fraction(1), Fraction(1))
        result = render(tree)

        assert isinstance(result, str)
        assert len(result) > 0

    def test_render_nested_grid(self) -> None:
        """Test rendering a nested grid structure."""
        store: GridStore = {
            "inner": Grid("inner", ((Concrete("x"),),)),
            "outer": Grid("outer", ((Ref("inner"), Concrete("a")),)),
        }
        tree = analyze(store, "outer", Fraction(1), Fraction(1))
        result = render(tree)

        assert isinstance(result, str)
        assert len(result) > 0


# =============================================================================
# Test Edge Cases
# =============================================================================


class TestEdgeCases:
    """Tests for edge cases and boundary conditions."""

    def test_single_cell_grid(self) -> None:
        """Test analyzing and rendering a single-cell grid."""
        store: GridStore = {
            "single": Grid("single", ((Concrete("x"),),)),
        }
        tree = analyze(store, "single", Fraction(1), Fraction(1))
        assert isinstance(tree, NestedNode)
        result = render(tree)
        assert isinstance(result, str)

    def test_grid_with_all_empty_cells(self) -> None:
        """Test a grid containing only empty cells."""
        store: GridStore = {
            "empty": Grid(
                "empty",
                (
                    (Empty(), Empty()),
                    (Empty(), Empty()),
                ),
            )
        }
        tree = analyze(store, "empty", Fraction(1), Fraction(1))
        assert isinstance(tree, NestedNode)
        # All children should be EmptyNode
        for row in tree.children:
            for cell in row:
                assert isinstance(cell, EmptyNode)

    def test_deeply_nested_structure(self) -> None:
        """Test a deeply nested grid structure."""
        store: GridStore = {
            "level3": Grid("level3", ((Concrete("c"),),)),
            "level2": Grid("level2", ((Ref("level3"),),)),
            "level1": Grid("level1", ((Ref("level2"),),)),
        }
        # Should handle nesting without errors
        tree = analyze(store, "level1", Fraction(1), Fraction(1))
        assert isinstance(tree, NestedNode)

    def test_mutual_recursion(self) -> None:
        """Test grids with mutual recursion."""
        store: GridStore = {
            "alpha": Grid("alpha", ((Concrete("a"), Ref("beta")),)),
            "beta": Grid("beta", ((Ref("alpha"), Concrete("b")),)),
        }
        # Should handle mutual recursion without infinite loop
        tree = analyze(store, "alpha", Fraction(1), Fraction(1))
        assert isinstance(tree, NestedNode)
        result = render(tree)
        assert isinstance(result, str)

    def test_large_grid(self) -> None:
        """Test a larger grid."""
        cells = tuple(tuple(Concrete(f"c{i}{j}") for j in range(5)) for i in range(5))
        store: GridStore = {
            "large": Grid("large", cells),
        }
        tree = analyze(store, "large", Fraction(1), Fraction(1))
        assert isinstance(tree, NestedNode)
        assert len(tree.children) == 5
        assert len(tree.children[0]) == 5

    def test_traverse_all_directions(self) -> None:
        """Test traversal in all four cardinal directions."""
        store: GridStore = {
            "test": Grid(
                "test",
                (
                    (Concrete("a"), Concrete("b"), Concrete("c")),
                    (Concrete("d"), Concrete("e"), Concrete("f")),
                    (Concrete("g"), Concrete("h"), Concrete("i")),
                ),
            )
        }
        center = CellPosition("test", 1, 1)  # Cell "e"

        def try_enter(grid_id: str, direction: Direction) -> CellPosition | None:
            return None

        # Test North
        positions_n = list(traverse(store, center, Direction.N, try_enter))
        assert CellPosition("test", 0, 1) in positions_n  # Cell "b"

        # Test South
        positions_s = list(traverse(store, center, Direction.S, try_enter))
        assert CellPosition("test", 2, 1) in positions_s  # Cell "h"

        # Test East
        positions_e = list(traverse(store, center, Direction.E, try_enter))
        assert CellPosition("test", 1, 2) in positions_e  # Cell "f"

        # Test West
        positions_w = list(traverse(store, center, Direction.W, try_enter))
        assert CellPosition("test", 1, 0) in positions_w  # Cell "d"


# =============================================================================
# Test Integration
# =============================================================================


class TestIntegration:
    """Integration tests combining multiple components."""

    def test_complete_workflow(self) -> None:
        """Test complete workflow from definition to rendering."""
        store: GridStore = {
            "inner": Grid(
                "inner",
                (
                    (Concrete("a"), Concrete("b")),
                    (Concrete("c"), Concrete("d")),
                ),
            ),
            "outer": Grid(
                "outer",
                (
                    (Ref("inner"), Concrete("x")),
                    (Concrete("y"), Empty()),
                ),
            ),
        }

        # Analyze
        tree = analyze(store, "outer", Fraction(1), Fraction(1))
        assert isinstance(tree, NestedNode)

        # Render
        result = render(tree)
        assert isinstance(result, str)
        assert len(result) > 0

        # Verify structure
        assert tree.grid_id == "outer"
        nested_inner = tree.children[0][0]
        assert isinstance(nested_inner, NestedNode)
        assert nested_inner.grid_id == "inner"

    def test_analyze_and_traverse(self) -> None:
        """Test analyzing and then traversing the same structure."""
        store: GridStore = {
            "test": Grid(
                "test",
                (
                    (Concrete("a"), Concrete("b")),
                    (Concrete("c"), Concrete("d")),
                ),
            )
        }

        # Analyze
        tree = analyze(store, "test", Fraction(1), Fraction(1))
        assert isinstance(tree, NestedNode)

        # Traverse
        start = CellPosition("test", 0, 0)

        def try_enter(grid_id: str, direction: Direction) -> CellPosition | None:
            return None

        positions = list(traverse(store, start, Direction.E, try_enter))
        assert len(positions) == 2
        assert positions[0].grid_id == "test"
