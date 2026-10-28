import 'dotenv/config'
import { prisma } from './db.js'
import { logger } from './logger.js'
import { startVerificationWorker, closeVerificationQueue } from './verification-queue.js'

const worker = startVerificationWorker()
let shutdownPromise: Promise<void> | undefined

worker.on('ready', () => logger.info('Submission verification worker is ready'))
worker.on('error', (error) => logger.error({ error }, 'Submission verification worker error'))

async function shutdown(signal: NodeJS.Signals) {
  if (shutdownPromise) return shutdownPromise
  shutdownPromise = (async () => {
    logger.info({ signal }, 'Stopping submission verification worker')
    await worker.close()
    await closeVerificationQueue()
    await prisma.$disconnect()
  })()
  return shutdownPromise
}

process.once('SIGINT', () => {
  void shutdown('SIGINT').catch((error: unknown) => {
    logger.error({ error }, 'Failed to stop submission verification worker')
    process.exitCode = 1
  })
})

process.once('SIGTERM', () => {
  void shutdown('SIGTERM').catch((error: unknown) => {
    logger.error({ error }, 'Failed to stop submission verification worker')
    process.exitCode = 1
  })
})
