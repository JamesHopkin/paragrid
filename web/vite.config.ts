import { defineConfig } from 'vite';
import { resolve } from 'path';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { gridStorePlugin } from './vite-plugin-grid-store';

export default defineConfig(({ mode }) => {
  // Determine which HTML file to build based on environment variable
  let input = resolve(__dirname, 'index.html');
  if (process.env.BUILD_TARGET === 'demo') {
    input = resolve(__dirname, 'demo-iso.html');
  } else if (process.env.BUILD_TARGET === 'editor') {
    input = resolve(__dirname, 'editor.html');
  }

  // For standalone editor build, inject a global flag
  const isStandaloneEditor = process.env.BUILD_TARGET === 'editor';

  return {
    plugins: [gridStorePlugin(), viteSingleFile()],
    test: {
      globals: true,
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
    define: isStandaloneEditor ? {
      '__PARAGRID_STANDALONE__': true,
    } : {},
    build: {
      rollupOptions: {
        input,
      },
    },
  };
});
