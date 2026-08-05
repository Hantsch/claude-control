import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // The package is ESM (`"type": "module"`), but Electron's own module only exposes named
  // exports to CommonJS consumers, and `koffi` is loaded with `require` on demand. Both the
  // main process and the preload script are therefore emitted as CommonJS `.cjs` files.
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/main/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/main/preload.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: {
          // Main window and the tray popover are two separate documents (§8).
          index: resolve(import.meta.dirname, 'src/renderer/index.html'),
          popover: resolve(import.meta.dirname, 'src/renderer/popover.html'),
        },
      },
    },
  },
});
