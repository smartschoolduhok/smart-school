import { defineConfig } from 'vite'
import build from '@hono/vite-build/cloudflare-pages'

export default defineConfig({
  plugins: [build({ entry: './src/worker.ts' })],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
  },
})
