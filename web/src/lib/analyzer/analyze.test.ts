/**
 * Tests for the grid analyzer.
 */

import { describe, it, expect } from 'vitest';
import { analyze } from './analyze.js';
import { isNestedNode, isConcreteNode, isEmptyNode, isRefNode, isCutoffNode } from './types.js';
import { parseGrids } from '../parser/parser.js';

describe('analyze', () => {
  it('analyzes a simple grid with no references', () => {
    const store = parseGrids({
      main: '1 2|3 _'
    });

    const tree = analyze(store, 'main', 1.0, 1.0);

    // Root should be NestedNode
    expect(isNestedNode(tree)).toBe(true);
    if (!isNestedNode(tree)) return;

    expect(tree.gridId).toBe('main');
    expect(tree.children.length).toBe(2); // 2 rows
    expect(tree.children[0].length).toBe(2); // 2 cols

    // Check cell contents
    const cell00 = tree.children[0][0];
    expect(isConcreteNode(cell00)).toBe(true);
    if (isConcreteNode(cell00)) {
      expect(cell00.id).toBe('1');
      expect(cell00.gridId).toBe('main');
    }

    const cell01 = tree.children[0][1];
    expect(isConcreteNode(cell01)).toBe(true);
    if (isConcreteNode(cell01)) {
      expect(cell01.id).toBe('2');
    }

    const cell10 = tree.children[1][0];
    expect(isConcreteNode(cell10)).toBe(true);
    if (isConcreteNode(cell10)) {
      expect(cell10.id).toBe('3');
    }

    const cell11 = tree.children[1][1];
    expect(isEmptyNode(cell11)).toBe(true);
  });

  it('analyzes a grid with a reference to another grid', () => {
    const store = parseGrids({
      main: '1 inner',
      inner: '2 3'
    });

    const tree = analyze(store, 'main', 1.0, 1.0);

    expect(isNestedNode(tree)).toBe(true);
    if (!isNestedNode(tree)) return;

    // First cell should be concrete
    const cell0 = tree.children[0][0];
    expect(isConcreteNode(cell0)).toBe(true);

    // Second cell should be a RefNode
    const cell1 = tree.children[0][1];
    expect(isRefNode(cell1)).toBe(true);
    if (!isRefNode(cell1)) return;

    expect(cell1.refTarget).toBe('inner');
    expect(cell1.isPrimary).toBe(true); // First ref to inner
    expect(cell1.gridId).toBe('main');

    // RefNode should contain analyzed content
    expect(isNestedNode(cell1.content)).toBe(true);
    if (!isNestedNode(cell1.content)) return;

    expect(cell1.content.gridId).toBe('inner');
    expect(cell1.content.children.length).toBe(1); // 1 row
    expect(cell1.content.children[0].length).toBe(2); // 2 cols

    // Check inner grid contents
    const innerCell0 = cell1.content.children[0][0];
    expect(isConcreteNode(innerCell0)).toBe(true);
    if (isConcreteNode(innerCell0)) {
      expect(innerCell0.id).toBe('2');
      expect(innerCell0.gridId).toBe('inner');
    }

    const innerCell1 = cell1.content.children[0][1];
    expect(isConcreteNode(innerCell1)).toBe(true);
    if (isConcreteNode(innerCell1)) {
      expect(innerCell1.id).toBe('3');
    }
  });

  it('handles self-referencing grid with cutoff', () => {
    const store = parseGrids({
      main: 'main _'
    });

    const tree = analyze(store, 'main', 1.0, 1.0, 0.1);

    expect(isNestedNode(tree)).toBe(true);
    if (!isNestedNode(tree)) return;

    // First cell should be a RefNode (self-reference)
    const cell0 = tree.children[0][0];
    expect(isRefNode(cell0)).toBe(true);
    if (!isRefNode(cell0)) return;

    expect(cell0.refTarget).toBe('main');
    expect(cell0.isPrimary).toBe(true);

    // Should eventually cutoff due to shrinking dimensions
    let node = cell0.content;
    let depth = 0;
    const maxDepth = 20; // Safety limit

    while (depth < maxDepth) {
      if (isCutoffNode(node)) {
        expect(node.gridId).toBe('main');
        break;
      }

      expect(isNestedNode(node)).toBe(true);
      if (!isNestedNode(node)) break;

      // Should have ref in first cell
      const firstCell = node.children[0][0];
      expect(isRefNode(firstCell)).toBe(true);
      if (!isRefNode(firstCell)) break;

      node = firstCell.content;
      depth++;
    }

    // Should have found cutoff before max depth
    expect(depth).toBeLessThan(maxDepth);
    expect(isCutoffNode(node)).toBe(true);
  });

  it('correctly identifies primary and secondary references', () => {
    const store = parseGrids({
      main: 'sub sub|sub _',
      sub: '1 2'
    });

    const tree = analyze(store, 'main', 1.0, 1.0);

    expect(isNestedNode(tree)).toBe(true);
    if (!isNestedNode(tree)) return;

    // First ref should be primary (top-left, DFS order)
    const cell00 = tree.children[0][0];
    expect(isRefNode(cell00)).toBe(true);
    if (isRefNode(cell00)) {
      expect(cell00.isPrimary).toBe(true);
      expect(cell00.refTarget).toBe('sub');
    }

    // Second ref should be secondary
    const cell01 = tree.children[0][1];
    expect(isRefNode(cell01)).toBe(true);
    if (isRefNode(cell01)) {
      expect(cell01.isPrimary).toBe(false);
      expect(cell01.refTarget).toBe('sub');
    }

    // Third ref should be secondary
    const cell10 = tree.children[1][0];
    expect(isRefNode(cell10)).toBe(true);
    if (isRefNode(cell10)) {
      expect(cell10.isPrimary).toBe(false);
      expect(cell10.refTarget).toBe('sub');
    }
  });

  it('respects explicit primary marking', () => {
    const store = parseGrids({
      main: '~sub *sub',
      sub: '1 2'
    });

    const tree = analyze(store, 'main', 1.0, 1.0);

    expect(isNestedNode(tree)).toBe(true);
    if (!isNestedNode(tree)) return;

    // First ref explicitly secondary (~)
    const cell0 = tree.children[0][0];
    expect(isRefNode(cell0)).toBe(true);
    if (isRefNode(cell0)) {
      expect(cell0.isPrimary).toBe(false);
      expect(cell0.refTarget).toBe('sub');
    }

    // Second ref explicitly primary (*)
    const cell1 = tree.children[0][1];
    expect(isRefNode(cell1)).toBe(true);
    if (isRefNode(cell1)) {
      expect(cell1.isPrimary).toBe(true);
      expect(cell1.refTarget).toBe('sub');
    }
  });

  it('handles threshold cutoff correctly', () => {
    const store = parseGrids({
      main: '1 2'
    });

    // Very large threshold - should cutoff immediately
    const tree = analyze(store, 'main', 1.0, 1.0, 2.0);

    expect(isCutoffNode(tree)).toBe(true);
    if (isCutoffNode(tree)) {
      expect(tree.gridId).toBe('main');
    }
  });

  it('handles mutual references (A→B→A)', () => {
    const store = parseGrids({
      a: 'b _',
      b: 'a _'
    });

    const tree = analyze(store, 'a', 1.0, 1.0, 0.1);

    expect(isNestedNode(tree)).toBe(true);
    if (!isNestedNode(tree)) return;

    // First cell should be ref to B
    const refB = tree.children[0][0];
    expect(isRefNode(refB)).toBe(true);
    if (!isRefNode(refB)) return;

    expect(refB.refTarget).toBe('b');
    expect(refB.isPrimary).toBe(true);

    // B's content should have ref to A
    expect(isNestedNode(refB.content)).toBe(true);
    if (!isNestedNode(refB.content)) return;

    const refA = refB.content.children[0][0];
    expect(isRefNode(refA)).toBe(true);
    if (!isRefNode(refA)) return;

    expect(refA.refTarget).toBe('a');
    expect(refA.isPrimary).toBe(true);

    // Should eventually cutoff
    let node = refA.content;
    let depth = 0;
    while (depth < 20 && !isCutoffNode(node)) {
      if (isNestedNode(node)) {
        const firstCell = node.children[0][0];
        if (isRefNode(firstCell)) {
          node = firstCell.content;
        } else {
          break;
        }
      } else {
        break;
      }
      depth++;
    }

    expect(isCutoffNode(node)).toBe(true);
  });
});
