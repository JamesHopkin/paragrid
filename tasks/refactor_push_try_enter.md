# Task

## Description (User Request)
Refactor `push` to use an internal `try_enter` function that takes a rule set parameter instead of accepting `try_enter` as an argument.

## Date Created
2025-12-23

## Requirements
1. Remove `try_enter` as a parameter from `push()`, `push_simple()`, and `push_traverse()` functions
2. Create a new `try_enter()` function in the main logic that:
   - Takes a `RuleSet` parameter
   - Returns `Optional[CellPosition]` (same as current callback signature)
   - Has signature: `try_enter(store: GridStore, grid_id: str, direction: Direction, rules: RuleSet) -> Optional[CellPosition]`
3. Initially, the `rules` parameter will be **unused** - only implement the standard enter-at-middle-of-edge behavior:
   - East (from left): `(rows // 2, 0)` — middle of left edge
   - West (from right): `(rows // 2, cols - 1)` — middle of right edge
   - South (from top): `(0, cols // 2)` — middle of top edge
   - North (from bottom): `(rows - 1, cols // 2)` — middle of bottom edge
4. Update all call sites to remove the `try_enter` argument
5. Maintain all existing push behavior and semantics
6. Update tests to work with the new signature

## Design Notes

**Current state**: `push()` accepts a `try_enter` callback parameter:
```python
def push(
    store: GridStore,
    start: CellPosition,
    direction: Direction,
    try_enter: TryEnter,  # ← Remove this
    rules: RuleSet,
    max_depth: int = 1000,
) -> GridStore | None
```

**Target state**: `push()` uses an internal `try_enter` function:
```python
def push(
    store: GridStore,
    start: CellPosition,
    direction: Direction,
    rules: RuleSet,
    max_depth: int = 1000,
) -> GridStore | None
```

**New internal function**:
```python
def try_enter(
    store: GridStore,
    grid_id: str,
    direction: Direction,
    rules: RuleSet
) -> CellPosition | None:
    """
    Determine entry point when entering a grid via a Ref.

    Returns the CellPosition to enter at, or None to deny entry.
    Currently implements only standard middle-of-edge entry.
    Future: rules parameter will control entry point selection.
    """
    # Get grid from store
    # Calculate middle-of-edge entry point based on direction
    # Return CellPosition(grid_id, row, col)
```

**Rationale**:
- Prepares for future rule-based entry point selection
- Simplifies the API - users don't need to provide their own `try_enter`
- Entry logic becomes an internal implementation detail
- The `RuleSet` parameter positions us for future extensibility without breaking changes

**Migration path**:
- Tests currently create custom `try_enter` callbacks for testing different scenarios (entry allowed, entry denied, etc.)
- These can be replaced with a test-specific `try_enter` that checks against a configuration or uses a mock/patch approach
- Alternatively, add a test-only parameter or use dependency injection for testing

## Python Implementation
<!-- Status and details of Python implementation -->
<!-- Location of code: file paths and line numbers -->
<!-- Tests created: test names and locations -->


## TypeScript Port
<!-- Status and details of TypeScript port -->
<!-- Location of code: file paths and line numbers -->
<!-- Tests created: test names and locations -->


## Verification
<!-- How to verify both implementations match -->
<!-- Test results, manual testing notes, etc. -->


## Completion Date
<!-- YYYY-MM-DD or leave empty if incomplete -->

## Completion Commit Hash
<!-- Git commit hash where the task was completed -->
