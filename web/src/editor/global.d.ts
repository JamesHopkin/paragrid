/**
 * Global type declarations for the Paragrid Level Editor
 */

declare global {
  interface Window {
    __PARAGRID_STANDALONE__?: boolean;
  }

  // Declare the global constant injected by Vite build
  const __PARAGRID_STANDALONE__: boolean | undefined;
}

export {};
