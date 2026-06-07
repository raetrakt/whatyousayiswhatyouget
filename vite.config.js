import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: './index.html',
        dictionary: './dictionary/index.html',
        manifesto: './manifesto/index.html',
        thesis: './thesis/index.html',
        tools: './tools/index.html',
        about: './about/index.html'
      },
    },
  },
});
