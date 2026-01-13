"""
Rotational tests for push operations.

Each test is automatically run in all 4 cardinal directions (N/S/E/W) by rotating
the grid definitions, start positions, and expected outputs.

## Usage

Define a test case with:
1. Grid definitions (dict of grid_id -> grid_string)
2. Variations (list of start position + direction + expected output)
3. The framework automatically generates 4 rotations (0°, 90°, 180°, 270°)

## Cell Naming Conventions

- **Concrete cells**: Must start with a digit (e.g., "1", "2abc", "7x")
- **Ref cells**: All uppercase, 2+ characters (e.g., "INNER", "PORTAL", "LOCKED")
- **Empty cells**: Use "_" in grid strings, checked as "_" in expectations

## Example

```python
test = RotationalTestCase(
    name="push_simple",
    grids={"main": "1 2 _"},  # Concrete cells: 1, 2; Empty: _
    variations=[
        TestVariation(
            start_grid="main",
            start_row=0,
            start_col=0,
            direction=Direction.E,
            expected=[
                ("main", 0, 0, "_"),   # After push: Empty moved here
                ("main", 0, 1, "1"),   # 1 shifted right
                ("main", 0, 2, "2"),   # 2 shifted right
            ],
            description="push east"
        )
    ]
)
run_rotational_test(test, [push])
```

This single test definition generates 4 test cases testing all directions!
"""

import pytest

from paragrid import Direction, RuleSet, push, push_simple
from test_rotations import (
    ExpectedFailure,
    RotationalTestCase,
    TestVariation,
    run_rotational_test,
)


