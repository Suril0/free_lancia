import { ProjectStatus, ProposalStatus, Prisma, UserRole } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { prisma } from './db.js'
import { requireAuth, type AuthenticatedRequest } from './auth.js'

export const projectsRouter = Router()
const proposalRouter = Router()

const decimalSchema = z.string()
  .regex(/^\d{1,12}(\.\d{1,6})?$/, 'Enter a valid PYUSD amount.')
  .refine((amount) => Number(amount) > 0, 'Enter a positive PYUSD amount.')
const projectStatuses = Object.values(ProjectStatus)

export const projectInputSchema = z.object({
  title: z.string().trim().min(5).max(120),
  description: z.string().trim().min(20).max(10_000),
  budget: decimalSchema,
  durationDays: z.number().int().min(1).max(365),
  deadline: z.iso.datetime()
    .refine((deadline) => new Date(deadline).getTime() > Date.now(), 'Choose a deadline in the future.')
    .optional(),
  skills: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  experienceLevel: z.enum(['Entry', 'Intermediate', 'Expert']).default('Intermediate'),
  remote: z.boolean().default(true),
  requirements: z.array(z.string().trim().min(1).max(300)).min(1).max(30),
})

const proposalInputSchema = z.object({
  price: decimalSchema,
  deliveryDays: z.number().int().min(1).max(365),
  coverMessage: z.string().trim().min(20).max(5000),
})

const patchProposalSchema = z.object({
  status: z.enum(['SHORTLISTED', 'REJECTED']),
})

const projectPatchSchema = projectInputSchema.partial().extend({
  status: z.enum(projectStatuses).optional(),
  featured: z.boolean().optional(),
})

function fail(response: Response, status: number, code: string, message: string, details?: unknown) {
  response.status(status).json({ code, message, ...(details ? { details } : {}) })
}

function validate<T>(schema: z.ZodType<T>, data: unknown, response: Response): T | undefined {
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    fail(response, 400, 'VALIDATION_ERROR', 'Please check the submitted details.', parsed.error.flatten())
    return undefined
  }
  return parsed.data
}

function authenticatedId(request: AuthenticatedRequest, response: Response) {
  if (!request.authUserId) {
    fail(response, 401, 'UNAUTHENTICATED', 'Sign in to continue.')
    return undefined
  }
  return request.authUserId
}

function routeParam(request: Request, name: string) {
  const value = request.params[name]
  return typeof value === 'string' ? value : undefined
}

async function requireRole(userId: string, role: UserRole, response: Response) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { roles: true, activeRole: true },
  })
  if (!user?.roles.includes(role) || user.activeRole !== role) {
    fail(response, 403, 'ROLE_NOT_AVAILABLE', `Switch to the ${role.toLowerCase()} role to continue.`)
    return false
  }
  return true
}

function asProject(item: {
  id: string
  clientId: string
  publicRef: string
  title: string
  description: string
  budget: Prisma.Decimal
  deadline: Date
  durationDays: number
  skills: string[]
  experienceLevel: string
  remote: boolean
  status: ProjectStatus
  featured: boolean
  proposalCount: number
  createdAt: Date
  client: {
    name: string
    location: string | null
    clientProfile: { paymentVerified: boolean; projectsPosted: number; totalSpent: Prisma.Decimal; ratingAvg: Prisma.Decimal } | null
  }
  requirements?: { id: string; text: string; order: number }[]
  _count?: { proposals: number }
}) {
  return {
    id: item.id,
    clientId: item.clientId,
    publicRef: item.publicRef,
    title: item.title,
    description: item.description,
    budget: item.budget.toFixed(2),
    currency: 'PYUSD',
    deadline: item.deadline.toISOString(),
    durationDays: item.durationDays,
    skills: item.skills,
    experienceLevel: item.experienceLevel,
    remote: item.remote,
    status: item.status,
    featured: item.featured,
    proposalCount: item._count?.proposals ?? item.proposalCount,
    createdAt: item.createdAt.toISOString(),
    client: {
      name: item.client.name,
      location: item.client.location,
      paymentVerified: item.client.clientProfile?.paymentVerified ?? false,
      projectsPosted: item.client.clientProfile?.projectsPosted ?? 0,
      totalSpent: item.client.clientProfile?.totalSpent.toFixed(2) ?? '0.00',
      ratingAvg: item.client.clientProfile?.ratingAvg.toFixed(2) ?? '0.00',
    },
    requirements: item.requirements?.map((requirement) => ({
      id: requirement.id,
      text: requirement.text,
      order: requirement.order,
    })),
  }
}

