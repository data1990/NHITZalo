import { defineConfig } from 'vite';
export default defineConfig({ build: { outDir: '../public', assetsDir: '', emptyOutDir: false, rollupOptions: { input: 'index.html' } } });
