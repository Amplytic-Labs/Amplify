import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import mdx from 'fumadocs-mdx/vite';

export default defineConfig({
  plugins: [
    react(),
    tsconfigPaths(),
    mdx(),
  ],
  resolve: {
    noExternal: [
      'fumadocs-core',
      'fumadocs-ui',
      'fumadocs-mdx',
      '@fumadocs/base-ui',
    ],
  },
  server: {
    port: 3001,
  },
});
