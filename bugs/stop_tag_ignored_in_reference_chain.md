# Bug Report

## Description (User Report)
When pushing east from (0, 0) in a grid with a reference chain, cells marked with the 'stop' tag are being moved even though they should block movement.

Reproduction case:
- Grid definition: `dict(main = 'main inner', inner = '9 _')`
- TagFn: cells containing '9' have tag 'stop'
- Action: Push east from (0, 0)
- Expected: Push should fail or stop at the '9' cell
- Actual: The '9' cell is moved despite having the 'stop' tag


## Date Found
2025-12-23


## Accompanying Info
Minimal reproduction:
```python
grids = dict(
    main = 'main inner',
    inner = '9 _'
)

tag_fn = lambda cell_content: ['stop'] if '9' in cell_content else []

# Push east from (0, 0) - incorrectly moves the '9'
```


## Explanation
Tags are not being correctly evaluated when following a reference chain during push operations. The bug occurs in both `push_traverse_simple` and `push_traverse_backtracking` functions.

When the push algorithm enters a Ref cell and follows the enter chain to reach a final destination cell, the stop tag check only happens on the Ref cell itself (before entering), not on the destination cell after following the chain. This means cells with stop tags inside referenced grids are incorrectly pushed.


## Tests Created
Test added: `test_stop_tag_in_referenced_grid_during_push` in `python/test_paragrid.py::TestTagging`

The test reproduces the bug and currently fails with:
```
AssertionError: Push should fail when encountering stop-tagged cell in reference chain
```

The test verifies that when pushing through a Ref into a referenced grid, cells with 'stop' tag inside that referenced grid should prevent the push. Currently the push succeeds when it should fail.


## Resolution
Fixed by adding stop tag checks after following the enter chain in both push traversal functions:

**In `push_traverse_simple` (paragrid.py:1057-1061):**
- Added tag check on `final_cell` after following the enter chain
- Returns `STOP_TAG` termination reason if stop tag found

**In `push_traverse_backtracking` (paragrid.py:1318-1333):**
- Added tag check on `final_cell` after following the enter chain
- Attempts to backtrack if stop tag found (treating Ref as solid)
- Returns `STOP_TAG` if backtracking exhausted

This ensures stop tags are respected on cells reached through reference chains, not just on the Ref cells themselves.


## Resolution Date
2025-12-23


## Resolution Commit Hash
809921da28064acf58f30d7562a99a77cbd398f9

