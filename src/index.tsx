import { Hono } from 'hono'
import { app as api } from './api'
import { page } from './page'

const app = new Hono<any>()
app.route('/', api)
app.get('/', (c) => c.html(page()))
app.get('/health', (c) => c.json({ ok: true }))
export default app
