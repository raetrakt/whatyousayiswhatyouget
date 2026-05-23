import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: './index.html',
        tools: './tools/index.html',
        quadtree: './tools/quadtree/index.html',
      },
    },
  },
});
