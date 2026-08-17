import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@mui/icons-material')) return 'mui-icons';
            if (id.includes('@mui/x-date-pickers')) return 'mui-x';
            if (id.includes('@mui/material') || id.includes('@emotion')) return 'mui-core';
            if (id.includes('recharts') || id.includes('d3-')) return 'charts';
            if (id.includes('@tanstack/react-query')) return 'query';
            if (id.includes('react-hook-form') || id.includes('@hookform') || id.includes('zod')) return 'forms';
            if (id.includes('xlsx')) return 'xlsx';
            if (id.includes('react-router-dom') || id.includes('react-router')) return 'router';
            if (id.includes('react-dom') || id.includes('react/')) return 'react-vendor';
          }
        },
      },
    },
  },
});
