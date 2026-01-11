/**
 * UI rendering and interaction for the Paragrid Level Editor
 */

import {
  getState,
  addGrid,
  deleteGrid,
  duplicateGrid,
  renameGrid,
  setCell,
  resizeGrid,
  getGridsAvailableForPrimaryRef,
  exportToConsole,
  getGridScale,
  setGridScale,
  undo,
  redo,
  getUndoStackSize,
  getRedoStackSize,
} from './state.js';
import {
  CellContent,
  GridDefinition,
  createEmptyCell,
  createConcreteCell,
  createRefCell,
  CONCRETE_IDS,
} from './types.js';

let currentContextMenu: HTMLElement | null = null;

/**
 * Update the history status display showing undo/redo availability.
 */
export function updateHistoryStatus(): void {
  const statusEl = document.getElementById('history-status');
  const undoBtn = document.getElementById('undo-btn') as HTMLButtonElement;
  const redoBtn = document.getElementById('redo-btn') as HTMLButtonElement;

  const undoCount = getUndoStackSize();
  const redoCount = getRedoStackSize();

  if (statusEl) {
    statusEl.textContent = `(${undoCount} undo, ${redoCount} redo)`;
  }

  // Enable/disable buttons based on availability
  if (undoBtn) {
    undoBtn.disabled = undoCount === 0;
  }
  if (redoBtn) {
    redoBtn.disabled = redoCount === 0;
  }
}

/**
 * Render all grids into the container
 */
export function renderGrids(): void {
  const container = document.getElementById('grids-container');
  if (!container) return;

  container.innerHTML = '';

  const state = getState();
  state.gridOrder.forEach(gridId => {
    const grid = state.grids.get(gridId);
    if (grid) {
      const gridCard = createGridCard(grid);
      container.appendChild(gridCard);
    }
  });
}

/**
 * Create a grid card element
 */
function createGridCard(grid: GridDefinition): HTMLElement {
  const card = document.createElement('div');
  card.className = 'grid-card';

  // Header
  const header = document.createElement('div');
  header.className = 'grid-header';

  const title = document.createElement('div');
  title.className = 'grid-title';
  title.textContent = grid.id;
  header.appendChild(title);

  card.appendChild(header);

  // Grid table wrapper (to contain scaled content)
  const tableWrapper = document.createElement('div');
  tableWrapper.style.position = 'relative';

  // Grid table
  const table = document.createElement('div');
  table.className = 'grid-table';
  table.style.gridTemplateColumns = `repeat(${grid.cols}, 1fr)`;
  table.style.gridTemplateRows = `repeat(${grid.rows}, 1fr)`;

  // Calculate unscaled dimensions (40px per cell + 2px gaps + 4px border)
  const cellSize = 40;
  const gapSize = 2;
  const borderSize = 4;
  const unscaledWidth = grid.cols * cellSize + (grid.cols - 1) * gapSize + borderSize;
  const unscaledHeight = grid.rows * cellSize + (grid.rows - 1) * gapSize + borderSize;

  // Set explicit size on table to prevent it from expanding
  table.style.width = `${unscaledWidth}px`;
  table.style.height = `${unscaledHeight}px`;

  // Apply scale transform
  const scale = getGridScale(grid.id);
  table.style.transform = `scale(${scale})`;
  table.style.transformOrigin = 'top left';

  // Set wrapper size to accommodate scaled content
  tableWrapper.style.width = `${unscaledWidth * scale}px`;
  tableWrapper.style.height = `${unscaledHeight * scale}px`;

  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const cell = createCellElement(grid, r, c);
      table.appendChild(cell);
    }
  }

  // Corner handle (drag = zoom, Super+drag = resize)
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'resize-handle';
  resizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startResize(grid.id, e);
  });
  table.appendChild(resizeHandle);

  tableWrapper.appendChild(table);
  card.appendChild(tableWrapper);

  // Context menu on right-click
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showGridContextMenu(grid.id, e.clientX, e.clientY);
  });

  return card;
}

/**
 * Create a cell element
 */
function createCellElement(grid: GridDefinition, row: number, col: number): HTMLElement {
  const cellContent = grid.cells[row][col];
  const cellDiv = document.createElement('div');
  cellDiv.className = 'grid-cell';

  // Set cell appearance based on type
  if (cellContent.type === 'Empty') {
    cellDiv.classList.add('empty');
    cellDiv.textContent = '·';
  } else if (cellContent.type === 'Concrete') {
    cellDiv.classList.add('concrete');
    cellDiv.textContent = cellContent.id || '?';
  } else if (cellContent.type === 'Ref') {
    if (cellContent.isPrimary) {
      cellDiv.classList.add('ref-primary');
    } else {
      cellDiv.classList.add('ref-secondary');
    }
    cellDiv.textContent = cellContent.id || '?';
  }

  // Click to open palette
  cellDiv.addEventListener('click', (e) => {
    e.stopPropagation();
    showCellPalette(grid.id, row, col, e.clientX, e.clientY);
  });

  return cellDiv;
}

