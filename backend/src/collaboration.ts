import { DisputeStatus, Prisma } from '@prisma/client'
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { prisma } from './db.js'
import { requireAuth, type AuthenticatedRequest } from './auth.js'
import { emitProjectRealtime, emitUserRealtime } from './realtime.js'
import { getArbiterWalletAddress } from './chain/config.js'

export const collaborationRouter = Router()
const messageBodySchema = z.object({
  body: z.string().trim().min(1).max(4000),
  attachments: z.array(z.url().max(2048)).max(5).default([]),
})

function fail(response: Response, status: number, code: string, message: string, details?: unknown) {
  response.status(status).json({ code, message, ...(details ? { details } : {}) })
}

function routeParam(request: Request, name: string) {
  const value = request.params[name]
  return typeof value === 'string' ? value : undefined
}

function currentUserId(request: AuthenticatedRequest, response: Response) {
  if (!request.authUserId) {
    fail(response, 401, 'UNAUTHENTICATED', 'Sign in to continue.')
    return undefined
  }
  return request.authUserId
}

async function canAccessProject(projectId: string, userId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      clientId: true,
      proposals: {
        where: { freelancerId: userId, status: 'ACCEPTED' },
        select: { id: true },
        take: 1,
      },
    },
  })
  return project && (project.clientId === userId || project.proposals.length > 0)
}

collaborationRouter.get('/notifications/count', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const userId = currentUserId(request, response)
  if (!userId) return
  try {
    const count = await prisma.notification.count({ where: { userId, readAt: null } })
    response.json({ count })
  } catch (error) {
    next(error)
  }
})

collaborationRouter.get('/projects/:projectId/workspace', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const userId = currentUserId(request, response)
  if (!userId) return
  const projectId = routeParam(request, 'projectId')
  if (!projectId) {
    fail(response, 404, 'PROJECT_NOT_FOUND', 'This project could not be found.')
    return
  }
  try {
    const arbiterAddress = getArbiterWalletAddress()
    const userWallet = await prisma.wallet.findUnique({
      where: { userId },
      select: { address: true },
    })
    const isArbiter = Boolean(
      arbiterAddress &&
      userWallet &&
      userWallet.address.toLowerCase() === arbiterAddress.toLowerCase(),
    )
    const accessConditions: Prisma.ProjectWhereInput[] = [
      { clientId: userId },
      { proposals: { some: { freelancerId: userId, status: 'ACCEPTED' } } },
    ]
    if (isArbiter) {
      accessConditions.push({
        disputes: { some: { status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] } } },
      })
    }
    const project = await prisma.project.findFirst({
      where: { id: projectId, OR: accessConditions },
      include: {
        requirements: { orderBy: { order: 'asc' } },
        escrow: true,
        proposals: {
          where: { status: 'ACCEPTED' },
          take: 1,
          include: {
            freelancer: {
              select: {
                id: true,
                name: true,
                title: true,
                wallet: { select: { address: true, chainId: true } },
              },
            },
          },
        },
        submissions: {
          orderBy: { version: 'desc' },
          take: 1,
          include: { aiReports: { orderBy: { createdAt: 'desc' }, take: 1 } },
        },
        activity: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: { actor: { select: { name: true } } },
        },
        disputes: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            opener: { select: { id: true, name: true } },
            evidence: {
              orderBy: { createdAt: 'asc' },
              include: { user: { select: { id: true, name: true } } },
            },
          },
        },
      },
    })
    if (!project) {
      fail(response, 404, 'PROJECT_NOT_FOUND', 'This project does not exist or you are not a participant.')
      return
    }
    response.json({
      project: {
        id: project.id,
        publicRef: project.publicRef,
        title: project.title,
        description: project.description,
        budget: project.budget.toFixed(6),
        status: project.status,
        deadline: project.deadline.toISOString(),
        durationDays: project.durationDays,
        clientId: project.clientId,
        isArbiter,
        requirements: project.requirements,
        freelancer: project.proposals[0]?.freelancer ?? null,
        escrow: project.escrow ? {
          id: project.escrow.id,
          contractAddress: project.escrow.contractAddress,
          onChainId: project.escrow.onChainId?.toString() ?? null,
          amount: project.escrow.amount.toFixed(6),
          fee: project.escrow.fee.toFixed(6),
          status: project.escrow.status,
          fundedTx: project.escrow.fundedTx,
          submittedTx: project.escrow.submittedTx,
          revisionTx: project.escrow.revisionTx,
          releasedTx: project.escrow.releasedTx,
        } : null,
        submission: project.submissions[0] ?? null,
        dispute: project.disputes[0] ?? null,
        activity: project.activity.map((entry) => ({
          id: entry.id,
          type: entry.type,
          title: entry.title,
          detail: entry.detail,
          createdAt: entry.createdAt.toISOString(),
          actor: entry.actor?.name ?? null,
        })),
      },
    })
  } catch (error) {
    next(error)
  }
})

