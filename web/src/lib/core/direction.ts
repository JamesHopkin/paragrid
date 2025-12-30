/**
 * Cardinal directions for grid traversal.
 */
export enum Direction {
  N = 'N', // Up (decreasing row)
  S = 'S', // Down (increasing row)
  E = 'E', // Right (increasing col)
  W = 'W', // Left (decreasing col)
}

/**
 * Get the opposite direction.
 */
export function flipDirection(dir: Direction): Direction {
  switch (dir) {
    case Direction.N:
      return Direction.S;
    case Direction.S:
      return Direction.N;
    case Direction.E:
      return Direction.W;
    case Direction.W:
      return Direction.E;
  }
}
