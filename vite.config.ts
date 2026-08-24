import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // 构建输出到 server/static，供 PyInstaller 打包和 FastAPI 静态托管
    outDir: 'server/static',
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/ollama': {
        target: 'http://localhost:11434',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama/, '')
      },
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true
      }
    }
  }
});