/**
 * Show the cell palette context menu
 */
function showCellPalette(gridId: string, row: number, col: number, x: number, y: number): void {
  closeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  // Empty option
  const emptyItem = createMenuItem('Empty', () => {
    setCell(gridId, row, col, createEmptyCell());
    closeContextMenu();
  });
  menu.appendChild(emptyItem);

  // Concrete section
  const concreteLabel = document.createElement('div');
  concreteLabel.className = 'context-menu-label context-menu-section';
  concreteLabel.textContent = 'CONCRETE';
  menu.appendChild(concreteLabel);

  CONCRETE_IDS.forEach(id => {
    const item = createMenuItem(id, () => {
      setCell(gridId, row, col, createConcreteCell(id));
      closeContextMenu();
    });
    menu.appendChild(item);
  });

  // Primary refs section
  const primaryLabel = document.createElement('div');
  primaryLabel.className = 'context-menu-label context-menu-section';
  primaryLabel.textContent = 'PRIMARY REFS';
  menu.appendChild(primaryLabel);

  const availablePrimary = getGridsAvailableForPrimaryRef();
  const state = getState();
  let hasPrimaryRefs = false;

  state.gridOrder.forEach(id => {
    // For current grid, only show if not already placed
    if (id === gridId && !availablePrimary.has(id)) {
      return;
    }

    if (availablePrimary.has(id)) {
      hasPrimaryRefs = true;
      const item = createMenuItem(`${id} (primary)`, () => {
        setCell(gridId, row, col, createRefCell(id, true));
        closeContextMenu();
      });
      menu.appendChild(item);
    }
  });

  if (!hasPrimaryRefs) {
    const noItem = createMenuItem('(none available)', () => {}, true);
    menu.appendChild(noItem);
  }

  // Secondary refs section
  const secondaryLabel = document.createElement('div');
  secondaryLabel.className = 'context-menu-label context-menu-section';
  secondaryLabel.textContent = 'SECONDARY REFS';
  menu.appendChild(secondaryLabel);

  state.gridOrder.forEach(id => {
    const item = createMenuItem(`${id} (secondary)`, () => {
      setCell(gridId, row, col, createRefCell(id, false));
      closeContextMenu();
    });
    menu.appendChild(item);
  });

  document.body.appendChild(menu);
  currentContextMenu = menu;
}

/**
 * Show the grid context menu
 */
function showGridContextMenu(gridId: string, x: number, y: number): void {
  closeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const renameItem = createMenuItem('Rename', () => {
    closeContextMenu();
    promptRename(gridId);
  });
  menu.appendChild(renameItem);

  const duplicateItem = createMenuItem('Duplicate', () => {
    duplicateGrid(gridId);
    closeContextMenu();
  });
  menu.appendChild(duplicateItem);

  const deleteItem = createMenuItem('Delete', () => {
    deleteGrid(gridId);
    closeContextMenu();
  });
  menu.appendChild(deleteItem);

  document.body.appendChild(menu);
  currentContextMenu = menu;
}

/**
 * Create a context menu item
 */
function createMenuItem(text: string, onClick: () => void, disabled = false): HTMLElement {
  const item = document.createElement('div');
  item.className = 'context-menu-item';
  if (disabled) {
    item.classList.add('disabled');
  }
  item.textContent = text;

  if (!disabled) {
    item.addEventListener('click', onClick);
  }

  return item;
}

/**
 * Close any open context menu
 */
function closeContextMenu(): void {
  if (currentContextMenu) {
    currentContextMenu.remove();
    currentContextMenu = null;
  }
}

/**
 * Prompt the user to rename a grid
 */
function promptRename(gridId: string): void {
  const newId = prompt(`Rename grid "${gridId}" to:`, gridId);
  if (newId && newId !== gridId) {
    const state = getState();
    if (state.grids.has(newId)) {
      alert(`Grid "${newId}" already exists!`);
    } else {
      renameGrid(gridId, newId);
    }
  }
}

/**
 * Start resizing/zooming a grid
 * Super+drag (Cmd/Ctrl+drag) = resize grid (add/remove rows/columns)
 * Simple drag = zoom (change visual size)
 */
