import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { defineConfig, loadEnv, type Rollup } from 'vite'
import react from '@vitejs/plugin-react'

const { version: appVersion } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const enableAdoptionImpact = mode === 'development'
    || env.VITE_ENABLE_ADOPTION_IMPACT === 'true'
  const emitBundleReport = process.env.AADB_BUNDLE_REPORT === 'true'

  return {
    define: {
      __ENABLE_ADOPTION_IMPACT__: JSON.stringify(enableAdoptionImpact),
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    plugins: [
      react(),
      {
        name: 'aadb-version-manifest',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'version.json',
            source: `${JSON.stringify({ version: appVersion })}\n`,
          })
        },
      },
      ...(emitBundleReport ? [{
        name: 'aadb-bundle-report',
        generateBundle(_options, bundle: Rollup.OutputBundle) {
          const chunks = Object.values(bundle)
            .filter((item): item is Rollup.OutputChunk => item.type === 'chunk')
            .map((chunk) => ({
              file: chunk.fileName,
              bytes: Buffer.byteLength(chunk.code),
              gzipBytes: gzipSync(chunk.code).byteLength,
              modules: Object.entries(chunk.modules)
                .map(([module, details]) => ({ module, bytes: details.renderedLength }))
                .sort((left, right) => right.bytes - left.bytes),
            }))
            .sort((left, right) => right.bytes - left.bytes)

          this.emitFile({
            type: 'asset',
            fileName: 'bundle-report.json',
            source: `${JSON.stringify({ version: appVersion, chunks }, null, 2)}\n`,
          })
        },
      }] : []),
    ],
    server: {
      port: 3000,
      // Allow the MSAL sign-in popup to communicate back to the opener window.
      // Without this, the Microsoft login redirect can split the popup into a
      // separate browsing-context group and MSAL's postMessage handshake times out.
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
      },
      proxy: {
        // Ollama is a local service and should work with `npm run dev` without
        // starting the Azure token server. Discover installed models separately
        // so the client can select the first one when none is pinned.
        '/api/ollama/models': {
          target: 'http://127.0.0.1:11434',
          changeOrigin: true,
          rewrite: () => '/api/tags',
        },
        '/api/ollama': {
          target: 'http://127.0.0.1:11434',
          changeOrigin: true,
          rewrite: () => '/api/chat',
        },
        // Forward /api/ to the local speech token server (mirrors nginx in production)
        '/api/voice-live': {
          target: 'ws://127.0.0.1:3001',
          ws: true,
        },
        '/api': {
          target: 'http://127.0.0.1:3001',
          changeOrigin: false,
        },
      },
    },
    build: {
      outDir: 'dist',
      // Pricing JSON is runtime-fetched and must remain as files. Inlining empty
      // or small regional assets would recreate a large JavaScript module graph.
      assetsInlineLimit: 0,
    },
  }
})