const projectInclude = {
  client: { include: { clientProfile: true } },
  requirements: { orderBy: { order: 'asc' as const } },
  _count: { select: { proposals: true } },
} as const

projectsRouter.get('/', async (request, response, next) => {
  const querySchema = z.object({
    q: z.string().trim().max(120).optional(),
    skills: z.union([z.string(), z.array(z.string())]).optional(),
    minBudget: decimalSchema.optional(),
    maxBudget: decimalSchema.optional(),
    deadlineBefore: z.iso.date().optional(),
    sort: z.enum(['relevant', 'newest', 'budget']).default('relevant'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(12),
  })
  const input = validate(querySchema, request.query, response)
  if (!input) return
  if (input.minBudget && input.maxBudget && new Prisma.Decimal(input.minBudget).gt(input.maxBudget)) {
    fail(response, 400, 'INVALID_BUDGET_RANGE', 'Minimum budget must not exceed maximum budget.')
    return
  }

  const rawSkills = input.skills
  const skills = rawSkills === undefined
    ? []
    : (Array.isArray(rawSkills) ? rawSkills : [rawSkills])
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter(Boolean)
  const where: Prisma.ProjectWhereInput = {
    status: ProjectStatus.OPEN,
    ...(input.q
      ? {
          OR: [
            { title: { contains: input.q, mode: 'insensitive' } },
            { description: { contains: input.q, mode: 'insensitive' } },
            { client: { name: { contains: input.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
    ...(skills.length ? { skills: { hasSome: skills } } : {}),
    ...(input.minBudget ? { budget: { gte: new Prisma.Decimal(input.minBudget) } } : {}),
    ...(input.maxBudget
      ? { budget: { ...(input.minBudget ? { gte: new Prisma.Decimal(input.minBudget) } : {}), lte: new Prisma.Decimal(input.maxBudget) } }
      : {}),
    ...(input.deadlineBefore ? { deadline: { lte: new Date(`${input.deadlineBefore}T23:59:59.999Z`) } } : {}),
  }

  try {
    const orderBy: Prisma.ProjectOrderByWithRelationInput[] =
      input.sort === 'newest'
        ? [{ createdAt: 'desc' }]
        : input.sort === 'budget'
          ? [{ budget: 'desc' }, { createdAt: 'desc' }]
          : [{ featured: 'desc' }, { proposalCount: 'asc' }, { createdAt: 'desc' }]
    const [items, total] = await prisma.$transaction([
      prisma.project.findMany({
        where,
        include: projectInclude,
        orderBy,
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      prisma.project.count({ where }),
    ])
    response.json({
      items: items.map(asProject),
      total,
      page: input.page,
      pageCount: Math.ceil(total / input.pageSize),
    })
  } catch (error) {
    next(error)
  }
})

projectsRouter.get('/featured', async (_request, response, next) => {
  try {
    const items = await prisma.project.findMany({
      where: { featured: true, status: ProjectStatus.OPEN },
      include: projectInclude,
      orderBy: { createdAt: 'desc' },
      take: 6,
    })
    response.json({ items: items.map(asProject) })
  } catch (error) {
    next(error)
  }
})

projectsRouter.get('/me', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const userId = authenticatedId(request, response)
  if (!userId) return
  const querySchema = z.object({
    status: z.enum(projectStatuses).optional(),
    role: z.enum(['client', 'freelancer']).optional(),
  })
  const input = validate(querySchema, request.query, response)
  if (!input) return
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { activeRole: true, roles: true },
    })
    if (!user) {
      fail(response, 401, 'UNAUTHENTICATED', 'This account is no longer available.')
      return
    }
    const role = input.role === 'client' ? UserRole.CLIENT : input.role === 'freelancer' ? UserRole.FREELANCER : user.activeRole
    if (!user.roles.includes(role)) {
      fail(response, 403, 'ROLE_NOT_AVAILABLE', 'This account does not have that role.')
      return
    }
    const where: Prisma.ProjectWhereInput = {
      ...(input.status ? { status: input.status } : {}),
      ...(role === UserRole.CLIENT
        ? { clientId: userId }
        : { proposals: { some: { freelancerId: userId } } }),
    }
    const items = await prisma.project.findMany({
      where,
      include: projectInclude,
      orderBy: { updatedAt: 'desc' },
    })
    response.json({ items: items.map(asProject) })
  } catch (error) {
    next(error)
  }
})

projectsRouter.get('/me/dashboard', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const userId = authenticatedId(request, response)
  if (!userId) return
  const roleInput = validate(z.object({ role: z.enum(['client', 'freelancer']).optional() }), request.query, response)
  if (!roleInput) return
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        roles: true,
        activeRole: true,
        freelancerProfile: true,
      },
    })
    if (!user) {
      fail(response, 401, 'UNAUTHENTICATED', 'This account is no longer available.')
      return
    }
    const role = roleInput.role === 'client'
      ? UserRole.CLIENT
      : roleInput.role === 'freelancer'
        ? UserRole.FREELANCER
        : user.activeRole
    if (!user.roles.includes(role)) {
      fail(response, 403, 'ROLE_NOT_AVAILABLE', 'This account does not have that role.')
      return
    }

    if (role === UserRole.CLIENT) {
      const [open, inProgress, awaitingReview, completed, disputed, escrow, pendingReviews] = await Promise.all([
        prisma.project.count({ where: { clientId: userId, status: ProjectStatus.OPEN } }),
        prisma.project.count({ where: { clientId: userId, status: ProjectStatus.IN_PROGRESS } }),
        prisma.project.count({ where: { clientId: userId, status: ProjectStatus.AWAITING_REVIEW } }),
        prisma.project.count({ where: { clientId: userId, status: ProjectStatus.COMPLETED } }),
        prisma.project.count({ where: { clientId: userId, status: ProjectStatus.DISPUTED } }),
        prisma.escrow.aggregate({
          where: { project: { clientId: userId }, status: { in: ['FUNDED', 'IN_PROGRESS', 'SUBMITTED', 'AI_VERIFIED', 'APPROVED'] } },
          _sum: { amount: true },
        }),
        prisma.project.count({ where: { clientId: userId, status: ProjectStatus.AWAITING_REVIEW } }),
      ])
      response.json({
        role: 'client',
        stats: {
          activeProjects: inProgress,
          openProjects: open,
          fundsInEscrow: escrow._sum.amount?.toFixed(2) ?? '0.00',
          completed,
          pendingReviews,
          disputed,
          successRate: completed + disputed === 0 ? '0.00' : new Prisma.Decimal(completed).mul(100).div(completed + disputed).toFixed(2),
          awaitingReview,
        },
      })
      return
    }

    const sixMonthsAgo = new Date()
    sixMonthsAgo.setDate(1)
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5)
    const [applied, active, submitted, completed, releases] = await Promise.all([
      prisma.proposal.count({ where: { freelancerId: userId, status: { in: [ProposalStatus.PENDING, ProposalStatus.SHORTLISTED] } } }),
      prisma.proposal.count({
        where: { freelancerId: userId, status: ProposalStatus.ACCEPTED, project: { status: ProjectStatus.IN_PROGRESS } },
      }),
      prisma.proposal.count({
        where: { freelancerId: userId, status: ProposalStatus.ACCEPTED, project: { status: ProjectStatus.AWAITING_REVIEW } },
      }),
      prisma.proposal.count({
        where: { freelancerId: userId, status: ProposalStatus.ACCEPTED, project: { status: ProjectStatus.COMPLETED } },
      }),
      prisma.transaction.findMany({
        where: { userId, type: 'RELEASE', status: 'CONFIRMED', createdAt: { gte: sixMonthsAgo } },
        select: { amount: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ])
    const monthLabels = Array.from({ length: 6 }, (_unused, index) => {
      const month = new Date(sixMonthsAgo)
      month.setMonth(sixMonthsAgo.getMonth() + index)
      return { year: month.getFullYear(), month: month.getMonth(), label: month.toLocaleString('en-US', { month: 'short' }) }
    })
    const earnings = monthLabels.map(({ year, month, label }) => {
      const amount = releases
        .filter((entry) => entry.createdAt.getFullYear() === year && entry.createdAt.getMonth() === month)
        .reduce((sum, entry) => sum.plus(entry.amount), new Prisma.Decimal(0))
      return { month: label, amount: amount.toFixed(2) }
    })
    const currentWindowStart = new Date(sixMonthsAgo)
    currentWindowStart.setMonth(currentWindowStart.getMonth() + 3)
    const currentPeriod = releases
      .filter((entry) => entry.createdAt >= currentWindowStart)
      .reduce((sum, entry) => sum.plus(entry.amount), new Prisma.Decimal(0))
    const totalReceived = user.freelancerProfile?.totalEarned ?? new Prisma.Decimal(0)
    response.json({
      role: 'freelancer',
      stats: {
        totalEarnings: totalReceived.toFixed(2),
        activeJobs: active,
        submitted,
        applied,
        completed,
        successRate: user.freelancerProfile?.successRate.toFixed(2) ?? '0.00',
        rating: user.freelancerProfile?.ratingAvg.toFixed(2) ?? '0.00',
        earnings,
        earningsChange: currentPeriod.toFixed(2),
      },
    })
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const userId = authenticatedId(request, response)
  if (!userId) return
  const input = validate(projectInputSchema, request.body, response)
  if (!input) return
  try {
    if (!(await requireRole(userId, UserRole.CLIENT, response))) return
    const deadline = input.deadline ? new Date(input.deadline) : new Date(Date.now() + input.durationDays * 86_400_000)
    const ref = `FL-${Date.now()}-${randomUUID().slice(0, 4).toUpperCase()}`
    const project = await prisma.$transaction(async (transaction) => {
      const created = await transaction.project.create({
        data: {
          clientId: userId,
          title: input.title,
          description: input.description,
          budget: new Prisma.Decimal(input.budget),
          deadline,
          durationDays: input.durationDays,
          skills: input.skills,
          experienceLevel: input.experienceLevel,
          remote: input.remote,
          publicRef: ref,
          requirements: {
            create: input.requirements.map((text, order) => ({ text, order })),
          },
          activity: {
            create: {
              actorId: userId,
              type: 'PROJECT_CREATED',
              title: 'Project posted',
              detail: `Project ${ref} was posted.`,
            },
          },
        },
        include: projectInclude,
      })
      await transaction.clientProfile.update({
        where: { userId },
        data: { projectsPosted: { increment: 1 } },
      })
      return created
    })
    response.status(201).json({ project: asProject(project) })
  } catch (error) {
    next(error)
  }
})

projectsRouter.get('/:projectId', async (request, response, next) => {
  const projectId = routeParam(request, 'projectId')
  if (!projectId) {
    fail(response, 404, 'PROJECT_NOT_FOUND', 'This project could not be found.')
    return
  }
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: projectInclude,
    })
    if (!project) {
      fail(response, 404, 'PROJECT_NOT_FOUND', 'This project could not be found.')
      return
    }
    response.json({ project: asProject(project) })
  } catch (error) {
    next(error)
  }
})

