# Push Chain Transition Metadata

## Overview

Each entry in a push chain now includes a `transition` field that indicates how that position was reached during the push operation.

## Transition Types

```typescript
export type TransitionType = 'enter' | 'exit' | 'move' | null;
```

- **`null`**: Initial position (starting point of the push)
- **`'move'`**: Position reached by moving within the same grid
- **`'enter'`**: Position reached by entering a grid through a Ref cell
- **`'exit'`**: Position reached by exiting from a nested grid to its parent

## PushChainEntry Interface

```typescript
export interface PushChainEntry {
  readonly position: CellPosition;
  readonly cell: Cell;
  readonly transition: TransitionType;
}
```

## Examples

### Simple Move Within Grid

```
Grid A: 1 2 3 _
```

Pushing from position [0,0] eastward:
- `[0,0]` (cell 1) - transition: `null` (initial)
- `[0,1]` (cell 2) - transition: `'move'`
- `[0,2]` (cell 3) - transition: `'move'`
- `[0,3]` (empty) - transition: `'move'`

### Entering a Ref (PORTAL strategy)

```
Grid A: 1 B
Grid B: 2 _
```

Pushing from A[0,0] eastward with PORTAL strategy:
- `A[0,0]` (cell 1) - transition: `null` (initial)
- `B[0,0]` (cell 2) - transition: `'enter'` (entered into B)
- `B[0,1]` (empty) - transition: `'move'`

### Exiting from Nested Grid

```
Grid A: 1 B 3
Grid B: 2
```

Pushing from A[0,0] eastward with SOLID strategy:
- `A[0,0]` (cell 1) - transition: `null` (initial)
- `A[0,1]` (ref B) - transition: `'move'`
- `A[0,2]` (cell 3) - transition: `'move'`
- `B[0,0]` (cell 2) - transition: `'enter'` (entered B)
- `A[0,0]` (cell 1) - transition: `'exit'` (exited B, cycled to start)

## Use Cases

This metadata enables:

1. **Custom Animations**: Different transition types can trigger different animation styles
   - `'enter'` → zoom-in animation
   - `'exit'` → zoom-out animation
   - `'move'` → slide animation

2. **Debugging**: Track how the push traversed through the grid structure

3. **Visualization**: Highlight different types of transitions with different colors or effects

4. **Analytics**: Understand push operation patterns and complexity

## Implementation Notes

- The transition metadata is tracked directly by the `Navigator` class
- `Navigator.tryAdvance()` sets the transition to `'move'` or `'exit'` based on whether it crossed a grid boundary
- `Navigator.tryEnter()` sets the transition to `'enter'`
- This approach correctly handles self-referencing grids where the grid ID may stay the same but the operation is still an enter or exit
- The backtracking algorithm (`push`) preserves transition information through the decision stack
