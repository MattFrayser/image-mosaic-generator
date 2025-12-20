import { defineConfig } from 'vite';

export default defineConfig({
    root: 'ui',
    build: {
        outDir: '../dist',
        emptyOutDir: true
    },
    clearScreen: false,
    server: {
        port: 5173,
        strictPort: true
    }
});
