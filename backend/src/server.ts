import 'dotenv/config'
import { createServer } from 'node:http'
import { createApp } from './app.js'
import { logger } from './logger.js'
import { attachRealtime, closeRealtime } from './realtime.js'
import { prisma } from './db.js'

const port = Number(process.env.PORT ?? 3000)
const app = createApp()
const server = createServer(app)
attachRealtime(server)

server.listen(port, '0.0.0.0', () => {
  logger.info({ port }, 'Freelancia API listening')
})

let closing: Promise<void> | undefined
async function shutdown(signal: NodeJS.Signals) {
  if (closing) return closing
  closing = (async () => {
    logger.info({ signal }, 'Stopping Freelancia API')
    await closeRealtime()
    await prisma.$disconnect()
  })()
  return closing
}

process.once('SIGINT', () => {
  void shutdown('SIGINT').catch((error: unknown) => {
    logger.error({ error }, 'Failed to stop Freelancia API cleanly')
    process.exitCode = 1
  })
})

process.once('SIGTERM', () => {
  void shutdown('SIGTERM').catch((error: unknown) => {
    logger.error({ error }, 'Failed to stop Freelancia API cleanly')
    process.exitCode = 1
  })
})
