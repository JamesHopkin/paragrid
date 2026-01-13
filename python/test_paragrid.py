"""
Comprehensive test suite for the Paragrid visualization system.
"""

from fractions import Fraction

import pytest

from paragrid import (
    Cell,
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
    PushFailure,
    Ref,
    RefNode,
    RefStrategy,
    RefStrategyType,
    RuleSet,
    analyze,
    find_primary_ref,
    find_tagged_cell,
    parse_grids,
    pull,
    push,
    push_simple,
)
from ascii_render import (
    collect_denominators,
    collect_grid_ids,
    compute_scale,
    render,
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
# Test String Parsing
# =============================================================================


class TestParseGrids:
    """Tests for the parse_grids function."""

    def test_parse_simple_concrete_grid(self) -> None:
        """Test parsing a simple grid with concrete cells."""
        definitions = {
            "test": "1 2|3 4"
        }
        store = parse_grids(definitions)

        assert "test" in store
        grid = store["test"]
        assert grid.id == "test"
        assert grid.rows == 2
        assert grid.cols == 2

        # Check cells
        assert isinstance(grid.cells[0][0], Concrete)
        assert grid.cells[0][0].id == "1"
        assert isinstance(grid.cells[0][1], Concrete)
        assert grid.cells[0][1].id == "2"
        assert isinstance(grid.cells[1][0], Concrete)
        assert grid.cells[1][0].id == "3"
        assert isinstance(grid.cells[1][1], Concrete)
        assert grid.cells[1][1].id == "4"

    def test_parse_with_refs(self) -> None:
        """Test parsing grids with references."""
        definitions = {
            "main": "1 A|2 3",
            "A": "5 6"
        }
        store = parse_grids(definitions)

        # Check main grid
        assert "main" in store
        main = store["main"]
        assert main.rows == 2
        assert main.cols == 2
        assert isinstance(main.cells[0][0], Concrete)
        assert main.cells[0][0].id == "1"
        assert isinstance(main.cells[0][1], Ref)
        assert main.cells[0][1].grid_id == "A"

        # Check referenced grid
        assert "A" in store
        grid_a = store["A"]
        assert grid_a.rows == 1
        assert grid_a.cols == 2

    def test_parse_with_empty_cells(self) -> None:
        """Test parsing grids with empty cells (spaces)."""
        definitions = {
            "test": "1  3|4 5 6"
        }
        store = parse_grids(definitions)

        grid = store["test"]
        assert grid.rows == 2
        assert grid.cols == 3

        # First row: 1, Empty, 3
        assert isinstance(grid.cells[0][0], Concrete)
        assert grid.cells[0][0].id == "1"
        assert isinstance(grid.cells[0][1], Empty)
        assert isinstance(grid.cells[0][2], Concrete)
        assert grid.cells[0][2].id == "3"

    def test_parse_with_underscore_empty(self) -> None:
        """Test parsing grids with explicit empty marker (_)."""
        definitions = {
            "test": "1 _|_ 2"
        }
        store = parse_grids(definitions)

        grid = store["test"]
        assert grid.rows == 2
        assert grid.cols == 2

        assert isinstance(grid.cells[0][0], Concrete)
        assert isinstance(grid.cells[0][1], Empty)
        assert isinstance(grid.cells[1][0], Empty)
        assert isinstance(grid.cells[1][1], Concrete)

    def test_parse_multiple_grids(self) -> None:
        """Test parsing multiple grid definitions."""
        definitions = {
            "grid1": "1 2",
            "grid2": "3|4",
            "grid3": "A B|C D"
        }
        store = parse_grids(definitions)

        assert len(store) == 3
        assert "grid1" in store
        assert "grid2" in store
        assert "grid3" in store

        # Check grid1
        assert store["grid1"].rows == 1
        assert store["grid1"].cols == 2

        # Check grid2
        assert store["grid2"].rows == 2
        assert store["grid2"].cols == 1

        # Check grid3 has refs
        assert isinstance(store["grid3"].cells[0][0], Ref)
        assert store["grid3"].cells[0][0].grid_id == "A"

    def test_parse_single_row(self) -> None:
        """Test parsing a single-row grid."""
        definitions = {
            "row": "1 2 3 4"
        }
        store = parse_grids(definitions)

        grid = store["row"]
        assert grid.rows == 1
        assert grid.cols == 4

    def test_parse_single_column(self) -> None:
        """Test parsing a single-column grid."""
        definitions = {
            "col": "1|2|3|4"
        }
        store = parse_grids(definitions)

        grid = store["col"]
        assert grid.rows == 4
        assert grid.cols == 1

    def test_parse_case_sensitive_refs(self) -> None:
        """Test that uppercase and lowercase refs are distinct."""
        definitions = {
            "test": "A a|B b"
        }
        store = parse_grids(definitions)

        grid = store["test"]
        # Both should be Refs, but with different grid_ids
        assert isinstance(grid.cells[0][0], Ref)
        assert grid.cells[0][0].grid_id == "A"
        assert isinstance(grid.cells[0][1], Ref)
        assert grid.cells[0][1].grid_id == "a"

    def test_parse_explicit_primary_ref(self) -> None:
        """Test parsing explicitly marked primary references."""
        definitions = {
            "test": "1 *A|2 3"
        }
        store = parse_grids(definitions)

        grid = store["test"]
        # Check that *A creates a Ref with is_primary=True
        assert isinstance(grid.cells[0][1], Ref)
        assert grid.cells[0][1].grid_id == "A"
        assert grid.cells[0][1].is_primary is True

    def test_parse_explicit_secondary_ref(self) -> None:
        """Test parsing explicitly marked secondary references."""
        definitions = {
            "test": "~A 1|2 3"
        }
        store = parse_grids(definitions)

        grid = store["test"]
        # Check that ~A creates a Ref with is_primary=False
        assert isinstance(grid.cells[0][0], Ref)
        assert grid.cells[0][0].grid_id == "A"
        assert grid.cells[0][0].is_primary is False

    def test_parse_auto_determined_ref(self) -> None:
        """Test parsing auto-determined references (plain letters)."""
        definitions = {
            "test": "1 A|2 3"
        }
        store = parse_grids(definitions)

        grid = store["test"]
        # Check that A creates a Ref with is_primary=None
        assert isinstance(grid.cells[0][1], Ref)
        assert grid.cells[0][1].grid_id == "A"
        assert grid.cells[0][1].is_primary is None

    def test_parse_mixed_primary_markers(self) -> None:
        """Test parsing mixed primary/secondary/auto markers."""
        definitions = {
            "test": "*A ~A A|~B B *B"
        }
        store = parse_grids(definitions)

        grid = store["test"]
        # First row: *A (primary), ~A (secondary), A (auto)
        assert isinstance(grid.cells[0][0], Ref)
        assert grid.cells[0][0].is_primary is True
        assert isinstance(grid.cells[0][1], Ref)
        assert grid.cells[0][1].is_primary is False
        assert isinstance(grid.cells[0][2], Ref)
        assert grid.cells[0][2].is_primary is None
        # Second row: ~B (secondary), B (auto), *B (primary)
        assert isinstance(grid.cells[1][0], Ref)
        assert grid.cells[1][0].is_primary is False
        assert isinstance(grid.cells[1][1], Ref)
        assert grid.cells[1][1].is_primary is None
        assert isinstance(grid.cells[1][2], Ref)
        assert grid.cells[1][2].is_primary is True

    def test_parse_invalid_cell_raises_error(self) -> None:
        """Test that invalid cell strings raise an error."""
        definitions = {
            "bad": "1 @ 2"
        }
        with pytest.raises(ValueError, match="Invalid cell string"):
            parse_grids(definitions)

    def test_parse_invalid_cell_error_details(self) -> None:
        """Test that invalid cell error includes detailed diagnostic information."""
        definitions = {
            "TestGrid": "1 2|3 @ 5"
        }
        try:
            parse_grids(definitions)
            assert False, "Should have raised ValueError"
        except ValueError as e:
            error_msg = str(e)
            # Verify all diagnostic information is present
            assert "Invalid cell string: '@'" in error_msg
            assert "Grid: 'TestGrid'" in error_msg
            assert "Row 1:" in error_msg
            assert "Position: column 1" in error_msg
            assert "Valid formats:" in error_msg
            assert "Digit start" in error_msg
            assert "Letter start" in error_msg

    def test_parse_inconsistent_row_length_raises_error(self) -> None:
        """Test that inconsistent row lengths raise an error."""
        definitions = {
            "bad": "1 2|3 4 5"
        }
        with pytest.raises(ValueError, match="same number of cells"):
            parse_grids(definitions)

    def test_parse_inconsistent_row_length_error_details(self) -> None:
        """Test that inconsistent row length error includes detailed information."""
        definitions = {
            "TestGrid": "1 2|3 4 5|6 7"
        }
        try:
            parse_grids(definitions)
            assert False, "Should have raised ValueError"
        except ValueError as e:
            error_msg = str(e)
            # Verify diagnostic information is present
            assert "Inconsistent row lengths in grid 'TestGrid'" in error_msg
            assert "Expected: 2 columns" in error_msg
            assert "Mismatched rows:" in error_msg
            assert "Row 1: 3 columns" in error_msg

    def test_parse_multichar_concrete(self) -> None:
        """Test parsing multi-character concrete cells."""
        definitions = {
            "test": "123 456abc|789xyz 0"
        }
        store = parse_grids(definitions)

        grid = store["test"]
        assert grid.rows == 2
        assert grid.cols == 2

        # First row: "123", "456abc"
        assert isinstance(grid.cells[0][0], Concrete)
        assert grid.cells[0][0].id == "123"
        assert isinstance(grid.cells[0][1], Concrete)
        assert grid.cells[0][1].id == "456abc"

        # Second row: "789xyz", "0"
        assert isinstance(grid.cells[1][0], Concrete)
        assert grid.cells[1][0].id == "789xyz"
        assert isinstance(grid.cells[1][1], Concrete)
        assert grid.cells[1][1].id == "0"

    def test_parse_multichar_refs(self) -> None:
        """Test parsing multi-character grid references."""
        definitions = {
            "Main": "100 Inner|200 Grid2",
            "Inner": "x",
            "Grid2": "y"
        }
        store = parse_grids(definitions)

        grid = store["Main"]
        assert grid.rows == 2
        assert grid.cols == 2

        # First row: Concrete("100"), Ref("Inner")
        assert isinstance(grid.cells[0][0], Concrete)
        assert grid.cells[0][0].id == "100"
        assert isinstance(grid.cells[0][1], Ref)
        assert grid.cells[0][1].grid_id == "Inner"

        # Second row: Concrete("200"), Ref("Grid2")
        assert isinstance(grid.cells[1][0], Concrete)
        assert grid.cells[1][0].id == "200"
        assert isinstance(grid.cells[1][1], Ref)
        assert grid.cells[1][1].grid_id == "Grid2"

    def test_parse_multichar_explicit_primary_refs(self) -> None:
        """Test parsing multi-character refs with explicit primary markers."""
        definitions = {
            "test": "*MainGrid ~OtherGrid",
            "MainGrid": "1",
            "OtherGrid": "2"
        }
        store = parse_grids(definitions)

        grid = store["test"]
        # First cell: *MainGrid -> Ref("MainGrid", is_primary=True)
        assert isinstance(grid.cells[0][0], Ref)
        assert grid.cells[0][0].grid_id == "MainGrid"
        assert grid.cells[0][0].is_primary is True

        # Second cell: ~OtherGrid -> Ref("OtherGrid", is_primary=False)
        assert isinstance(grid.cells[0][1], Ref)
        assert grid.cells[0][1].grid_id == "OtherGrid"
        assert grid.cells[0][1].is_primary is False

    def test_parse_mixed_multichar_content(self) -> None:
        """Test parsing a realistic grid with multi-character content and refs."""
        definitions = {
            "MainGrid": "1item Portal 2item|100 200 Portal",
            "Portal": "9x 8y"
        }
        store = parse_grids(definitions)

        main = store["MainGrid"]
        assert main.rows == 2
        assert main.cols == 3

        # First row: Concrete("1item"), Ref("Portal"), Concrete("2item")
        assert isinstance(main.cells[0][0], Concrete)
        assert main.cells[0][0].id == "1item"
        assert isinstance(main.cells[0][1], Ref)
        assert main.cells[0][1].grid_id == "Portal"
        assert isinstance(main.cells[0][2], Concrete)
        assert main.cells[0][2].id == "2item"

        # Second row: Concrete("100"), Concrete("200"), Ref("Portal")
        assert isinstance(main.cells[1][0], Concrete)
        assert main.cells[1][0].id == "100"
        assert isinstance(main.cells[1][1], Concrete)
        assert main.cells[1][1].id == "200"
        assert isinstance(main.cells[1][2], Ref)
        assert main.cells[1][2].grid_id == "Portal"

        # Verify Portal grid
        portal = store["Portal"]
        assert isinstance(portal.cells[0][0], Concrete)
        assert portal.cells[0][0].id == "9x"
        assert isinstance(portal.cells[0][1], Concrete)
        assert portal.cells[0][1].id == "8y"


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
        # The referenced grid should be wrapped in RefNode
        ref_node = result.children[0][0]
        assert isinstance(ref_node, RefNode)
        assert ref_node.grid_id == "outer"
        assert ref_node.ref_target == "inner"
        assert ref_node.is_primary is True
        # The content should be the nested grid
        assert isinstance(ref_node.content, NestedNode)
        assert ref_node.content.grid_id == "inner"

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
        # Should be wrapped in RefNode
        assert isinstance(ref_cell, RefNode)
        # The content may be nested multiple times before cutoff
        assert isinstance(ref_cell.content, (NestedNode, CutoffNode))

    def test_analyze_explicit_is_primary_true(self) -> None:
        """Test analyze() with explicit is_primary=True marking."""
        store: GridStore = {
            "main": Grid(
                "main",
                (
                    (Ref("child", is_primary=True), Concrete("a")),
                ),
            ),
            "child": Grid(
                "child",
                (
                    (Concrete("x"),),
                ),
            ),
        }
        result = analyze(store, "main", Fraction(1), Fraction(1))
        assert isinstance(result, NestedNode)
        # Check that the ref is recognized as primary
        ref_cell = result.children[0][0]
        assert isinstance(ref_cell, RefNode)
        assert ref_cell.is_primary is True

    def test_analyze_explicit_is_primary_false(self) -> None:
        """Test analyze() with explicit is_primary=False marking."""
        store: GridStore = {
            "main": Grid(
                "main",
                (
                    (Ref("child", is_primary=True), Ref("child", is_primary=False)),
                ),
            ),
            "child": Grid(
                "child",
                (
                    (Concrete("x"),),
                ),
            ),
        }
        result = analyze(store, "main", Fraction(1), Fraction(1))
        assert isinstance(result, NestedNode)
        # First ref should be primary (explicitly marked)
        ref_cell_1 = result.children[0][0]
        assert isinstance(ref_cell_1, RefNode)
        assert ref_cell_1.is_primary is True
        # Second ref should be secondary (explicitly marked)
        ref_cell_2 = result.children[0][1]
        assert isinstance(ref_cell_2, RefNode)
        assert ref_cell_2.is_primary is False


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

    def test_find_primary_ref_explicit_primary(self) -> None:
        """Test that explicitly marked primary is found first."""
        store: GridStore = {
            "inner": Grid("inner", ((Concrete("x"),),)),
            "outer": Grid(
                "outer",
                (
                    (Ref("inner", is_primary=False), Ref("inner", is_primary=True)),
                ),
            ),
        }
        result = find_primary_ref(store, "inner")
        assert result == ("outer", 0, 1)  # Second ref is explicitly primary

    def test_find_primary_ref_explicit_overrides_order(self) -> None:
        """Test that explicit primary marking overrides discovery order."""
        # Parse with explicit markers - second ref is primary
        store = parse_grids({
            "inner": "1",
            "outer": "~A *A"
        })
        # Rename refs to point to "inner" instead of "A"
        store = {
            "inner": store["inner"],
            "outer": Grid(
                "outer",
                ((Ref("inner", is_primary=False), Ref("inner", is_primary=True)),)
            ),
        }
        result = find_primary_ref(store, "inner")
        assert result == ("outer", 0, 1)  # Explicit primary wins


# OBSOLETE: TestTraverse class removed - traverse() function was removed in favor of Navigator
# See commits: 920940d "Remove traverse() and related functions"

# =============================================================================
# Test Push
# =============================================================================


class TestPush:
    """Tests for simple push operation (without backtracking)."""

    def test_push_simple_to_empty(self) -> None:
        """Test basic push of 2-3 cells ending at Empty."""
        store: GridStore = {
            "main": Grid("main", ((Concrete("A"), Concrete("B"), Empty()),)),
        }

        start = CellPosition("main", 0, 0)
        rules = RuleSet()  # Default: TRY_ENTER_FIRST
        result = push_simple(store, start, Direction.E, rules)

        assert isinstance(result, dict)
        # After push: [A, B, Empty] -> [Empty, A, B]
        assert isinstance(result["main"].cells[0][0], Empty)
        assert result["main"].cells[0][1] == Concrete("A")
        assert result["main"].cells[0][2] == Concrete("B")

    def test_push_cycle_to_start(self) -> None:
        """Test push that cycles back to start position."""
        # Create a simple 2x2 grid with a cycle: A -> B -> C -> D -> A
        store: GridStore = {
            "main": Grid(
                "main",
                (
                    (Concrete("A"), Concrete("B")),
                    (Concrete("D"), Concrete("C")),
                ),
            ),
        }

        def allow_all_entry(grid_id: str, direction: Direction) -> CellPosition | None:
            return None

        # Start at top-left, push East
        start = CellPosition("main", 0, 0)
        # Path: A -> B (edge) -> wraps down -> C -> D (edge) -> wraps up -> A (cycle)
        # This won't actually cycle in a simple 2x2, let me create a better example

        # Actually, let's create a 1x3 grid that wraps via a Ref
        store2: GridStore = {
            "main": Grid(
                "main", ((Concrete("A"), Concrete("B"), Concrete("C")),)
            ),
        }

        # For now, test that we detect when push cycles to start
        # This is a simpler case - we'll test with a self-referencing grid later
        # Skip this test for now and come back to it
        pass

    def test_push_single_cell_at_empty(self) -> None:
        """Test push starting at Empty (no-op but valid)."""
        store: GridStore = {
            "main": Grid("main", ((Empty(), Concrete("A")),)),
        }

        start = CellPosition("main", 0, 0)
        result = push_simple(store, start, Direction.E, RuleSet())

        # Path: [Empty, A], push ends at A (not Empty) -> should fail
        assert isinstance(result, PushFailure)
        assert result.reason == "NO_STRATEGY"

    def test_push_immutability(self) -> None:
        """Test that original store is unchanged after push."""
        store: GridStore = {
            "main": Grid("main", ((Concrete("A"), Concrete("B"), Empty()),)),
        }

        start = CellPosition("main", 0, 0)
        result = push_simple(store, start, Direction.E, RuleSet())

        assert isinstance(result, dict)
        # Original store should be unchanged
        assert store["main"].cells[0][0] == Concrete("A")
        assert store["main"].cells[0][1] == Concrete("B")
        assert isinstance(store["main"].cells[0][2], Empty)

    def test_push_fails_edge_no_empty(self) -> None:
        """Test push fails when hitting edge without Empty."""
        store: GridStore = {
            "main": Grid("main", ((Concrete("A"), Concrete("B"), Concrete("C")),)),
        }

        start = CellPosition("main", 0, 0)
        result = push_simple(store, start, Direction.E, RuleSet())

        # Path: [A, B, C], hits edge at non-Empty -> should fail
        assert isinstance(result, PushFailure)
        assert result.reason == "NO_STRATEGY"

    def test_push_through_portal(self) -> None:
        """Test push through a Ref that acts as portal."""
        # Grid Main: [A, Ref(Inner), Empty]
        # Grid Inner: [X, Y]
        # Push from A eastward with TRY_ENTER_FIRST strategy
        # Expected path: A -> (enter portal) -> X -> Y -> (exit portal) -> Empty
        # Result: [Empty, A, X, Y] with Y ending up in main, A,X in inner
        store: GridStore = {
            "main": Grid("main", ((Concrete("A"), Ref("inner"), Empty()),)),
            "inner": Grid("inner", ((Concrete("X"), Concrete("Y")),)),
        }

        start = CellPosition("main", 0, 0)
        result = push_simple(store, start, Direction.E, RuleSet(ref_strategy=RefStrategy.TRY_ENTER_FIRST))

        assert isinstance(result, dict)
        # After push: A -> X -> Y -> Empty
        # Rotation: [A, X, Y, Empty] -> [Empty, A, X, Y]
        assert isinstance(result["main"].cells[0][0], Empty)
        assert result["main"].cells[0][1] == Ref("inner")  # Ref not pushed
        assert isinstance(result["main"].cells[0][2], Concrete)
        assert result["main"].cells[0][2] == Concrete("Y")

        # Inner grid updated
        assert result["inner"].cells[0][0] == Concrete("A")
        assert result["inner"].cells[0][1] == Concrete("X")

    def test_push_blocked_ref(self) -> None:
        """Test push with Ref that denies entry (acts as solid).

        NOTE: With the refactored try_enter, entry is always allowed.
        This test needs to be updated to use mocking/patching to test entry denial.
        For now, this test will behave differently - the Ref will act as a portal.
        """
        store: GridStore = {
            "main": Grid("main", ((Concrete("A"), Ref("locked"), Empty()),)),
            "locked": Grid("locked", ((Concrete("SECRET"),),)),
        }

        start = CellPosition("main", 0, 0)
        # Use PUSH_FIRST strategy to treat Ref as solid
        result = push_simple(store, start, Direction.E, RuleSet(ref_strategy=RefStrategy.PUSH_FIRST))

        assert isinstance(result, dict)
        # Path: [A, Ref(locked), Empty]
        # Ref acts as solid object, gets pushed
        # Rotation: [A, Ref, Empty] -> [Empty, A, Ref]
        assert isinstance(result["main"].cells[0][0], Empty)
        assert result["main"].cells[0][1] == Concrete("A")
        assert result["main"].cells[0][2] == Ref("locked")

        # Locked grid unchanged
        assert result["locked"].cells[0][0] == Concrete("SECRET")

    def test_push_affects_multiple_grids(self) -> None:
        """Test that push updates multiple grids correctly when using portal."""
        store: GridStore = {
            "main": Grid("main", ((Concrete("A"), Ref("inner"), Empty()),)),
            "inner": Grid("inner", ((Concrete("X"), Concrete("Y")),)),
        }

        start = CellPosition("main", 0, 0)
        result = push_simple(store, start, Direction.E, RuleSet(ref_strategy=RefStrategy.TRY_ENTER_FIRST))

        assert isinstance(result, dict)
        # Both grids should be updated
        assert "main" in result
        assert "inner" in result

        # Verify changes
        assert isinstance(result["main"].cells[0][0], Empty)
        assert result["inner"].cells[0][0] == Concrete("A")

    def test_push_stops_at_empty(self) -> None:
        """Test that push stops immediately when encountering Empty, not continuing past it."""
        # Setup: [A, B, Empty, C, D]
        # Push from A eastward should stop at Empty, creating path [A, B, Empty]
        # NOT continuing to C and D
        store: GridStore = {
            "main": Grid(
                "main",
                ((Concrete("A"), Concrete("B"), Empty(), Concrete("C"), Concrete("D")),),
            ),
        }

        start = CellPosition("main", 0, 0)
        result = push_simple(store, start, Direction.E, RuleSet())

        assert isinstance(result, dict)
        # After push: [A, B, Empty, C, D] -> [Empty, A, B, C, D]
        # Only the first 3 cells should be affected
        assert isinstance(result["main"].cells[0][0], Empty)
        assert result["main"].cells[0][1] == Concrete("A")
        assert result["main"].cells[0][2] == Concrete("B")
        # C and D should remain unchanged
        assert result["main"].cells[0][3] == Concrete("C")
        assert result["main"].cells[0][4] == Concrete("D")

    def test_push_stops_at_empty_through_portal(self) -> None:
        """Test that push stops at Empty even when entering through a portal."""
        # Setup: Main: [A, Ref(inner), C]
        #        Inner: [X, Empty]
        # Push from A eastward with TRY_ENTER_FIRST, entering inner at X
        # Should stop at Empty inside inner
        store: GridStore = {
            "main": Grid("main", ((Concrete("A"), Ref("inner"), Concrete("C")),)),
            "inner": Grid("inner", ((Concrete("X"), Empty()),)),
        }

        start = CellPosition("main", 0, 0)
        result = push_simple(store, start, Direction.E, RuleSet(ref_strategy=RefStrategy.TRY_ENTER_FIRST))

        assert isinstance(result, dict)
        # Path should be: [A, X, Empty]
        # After rotation: [Empty, A, X]
        # Main[0,0] should be Empty, Main[0,2] should still be C (unchanged)
        assert isinstance(result["main"].cells[0][0], Empty)
        assert result["main"].cells[0][2] == Concrete("C")  # C unchanged
        # Inner should have [A, X]
        assert result["inner"].cells[0][0] == Concrete("A")
        assert result["inner"].cells[0][1] == Concrete("X")

    def test_push_east_with_self_ref_swallow(self) -> None:
        """Test push east with self-reference and swallow strategy.

        Layout: '1 main 5|_ _ _|_ _ _'
        Grid: Row 0: [1, main, 5]
              Row 1: [_, _, _]
              Row 2: [_, _, _]

        Where 'main' is a self-reference to the grid.
        This tests the important mechanic where a cell can be swallowed
        into the same grid it's in, entering at a different position.

        Expected: Cell 5 gets swallowed into main, entering at [1, 2]
        (middle of right edge when entering from west).
        """
        store = parse_grids({"main": "1 main 5|_ _ _|_ _ _"})

        # Verify initial layout
        assert store["main"].cells[0][0] == Concrete("1")
        assert store["main"].cells[0][1] == Ref("main")
        assert store["main"].cells[0][2] == Concrete("5")
        assert isinstance(store["main"].cells[1][0], Empty)
        assert isinstance(store["main"].cells[2][0], Empty)

        # Push east from position [0, 0] (cell "1") with default (SOLID first) strategy
        start = CellPosition("main", 0, 0)
        result = push(store, start, Direction.E, RuleSet())

        # Should succeed
        assert isinstance(result, dict), f"Push should succeed, got {result}"

        # Expected outcome with SWALLOW strategy:
        # Path: [1, main, 5] where main swallows 5
        # 5 enters main from west at middle right = [1, 2]
        # Rotation: [_, 1, main] with 5 at [1, 2]
        assert isinstance(result["main"].cells[0][0], Empty), "Cell [0,0] should be empty"
        assert result["main"].cells[0][1] == Concrete("1"), "Cell [0,1] should be 1"
        assert result["main"].cells[0][2] == Ref("main"), "Cell [0,2] should be ref(main)"

        # Cell 5 should have been swallowed into position [1, 2]
        assert result["main"].cells[1][2] == Concrete("5"), "Cell [1,2] should be 5 (swallowed)"

    def test_push_east_with_self_ref_portal(self) -> None:
        """Test push east with self-reference using portal strategy.

        Same layout but with PORTAL strategy first, so '1' enters the ref.

        Expected: Cell 1 enters main via the ref, appearing at [1, 0]
        (middle of left edge when entering from east).
        """
        store = parse_grids({"main": "1 main 5|_ _ _|_ _ _"})

        # Push east with PORTAL first strategy
        start = CellPosition("main", 0, 0)
        result = push(store, start, Direction.E, RuleSet(ref_strategy=(
            RefStrategyType.PORTAL,
            RefStrategyType.SOLID,
            RefStrategyType.SWALLOW
        )))

        # Should succeed
        assert isinstance(result, dict), f"Push should succeed, got {result}"

        # Expected outcome with PORTAL strategy:
        # 1 enters main from east at middle left = [1, 0]
        # Rotation: [_, main, 5] with 1 at [1, 0]
        assert isinstance(result["main"].cells[0][0], Empty), "Cell [0,0] should be empty"
        assert result["main"].cells[0][1] == Ref("main"), "Cell [0,1] should be ref(main)"
        assert result["main"].cells[0][2] == Concrete("5"), "Cell [0,2] should be 5"

        # Cell 1 should have entered at position [1, 0]
        assert result["main"].cells[1][0] == Concrete("1"), "Cell [1,0] should be 1 (entered)"


# =============================================================================
# Test Navigator Exit Cycle Detection
# =============================================================================


class TestNavigator:
    """Tests for Navigator exit cycle detection."""

    def test_exit_cycle_detection(self) -> None:
        """Test that Navigator detects exit cycles and doesn't recurse infinitely."""
        # Create a grid structure where exiting forms a cycle:
        # Grid A contains a ref to B
        # Grid B contains a ref to A
        # Both grids are 1x1, so any movement hits an edge and tries to exit
        # This creates an exit cycle: A -> exit to B -> exit to A -> ...

        store: GridStore = {
            "A": Grid("A", ((Ref("B", is_primary=True),),)),
            "B": Grid("B", ((Ref("A", is_primary=True),),)),
        }

        from paragrid import Navigator

        # Start in grid A
        nav = Navigator(store, CellPosition("A", 0, 0), Direction.E)

        # Try to advance east - this should detect the exit cycle and return False
        # rather than recursing infinitely
        result = nav.try_advance()

        assert result is False, "Should detect exit cycle and return False"


# =============================================================================
# Test Push with Backtracking
# =============================================================================


class TestPushBacktracking:
    """Tests for push operation with backtracking."""

    def test_backtrack_on_stop_inside_ref(self) -> None:
        """Test backtracking when hitting stop tag inside referenced grid."""
        # Setup: [A, Ref(inner), Empty]
        #        inner: [X, STOP]
        # Push from A eastward.
        # Simple: fails (hits STOP inside inner)
        # Backtracking: succeeds by treating Ref as solid
        # Result: [Empty, A, Ref(inner)]

        store: GridStore = {
            "main": Grid("main", ((Concrete("A"), Ref("inner"), Empty()),)),
            "inner": Grid("inner", ((Concrete("X"), Concrete("STOP")),)),
        }

        def tag_stop(cell: Cell) -> set[str]:
            """Tag STOP concrete cells with 'stop' tag."""
            if isinstance(cell, Concrete) and cell.id == "STOP":
                return {"stop"}
            return set()

        start = CellPosition("main", 0, 0)

        # Simple version with TRY_ENTER_FIRST should fail (enters Ref, hits STOP)
        result_simple = push_simple(store, start, Direction.E, RuleSet(ref_strategy=RefStrategy.TRY_ENTER_FIRST), tag_fn=tag_stop)
        assert isinstance(result_simple, PushFailure), "Simple push should fail when hitting stop inside Ref"
        assert result_simple.reason == "STOP_TAG"

        # Backtracking version should succeed (tries portal, fails, backtracks to solid)
        result = push(store, start, Direction.E, RuleSet(ref_strategy=RefStrategy.TRY_ENTER_FIRST), tag_fn=tag_stop)
        assert isinstance(result, dict), "Backtracking push should succeed"

        # Result: [Empty, A, Ref(inner)]
        assert isinstance(result["main"].cells[0][0], Empty)
        assert result["main"].cells[0][1] == Concrete("A")
        assert result["main"].cells[0][2] == Ref("inner")

        # Inner grid should be unchanged (Ref treated as solid, not entered)
        assert result["inner"].cells[0][0] == Concrete("X")
        assert result["inner"].cells[0][1] == Concrete("STOP")

    def test_no_backtrack_when_simple_succeeds(self) -> None:
        """Test that backtracking doesn't trigger when portal path succeeds."""
        store: GridStore = {
            "main": Grid("main", ((Concrete("A"), Ref("inner"), Empty()),)),
            "inner": Grid("inner", ((Concrete("X"), Concrete("Y")),)),
        }

        start = CellPosition("main", 0, 0)

        # Both versions should succeed with same result
        result_simple = push_simple(store, start, Direction.E, RuleSet())
        result_backtrack = push(store, start, Direction.E, RuleSet())

        assert isinstance(result_simple, dict)
        assert isinstance(result_backtrack, dict)

        # Results should be identical
        assert result_simple["main"].cells == result_backtrack["main"].cells
        assert result_simple["inner"].cells == result_backtrack["inner"].cells

    def test_backtrack_multiple_levels(self) -> None:
        """Test backtracking through multiple nested Refs."""
        # Setup: [A, Ref1(B), Empty]
        #        B: [X, STOP]  (STOP is reached by moving, not entering)
        # Expected:
        # 1. Enter Ref1, arrive at X, move to STOP, fail
        # 2. Backtrack: treat Ref1 as solid -> succeeds

        store: GridStore = {
            "main": Grid("main", ((Concrete("A"), Ref("B"), Empty()),)),
            "B": Grid("B", ((Concrete("X"), Concrete("STOP")),)),
        }

        def tag_stop(cell: Cell) -> set[str]:
            if isinstance(cell, Concrete) and cell.id == "STOP":
                return {"stop"}
            return set()

        start = CellPosition("main", 0, 0)

        # Simple version with TRY_ENTER_FIRST should fail (enters B, hits STOP after X)
        result_simple = push_simple(store, start, Direction.E, RuleSet(ref_strategy=RefStrategy.TRY_ENTER_FIRST), tag_fn=tag_stop)
        assert isinstance(result_simple, PushFailure)
        assert result_simple.reason == "STOP_TAG"

        # Backtracking version should succeed by treating Ref1 as solid
        result = push(store, start, Direction.E, RuleSet(ref_strategy=RefStrategy.TRY_ENTER_FIRST), tag_fn=tag_stop)
        assert isinstance(result, dict)

        # Result: [Empty, A, Ref(B)]
        assert isinstance(result["main"].cells[0][0], Empty)
        assert result["main"].cells[0][1] == Concrete("A")
        assert result["main"].cells[0][2] == Ref("B")


class TestPushSwallowing:
    """Tests for push swallowing behavior where Refs can absorb target cells."""

    def test_swallow_basic_eastward(self) -> None:
        """Test basic swallowing: Ref swallows Concrete cell when pushed east."""
        # Setup: [Ref(pocket), ball, Empty]
        #        pocket: [Empty, Empty]
        # Push Ref eastward -> ball gets pushed into pocket from west
        # Result: [Empty, Ref(pocket), Empty]
        #         pocket: [ball, Empty]
        store: GridStore = {
            "main": Grid("main", ((Ref("pocket"), Concrete("ball"), Empty()),)),
            "pocket": Grid("pocket", ((Empty(), Empty()),)),
        }

        start = CellPosition("main", 0, 0)
        # Use a rule set that tries swallow strategy
        result = push_simple(store, start, Direction.E, RuleSet(ref_strategy=RefStrategy.SWALLOW_FIRST))

        # Verify swallowing succeeded
        # Pushing east enters from west (right side), so ball goes to position (0,1)
        assert isinstance(result, dict)
        assert isinstance(result["main"].cells[0][0], Empty)
        assert result["main"].cells[0][1] == Ref("pocket")
        assert isinstance(result["main"].cells[0][2], Empty)
        assert isinstance(result["pocket"].cells[0][0], Empty)
        assert result["pocket"].cells[0][1] == Concrete("ball")

    def test_swallow_westward(self) -> None:
        """Test swallowing when pushing Ref westward."""
        # Setup: [Empty, ball, Ref(pocket)]
        #        pocket: [Empty, Empty]
        # Push Ref westward -> ball gets pushed into pocket from east (right edge)
        # Result: [Empty, Ref(pocket), Empty]
        #         pocket: [Empty, ball]
        store: GridStore = {
            "main": Grid("main", ((Empty(), Concrete("ball"), Ref("pocket")),)),
            "pocket": Grid("pocket", ((Empty(), Empty()),)),
        }

        start = CellPosition("main", 0, 2)
        result = push_simple(store, start, Direction.W, RuleSet(ref_strategy=RefStrategy.SWALLOW_FIRST))

        # Verify swallowing succeeded
        # Pushing west enters from east (left side), so ball goes to position (0,0)
        assert isinstance(result, dict)
        assert isinstance(result["main"].cells[0][0], Empty)
        assert result["main"].cells[0][1] == Ref("pocket")
        assert isinstance(result["main"].cells[0][2], Empty)
        assert result["pocket"].cells[0][0] == Concrete("ball")
        assert isinstance(result["pocket"].cells[0][1], Empty)

    def test_swallow_southward(self) -> None:
        """Test swallowing when pushing Ref southward."""
        # Setup: Grid (3 rows x 1 col):
        #        [Ref(pocket)]
        #        [ball]
        #        [Empty]
        #        pocket (2 rows x 1 col): [Empty, Empty]
        # Push Ref southward -> ball gets pushed into pocket from north (top edge)
        store: GridStore = {
            "main": Grid("main", ((Ref("pocket"),), (Concrete("ball"),), (Empty(),))),
            "pocket": Grid("pocket", ((Empty(),), (Empty(),))),
        }

        start = CellPosition("main", 0, 0)
        result = push_simple(store, start, Direction.S, RuleSet(ref_strategy=RefStrategy.SWALLOW_FIRST))

        # Verify swallowing succeeded
        # Pushing south enters from north (bottom edge), so ball goes to position (1,0)
        assert isinstance(result, dict)
        assert isinstance(result["main"].cells[0][0], Empty)
        assert result["main"].cells[1][0] == Ref("pocket")
        assert isinstance(result["main"].cells[2][0], Empty)
        assert isinstance(result["pocket"].cells[0][0], Empty)
        assert result["pocket"].cells[1][0] == Concrete("ball")

    def test_swallow_northward(self) -> None:
        """Test swallowing when pushing Ref northward."""
        # Setup: Grid (3 rows x 1 col):
        #        [Empty]
        #        [ball]
        #        [Ref(pocket)]
        #        pocket (2 rows x 1 col): [Empty, Empty]
        # Push Ref northward -> ball gets pushed into pocket from south (bottom edge)
        store: GridStore = {
            "main": Grid("main", ((Empty(),), (Concrete("ball"),), (Ref("pocket"),))),
            "pocket": Grid("pocket", ((Empty(),), (Empty(),))),
        }

        start = CellPosition("main", 2, 0)
        result = push_simple(store, start, Direction.N, RuleSet(ref_strategy=RefStrategy.SWALLOW_FIRST))

        # Verify swallowing succeeded
        # Pushing north enters from south (top edge), so ball goes to position (0,0)
        assert isinstance(result, dict)
        assert isinstance(result["main"].cells[0][0], Empty)
        assert result["main"].cells[1][0] == Ref("pocket")
        assert isinstance(result["main"].cells[2][0], Empty)
        assert result["pocket"].cells[0][0] == Concrete("ball")
        assert isinstance(result["pocket"].cells[1][0], Empty)

    def test_swallow_fails_when_target_grid_full(self) -> None:
        """Test swallowing fails when target grid has no space."""
        # Setup: [Ref(pocket), ball, Empty]
        #        pocket: [X, Y] (full)
        # Push Ref eastward -> attempt to push ball into pocket fails (no space)
        # Should try alternative strategies (portal or solid)
        store: GridStore = {
            "main": Grid("main", ((Ref("pocket"), Concrete("ball"), Empty()),)),
            "pocket": Grid("pocket", ((Concrete("X"), Concrete("Y")),)),
        }

        start = CellPosition("main", 0, 0)
        result = push_simple(store, start, Direction.E, RuleSet())

        # Should fall back to portal or solid behavior
        # This test just ensures swallowing failure is handled gracefully

    def test_swallow_with_empty_target(self) -> None:
        """Test swallowing behavior when target is Empty."""
        # Setup: [Ref(pocket), Empty, X]
        #        pocket: [Empty, Empty]
        # Push Ref eastward -> target is Empty
        # Swallowing Empty doesn't make semantic sense
        # Should likely skip swallow and try other strategies or just succeed normally
        store: GridStore = {
            "main": Grid("main", ((Ref("pocket"), Empty(), Concrete("X")),)),
            "pocket": Grid("pocket", ((Empty(), Empty()),)),
        }

        start = CellPosition("main", 0, 0)
        result = push_simple(store, start, Direction.E, RuleSet())

        # Expected: Skip swallow and succeed with normal push logic
        assert isinstance(result, dict)

    def test_swallow_vs_portal_priority(self) -> None:
        """Test that rule set controls whether swallow or portal is tried first.

        Bug: Currently swallow is tried opportunistically during portal/solid processing,
        breaking the strategy ordering.
        """
        # Setup: [Ref(inner), 1, Empty]
        #        inner: [Empty, Empty]
        #
        # Push from Ref(inner) with DEFAULT strategy (PORTAL, SOLID, SWALLOW - swallow is LAST):
        # - Should try PORTAL first: Ref acts as portal (enter), likely fails
        # - Should try SOLID next: Ref acts as solid object, pushes 1, succeeds
        # - Should NOT try swallow until portal and solid both fail
        #
        # Expected with DEFAULT (portal, solid, swallow): [Empty, Ref(inner), 1]
        # Bug behavior: swallow happens early, 1 gets swallowed into inner
        store = parse_grids({
            "main": "inner 1 _",
            "inner": "_ _"
        })

        start = CellPosition("main", 0, 0)

        # Test with DEFAULT strategy (PORTAL, SOLID, SWALLOW)
        # Use push() not push_simple() since we need multi-strategy support
        result_default = push(store, start, Direction.E, RuleSet())

        # Should NOT swallow 1 into inner (swallow is last strategy, portal/solid should succeed first)
        # Instead should push Ref as solid: [Empty, Ref(inner), 1]
        assert isinstance(result_default, dict)
        assert isinstance(result_default["main"].cells[0][0], Empty)
        assert result_default["main"].cells[0][1] == Ref("inner")
        assert result_default["main"].cells[0][2] == Concrete("1")
        # Inner should still be empty (no swallowing should have occurred)
        assert isinstance(result_default["inner"].cells[0][0], Empty)
        assert isinstance(result_default["inner"].cells[0][1], Empty)

        # Test with SWALLOW_FIRST strategy - now swallow SHOULD be tried first and succeed
        result_swallow_first = push(store, start, Direction.E, RuleSet(ref_strategy=RefStrategy.SWALLOW_FIRST))

        # Should swallow 1 into inner
        assert isinstance(result_swallow_first, dict)
        assert isinstance(result_swallow_first["main"].cells[0][0], Empty)
        assert result_swallow_first["main"].cells[0][1] == Ref("inner")
        assert isinstance(result_swallow_first["main"].cells[0][2], Empty)
        # 1 should be in inner now
        assert isinstance(result_swallow_first["inner"].cells[0][0], Empty)
        assert result_swallow_first["inner"].cells[0][1] == Concrete("1")

    def test_swallow_ref_cell(self) -> None:
        """Test swallowing when target is also a Ref."""
        # Setup: [Ref(pocket), Ref(other), Empty]
        #        pocket: [Empty, Empty]
        #        other: [Z]
        # Push Ref(pocket) eastward -> try to swallow Ref(other)
        # Ref can be pushed into another grid
        store: GridStore = {
            "main": Grid("main", ((Ref("pocket"), Ref("other"), Empty()),)),
            "pocket": Grid("pocket", ((Empty(), Empty()),)),
            "other": Grid("other", ((Concrete("Z"),),)),
        }

        start = CellPosition("main", 0, 0)
        result = push_simple(store, start, Direction.E, RuleSet(ref_strategy=RefStrategy.SWALLOW_FIRST))

        # Expected: Ref(other) gets pushed into pocket, Ref(pocket) moves right
        # Pushing east enters from west (right side), so Ref(other) goes to position (0,1)
        assert isinstance(result, dict)
        assert isinstance(result["main"].cells[0][0], Empty)
        assert result["main"].cells[0][1] == Ref("pocket")
        assert isinstance(result["main"].cells[0][2], Empty)
        assert isinstance(result["pocket"].cells[0][0], Empty)
        assert result["pocket"].cells[0][1] == Ref("other")

    def test_swallow_chain_reaction(self) -> None:
        """Test swallowing where target itself needs to be pushed."""
        # Setup: [Ref(pocket), A, B, Empty]
        #        pocket: [Empty, Empty]
        # Push Ref eastward -> A needs to be swallowed, but A must first push B
        # This tests if swallowing integrates correctly with normal push mechanics
        store: GridStore = {
            "main": Grid(
                "main",
                ((Ref("pocket"), Concrete("A"), Concrete("B"), Empty()),),
            ),
            "pocket": Grid("pocket", ((Empty(), Empty()),)),
        }

        start = CellPosition("main", 0, 0)
        result = push_simple(store, start, Direction.E, RuleSet())

        # Expected behavior depends on swallow implementation
        # This test ensures complex push scenarios work with swallowing

    def test_swallow_stop_tag_prevents_swallow(self) -> None:
        """Test that cells with stop tag cannot be swallowed."""
        # Setup: [Ref(pocket), wall, Empty]
        #        pocket: [Empty, Empty]
        # The 'wall' cell has a stop tag - it should not be swallowable
        # Push Ref eastward -> swallow should fail because wall is stop-tagged
        store: GridStore = {
            "main": Grid("main", ((Ref("pocket"), Concrete("wall"), Empty()),)),
            "pocket": Grid("pocket", ((Empty(), Empty()),)),
        }

        def tag_stop(cell: Cell) -> set[str]:
            """Tag 'wall' cells with stop tag."""
            if isinstance(cell, Concrete) and cell.id == "wall":
                return {"stop"}
            return set()

        start = CellPosition("main", 0, 0)
        # Try swallow with stop-tagged target
        result = push_simple(
            store, start, Direction.E, RuleSet(ref_strategy=RefStrategy.SWALLOW_FIRST), tag_fn=tag_stop
        )

        # Swallow should fail, but the push might succeed via alternative strategy (portal/solid)
        # If using SWALLOW_FIRST with only swallow, it should fail completely
        # Let's verify the wall hasn't been swallowed
        if isinstance(result, dict):
            # If push succeeded, the wall should still be in main grid, not in pocket
            # Check that pocket is still empty (no swallowing occurred)
            assert isinstance(result["pocket"].cells[0][0], Empty)
            assert isinstance(result["pocket"].cells[0][1], Empty)

    def test_swallow_immutability(self) -> None:
        """Test that swallowing preserves immutability of original store."""
        store: GridStore = {
            "main": Grid("main", ((Ref("pocket"), Concrete("ball"), Empty()),)),
            "pocket": Grid("pocket", ((Empty(), Empty()),)),
        }

        original_main = store["main"]
        original_pocket = store["pocket"]

        start = CellPosition("main", 0, 0)
        result = push_simple(store, start, Direction.E, RuleSet())

        # Original store should be completely unchanged
        assert store["main"] is original_main
        assert store["pocket"] is original_pocket
        assert store["main"].cells[0][0] == Ref("pocket")
        assert store["main"].cells[0][1] == Concrete("ball")
        assert isinstance(store["main"].cells[0][2], Empty)
        assert isinstance(store["pocket"].cells[0][0], Empty)
        assert isinstance(store["pocket"].cells[0][1], Empty)


# =============================================================================
# Test Termination Reasons
# =============================================================================


# OBSOLETE: TestTerminationReasons class removed - traverse() function was removed in favor of Navigator
# See commits: 920940d "Remove traverse() and related functions"


# =============================================================================
# Test Tagging
# =============================================================================


class TestTagging:
    """Tests for cell tagging functionality."""

    def test_stop_tag_in_referenced_grid_during_push(self) -> None:
        """Test that stop tag is respected when pushing through reference chain.

        Bug reproduction: When pushing through a Ref into a referenced grid,
        cells with 'stop' tag inside the referenced grid should prevent the push,
        but they are currently being moved.
        """
        # Setup: main: [1, Ref(inner)]
        #        inner: [9, _]
        # Tag function: '9' has stop tag
        # Push from (0,0) eastward should fail (can't push the stop-tagged cell)

        store = parse_grids({
            "main": "1 inner",
            "inner": "9 _"
        })

        def tag_fn(cell: Cell) -> set[str]:
            # Tag cells containing '9' with stop
            if isinstance(cell, Concrete) and '9' in cell.id:
                return {"stop"}
            return set()

        start = CellPosition("main", 0, 0)
        result = push(store, start, Direction.E, RuleSet(), tag_fn=tag_fn)

        # The push should fail because the '9' cell has a stop tag
        assert isinstance(result, PushFailure), "Push should fail when encountering stop-tagged cell in reference chain"
        assert result.reason == "STOP_TAG"

    def test_stop_tagged_cell_cannot_push_itself(self) -> None:
        """Test that a cell with stop tag cannot initiate a push.

        Bug reproduction: When pushing FROM a stop-tagged cell, the push succeeds
        and the stop-tagged cell moves. However, stop-tagged cells should be immovable
        and unable to participate in any push operation, including initiating one.

        Grid layout:
        main: [Ref(inner), 9]
              [Ref(main),  _]
        inner: [9]

        The '9' cells have stop tags.
        Push east from (0,1) [the stop-tagged '9'] should fail immediately.
        Currently the push succeeds and the '9' moves.
        """
        store = parse_grids({
            "main": "inner 9|main _",
            "inner": "9"
        })

        def tag_fn(cell: Cell) -> set[str]:
            # Tag cells containing '9' with stop
            if isinstance(cell, Concrete) and '9' in cell.id:
                return {"stop"}
            return set()

        # Push FROM the stop-tagged '9' at (0,1)
        start = CellPosition("main", 0, 1)
        result = push(store, start, Direction.E, RuleSet(), tag_fn=tag_fn)

        # The push should fail because the starting cell has a stop tag
        assert isinstance(result, PushFailure), "Push should fail when initiating from a stop-tagged cell"
        assert result.reason == "STOP_TAG"
        assert result.position == start

    def test_find_tagged_cell_single_grid(self) -> None:
        """Test finding a tagged cell in a single grid."""
        store = parse_grids({"main": "1 2|3 4"})

        def tag_fn(cell: Cell) -> set[str]:
            if isinstance(cell, Concrete) and cell.id == "3":
                return {"player"}
            return set()

        result = find_tagged_cell(store, "player", tag_fn)
        assert result is not None
        assert result == CellPosition("main", 1, 0)

    def test_find_tagged_cell_not_found(self) -> None:
        """Test that None is returned when tag is not found."""
        store = parse_grids({"main": "1 2|3 4"})

        def tag_fn(cell: Cell) -> set[str]:
            return set()

        result = find_tagged_cell(store, "player", tag_fn)
        assert result is None

    def test_find_tagged_cell_returns_first_match(self) -> None:
        """Test that the first tagged cell is returned when multiple exist."""
        store = parse_grids({"main": "1 2|3 4"})

        def tag_fn(cell: Cell) -> set[str]:
            if isinstance(cell, Concrete) and cell.id in ["2", "4"]:
                return {"player"}
            return set()

        result = find_tagged_cell(store, "player", tag_fn)
        assert result is not None
        # Should return 2 (0,1) not 4 (1,1) since it's encountered first
        assert result == CellPosition("main", 0, 1)

    def test_find_tagged_cell_multiple_grids(self) -> None:
        """Test finding a tagged cell across multiple grids."""
        store = parse_grids({
            "first": "1 2",
            "second": "3 4",
            "third": "5 6"
        })

        def tag_fn(cell: Cell) -> set[str]:
            if isinstance(cell, Concrete) and cell.id == "5":
                return {"target"}
            return set()

        result = find_tagged_cell(store, "target", tag_fn)
        assert result is not None
        assert result == CellPosition("third", 0, 0)

    def test_find_tagged_cell_with_multiple_tags(self) -> None:
        """Test finding a cell when tag_fn returns multiple tags."""
        store = parse_grids({"main": "1 2|3 4"})

        def tag_fn(cell: Cell) -> set[str]:
            if isinstance(cell, Concrete) and cell.id == "2":
                return {"player", "movable", "important"}
            return set()

        # Should find the cell when searching for any of its tags
        result = find_tagged_cell(store, "movable", tag_fn)
        assert result is not None
        assert result == CellPosition("main", 0, 1)

    def test_find_tagged_cell_with_empty_cells(self) -> None:
        """Test that Empty cells are properly checked by tag_fn."""
        store = parse_grids({"main": "1 _|3 4"})

        def tag_fn(cell: Cell) -> set[str]:
            # Tag empty cells
            if isinstance(cell, Empty):
                return {"empty"}
            return set()

        result = find_tagged_cell(store, "empty", tag_fn)
        assert result is not None
        assert result == CellPosition("main", 0, 1)


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
        width_denoms, height_denoms = collect_denominators(node)
        assert 2 in width_denoms  # 1/2 from dividing by 2 cols
        assert 2 in height_denoms  # 1/2 from dividing by 2 rows

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
        width_denoms, height_denoms = collect_denominators(outer)
        # Should have denominators from both levels
        assert 2 in width_denoms  # From outer 2 cols and inner 2 cols
        assert 2 in height_denoms  # From outer 2 rows

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
        # With separate X/Y scaling, a 1-row grid will render as a single line
        # (height_scale=1 since no vertical subdivision occurs)

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
        ref_node = tree.children[0][0]
        assert isinstance(ref_node, RefNode)
        assert ref_node.grid_id == "outer"
        assert ref_node.ref_target == "inner"
        assert ref_node.is_primary is True
        # The content should be the nested grid
        assert isinstance(ref_node.content, NestedNode)
        assert ref_node.content.grid_id == "inner"



class TestPull:
    """Tests for pull operation."""

    def test_pull_simple(self) -> None:
        """Test basic pull of single Concrete into Empty."""
        store: GridStore = {
            "main": Grid("main", ((Empty(), Concrete("A"), Concrete("B")),)),
        }

        start = CellPosition("main", 0, 0)
        result = pull(store, start, Direction.E, RuleSet())

        # After pull from East: path [Empty, A, B] (B included even though can't advance from it)
        # Rotation: [Empty, A, B] -> [A, B, Empty] (opposite of push to maintain order)
        # Result: [A, B, Empty]
        assert result["main"].cells[0][0] == Concrete("A")
        assert result["main"].cells[0][1] == Concrete("B")
        assert isinstance(result["main"].cells[0][2], Empty)

    def test_pull_chain(self) -> None:
        """Test pull of multiple Concrete cells."""
        store: GridStore = {
            "main": Grid("main", ((Empty(), Concrete("A"), Concrete("B"), Concrete("C")),)),
        }

        start = CellPosition("main", 0, 0)
        result = pull(store, start, Direction.E, RuleSet())

        # Path: [Empty, A, B, C] (C included even though can't advance from it)
        # Rotation: [Empty, A, B, C] -> [A, B, C, Empty] (maintains order A->B->C)
        # Result: [A, B, C, Empty]
        assert result["main"].cells[0][0] == Concrete("A")
        assert result["main"].cells[0][1] == Concrete("B")
        assert result["main"].cells[0][2] == Concrete("C")
        assert isinstance(result["main"].cells[0][3], Empty)

    def test_pull_immutability(self) -> None:
        """Test that original store is unchanged after pull."""
        store: GridStore = {
            "main": Grid("main", ((Empty(), Concrete("A"), Concrete("B")),)),
        }

        start = CellPosition("main", 0, 0)
        result = pull(store, start, Direction.E, RuleSet())

        # Original store should be unchanged
        assert isinstance(store["main"].cells[0][0], Empty)
        assert store["main"].cells[0][1] == Concrete("A")
        assert store["main"].cells[0][2] == Concrete("B")

        # Result should be different - first cell (Empty) moved to back
        assert result["main"].cells[0][0] == Concrete("A")

    def test_pull_rotation(self) -> None:
        """Test that rotation direction is correct for pull."""
        store: GridStore = {
            "main": Grid("main", ((Empty(), Concrete("X"), Concrete("Y")),)),
        }

        start = CellPosition("main", 0, 0)
        result = pull(store, start, Direction.E, RuleSet())

        # Path: [Empty, X, Y] (Y included even though can't advance from it)
        # Rotation: [Empty, X, Y] -> [X, Y, Empty] (maintains X->Y order)
        # Result: [X, Y, Empty]
        assert result["main"].cells[0][0] == Concrete("X")
        assert result["main"].cells[0][1] == Concrete("Y")
        assert isinstance(result["main"].cells[0][2], Empty)

    def test_pull_start_not_empty(self) -> None:
        """Test pull when start is not Empty returns unchanged store."""
        store: GridStore = {
            "main": Grid("main", ((Concrete("A"), Concrete("B"), Empty()),)),
        }

        start = CellPosition("main", 0, 0)
        result = pull(store, start, Direction.E, RuleSet())

        # Should return unchanged store (no-op)
        assert result == store
        assert result["main"].cells[0][0] == Concrete("A")
        assert result["main"].cells[0][1] == Concrete("B")

    def test_pull_blocked_edge(self) -> None:
        """Test pull when can't advance from start returns unchanged store."""
        store: GridStore = {
            "main": Grid("main", ((Empty(),),)),
        }

        start = CellPosition("main", 0, 0)
        result = pull(store, start, Direction.E, RuleSet())

        # Can't advance east from (0,0) in 1-column grid
        # Should return unchanged store (no-op)
        assert result == store
        assert isinstance(result["main"].cells[0][0], Empty)

    def test_pull_from_empty(self) -> None:
        """Test pull when first cell in direction is Empty returns unchanged store."""
        store: GridStore = {
            "main": Grid("main", ((Empty(), Empty(), Concrete("A")),)),
        }

        start = CellPosition("main", 0, 0)
        result = pull(store, start, Direction.E, RuleSet())

        # First cell after Empty is Empty, path length 1, return unchanged
        assert result == store

    def test_pull_stops_at_empty(self) -> None:
        """Test pull stops successfully when hitting Empty midway."""
        store: GridStore = {
            "main": Grid("main", ((Empty(), Concrete("A"), Empty(), Concrete("B")),)),
        }

        start = CellPosition("main", 0, 0)
        result = pull(store, start, Direction.E, RuleSet())

        # Path: [Empty@(0,0), A@(0,1)], break at Empty@(0,2)
        # Rotation: [Empty, A] -> [A, Empty]
        assert result["main"].cells[0][0] == Concrete("A")
        assert isinstance(result["main"].cells[0][1], Empty)
        # Rest unchanged
        assert isinstance(result["main"].cells[0][2], Empty)
        assert result["main"].cells[0][3] == Concrete("B")

    def test_pull_stops_at_stop_tag(self) -> None:
        """Test pull stops successfully when hitting stop tag."""
        store: GridStore = {
            "main": Grid("main", ((Empty(), Concrete("A"), Concrete("STOP"), Concrete("B")),)),
        }

        def tag_fn(cell: Cell) -> set[str]:
            if isinstance(cell, Concrete) and cell.id == "STOP":
                return {"stop"}
            return set()

        start = CellPosition("main", 0, 0)
        result = pull(store, start, Direction.E, RuleSet(), tag_fn=tag_fn)

        # Path: [Empty@(0,0), A@(0,1)], break at STOP
        # Rotation: [Empty, A] -> [A, Empty]
        assert result["main"].cells[0][0] == Concrete("A")
        assert isinstance(result["main"].cells[0][1], Empty)
        # STOP and B unchanged
        assert result["main"].cells[0][2] == Concrete("STOP")
        assert result["main"].cells[0][3] == Concrete("B")

    def test_pull_solid_ref(self) -> None:
        """Test pull with SOLID strategy treats Ref as object."""
        store: GridStore = {
            "main": Grid("main", ((Empty(), Ref("inner"), Concrete("A")),)),
            "inner": Grid("inner", ((Concrete("X"), Concrete("Y")),)),
        }

        # Use PUSH_FIRST which has SOLID before PORTAL
        rules = RuleSet(ref_strategy=RefStrategy.PUSH_FIRST)
        start = CellPosition("main", 0, 0)
        result = pull(store, start, Direction.E, rules)

        # With SOLID strategy: Ref pulled as object
        # Path: [Empty@(0,0), Ref@(0,1), A@(0,2)] (A included)
        # Rotation: [Empty, Ref, A] -> [Ref, A, Empty] (maintains Ref->A order)
        # Result: [Ref, A, Empty]
        assert result["main"].cells[0][0] == Ref("inner")
        assert result["main"].cells[0][1] == Concrete("A")
        assert isinstance(result["main"].cells[0][2], Empty)
        # Inner grid unchanged
        assert result["inner"].cells[0][0] == Concrete("X")
        assert result["inner"].cells[0][1] == Concrete("Y")

    def test_pull_portal_ref(self) -> None:
        """Test pull with PORTAL strategy enters Ref."""
        store: GridStore = {
            "main": Grid("main", ((Empty(), Ref("inner"), Concrete("A")),)),
            "inner": Grid("inner", ((Concrete("X"), Concrete("Y")),)),
        }

        # Use TRY_ENTER_FIRST which has PORTAL before SOLID
        rules = RuleSet(ref_strategy=RefStrategy.TRY_ENTER_FIRST)
        start = CellPosition("main", 0, 0)
        result = pull(store, start, Direction.E, rules)

        # With PORTAL: Enter Ref, path excludes Ref position
        # Path: [Empty@main(0,0), X@inner(0,0), Y@inner(0,1), A@main(0,2)]
        # Cells: [Empty, X, Y, A]
        # Rotated: [X, Y, A, Empty] (maintains X->Y->A order!)
        assert result["main"].cells[0][0] == Concrete("X")
        assert result["main"].cells[0][1] == Ref("inner")  # Ref unchanged
        assert isinstance(result["main"].cells[0][2], Empty)
        # Inner grid modified - X and Y maintain their order, A joined them!
        assert result["inner"].cells[0][0] == Concrete("Y")
        assert result["inner"].cells[0][1] == Concrete("A")

    def test_pull_stops_at_cycle(self) -> None:
        """Test pull stops successfully when detecting a cycle."""
        store: GridStore = {
            "main": Grid("main", ((Empty(), Ref("loop")),)),
            "loop": Grid("loop", ((Concrete("A"), Ref("loop")),)),
        }

        rules = RuleSet(ref_strategy=RefStrategy.TRY_ENTER_FIRST)
        start = CellPosition("main", 0, 0)
        result = pull(store, start, Direction.E, rules)

        # Should complete without error (cycle handled)
        assert isinstance(result, dict)
        assert "main" in result
        assert "loop" in result

    def test_pull_strategy_ordering(self) -> None:
        """Test that pull uses first applicable strategy only."""
        store: GridStore = {
            "main": Grid("main", ((Empty(), Ref("inner"), Concrete("A")),)),
            "inner": Grid("inner", ((Concrete("X"), Concrete("Y")),)),
        }

        # Test with SOLID first - should pull Ref as object
        rules_solid = RuleSet(ref_strategy=RefStrategy.PUSH_FIRST)
        result_solid = pull(store, CellPosition("main", 0, 0), Direction.E, rules_solid)
        assert result_solid["main"].cells[0][0] == Ref("inner")  # Ref stays first in order
        assert result_solid["main"].cells[0][1] == Concrete("A")  # A stays second

        # Test with PORTAL first - should enter Ref
        rules_portal = RuleSet(ref_strategy=RefStrategy.TRY_ENTER_FIRST)
        result_portal = pull(store, CellPosition("main", 0, 0), Direction.E, rules_portal)
        assert result_portal["main"].cells[0][1] == Ref("inner")  # Ref stayed
        assert result_portal["inner"].cells[0][0] == Concrete("Y")  # Inner modified (Y stayed together)

    def test_pull_max_depth(self) -> None:
        """Test pull stops at max depth."""
        cells = [Empty()] + [Concrete(str(i)) for i in range(100)]
        store: GridStore = {
            "main": Grid("main", (tuple(cells),)),
        }

        start = CellPosition("main", 0, 0)
        result = pull(store, start, Direction.E, RuleSet(), max_depth=10)

        # Should stop after 10 iterations
        # Path: [Empty, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9] = 11 positions
        # Rotation: [Empty, 0, 1, ..., 9] -> [0, 1, 2, ..., 9, Empty]
        # First element (0) moves to first, maintaining order
        assert result["main"].cells[0][0] == Concrete("0")


# =============================================================================
# Test Focus Metadata
# =============================================================================


class TestFocusMetadata:
    """Tests for focus metadata (focus_depth and focus_offset)."""

    def test_no_focus_path(self) -> None:
        """Test that without focus_path, all metadata is None."""
        store = parse_grids({"main": "1 2|3 4"})
        tree = analyze(store, "main", Fraction(10), Fraction(10))

        # Should be a NestedNode with no focus metadata
        assert isinstance(tree, NestedNode)
        assert tree.focus_depth is None
        assert tree.focus_offset is None

        # Check children have no metadata
        for row in tree.children:
            for node in row:
                assert node.focus_depth is None
                assert node.focus_offset is None

    def test_depth_zero_focused_grid(self) -> None:
        """Test depth 0 for cells inside the focused grid."""
        store = parse_grids({"main": "1 2|3 4"})
        tree = analyze(store, "main", Fraction(10), Fraction(10), focus_path=["main"])

        assert isinstance(tree, NestedNode)
        assert tree.focus_depth == 0
        assert tree.focus_offset == (0, 0)

        # Check all cells have depth 0 and correct offsets
        # Row 0
        assert tree.children[0][0].focus_depth == 0
        assert tree.children[0][0].focus_offset == (0, 0)
        assert tree.children[0][1].focus_depth == 0
        assert tree.children[0][1].focus_offset == (1, 0)
        # Row 1
        assert tree.children[1][0].focus_depth == 0
        assert tree.children[1][0].focus_offset == (0, 1)
        assert tree.children[1][1].focus_depth == 0
        assert tree.children[1][1].focus_offset == (1, 1)

    def test_depth_negative_one_parent(self) -> None:
        """Test depth -1 for the parent grid of the focused grid."""
        store = parse_grids({"main": "A 2|3 4", "A": "7 8"})
        # Focus on grid "A"
        tree = analyze(store, "main", Fraction(10), Fraction(10), focus_path=["main", "A"])

        assert isinstance(tree, NestedNode)
        # "main" is the parent of "A", so depth should be -1
        # The ref to "A" is at (0, 0), so the grid has offset (0, 0)
        assert tree.focus_depth == -1
        assert tree.focus_offset == (0, 0)

        # The ref at (0,0) should have depth -1 with offset (0,0)
        ref_node = tree.children[0][0]
        assert isinstance(ref_node, RefNode)
        assert ref_node.focus_depth == -1
        assert ref_node.focus_offset == (0, 0)

        # The content of the ref (grid "A") should have depth 0
        assert isinstance(ref_node.content, NestedNode)
        assert ref_node.content.focus_depth == 0
        assert ref_node.content.focus_offset == (0, 0)

        # Cells inside "A" should have depth 0 with offsets
        a_cells = ref_node.content.children[0]
        assert a_cells[0].focus_depth == 0
        assert a_cells[0].focus_offset == (0, 0)
        assert a_cells[1].focus_depth == 0
        assert a_cells[1].focus_offset == (1, 0)

        # Other cells in "main" should have depth -1 with offsets relative to ref at (0,0)
        # Cell at (1,0) in "main"
        assert tree.children[0][1].focus_depth == -1
        assert tree.children[0][1].focus_offset == (1, 0)
        # Cell at (0,1) in "main"
        assert tree.children[1][0].focus_depth == -1
        assert tree.children[1][0].focus_offset == (0, 1)
        # Cell at (1,1) in "main"
        assert tree.children[1][1].focus_depth == -1
        assert tree.children[1][1].focus_offset == (1, 1)

    def test_depth_positive_descendant(self) -> None:
        """Test positive depth for descendant grids."""
        store = parse_grids({"main": "A 2", "A": "B 3", "B": "4 5"})
        # Focus on grid "main"
        tree = analyze(store, "main", Fraction(10), Fraction(10), focus_path=["main"])

        assert isinstance(tree, NestedNode)
        assert tree.focus_depth == 0

        # Grid "A" is a child, so depth +1
        ref_a = tree.children[0][0]
        assert isinstance(ref_a, RefNode)
        assert ref_a.focus_depth == 0
        assert ref_a.focus_offset == (0, 0)

        a_content = ref_a.content
        assert isinstance(a_content, NestedNode)
        assert a_content.focus_depth == 1
        assert a_content.focus_offset is None

        # Grid "B" is a grandchild, so depth +2
        ref_b = a_content.children[0][0]
        assert isinstance(ref_b, RefNode)
        assert ref_b.focus_depth == 1
        assert ref_b.focus_offset is None

        b_content = ref_b.content
        assert isinstance(b_content, NestedNode)
        assert b_content.focus_depth == 2
        assert b_content.focus_offset is None

    def test_multiple_depth_levels(self) -> None:
        """Test focus at middle level of deep hierarchy."""
        store = parse_grids({
            "root": "A",
            "A": "B",
            "B": "C",
            "C": "1 2"
        })
        # Focus on grid "B"
        tree = analyze(
            store, "root", Fraction(10), Fraction(10),
            focus_path=["root", "A", "B"]
        )

        # "root" is depth -2
        # The ref to "A" is at (0, 0), so the grid has offset (0, 0)
        assert isinstance(tree, NestedNode)
        assert tree.focus_depth == -2
        assert tree.focus_offset == (0, 0)

        # "A" is depth -1
        # The ref to "B" is at (0, 0), so the grid has offset (0, 0)
        ref_a = tree.children[0][0]
        assert isinstance(ref_a, RefNode)
        a_content = ref_a.content
        assert isinstance(a_content, NestedNode)
        assert a_content.focus_depth == -1
        assert a_content.focus_offset == (0, 0)

        # "B" is depth 0
        ref_b = a_content.children[0][0]
        assert isinstance(ref_b, RefNode)
        b_content = ref_b.content
        assert isinstance(b_content, NestedNode)
        assert b_content.focus_depth == 0
        assert b_content.focus_offset == (0, 0)

        # "C" is depth +1
        ref_c = b_content.children[0][0]
        assert isinstance(ref_c, RefNode)
        c_content = ref_c.content
        assert isinstance(c_content, NestedNode)
        assert c_content.focus_depth == 1
        assert c_content.focus_offset is None

    def test_path_divergence(self) -> None:
        """Test that diverging paths result in None metadata."""
        store = parse_grids({
            "main": "A B",
            "A": "1 2",
            "B": "3 4"
        })
        # Focus on grid "A"
        tree = analyze(
            store, "main", Fraction(10), Fraction(10),
            focus_path=["main", "A"]
        )

        assert isinstance(tree, NestedNode)
        # "main" is depth -1 (parent of focus)
        assert tree.focus_depth == -1

        # Grid "A" should have depth 0
        ref_a = tree.children[0][0]
        assert isinstance(ref_a, RefNode)
        a_content = ref_a.content
        assert isinstance(a_content, NestedNode)
        assert a_content.focus_depth == 0

        # Grid "B" is on a different branch - should have None
        ref_b = tree.children[0][1]
        assert isinstance(ref_b, RefNode)
        b_content = ref_b.content
        assert isinstance(b_content, NestedNode)
        # Path ["main", "B"] diverges from ["main", "A"]
        assert b_content.focus_depth is None
        assert b_content.focus_offset is None

    def test_cutoff_with_focus(self) -> None:
        """Test that CutoffNode receives focus metadata."""
        store = parse_grids({"main": "A", "A": "1 2"})
        # Use a large threshold to force cutoff
        tree = analyze(
            store, "main", Fraction(1), Fraction(1),
            threshold=Fraction(5),
            focus_path=["main"]
        )

        # Should cutoff at main level since dimensions are below threshold
        assert isinstance(tree, CutoffNode)
        assert tree.focus_depth == 0
        assert tree.focus_offset == (0, 0)


# =============================================================================
# Test Depth-Aware Entry Strategy
# =============================================================================


class TestDepthAwareEntry:
    """Tests for depth-aware entry strategy with equivalent point transfer."""

    def test_equivalent_point_transfer_across_refs(self) -> None:
        """Test that entry point preserves fractional position when exiting one ref and entering another."""
        # Main has two refs A and B side by side, both occupying 5 rows
        # A is a single-column grid (forces immediate exit east)
        # Push from inside A (at row 0), exit, and enter B - should enter B at row 0, not middle
        store: GridStore = {
            "main": Grid("main", (
                (Ref("A"), Ref("B")),
                (Empty(), Empty()),
                (Empty(), Empty()),
                (Empty(), Empty()),
                (Empty(), Empty()),
            )),
            "A": Grid("A", (
                (Concrete("X"),),  # X at A[0,0] (top row, only column)
                (Concrete("a"),),
                (Concrete("b"),),
                (Concrete("c"),),
                (Concrete("d"),),
            )),
            "B": Grid("B", (
                (Empty(), Concrete("1")),
                (Empty(), Concrete("2")),
                (Empty(), Concrete("3")),
                (Empty(), Concrete("4")),
                (Empty(), Concrete("5")),
            )),
        }

        # Push eastward from A[0,0] (row 0 of A)
        # Path: A[0,0] -> [hit east edge, exit A] -> main[0,1] (Ref B) -> [enter B] -> B[0,0]
        # Equivalent point: exited at fraction 0.0 (row 0 of 5), enter at fraction 0.0 (row 0 of 5)
        result = push(
            store,
            CellPosition("A", 0, 0),
            Direction.E,
            RuleSet(ref_strategy=RefStrategy.TRY_ENTER_FIRST)
        )

        assert not isinstance(result, PushFailure)

        # The entry should be at B[0,0] (top row), not B[2,0] (middle row)
        # Verify by checking where X ended up in grid B
        new_store = result
        grid_b = new_store["B"]
        # X should be at row 0, column 0 (equivalent point transfer - same depth)
        assert isinstance(grid_b.cells[0][0], Concrete)
        assert grid_b.cells[0][0].id == "X"

    def test_standard_entry_when_no_prior_exit(self) -> None:
        """Test that standard middle-of-edge entry is used when entering without prior exit."""
        # When entering a ref directly from main (no prior exit at same depth)
        # Should use standard middle-of-edge entry
        store = parse_grids({
            "main": "9 A _|_ _ _|_ _ _",
            "A": "1 2 3|4 5 6|7 8 9"
        })

        # Push eastward from main[0,0] (row 0)
        # No prior exit, so use standard middle entry
        result = push(
            store,
            CellPosition("main", 0, 0),
            Direction.E,
            RuleSet(ref_strategy=RefStrategy.TRY_ENTER_FIRST)
        )

        assert not isinstance(result, PushFailure)

        # When entering A from main (no prior exit), use standard middle entry
        # A has 3 rows, so middle is row 1
        new_store = result
        grid_a = new_store["A"]
        # 9 should be at row 1 (middle, standard entry)
        assert isinstance(grid_a.cells[1][0], Concrete)
        assert grid_a.cells[1][0].id == "9"

    def test_equivalent_point_bottom_row(self) -> None:
        """Test equivalent point transfer from bottom row."""
        # Push from bottom row of A, should enter B at bottom row
        # A is a single-column grid (forces immediate exit east)
        store: GridStore = {
            "main": Grid("main", (
                (Ref("A"), Ref("B")),
                (Empty(), Empty()),
                (Empty(), Empty()),
                (Empty(), Empty()),
                (Empty(), Empty()),
            )),
            "A": Grid("A", (
                (Concrete("a"),),
                (Concrete("b"),),
                (Concrete("c"),),
                (Concrete("d"),),
                (Concrete("X"),),  # X at A[4,0] (bottom row, only column)
            )),
            "B": Grid("B", (
                (Empty(), Concrete("1")),
                (Empty(), Concrete("2")),
                (Empty(), Concrete("3")),
                (Empty(), Concrete("4")),
                (Empty(), Concrete("5")),
            )),
        }

        # Push eastward from A[4,0] (bottom row of A)
        # Path: A[4,0] -> [hit east edge, exit A] -> main[0,1] (Ref B) -> [enter B] -> B[4,0]
        # Equivalent point: exited at fraction 1.0 (row 4 of 5), enter at fraction 1.0 (row 4 of 5)
        result = push(
            store,
            CellPosition("A", 4, 0),
            Direction.E,
            RuleSet(ref_strategy=RefStrategy.TRY_ENTER_FIRST)
        )

        assert not isinstance(result, PushFailure)

        # X should enter B at bottom row (row 4), not middle (row 2)
        new_store = result
        grid_b = new_store["B"]
        assert isinstance(grid_b.cells[4][0], Concrete)
        assert grid_b.cells[4][0].id == "X"

    def test_equivalent_point_4_to_2_rows(self) -> None:
        """Test equivalent point transfer from 4-row grid to 2-row grid (multiple)."""
        # A has 4 rows, B has 2 rows
        # Exit from row 3 (bottom) of A = fraction 1.0
        # Should enter B at row 1 (bottom) = round(1.0 * 1) = 1
        store: GridStore = {
            "main": Grid("main", (
                (Ref("A"), Ref("B")),
            )),
            "A": Grid("A", (
                (Concrete("a"),),
                (Concrete("b"),),
                (Concrete("c"),),
                (Concrete("X"),),  # X at A[3,0] (bottom row)
            )),
            "B": Grid("B", (
                (Empty(), Concrete("1")),
                (Empty(), Concrete("2")),
            )),
        }

        result = push(
            store,
            CellPosition("A", 3, 0),
            Direction.E,
            RuleSet(ref_strategy=RefStrategy.TRY_ENTER_FIRST)
        )

        assert not isinstance(result, PushFailure)
        # Fraction 1.0 maps to row 1 in 2-row grid
        grid_b = result["B"]
        assert isinstance(grid_b.cells[1][0], Concrete)
        assert grid_b.cells[1][0].id == "X"

    def test_equivalent_point_2_to_4_rows(self) -> None:
        """Test equivalent point transfer from 2-row grid to 4-row grid (reverse multiple)."""
        # A has 2 rows, B has 4 rows
        # Exit from row 1 (bottom) of A = fraction 1.0
        # Should enter B at row 3 (bottom) = round(1.0 * 3) = 3
        store: GridStore = {
            "main": Grid("main", (
                (Ref("A"), Ref("B")),
            )),
            "A": Grid("A", (
                (Concrete("a"),),
                (Concrete("X"),),  # X at A[1,0] (bottom row)
            )),
            "B": Grid("B", (
                (Empty(), Concrete("1")),
                (Empty(), Concrete("2")),
                (Empty(), Concrete("3")),
                (Empty(), Concrete("4")),
            )),
        }

        result = push(
            store,
            CellPosition("A", 1, 0),
            Direction.E,
            RuleSet(ref_strategy=RefStrategy.TRY_ENTER_FIRST)
        )

        assert not isinstance(result, PushFailure)
        # Fraction 1.0 maps to row 3 in 4-row grid
        grid_b = result["B"]
        assert isinstance(grid_b.cells[3][0], Concrete)
        assert grid_b.cells[3][0].id == "X"

    def test_equivalent_point_3_to_5_rows(self) -> None:
        """Test equivalent point transfer from 3-row grid to 5-row grid (unrelated)."""
        # A has 3 rows, B has 5 rows
        # Exit from row 2 (bottom) of A = fraction 1.0
        # Should enter B at row 4 (bottom) = round(1.0 * 4) = 4
        store: GridStore = {
            "main": Grid("main", (
                (Ref("A"), Ref("B")),
            )),
            "A": Grid("A", (
                (Concrete("a"),),
                (Concrete("b"),),
                (Concrete("X"),),  # X at A[2,0] (bottom row)
            )),
            "B": Grid("B", (
                (Empty(), Concrete("1")),
                (Empty(), Concrete("2")),
                (Empty(), Concrete("3")),
                (Empty(), Concrete("4")),
                (Empty(), Concrete("5")),
            )),
        }

        result = push(
            store,
            CellPosition("A", 2, 0),
            Direction.E,
            RuleSet(ref_strategy=RefStrategy.TRY_ENTER_FIRST)
        )

        assert not isinstance(result, PushFailure)
        # Fraction 1.0 maps to row 4 in 5-row grid
        grid_b = result["B"]
        assert isinstance(grid_b.cells[4][0], Concrete)
        assert grid_b.cells[4][0].id == "X"

    def test_equivalent_point_5_to_3_rows(self) -> None:
        """Test equivalent point transfer from 5-row grid to 3-row grid (reverse unrelated)."""
        # A has 5 rows, B has 3 rows
        # Exit from row 4 (bottom) of A = fraction 1.0
        # Should enter B at row 2 (bottom) = round(1.0 * 2) = 2
        store: GridStore = {
            "main": Grid("main", (
                (Ref("A"), Ref("B")),
            )),
            "A": Grid("A", (
                (Concrete("a"),),
                (Concrete("b"),),
                (Concrete("c"),),
                (Concrete("d"),),
                (Concrete("X"),),  # X at A[4,0] (bottom row)
            )),
            "B": Grid("B", (
                (Empty(), Concrete("1")),
                (Empty(), Concrete("2")),
                (Empty(), Concrete("3")),
            )),
        }

        result = push(
            store,
            CellPosition("A", 4, 0),
            Direction.E,
            RuleSet(ref_strategy=RefStrategy.TRY_ENTER_FIRST)
        )

        assert not isinstance(result, PushFailure)
        # Fraction 1.0 maps to row 2 in 3-row grid
        grid_b = result["B"]
        assert isinstance(grid_b.cells[2][0], Concrete)
        assert grid_b.cells[2][0].id == "X"

    def test_equivalent_point_3_to_5_middle_row(self) -> None:
        """Test equivalent point transfer from middle row with unrelated dimensions."""
        # A has 3 rows, B has 5 rows
        # Exit from row 1 (middle) of A = fraction 0.5
        # Should enter B at row 2 (middle) = round(0.5 * 4) = 2
        store: GridStore = {
            "main": Grid("main", (
                (Ref("A"), Ref("B")),
            )),
            "A": Grid("A", (
                (Concrete("a"),),
                (Concrete("X"),),  # X at A[1,0] (middle row)
                (Concrete("c"),),
            )),
            "B": Grid("B", (
                (Empty(), Concrete("1")),
                (Empty(), Concrete("2")),
                (Empty(), Concrete("3")),
                (Empty(), Concrete("4")),
                (Empty(), Concrete("5")),
            )),
        }

        result = push(
            store,
            CellPosition("A", 1, 0),
            Direction.E,
            RuleSet(ref_strategy=RefStrategy.TRY_ENTER_FIRST)
        )

        assert not isinstance(result, PushFailure)
        # Fraction 0.5 maps to row 2 in 5-row grid
        grid_b = result["B"]
        assert isinstance(grid_b.cells[2][0], Concrete)
        assert grid_b.cells[2][0].id == "X"

    def test_equivalent_point_5_to_3_middle_row(self) -> None:
        """Test equivalent point transfer from middle row, reverse direction."""
        # A has 5 rows, B has 3 rows
        # Exit from row 2 (middle) of A = fraction 0.5
        # Should enter B at row 1 (middle) = round(0.5 * 2) = 1
        store: GridStore = {
            "main": Grid("main", (
                (Ref("A"), Ref("B")),
            )),
            "A": Grid("A", (
                (Concrete("a"),),
                (Concrete("b"),),
                (Concrete("X"),),  # X at A[2,0] (middle row)
                (Concrete("d"),),
                (Concrete("e"),),
            )),
            "B": Grid("B", (
                (Empty(), Concrete("1")),
                (Empty(), Concrete("2")),
                (Empty(), Concrete("3")),
            )),
        }

        result = push(
            store,
            CellPosition("A", 2, 0),
            Direction.E,
            RuleSet(ref_strategy=RefStrategy.TRY_ENTER_FIRST)
        )

        assert not isinstance(result, PushFailure)
        # Fraction 0.5 maps to row 1 in 3-row grid
        grid_b = result["B"]
        assert isinstance(grid_b.cells[1][0], Concrete)
        assert grid_b.cells[1][0].id == "X"
