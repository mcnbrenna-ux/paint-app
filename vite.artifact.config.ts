import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Single-file build used to package the app as one self-contained HTML page
// (e.g. for sharing a functional preview): no code splitting, so the catalog's
// dynamic import lands in the single bundle that gets inlined.
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    outDir: 'dist-artifact',
    emptyOutDir: true,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})
