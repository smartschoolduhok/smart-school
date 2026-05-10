import { Hono } from 'hono'

const app = new Hono()

// API placeholder routes for future Phase 2
app.get('/api/health', (c) => c.json({ status: 'ok', project: 'smart-school' }))

export default app
