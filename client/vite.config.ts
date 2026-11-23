import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { sentryVitePlugin } from '@sentry/vite-plugin'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN || env.SENTRY_AUTH_TOKEN
  const sentryOrg = process.env.SENTRY_ORG || env.SENTRY_ORG
  const sentryProject = process.env.SENTRY_PROJECT || env.SENTRY_PROJECT

  return {
    build: {
      // Only emit hidden source maps when Sentry upload is enabled so direct builds
      // never leave unuploaded .map files behind in dist/.
      sourcemap: sentryAuthToken ? 'hidden' : false,
    },
    plugins: [
      react(),
      tailwindcss(),
      nodePolyfills({
        globals: {
          Buffer: true,
          global: true,
          process: true,
        },
      }),
      // Only upload source maps when auth token is available (CI/production builds)
      sentryVitePlugin({
        org: sentryOrg,
        project: sentryProject,
        authToken: sentryAuthToken,
        disable: !sentryAuthToken,
        sourcemaps: {
          filesToDeleteAfterUpload: './dist/**/*.map',
        },
      }),
    ],
    define: {
      global: 'globalThis',
    },
  }
})

