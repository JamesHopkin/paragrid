# Test Analysis: Failing traverse() Tests

After removing `traverse()` and related functions, 26 tests fail. This document analyzes each test and categorizes them.

## Summary

- **REIMPLEMENT**: 3 tests worth reimplementing for push semantics
- **REDUNDANT**: 23 tests that are traverse-specific or no longer relevant

## Tests to REIMPLEMENT for push()

These tests verify important behaviors that push() should also handle. They need to be rewritten using push() and should test for proper failure reasons.

### 1. TestTraverse::test_traverse_enter_chain_cycle
**Original behavior**: Detects cycles when entering nested Refs (a→b→a)

**Push equivalent**: When pushing encounters a Ref and chooses "enter" strategy, if the entry point lands on another Ref that would create a cycle, push should fail with `ENTER_CYCLE` reason.

**Test scenario**:
```
main: [1, Ref(a)]
a: [Ref(b)]
b: [Ref(a)]
```
Push from `1` eastward with `PORTAL` strategy → should fail with `ENTER_CYCLE`

**New failure reason needed**: `ENTER_CYCLE` or `ENTRY_CYCLE_DETECTED`

---

### 2. TestTraverse::test_traverse_exit_chain_cycle
**Original behavior**: Detects cycles when exiting through parent grids

**Push equivalent**: When Navigator.try_advance() exits a grid and the exit position lands on a Ref that would create an exit cycle, push should fail.

**Test scenario**:
```
inner: [1, _]
loop1: [Ref(loop2)]
loop2: [Ref(loop1)]
main: [Ref(inner), Ref(loop1)]
```
Push from inner, exiting would cycle through loop1↔loop2

**New failure reason needed**: `EXIT_CYCLE` or `EXIT_CYCLE_DETECTED`

**Implementation note**: This should be detected in `Navigator.try_advance()` when handling cascading exits.

---

### 3. TestTerminationReasons::test_termination_edge_reached
**Original behavior**: traverse() returns `EDGE_REACHED` when hitting root grid edge

**Push equivalent**: push() should fail when it can't advance (hits root edge) and hasn't found an Empty cell.

**Test scenario**:
```
main: [1, 2]
```
Push from `1` eastward → can't push `2` anywhere, fails

**New failure reason needed**: `BLOCKED` or `EDGE_REACHED`

---

## Tests that are REDUNDANT

These tests are specific to `traverse()` semantics and don't apply to `push()`.

### TestTraverse (8 redundant tests)

1. **test_traverse_simple_east** - Basic movement east. Not relevant to push.
2. **test_traverse_simple_south** - Basic movement south. Not relevant to push.
3. **test_traverse_stops_at_edge** - Edge detection. Not a push concern.
4. **test_traverse_with_auto_enter** - Tests `auto_enter` flag. Push doesn't have this concept.
5. **test_traverse_without_auto_exit** - Tests `auto_exit` flag. Push doesn't have this concept.
6. **test_traverse_exit_chain_simple** - Tests automatic Ref chain following on exit. Push doesn't follow chains automatically.
7. **test_traverse_mixed_enter_exit_chains** - Tests mixed chain behavior. Not relevant to push.
8. **test_traverse_enter_chain_fast_path** - Performance optimization test. Not relevant.

**Note**: `test_traverse_enter_chain_simple` might seem important, but it's actually testing that traverse() *automatically follows* Ref chains. Push should NOT do this - it should create decision points at each Ref. So this is also redundant.

---

### TestTerminationReasons (3 redundant tests)

1. **test_termination_cycle_detected_enter** - Duplicate of TestTraverse::test_traverse_enter_chain_cycle (already marked for reimplement)
2. **test_termination_cycle_detected_exit** - Duplicate of TestTraverse::test_traverse_exit_chain_cycle (already marked for reimplement)
3. **test_termination_entry_denied_auto_enter** - Tests entry denial with auto_enter. Push doesn't have "entry denied" - strategies just fail.
4. **test_termination_entry_denied_manual_enter** - Tests entry denial without auto_enter. Not relevant.
5. **test_termination_max_depth_reached** - Tests max_depth limit. Push has this but it's already tested indirectly.

**Note**: Items 1-2 duplicate the TestTraverse cycle tests, so we only need to reimplement once (covered above).

---

### TestTagging (7 redundant tests)

These tests verify stop tag behavior in traverse(). The two push-based tagging tests already PASS.

1. **test_stop_tag_terminates_traversal** - traverse() stops at stop-tagged cells
2. **test_no_tag_fn_continues_normally** - traverse() works without tag_fn
3. **test_empty_tags_continues_traversal** - traverse() ignores empty tag sets
4. **test_non_stop_tags_ignored** - traverse() ignores non-stop tags
5. **test_stop_tag_on_ref_cell** - traverse() respects stop tags on Refs
6. **test_stop_tag_on_empty_cell** - traverse() respects stop tags on Empty
7. **test_stop_tag_with_multiple_tags** - traverse() respects stop when multiple tags present

**Already passing** (keep these):
- test_stop_tag_in_referenced_grid_during_push ✓
- test_stop_tagged_cell_cannot_push_itself ✓

---

### TestEdgeCases (1 redundant test)

**test_traverse_all_directions** - Tests traverse() in N/S/E/W. Basic movement test, not relevant to push.

---

### TestIntegration (1 redundant test)

**test_analyze_and_traverse** - Integration test for analyze() + traverse(). The traverse() part is redundant. The existing `test_complete_workflow` already tests analyze() + render().

---

## Required Changes to push()

To support the tests we want to reimplement, push() needs to return failure reasons:

### New return type
```python
@dataclass
class PushFailure:
    """Information about why a push failed."""
    reason: str  # "ENTER_CYCLE" | "EXIT_CYCLE" | "BLOCKED" | "STOP_TAG"
    position: CellPosition  # Where the failure occurred
    details: str | None = None  # Optional human-readable details

def push(...) -> GridStore | PushFailure:
    """Returns new store on success, PushFailure on failure."""
    ...
```

### Failure reasons needed:

1. **ENTER_CYCLE**: Detected cycle when trying to enter nested Refs
   - Implement in: `Navigator.try_enter()` with visited set

2. **EXIT_CYCLE**: Detected cycle when exiting through parent grids
   - Implement in: `Navigator.try_advance()` during cascading exits

3. **BLOCKED**: Can't advance to next position (hit root edge or similar)
   - Already implicitly detected when all strategies fail

4. **STOP_TAG**: Encountered stop-tagged cell (already partially supported)
   - Already checked in `make_new_state()`

---

## Recommended Actions

1. **Remove** all 23 redundant tests from test_paragrid.py
2. **Reimplement** the 3 important tests using push() semantics
3. **Add** PushFailure return type to push()
4. **Add** cycle detection to Navigator:
   - Enter cycle detection in `try_enter()`
   - Exit cycle detection in `try_advance()`
5. **Update** existing push tests to check for failure reasons where appropriate
