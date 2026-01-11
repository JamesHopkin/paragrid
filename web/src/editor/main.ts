/**
 * Main entry point for the Paragrid Level Editor
 */

import { onStateChange } from './state.js';
import { renderGrids, initializeUI } from './ui.js';

/**
 * Initialize the editor
 */
function init(): void {
  // Set up state change listener to re-render
  onStateChange(() => {
    renderGrids();
  });

  // Initialize UI event listeners
  initializeUI();

  // Initial render
  renderGrids();

  console.log('Paragrid Level Editor initialized');
}

// Start the editor when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
