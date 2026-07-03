import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/travel-map/',
  build: {
    rollupOptions: {
      output: {
        // Keep the two big libraries in stable, separately-cached chunks
        manualChunks: {
          three: ['three'],
          maplibre: ['maplibre-gl'],
        },
      },
    },
  },
})
