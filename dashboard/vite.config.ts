import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '..', 'PORT');
  return { plugins: [react()], server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/ws': { target: `ws://127.0.0.1:${env.PORT || 3000}`, ws: true, changeOrigin: true }, '/api': `http://127.0.0.1:${env.PORT || 3000}`, '/auth': `http://127.0.0.1:${env.PORT || 3000}` } } };
});
