import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'

const app = new Hono()

// Serve static files from the dist directory (built React SPA)
app.use('/*', serveStatic({ root: './dist' }))

// API placeholder routes for future Phase 2
app.get('/api/health', (c) => c.json({ status: 'ok', project: 'smart-school' }))

export default app
