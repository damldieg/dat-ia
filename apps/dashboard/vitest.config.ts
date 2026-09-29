import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // Server tests run under `node --test`; vitest owns the SPA unit tests only.
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
