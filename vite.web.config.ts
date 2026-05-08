import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [react()],
    root: 'src/web/client',
    build: {
        outDir: '../../../dist/web/client',
        emptyOutDir: true,
    },
});
