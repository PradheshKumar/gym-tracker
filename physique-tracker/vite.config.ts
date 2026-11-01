import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the app from /<repo>/; BASE_PATH is set by the deploy workflow.
export default defineConfig({
  base: (globalThis as any).process?.env?.BASE_PATH ?? '/',
  plugins: [react()],
  test: { environment: 'node' },
} as any);
