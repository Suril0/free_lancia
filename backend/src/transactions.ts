import { Prisma } from '@prisma/client'
import { Router, type Response } from 'express'
import { z } from 'zod'
import { prisma } from './db.js'
import { requireAuth, type AuthenticatedRequest } from './auth.js'

export const transactionsRouter = Router()

transactionsRouter.get('/transactions', requireAuth, async (request: AuthenticatedRequest, response: Response, next) => {
  const userId = request.authUserId
  if (!userId) {
    response.status(401).json({ code: 'UNAUTHENTICATED', message: 'Sign in to continue.' })
    return
  }
  const parsed = z.object({
    type: z.enum(['FUND', 'RELEASE', 'REFUND']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  }).safeParse(request.query)
  if (!parsed.success) {
    response.status(400).json({ code: 'VALIDATION_ERROR', message: 'Please check the transaction filters.' })
    return
  }

  try {
    const where = {
      userId,
      ...(parsed.data.type ? { type: parsed.data.type } : {}),
    }
    const [items, total, totals] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: { project: { select: { id: true, title: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (parsed.data.page - 1) * parsed.data.pageSize,
        take: parsed.data.pageSize,
      }),
      prisma.transaction.count({ where }),
      prisma.transaction.groupBy({
        by: ['type'],
        where: { userId, status: 'CONFIRMED' },
        _sum: { amount: true },
      }),
    ])
    const amounts = new Map(totals.map((item) => [item.type, item._sum.amount ?? new Prisma.Decimal(0)]))
    response.json({
      items: items.map((item) => ({
        id: item.id,
        type: item.type,
        amount: item.amount.toFixed(6),
        status: item.status,
        txHash: item.txHash,
        blockNumber: item.blockNumber?.toString() ?? null,
        createdAt: item.createdAt.toISOString(),
        project: item.project,
      })),
      summary: {
        funded: amounts.get('FUND')?.toFixed(6) ?? '0.000000',
        received: amounts.get('RELEASE')?.toFixed(6) ?? '0.000000',
        refunded: amounts.get('REFUND')?.toFixed(6) ?? '0.000000',
        pending: (await prisma.transaction.aggregate({
          where: { userId, status: 'PENDING' },
          _sum: { amount: true },
        }))._sum.amount?.toFixed(6) ?? '0.000000',
      },
      total,
      page: parsed.data.page,
      pageCount: Math.ceil(total / parsed.data.pageSize),
    })
  } catch (error) {
    next(error)
  }
})
