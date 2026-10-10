import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
      restoreMocks: true,
      coverage: {
        provider: 'v8',
        include: ['src/**'],
        exclude: ['src/mocks/**', 'src/test/**', '**/*.d.ts'],
      },
    },
  }),
);