function startResize(gridId: string, startEvent: MouseEvent): void {
  const state = getState();
  const grid = state.grids.get(gridId);
  if (!grid) return;

  const startX = startEvent.clientX;
  const startY = startEvent.clientY;
  const isSuperDrag = startEvent.metaKey || startEvent.ctrlKey;

  if (isSuperDrag) {
    // Super+drag: Resize grid (add/remove rows/columns)
    // Preview during drag, commit on mouseup
    const startRows = grid.rows;
    const startCols = grid.cols;
    const scale = getGridScale(gridId);

    // Get the table element for preview updates
    const gridCard = (startEvent.target as HTMLElement).closest('.grid-card');
    const table = gridCard?.querySelector('.grid-table') as HTMLElement;
    if (!table) return;

    let targetRows = startRows;
    let targetCols = startCols;
    let previewCells: HTMLElement[] = [];

    // Pin existing cells to their original positions
    const cells = table.querySelectorAll('.grid-cell');
    cells.forEach((cell, index) => {
      const row = Math.floor(index / startCols);
      const col = index % startCols;
      (cell as HTMLElement).style.gridRow = `${row + 1}`;
      (cell as HTMLElement).style.gridColumn = `${col + 1}`;
    });

    const onMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      // Scale the delta to account for visual zoom, then calculate cells
      // If grid is zoomed 2x, 84px of mouse movement = 1 cell
      const cellSize = 42 * scale; // 40px cell + 2px gap, scaled
      targetCols = Math.max(1, startCols + Math.round(deltaX / cellSize));
      targetRows = Math.max(1, startRows + Math.round(deltaY / cellSize));

      // Update grid template
      table.style.gridTemplateColumns = `repeat(${targetCols}, 1fr)`;
      table.style.gridTemplateRows = `repeat(${targetRows}, 1fr)`;

      // Hide/show existing cells based on target dimensions
      cells.forEach((cell, index) => {
        const row = Math.floor(index / startCols);
        const col = index % startCols;

        if (row >= targetRows || col >= targetCols) {
          (cell as HTMLElement).style.display = 'none';
        } else {
          (cell as HTMLElement).style.display = '';
        }
      });

      // Remove old preview cells
      previewCells.forEach(cell => cell.remove());
      previewCells = [];

      // Add preview cells for new positions when growing
      for (let r = 0; r < targetRows; r++) {
        for (let c = 0; c < targetCols; c++) {
          // Skip positions that already have original cells
          if (r < startRows && c < startCols) continue;

          const previewCell = document.createElement('div');
          previewCell.className = 'grid-cell empty preview-cell';
          previewCell.textContent = '·';
          previewCell.style.gridRow = `${r + 1}`;
          previewCell.style.gridColumn = `${c + 1}`;
          table.appendChild(previewCell);
          previewCells.push(previewCell);
        }
      }

      // Update wrapper size for new dimensions
      const cellSize2 = 40;
      const gapSize = 2;
      const borderSize = 4;
      const unscaledWidth = targetCols * cellSize2 + (targetCols - 1) * gapSize + borderSize;
      const unscaledHeight = targetRows * cellSize2 + (targetRows - 1) * gapSize + borderSize;

      table.style.width = `${unscaledWidth}px`;
      table.style.height = `${unscaledHeight}px`;

      const wrapper = table.parentElement;
      if (wrapper) {
        wrapper.style.width = `${unscaledWidth * scale}px`;
        wrapper.style.height = `${unscaledHeight * scale}px`;
      }
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      // Remove preview cells and explicit positioning
      previewCells.forEach(cell => cell.remove());
      cells.forEach(cell => {
        (cell as HTMLElement).style.gridRow = '';
        (cell as HTMLElement).style.gridColumn = '';
        (cell as HTMLElement).style.display = '';
      });

      // Commit the resize only if dimensions changed
      if (targetRows !== startRows || targetCols !== startCols) {
        resizeGrid(gridId, targetRows, targetCols);
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  } else {
    // Simple drag: Zoom (change visual scale)
    const startScale = getGridScale(gridId);

    const onMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      // Use average of X and Y for zoom direction
      // Down-right = positive = zoom in, Up-left = negative = zoom out
      const avgDelta = (deltaX + deltaY) / 2;

      // 300px of drag = 1.0 scale change (less sensitive)
      const scaleChange = avgDelta / 300;
      const newScale = startScale + scaleChange;

      setGridScale(gridId, newScale);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }
}

/**
 * Initialize UI event listeners
 */
export function initializeUI(): void {
  // Add grid button
  const addBtn = document.getElementById('add-grid-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      addGrid();
    });
  }

  // Undo button
  const undoBtn = document.getElementById('undo-btn');
  if (undoBtn) {
    undoBtn.addEventListener('click', () => {
      undo();
    });
  }

  // Redo button
  const redoBtn = document.getElementById('redo-btn');
  if (redoBtn) {
    redoBtn.addEventListener('click', () => {
      redo();
    });
  }

  // Save button
  const saveBtn = document.getElementById('save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      exportToConsole();
    });
  }

  // Update history status display
  updateHistoryStatus();

  // Close context menu when clicking outside
  document.addEventListener('click', (e) => {
    if (currentContextMenu && !currentContextMenu.contains(e.target as Node)) {
      closeContextMenu();
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Escape: Close context menu
    if (e.key === 'Escape') {
      closeContextMenu();
      return;
    }

    // Ctrl+Z / Cmd+Z: Undo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
      return;
    }

    // Ctrl+Shift+Z / Cmd+Shift+Z: Redo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
      e.preventDefault();
      redo();
      return;
    }

    // Ctrl+Y / Cmd+Y: Redo (Windows convention)
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
      e.preventDefault();
      redo();
      return;
    }
  });
}
