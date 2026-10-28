import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { logger } from './logger.js'
import { authRouter, unexpectedAuthError } from './auth.js'
import { projectsRouter, proposalRouter } from './projects.js'
import { collaborationRouter } from './collaboration.js'
import { decisionsRouter } from './decisions.js'
import { submissionsRouter } from './submissions.js'
import { chainRouter } from './chain/index.js'
import { transactionsRouter } from './transactions.js'
import { prisma } from './db.js'

export function createApp() {
  const app = express()
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173'

  app.disable('x-powered-by')
  app.use(helmet())
  app.use(cors({ origin: frontendUrl, credentials: true }))
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())
  app.use((request, response, next) => {
    const startedAt = process.hrtime.bigint()
    response.on('finish', () => {
      logger.info({
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
      }, 'request completed')
    })
    next()
  })
  app.use(rateLimit({ windowMs: 60_000, limit: 120 }))

  app.get('/healthz', (_request, response) => {
    response.json({ status: 'ok' })
  })

  app.get('/readyz', async (_request, response, next) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      response.json({ status: 'ready', dependencies: { database: 'ok' } })
    } catch (error) {
      next(error)
    }
  })

  app.use('/api/v1/auth', authRouter)
  app.use('/api/v1/projects', projectsRouter)
  app.use('/api/v1/proposals', proposalRouter)
  app.use('/api/v1', collaborationRouter)
  app.use('/api/v1', decisionsRouter)
  app.use('/api/v1', submissionsRouter)
  app.use('/api/v1', chainRouter)
  app.use('/api/v1', transactionsRouter)
  app.use(unexpectedAuthError)

  return app
}
