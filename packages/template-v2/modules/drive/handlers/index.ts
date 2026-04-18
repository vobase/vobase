import { Hono } from 'hono'
import proposalHandlers from './proposal'

const app = new Hono()

app.get('/health', (c) => c.json({ module: 'drive', status: 'ok' }))
app.route('/proposals', proposalHandlers)

export default app