projectsRouter.patch('/:projectId', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const userId = authenticatedId(request, response)
  if (!userId) return
  const projectId = routeParam(request, 'projectId')
  if (!projectId) {
    fail(response, 404, 'PROJECT_NOT_FOUND', 'This project could not be found.')
    return
  }
  const input = validate(projectPatchSchema, request.body, response)
  if (!input) return
  try {
    const existing = await prisma.project.findUnique({ where: { id: projectId } })
    if (!existing) {
      fail(response, 404, 'PROJECT_NOT_FOUND', 'This project could not be found.')
      return
    }
    if (existing.clientId !== userId) {
      fail(response, 403, 'FORBIDDEN', 'Only the project owner can update this project.')
      return
    }
    if (existing.status !== ProjectStatus.OPEN) {
      fail(response, 409, 'INVALID_PROJECT_STATE', 'Only open projects can be edited.')
      return
    }
    if (input.status || input.featured !== undefined) {
      fail(response, 409, 'INVALID_PROJECT_STATE', 'Project status and featured placement are managed by the marketplace.')
      return
    }
    const project = await prisma.project.update({
      where: { id: existing.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.budget !== undefined ? { budget: new Prisma.Decimal(input.budget) } : {}),
        ...(input.durationDays !== undefined ? { durationDays: input.durationDays } : {}),
        ...(input.deadline !== undefined ? { deadline: new Date(input.deadline) } : {}),
        ...(input.skills !== undefined ? { skills: input.skills } : {}),
        ...(input.experienceLevel !== undefined ? { experienceLevel: input.experienceLevel } : {}),
        ...(input.remote !== undefined ? { remote: input.remote } : {}),
        ...(input.requirements !== undefined
          ? {
              requirements: {
                deleteMany: {},
                create: input.requirements.map((text, order) => ({ text, order })),
              },
            }
          : {}),
      },
      include: projectInclude,
    })
    response.json({ project: asProject(project) })
  } catch (error) {
    next(error)
  }
})

