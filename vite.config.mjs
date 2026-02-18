import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react({
      include: /\.[jt]sx?$/,
    }),
  ],
  base: './',
  optimizeDeps: {
    esbuildOptions: {
      loader: { '.js': 'jsx' },
    },
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: [
      { find: /^Editor\//, replacement: path.resolve(__dirname, 'src/Editor') + '/' },
      { find: /^resources\//, replacement: path.resolve(__dirname, 'src/resources') + '/' },
      { find: /^files\//, replacement: path.resolve(__dirname, 'src/files') + '/' },
    ],
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern',
        loadPaths: [path.resolve(__dirname, 'src')],
        silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'strict-unary'],
      },
    },
  },
  build: {
    outDir: 'build',
    sourcemap: false,
    chunkSizeWarningLimit: 3000,
  },
  server: { port: 5173, open: true },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  },
});
