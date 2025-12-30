/**
 * Represents a position within a specific grid.
 */
export class CellPosition {
  constructor(
    public readonly gridId: string,
    public readonly row: number,
    public readonly col: number
  ) {}

  /**
   * Create a string key for use in Sets or Maps.
   */
  toKey(): string {
    return `${this.gridId},${this.row},${this.col}`;
  }

  /**
   * Check equality with another position.
   */
  equals(other: CellPosition): boolean {
    return (
      this.gridId === other.gridId &&
      this.row === other.row &&
      this.col === other.col
    );
  }

  /**
   * Create a copy of this position.
   */
  clone(): CellPosition {
    return new CellPosition(this.gridId, this.row, this.col);
  }

  toString(): string {
    return `CellPosition(${this.gridId}, ${this.row}, ${this.col})`;
  }
}
