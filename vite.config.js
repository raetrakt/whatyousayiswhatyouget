import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: './index.html',
        dictionary: './dictionary/index.html',
        tools: './tools/index.html',
      },
    },
  },
});
