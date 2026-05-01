import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/larry-festschrift/',
  build: {
    chunkSizeWarningLimit: 550,
    rollupOptions: {
      output: {
        manualChunks: {
          'three-core': ['three', 'three/examples/jsm/controls/OrbitControls.js'],
        },
      },
    },
  },
})
