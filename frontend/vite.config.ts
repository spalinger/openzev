import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined
          }

          if (id.includes('@tanstack/react-query')) {
            return 'vendor-react-query'
          }

          if (id.includes('@mui/x-data-grid')) {
            return 'vendor-mui-data-grid'
          }

          if (id.includes('@mui/x-date-pickers') || id.includes('@mui/material') || id.includes('@emotion/')) {
            return 'vendor-mui'
          }

          if (id.includes('@mantine/')) {
            return 'vendor-mantine'
          }

          if (id.includes('recharts') || id.includes('d3-')) {
            return 'vendor-charts'
          }

          if (id.includes('react-router')) {
            return 'vendor-router'
          }

          if (id.includes('react') || id.includes('scheduler')) {
            return 'vendor-react'
          }

          return 'vendor-misc'
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://backend:8000',
        changeOrigin: true,
      },
    },
  },
})
