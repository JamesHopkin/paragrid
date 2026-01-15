# Early Outs on Optional Arguments - Analysis and Plan

## Overview
This document analyzes defensive early returns based on optional parameters that are affecting coverage statistics.

## Cases Identified

### 1. Line 782: Grid Not in Store (try_enter)
```python
if grid_id not in store:
    return None
```

**Context**: `try_enter()` checks if target grid exists before entering
**Optional Parameter**: None directly, but handles potentially invalid Refs
**Analysis**: This is defensive - if a Ref points to non-existent grid, that's likely a data error
**Decision**: **ADD TEST** - this is a legitimate error case (malformed GridStore)
**Rationale**: Better to test error handling than assert, as user data could be malformed

---

### 2. Lines 329-330: Focus Path None Checks (analyze)
```python
def find_focus_ref_position() -> tuple[int, int] | None:
    if focus_path is None or current_path is None:
        return None
```

**Context**: Helper inside `analyze()` for computing focus metadata
**Optional Parameters**: `focus_path` and `current_path` (both optional in analyze)
**Analysis**: Defensive - the parent function `compute_focus_metadata` already checks `focus_path is None`
**Decision**: **CONVERT TO ASSERT** - these should never be None when this helper is called
**Rationale**: The helper is only called from line 361 which is inside a branch where focus_path was already validated

---

### 3. Line 855: Unknown Direction (try_enter)
```python
else:
    # Unknown direction
    return None
```

**Context**: Falls through after checking N/S/E/W directions
**Optional Parameter**: None, but defensive against invalid Direction enum
**Analysis**: Unreachable - Direction enum only has 4 values, all checked
**Decision**: **CONVERT TO ASSERT** - this should never execute
**Rationale**: Type system guarantees Direction is one of 4 values; exhaustive match should be clear

---

### 4. Lines 400-401, 404: Explicit is_primary Values (analyze)
```python
if explicit_primary is True:
    # Explicitly marked as primary
    is_primary = True
    primary_refs.add(ref_id)
elif explicit_primary is False:
    # Explicitly marked as non-primary
    is_primary = False
```

**Context**: `analyze()` handling explicit `Ref(grid_id, is_primary=True/False)`
**Optional Parameter**: `Ref.is_primary` defaults to `None` (auto-determine)
**Analysis**: Legitimate feature - allows explicit primary/secondary marking
**Decision**: **ADD TESTS** - these are valid code paths we should exercise
**Rationale**: This is an intentional feature, not defensive code

---

### 5. Line 898: Strategy Unknown Default (push)
```python
def strategy_to_str(strat: RefStrategyType) -> str:
    if strat == RefStrategyType.PORTAL:
        return "enter"
    elif strat == RefStrategyType.SOLID:
        return "solid"
    elif strat == RefStrategyType.SWALLOW:
        return "swallow"
    return "solid"  # Line 898
```

**Context**: Helper converting RefStrategyType to string
**Optional Parameter**: None, but defensive default
**Analysis**: Unreachable - RefStrategyType enum only has 3 values, all checked
**Decision**: **CONVERT TO ASSERT** - or use exhaustive match pattern
**Rationale**: Type system guarantees this is exhaustive

---

## Summary Table

| Line(s) | Location | Decision | Priority | Effort |
|---------|----------|----------|----------|--------|
| 782 | try_enter: grid not in store | Add test | Medium | Low |
| 329-330 | analyze: focus_path None | Assert | Low | Very Low |
| 855 | try_enter: unknown direction | Assert | Low | Very Low |
| 400-401, 404 | analyze: explicit is_primary | Add test | **High** | Low |
| 898 | push: strategy default | Assert | Low | Very Low |

## Implementation Plan

### Phase 1: Quick Asserts (Very Low Effort)
1. **Line 329-330**: Add assertion in `find_focus_ref_position()`
2. **Line 855**: Replace else with assert in `try_enter()`
3. **Line 898**: Replace default with assert in `strategy_to_str()`

### Phase 2: High-Value Tests (Low Effort)
4. **Lines 400-401, 404**: Add test for explicit `is_primary=True` and `is_primary=False`
   - This is mentioned in COVERAGE.md as "Easy" and "High" priority
   - Gains 4 lines of coverage

### Phase 3: Error Case Tests (Medium Effort)
5. **Line 782**: Add test for Ref pointing to non-existent grid
   - Tests error handling
   - Gains 1 line of coverage

## Expected Coverage Gain
- Asserts: ~4 lines (but they become untestable)
- Tests: ~5 lines (legitimate code paths validated)
- **Net coverage improvement**: ~5 lines + clearer invariants

## Notes
- Asserts make code intent clearer even if they reduce coverage numbers
- Better to have tested error handling (line 782) than assert and hope it never happens
- The explicit is_primary tests are high value - they document an intentional feature
