import { createReadStream, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const BACKEND = process.env.VITE_BACKEND_URL ?? 'http://127.0.0.1:8000';
const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Dev-only: serve MSW's service worker straight from node_modules so it never lands in `public/`
 * (and therefore never in the production bundle). Only used when running with VITE_MOCK_API=1.
 */
function mswWorker(): Plugin {
  return {
    name: 'lantern:msw-worker',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/mockServiceWorker.js', (_req, res) => {
        const file = path.join(root, 'node_modules/msw/lib/mockServiceWorker.js');
        if (!existsSync(file)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('Content-Type', 'text/javascript');
        createReadStream(file).pipe(res);
      });
    },
  };
}

const proxied = ['/api', '/media', '/django-admin', '/static', '/sitemap.xml', '/robots.txt'];

function manualChunk(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined;
  if (
    /node_modules\/(react|react-dom|scheduler|react-router|@remix-run|cookie|set-cookie-parser)\//.test(
      id,
    )
  )
    return 'react';
  if (id.includes('@tanstack')) return 'query';
  if (
    /node_modules\/(radix-ui|@radix-ui|@floating-ui|aria-hidden|react-remove-scroll|react-style-singleton|use-callback-ref|use-sidecar|get-nonce|tslib)\//.test(
      id,
    )
  )
    return 'radix';
  if (/node_modules\/(react-hook-form|@hookform|zod)\//.test(id)) return 'forms';
  if (
    /node_modules\/(recharts|d3-[^/]+|victory-vendor|decimal\.js-light|internmap|react-smooth|recharts-scale|immer|redux|react-redux|@reduxjs)\//.test(
      id,
    )
  )
    return 'charts';
  if (
    /node_modules\/(react-markdown|remark-[^/]+|rehype-[^/]+|mdast-[^/]+|micromark[^/]*|unified|unist-[^/]+|hast-[^/]+|vfile[^/]*|decode-named-character-reference|character-entities[^/]*|property-information|space-separated-tokens|comma-separated-tokens|trim-lines|trough|bail|is-plain-obj|devlop|ccount|markdown-table|zwitch|longest-streak|estree-util-[^/]+|html-url-attributes|style-to-[^/]+|inline-style-parser)\//.test(
      id,
    )
  )
    return 'markdown';
  return 'vendor';
}

export default defineConfig({
  plugins: [react(), tailwindcss(), mswWorker()],
  resolve: { alias: { '@': path.join(root, 'src') } },
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      proxied.map((p) => [p, { target: BACKEND, changeOrigin: false, xfwd: true }]),
    ),
  },
  preview: { port: 4173 },
  build: {
    sourcemap: true,
    target: 'es2022',
    chunkSizeWarningLimit: 600,
    rollupOptions: { output: { manualChunks: manualChunk } },
  },
});