class TestPushRotational:
    """Rotational tests for push operation."""

    def test_push_simple_to_empty(self) -> None:
        """Test basic push of 2 cells ending at Empty - all 4 directions."""
        test = RotationalTestCase(
            name="push_simple_to_empty",
            grids={"main": "1 2 _"},
            variations=[
                TestVariation(
                    start_grid="main",
                    start_row=0,
                    start_col=0,
                    direction=Direction.E,
                    expected=[
                        ("main", 0, 0, "_"),
                        ("main", 0, 1, "1"),
                        ("main", 0, 2, "2"),
                    ],
                    description="push 1,2 east into empty"
                )
            ]
        )

        run_rotational_test(test, [push, push_simple])

    def test_push_three_cells(self) -> None:
        """Test pushing 3 cells ending at Empty - all 4 directions."""
        test = RotationalTestCase(
            name="push_three_cells",
            grids={"main": "1 2 3 _"},
            variations=[
                TestVariation(
                    start_grid="main",
                    start_row=0,
                    start_col=0,
                    direction=Direction.E,
                    expected=[
                        ("main", 0, 0, "_"),
                        ("main", 0, 1, "1"),
                        ("main", 0, 2, "2"),
                        ("main", 0, 3, "3"),
                    ],
                    description="push 1,2,3 east"
                )
            ]
        )

        run_rotational_test(test, [push, push_simple])

    def test_push_stops_at_midway_empty(self) -> None:
        """Test that push stops at Empty and doesn't continue past it."""
        test = RotationalTestCase(
            name="push_stops_at_empty",
            grids={"main": "1 2 _ 3 4"},
            variations=[
                TestVariation(
                    start_grid="main",
                    start_row=0,
                    start_col=0,
                    direction=Direction.E,
                    expected=[
                        ("main", 0, 0, "_"),
                        ("main", 0, 1, "1"),
                        ("main", 0, 2, "2"),
                        ("main", 0, 3, "3"),  # Unchanged
                        ("main", 0, 4, "4"),  # Unchanged
                    ],
                    description="push stops at empty"
                )
            ]
        )

        run_rotational_test(test, [push, push_simple])

    def test_push_2x2_grid_vertical(self) -> None:
        """Test pushing in a 2x2 grid (tests row-wise movement)."""
        test = RotationalTestCase(
            name="push_2x2_vertical",
            grids={"main": "1 2|_ 4"},
            variations=[
                TestVariation(
                    start_grid="main",
                    start_row=0,
                    start_col=0,
                    direction=Direction.S,
                    expected=[
                        ("main", 0, 0, "_"),
                        ("main", 1, 0, "1"),
                        ("main", 0, 1, "2"),  # Unchanged
                        ("main", 1, 1, "4"),  # Unchanged
                    ],
                    description="push 1 south into empty"
                )
            ]
        )

        run_rotational_test(test, [push, push_simple])

    def test_push_ref_as_solid(self) -> None:
        """Test push where Ref acts as solid object (SOLID strategy)."""
        test = RotationalTestCase(
            name="push_ref_solid",
            grids={
                "main": "1 INNER _",
                "INNER": "7x 8y"
            },
            variations=[
                TestVariation(
                    start_grid="main",
                    start_row=0,
                    start_col=0,
                    direction=Direction.E,
                    expected=[
                        ("main", 0, 0, "_"),
                        ("main", 0, 1, "1"),
                        ("main", 0, 2, "INNER"),   # Ref treated as solid, moved
                        ("INNER", 0, 0, "7x"),     # INNER grid unchanged
                        ("INNER", 0, 1, "8y"),
                    ],
                    description="push ref as solid"
                )
            ]
        )

        run_rotational_test(test, [push, push_simple])

    def test_push_swallow_into_ref(self) -> None:
        """Test push with swallow behavior (Ref swallows trailing cell)."""
        test = RotationalTestCase(
            name="push_swallow",
            grids={
                "main": "1 INNER 3",
                "INNER": "7x _"
            },
            variations=[
                TestVariation(
                    start_grid="main",
                    start_row=0,
                    start_col=0,
                    direction=Direction.E,
                    expected=[
                        ("main", 0, 0, "_"),
                        ("main", 0, 1, "1"),
                        ("main", 0, 2, "INNER"),
                        ("INNER", 0, 0, "7x"),
                        ("INNER", 0, 1, "3"),      # 3 swallowed into INNER
                    ],
                    description="push with swallow"
                )
            ]
        )

        run_rotational_test(test, [push, push_simple])

    # below: specifially added to fill coverage gaps

    def test_push_with_entry_cycle(self) -> None:
        '''may make the test name more generic and cover more with variations'''

        test = RotationalTestCase(
            name="push_entry_cycle",
            grids={"main": "1 *a", "a": "~a"},
            variations=[
                TestVariation(
                    start_grid="main",
                    start_row=0,
                    start_col=0,
                    direction=Direction.E,
                    expected=ExpectedFailure("PATH_CYCLE"),
                    description="push fails on entry cycle"
                )
            ]
        )

        run_rotational_test(test, [push, push_simple])

    def test_push_with_valid_cycle(self) -> None:
        '''may make the test name more generic and cover more with variations'''

        test = RotationalTestCase(
            name="push_entry_cycle",
            grids={"main": "*main 1 2"},
            variations=[
                TestVariation(
                    start_grid="main",
                    start_row=0,
                    start_col=1,
                    direction=Direction.E,
                    expected=[("main", 0, 1, "2")],
                    description="valid cycle"
                )
            ]
        )

        run_rotational_test(test, [push, push_simple])

    def test_nowhere_to_go(self) -> None:
        '''may make the test name more generic and cover more with variations'''

        test = RotationalTestCase(
            name="push_entry_cycle",
            grids={"main": "_ 1 2"},
            variations=[
                TestVariation(start_grid="main", start_row=0, start_col=2, direction=Direction.E, expected=ExpectedFailure("BLOCKED"), description="edge of grid"),
                TestVariation(start_grid="main", start_row=0, start_col=1, direction=Direction.E, expected=ExpectedFailure("NO_STRATEGY"), description="push stuck block"),
            ]
        )

        run_rotational_test(test, [push, push_simple])

    def test_exit_enter(self) -> None:
        test = RotationalTestCase(
            name="exit_enter",
            grids = 'm:AB\na:1\nb:_',
            variations=[TestVariation(start_grid="a", expected=[("b", 0, 0, "1")])]
        )

        run_rotational_test(test, [push, push_simple])

class TestPushRotationalMultiVariation:
    """Tests with multiple variations per rotational case."""

    def test_push_from_different_starts(self) -> None:
        """Test pushing from different starting positions in same grid."""
        test = RotationalTestCase(
            name="push_different_starts",
            grids={"main": "1 2 _ 4"},
            variations=[
                TestVariation(
                    start_grid="main",
                    start_row=0,
                    start_col=0,
                    direction=Direction.E,
                    expected=[
                        ("main", 0, 0, "_"),
                        ("main", 0, 1, "1"),
                        ("main", 0, 2, "2"),
                        ("main", 0, 3, "4"),
                    ],
                    description="push from position 0"
                ),
                TestVariation(
                    start_grid="main",
                    start_row=0,
                    start_col=1,
                    direction=Direction.E,
                    expected=[
                        ("main", 0, 0, "1"),
                        ("main", 0, 1, "_"),
                        ("main", 0, 2, "2"),
                        ("main", 0, 3, "4"),
                    ],
                    description="push from position 1"
                ),
            ]
        )

        run_rotational_test(test, [push, push_simple])


if __name__ == "__main__":
    # Run the tests
    pytest.main([__file__, "-v"])
