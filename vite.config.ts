/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/**
 * Serves api/extract.ts during `vite dev`, so the extraction step works locally
 * and not only once deployed to Vercel. Production uses the same file as a
 * Vercel serverless function; this only supplies the request plumbing.
 */
function devExtractionApi(): Plugin {
  return {
    name: 'ona-dev-extraction-api',
    configureServer(server) {
      server.middlewares.use('/api/extract', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'method_not_allowed' }))
          return
        }
        try {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const raw = Buffer.concat(chunks).toString('utf8')
          const body: unknown = raw === '' ? {} : JSON.parse(raw)

          const module = await server.ssrLoadModule('/api/extract.ts')
          const handleExtract = module.handleExtract as (
            input: unknown,
          ) => Promise<{ status: number; body: unknown }>
          const result = await handleExtract(body)

          res.statusCode = result.status
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(result.body))
        } catch (caught) {
          res.statusCode = 502
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: 'extraction_failed', detail: String(caught) }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load every variable, not just VITE_-prefixed ones, so the dev middleware can
  // read ANTHROPIC_API_KEY from .env.local. Copying it onto process.env keeps it
  // server-side: it is never handed to the client config, and without a VITE_
  // prefix Vite will not inline it into the bundle.
  const env = loadEnv(mode, process.cwd(), '')
  if (env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY
  if (env.ANTHROPIC_MODEL) process.env.ANTHROPIC_MODEL = env.ANTHROPIC_MODEL

  return {
    plugins: [react(), tailwindcss(), devExtractionApi()],
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'bot/**/*.test.ts'],
    },
  }
})
