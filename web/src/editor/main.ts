/**
 * Main entry point for the Paragrid Level Editor
 */

import { onStateChange } from './state.js';
import { renderGrids, initializeUI, updateHistoryStatus, selectCellByCoords } from './ui.js';

/**
 * Initialize the editor
 */
function init(): void {
  // Set up state change listener to re-render and update history
  onStateChange(() => {
    renderGrids();
    updateHistoryStatus();
  });

  // Initialize UI event listeners
  initializeUI();

  // Initial render
  renderGrids();

  // Select first cell (0, 0) of first grid
  selectCellByCoords('grid_1', 0, 0);

  console.log('Paragrid Level Editor initialized');
}

// Start the editor when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
