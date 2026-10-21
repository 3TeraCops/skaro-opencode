import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [svelte()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  worker: { format: 'es' },
  build: {
    outDir: resolve('../../output/graph-preview-export'),
    emptyOutDir: true,
    lib: {
      entry: resolve('src/renderer/src/graph-preview/export.ts'),
      formats: ['iife'],
      name: 'SkaroGraphPreview',
      fileName: () => 'preview.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