collaborationRouter.get('/notifications', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const userId = currentUserId(request, response)
  if (!userId) return
  const unreadValue = request.query.unread
  if (unreadValue !== undefined && unreadValue !== 'true' && unreadValue !== 'false') {
    fail(response, 400, 'VALIDATION_ERROR', 'The unread filter must be true or false.')
    return
  }
  const pageInput = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  }).safeParse(request.query)
  if (!pageInput.success) {
    fail(response, 400, 'VALIDATION_ERROR', 'Please check the pagination parameters.', pageInput.error.flatten())
    return
  }
  const where = {
    userId,
    ...(unreadValue === 'true' ? { readAt: null } : {}),
    ...(unreadValue === 'false' ? { readAt: { not: null } } : {}),
  }
  try {
    const [items, total] = await prisma.$transaction([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageInput.data.page - 1) * pageInput.data.pageSize,
        take: pageInput.data.pageSize,
      }),
      prisma.notification.count({ where }),
    ])
    response.json({
      items: items.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        readAt: item.readAt?.toISOString() ?? null,
      })),
      total,
      unreadCount: await prisma.notification.count({ where: { userId, readAt: null } }),
      page: pageInput.data.page,
      pageCount: Math.ceil(total / pageInput.data.pageSize),
    })
  } catch (error) {
    next(error)
  }
})

collaborationRouter.patch('/notifications/:notificationId/read', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const userId = currentUserId(request, response)
  if (!userId) return
  const notificationId = routeParam(request, 'notificationId')
  if (!notificationId) {
    fail(response, 404, 'NOTIFICATION_NOT_FOUND', 'This notification could not be found.')
    return
  }
  try {
    const result = await prisma.notification.updateMany({
      where: { id: notificationId, userId, readAt: null },
      data: { readAt: new Date() },
    })
    if (result.count === 0) {
      const existing = await prisma.notification.findFirst({
        where: { id: notificationId, userId },
        select: { id: true },
      })
      if (!existing) {
        fail(response, 404, 'NOTIFICATION_NOT_FOUND', 'This notification could not be found.')
        return
      }
    }
    response.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

collaborationRouter.post('/notifications/read-all', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const userId = currentUserId(request, response)
  if (!userId) return
  try {
    const result = await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    })
    response.json({ ok: true, updated: result.count })
  } catch (error) {
    next(error)
  }
})

collaborationRouter.get('/projects/:projectId/messages', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const userId = currentUserId(request, response)
  if (!userId) return
  const projectId = routeParam(request, 'projectId')
  if (!projectId) {
    fail(response, 404, 'PROJECT_NOT_FOUND', 'This project could not be found.')
    return
  }
  const pagination = z.object({
    before: z.iso.datetime().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }).safeParse(request.query)
  if (!pagination.success) {
    fail(response, 400, 'VALIDATION_ERROR', 'Please check the message pagination.', pagination.error.flatten())
    return
  }
  try {
    if (!(await canAccessProject(projectId, userId))) {
      fail(response, 403, 'FORBIDDEN', 'Only the project client and hired freelancer can view messages.')
      return
    }
    const before = pagination.data.before ? new Date(pagination.data.before) : undefined
    const items = await prisma.message.findMany({
      where: {
        projectId,
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      include: { sender: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
      take: pagination.data.limit,
    })
    await prisma.message.updateMany({
      where: { projectId, senderId: { not: userId }, readAt: null },
      data: { readAt: new Date() },
    })
    response.json({
      items: items.reverse().map((item) => ({
        id: item.id,
        projectId: item.projectId,
        body: item.body,
        attachments: item.attachments,
        createdAt: item.createdAt.toISOString(),
        readAt: item.readAt?.toISOString() ?? null,
        sender: item.sender,
      })),
    })
  } catch (error) {
    next(error)
  }
})

collaborationRouter.post('/projects/:projectId/messages', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const userId = currentUserId(request, response)
  if (!userId) return
  const projectId = routeParam(request, 'projectId')
  if (!projectId) {
    fail(response, 404, 'PROJECT_NOT_FOUND', 'This project could not be found.')
    return
  }
  const parsed = messageBodySchema.safeParse(request.body)
  if (!parsed.success) {
    fail(response, 400, 'VALIDATION_ERROR', 'Please check the message details.', parsed.error.flatten())
    return
  }
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        title: true,
        clientId: true,
        proposals: {
          where: { status: 'ACCEPTED' },
          select: { freelancerId: true },
          take: 1,
        },
      },
    })
    if (!project || (project.clientId !== userId && !project.proposals.some((proposal) => proposal.freelancerId === userId))) {
      fail(response, 403, 'FORBIDDEN', 'Only the project client and hired freelancer can send messages.')
      return
    }
    const recipientId = project.clientId === userId ? project.proposals[0]?.freelancerId : project.clientId
    const message = await prisma.$transaction(async (transaction) => {
      const created = await transaction.message.create({
        data: {
          projectId,
          senderId: userId,
          body: parsed.data.body,
          attachments: parsed.data.attachments,
        },
        include: { sender: { select: { id: true, name: true, avatarUrl: true } } },
      })
      if (recipientId) {
        await transaction.notification.create({
          data: {
            userId: recipientId,
            type: 'MESSAGE',
            title: 'New project message',
            detail: `You received a message about ${project.title}.`,
            link: `/workspace/${projectId}`,
          },
        })
      }
      return created
    })
    emitProjectRealtime(projectId, 'message:new', {
      id: message.id,
      projectId,
      body: message.body,
      attachments: message.attachments,
      createdAt: message.createdAt.toISOString(),
      readAt: null,
      sender: message.sender,
    })
    if (recipientId) {
      emitUserRealtime(recipientId, 'notification:new', {
        type: 'MESSAGE',
        title: 'New project message',
        detail: `You received a message about ${project.title}.`,
        link: `/workspace/${projectId}`,
      })
    }
    response.status(201).json({
      message: {
        id: message.id,
        projectId: message.projectId,
        body: message.body,
        attachments: message.attachments,
        createdAt: message.createdAt.toISOString(),
        readAt: null,
        sender: message.sender,
      },
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      next(error)
      return
    }
    next(error)
  }
})