projectsRouter.delete('/:projectId', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const userId = authenticatedId(request, response)
  if (!userId) return
  const projectId = routeParam(request, 'projectId')
  if (!projectId) {
    fail(response, 404, 'PROJECT_NOT_FOUND', 'This project could not be found.')
    return
  }
  try {
    const project = await prisma.project.findUnique({ where: { id: projectId } })
    if (!project) {
      fail(response, 404, 'PROJECT_NOT_FOUND', 'This project could not be found.')
      return
    }
    if (project.clientId !== userId) {
      fail(response, 403, 'FORBIDDEN', 'Only the project owner can cancel this project.')
      return
    }
    if (project.status !== ProjectStatus.OPEN) {
      fail(response, 409, 'INVALID_PROJECT_STATE', 'Only open projects can be cancelled.')
      return
    }
    await prisma.project.update({
      where: { id: project.id },
      data: { status: ProjectStatus.CANCELLED },
    })
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

projectsRouter.post('/:projectId/proposals', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const userId = authenticatedId(request, response)
  if (!userId) return
  const projectId = routeParam(request, 'projectId')
  if (!projectId) {
    fail(response, 404, 'PROJECT_NOT_FOUND', 'This project could not be found.')
    return
  }
  const input = validate(proposalInputSchema, request.body, response)
  if (!input) return
  try {
    if (!(await requireRole(userId, UserRole.FREELANCER, response))) return
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, status: true, clientId: true },
    })
    if (!project) {
      fail(response, 404, 'PROJECT_NOT_FOUND', 'This project could not be found.')
      return
    }
    if (project.status !== ProjectStatus.OPEN || project.clientId === userId) {
      fail(response, 409, 'PROJECT_NOT_AVAILABLE', 'You cannot apply to this project.')
      return
    }
    const proposal = await prisma.$transaction(async (transaction) => {
      const created = await transaction.proposal.create({
        data: {
          projectId: project.id,
          freelancerId: userId,
          price: new Prisma.Decimal(input.price),
          deliveryDays: input.deliveryDays,
          coverMessage: input.coverMessage,
        },
        include: {
          freelancer: {
            select: { id: true, name: true, title: true, freelancerProfile: true },
          },
        },
      })
      await transaction.project.update({
        where: { id: project.id },
        data: { proposalCount: { increment: 1 } },
      })
      await transaction.notification.create({
        data: {
          userId: project.clientId,
          type: 'SYSTEM',
          title: 'New proposal received',
          detail: `${created.freelancer.name} applied to your project.`,
          link: `/projects/${project.id}`,
        },
      })
      return created
    })
    response.status(201).json({ proposal })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      fail(response, 409, 'PROPOSAL_EXISTS', 'You have already applied to this project.')
      return
    }
    next(error)
  }
})

