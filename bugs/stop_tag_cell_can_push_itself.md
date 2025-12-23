# Bug Report

## Description (User Report)
When a cell is tagged with 'stop', it can still initiate a push operation and move itself, even though stop-tagged cells should be completely immovable.

Reproduction case:
- Grid definition: `dict(main = 'inner 9|main _', inner = '9')`
- TagFn: cells containing '9' have tag 'stop'
- Action: Push east from (0, 1) [the '9' cell]
- Expected: Push should fail because stop-tagged cells cannot move
- Actual: The push succeeds and the '9' cell moves


## Date Found
2025-12-23


## Accompanying Info
Minimal reproduction:
```python
grids = dict(
    main = 'inner 9|main _',
    inner = '9'
)

tag_fn = lambda cell_content: ['stop'] if '9' in cell_content else []

# Push east from (0, 1) - incorrectly allows the stop-tagged '9' to move
```


## Explanation
The push algorithm checks stop tags when encountering cells along the traversal path, but it does not check if the **starting cell** (the cell initiating the push) has a stop tag. This means a stop-tagged cell can push itself.

The stop tag semantics should be: a cell with a stop tag is **immovable** and cannot participate in any push operation, whether as:
1. A cell being pushed by another cell (currently works correctly)
2. A cell initiating a push itself (BUG - currently allows movement)

The bug occurs in both `push_traverse_simple` and `push_traverse_backtracking` functions. Before beginning the traversal, these functions should check if the starting cell has a stop tag and immediately return failure if so.


## Tests Created
Test added: `test_stop_tagged_cell_cannot_push_itself` in `python/test_paragrid.py::TestTagging`

The test reproduces the bug and currently fails with:
```
AssertionError: Push should fail when initiating from a stop-tagged cell
```

The test verifies that when initiating a push from a stop-tagged cell, the push should fail immediately. Currently the push succeeds, which is incorrect.


## Resolution
Fixed by adding stop tag check at the beginning of both `push_traverse_simple` and `push_traverse_backtracking` functions. Before beginning traversal, both functions now check if the starting cell has a stop tag and immediately return failure (empty path with STOP_TAG termination reason) if so.

The fix ensures that stop-tagged cells are completely immovable, preventing them from:
1. Being pushed by other cells (already worked correctly)
2. Initiating a push themselves (now fixed)

Changes made:
- `push_traverse_simple` (python/paragrid.py:1008-1012): Added stop tag check after getting start_cell
- `push_traverse_backtracking` (python/paragrid.py:1222-1226): Added stop tag check after getting start_cell


## Resolution Date
2025-12-23


## Resolution Commit Hash
cbe0adc6f947f4d9d0e23e857e87f2b986a07f6e
