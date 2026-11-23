import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default defineConfig((configEnv) =>
  mergeConfig(
    viteConfig(configEnv),
    defineConfig({
      test: {
        exclude: ['e2e/**', 'node_modules/**'],
        coverage: {
          provider: 'v8',
          reporter: ['text', 'html'],
          include: ['src/**/*.{ts,tsx}'],
          exclude: ['src/**/__tests__/**', 'src/main.tsx'],
        },
      },
    }),
  ),
)