projectsRouter.get('/:projectId/proposals', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const userId = authenticatedId(request, response)
  if (!userId) return
  const projectId = routeParam(request, 'projectId')
  if (!projectId) {
    fail(response, 404, 'PROJECT_NOT_FOUND', 'This project could not be found.')
    return
  }
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, clientId: true },
    })
    if (!project) {
      fail(response, 404, 'PROJECT_NOT_FOUND', 'This project could not be found.')
      return
    }
    if (project.clientId !== userId) {
      fail(response, 403, 'FORBIDDEN', 'Only the project owner can view proposals.')
      return
    }
    const proposals = await prisma.proposal.findMany({
      where: { projectId: project.id },
      include: {
        freelancer: {
          select: {
            id: true,
            name: true,
            title: true,
            avatarUrl: true,
            freelancerProfile: true,
            wallet: true,
          },
        },
        shortlist: true,
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    })
    response.json({ items: proposals })
  } catch (error) {
    next(error)
  }
})

proposalRouter.get('/compare', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const userId = authenticatedId(request, response)
  if (!userId) return
  const ids = typeof request.query.ids === 'string'
    ? request.query.ids.split(',').filter(Boolean)
    : []
  if (!ids.length || ids.length > 5 || ids.some((id) => id.length > 64)) {
    fail(response, 400, 'VALIDATION_ERROR', 'Provide between one and five valid proposal IDs.')
    return
  }
  try {
    const proposals = await prisma.proposal.findMany({
      where: {
        id: { in: ids },
        project: { clientId: userId },
      },
      include: {
        freelancer: {
          select: { id: true, name: true, title: true, freelancerProfile: true, wallet: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    })
    if (proposals.length !== ids.length) {
      fail(response, 404, 'PROPOSAL_NOT_FOUND', 'One or more proposals are unavailable.')
      return
    }
    response.json({ items: proposals })
  } catch (error) {
    next(error)
  }
})

proposalRouter.patch('/:proposalId', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const userId = authenticatedId(request, response)
  if (!userId) return
  const proposalId = routeParam(request, 'proposalId')
  if (!proposalId) {
    fail(response, 404, 'PROPOSAL_NOT_FOUND', 'This proposal could not be found.')
    return
  }
  const input = validate(patchProposalSchema, request.body, response)
  if (!input) return
  try {
    const proposal = await prisma.proposal.findUnique({
      where: { id: proposalId },
      include: { project: { select: { clientId: true, status: true } } },
    })
    if (!proposal) {
      fail(response, 404, 'PROPOSAL_NOT_FOUND', 'This proposal could not be found.')
      return
    }
    if (proposal.project.clientId !== userId) {
      fail(response, 403, 'FORBIDDEN', 'Only the project owner can manage proposals.')
      return
    }
    if (
      proposal.project.status !== ProjectStatus.OPEN ||
      (proposal.status !== ProposalStatus.PENDING && proposal.status !== ProposalStatus.SHORTLISTED)
    ) {
      fail(response, 409, 'INVALID_PROPOSAL_STATE', 'This proposal can no longer be changed.')
      return
    }
    const updated = await prisma.$transaction(async (transaction) => {
      const result = await transaction.proposal.update({
        where: { id: proposal.id },
        data: { status: input.status },
      })
      if (input.status === ProposalStatus.SHORTLISTED) {
        await transaction.shortlist.upsert({
          where: { proposalId: proposal.id },
          create: { clientId: userId, proposalId: proposal.id },
          update: { clientId: userId },
        })
      } else {
        await transaction.shortlist.deleteMany({ where: { proposalId: proposal.id, clientId: userId } })
      }
      return result
    })
    response.json({ proposal: updated })
  } catch (error) {
    next(error)
  }
})

proposalRouter.post('/:proposalId/hire', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const userId = authenticatedId(request, response)
  if (!userId) return
  const proposalId = routeParam(request, 'proposalId')
  if (!proposalId) {
    fail(response, 404, 'PROPOSAL_NOT_FOUND', 'This proposal could not be found.')
    return
  }
  try {
    const result = await prisma.$transaction(async (transaction) => {
      const proposal = await transaction.proposal.findUnique({
        where: { id: proposalId },
        include: { project: true },
      })
      if (!proposal) return { error: 'NOT_FOUND' as const }
      if (proposal.project.clientId !== userId) return { error: 'FORBIDDEN' as const }
      if (
        proposal.project.status !== ProjectStatus.OPEN ||
        (proposal.status !== ProposalStatus.PENDING && proposal.status !== ProposalStatus.SHORTLISTED)
      ) {
        return { error: 'INVALID_STATE' as const }
      }
      const updated = await transaction.proposal.update({
        where: { id: proposal.id },
        data: { status: ProposalStatus.ACCEPTED },
      })
      await transaction.proposal.updateMany({
        where: { projectId: proposal.projectId, id: { not: proposal.id }, status: { in: [ProposalStatus.PENDING, ProposalStatus.SHORTLISTED] } },
        data: { status: ProposalStatus.REJECTED },
      })
      await transaction.project.update({
        where: { id: proposal.projectId },
        data: { status: ProjectStatus.IN_PROGRESS },
      })
      await transaction.activityLog.create({
        data: {
          projectId: proposal.projectId,
          actorId: userId,
          type: 'FREELANCER_HIRED',
          title: 'Freelancer hired',
          detail: 'The client selected a freelancer. Escrow funding is the next step.',
        },
      })
      await transaction.notification.create({
        data: {
          userId: proposal.freelancerId,
          type: 'HIRED',
          title: 'You were hired',
          detail: `You were selected for ${proposal.project.title}.`,
          link: `/workspace/${proposal.projectId}`,
        },
      })
      return { proposal: updated, projectId: proposal.projectId }
    })
    if ('error' in result) {
      const statuses = {
        NOT_FOUND: [404, 'PROPOSAL_NOT_FOUND', 'This proposal could not be found.'],
        FORBIDDEN: [403, 'FORBIDDEN', 'Only the project owner can hire a freelancer.'],
        INVALID_STATE: [409, 'INVALID_PROPOSAL_STATE', 'This project or proposal can no longer be hired.'],
      } as const
      const [status, code, message] = statuses[result.error]
      fail(response, status, code, message)
      return
    }
    response.json(result)
  } catch (error) {
    next(error)
  }
})

export { proposalRouter }
