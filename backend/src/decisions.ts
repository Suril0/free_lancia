import { DisputeStatus, EscrowStatus, ProjectStatus, ProposalStatus, Prisma } from '@prisma/client'
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { prisma } from './db.js'
import { requireAuth, type AuthenticatedRequest } from './auth.js'

export const decisionsRouter = Router()
const revisionInput = z.object({ feedback: z.string().trim().min(10).max(5000) })
const disputeInput = z.object({ reason: z.string().trim().min(20).max(5000) })
const approvalInput = z.object({ decision: z.literal('approve') })
const evidenceInput = z.object({
  text: z.string().trim().min(1).max(5000),
  fileUrl: z.url().max(2048).optional(),
})
const reviewInput = z.object({
  revieweeId: z.string().min(1).max(64),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().min(10).max(2000),
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

function validate<T>(schema: z.ZodType<T>, body: unknown, response: Response) {
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    fail(response, 400, 'VALIDATION_ERROR', 'Please check the submitted details.', parsed.error.flatten())
    return undefined
  }
  return parsed.data
}

async function getParticipantProject(projectId: string, userId: string) {
  return prisma.project.findFirst({
    where: {
      id: projectId,
      OR: [
        { clientId: userId },
        { proposals: { some: { freelancerId: userId, status: ProposalStatus.ACCEPTED } } },
      ],
    },
    include: {
      escrow: true,
      client: { select: { id: true, name: true } },
      proposals: {
        where: { status: ProposalStatus.ACCEPTED },
        select: { freelancerId: true, freelancer: { select: { id: true, name: true } } },
        take: 1,
      },
    },
  })
}

decisionsRouter.post('/projects/:projectId/revisions', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const userId = currentUserId(request, response)
  if (!userId) return
  const projectId = routeParam(request, 'projectId')
  if (!projectId) {
    fail(response, 404, 'PROJECT_NOT_FOUND', 'This project could not be found.')
    return
  }
  const input = validate(revisionInput, request.body, response)
  if (!input) return
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { submissions: { orderBy: { version: 'desc' }, take: 1 }, escrow: true },
    })
    if (!project) {
      fail(response, 404, 'PROJECT_NOT_FOUND', 'This project could not be found.')
      return
    }
    if (project.clientId !== userId) {
      fail(response, 403, 'FORBIDDEN', 'Only the project client can request a revision.')
      return
    }
    const submission = project.submissions[0]
    if (project.status !== ProjectStatus.AWAITING_REVIEW || !submission) {
      fail(response, 409, 'INVALID_PROJECT_STATE', 'A revision can only be requested for submitted work awaiting review.')
      return
    }
    if (project.escrow?.onChainId && project.escrow.status !== EscrowStatus.REVISION_REQUESTED) {
      fail(response, 409, 'ONCHAIN_REVISION_REQUIRED', 'Confirm the on-chain revision request before saving the revision.')
      return
    }
    const result = await prisma.$transaction(async (transaction) => {
      const revision = await transaction.revision.create({
        data: { submissionId: submission.id, requestedBy: userId, feedback: input.feedback },
      })
      await transaction.project.update({
        where: { id: project.id },
        data: { status: ProjectStatus.IN_PROGRESS },
      })
      if (project.escrow) {
        await transaction.escrow.update({
          where: { projectId: project.id },
          data: { status: EscrowStatus.REVISION_REQUESTED },
        })
      }
      await transaction.activityLog.create({
        data: {
          projectId: project.id,
          actorId: userId,
          type: 'REVISION_REQUESTED',
          title: 'Revision requested',
          detail: input.feedback,
        },
      })
      await transaction.notification.create({
        data: {
          userId: submission.freelancerId,
          type: 'REVISION_REQUESTED',
          title: 'Revision requested',
          detail: `The client requested changes to ${project.title}.`,
          link: `/workspace/${project.id}`,
        },
      })
      return revision
    })
    response.status(201).json({ revision: result })
  } catch (error) {
    next(error)
  }
})

decisionsRouter.post('/projects/:projectId/approve', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const userId = currentUserId(request, response)
  if (!userId) return
  const projectId = routeParam(request, 'projectId')
  if (!projectId) {
    fail(response, 404, 'PROJECT_NOT_FOUND', 'This project could not be found.')
    return
  }
  const input = validate(approvalInput, request.body, response)
  if (!input) return
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { escrow: true, submissions: { orderBy: { version: 'desc' }, take: 1 } },
    })
    if (!project) {
      fail(response, 404, 'PROJECT_NOT_FOUND', 'This project could not be found.')
      return
    }
    if (project.clientId !== userId) {
      fail(response, 403, 'FORBIDDEN', 'Only the project client can approve submitted work.')
      return
    }
    if (project.status !== ProjectStatus.AWAITING_REVIEW || !project.submissions[0]) {
      fail(response, 409, 'INVALID_PROJECT_STATE', 'Submitted work must be awaiting review before approval.')
      return
    }
    if (!project.escrow || project.escrow.status !== EscrowStatus.SUBMITTED && project.escrow.status !== EscrowStatus.AI_VERIFIED) {
      fail(response, 409, 'ESCROW_NOT_READY', 'A funded escrow with submitted work is required.')
      return
    }
    const freelancerId = project.submissions[0].freelancerId
    const result = await prisma.$transaction(async (transaction) => {
      const escrow = await transaction.escrow.update({
        where: { projectId },
        data: { status: EscrowStatus.APPROVED },
      })
      await transaction.activityLog.create({
        data: {
          projectId,
          actorId: userId,
          type: 'WORK_APPROVED',
          title: 'Work approved',
          detail: 'The client approved the submitted work. On-chain release is the remaining payment step.',
        },
      })
      await transaction.notification.create({
        data: {
          userId: freelancerId,
          type: 'SYSTEM',
          title: 'Work approved',
          detail: `The submitted work for ${project.title} was approved.`,
          link: `/workspace/${projectId}`,
        },
      })
      return escrow
    })
    response.json({ escrow: { status: result.status } })
  } catch (error) {
    next(error)
  }
})

decisionsRouter.post('/projects/:projectId/disputes', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const userId = currentUserId(request, response)
  if (!userId) return
  const projectId = routeParam(request, 'projectId')
  if (!projectId) {
    fail(response, 404, 'PROJECT_NOT_FOUND', 'This project could not be found.')
    return
  }
  const input = validate(disputeInput, request.body, response)
  if (!input) return
  try {
    const project = await getParticipantProject(projectId, userId)
    if (!project) {
      fail(response, 404, 'PROJECT_NOT_FOUND', 'This project or your project access could not be found.')
      return
    }
    if (project.status !== ProjectStatus.IN_PROGRESS && project.status !== ProjectStatus.AWAITING_REVIEW) {
      fail(response, 409, 'INVALID_PROJECT_STATE', 'A dispute cannot be opened in the current project state.')
      return
    }
    if (project.escrow?.onChainId && project.escrow.status !== EscrowStatus.DISPUTED) {
      fail(response, 409, 'ONCHAIN_DISPUTE_REQUIRED', 'Confirm the on-chain dispute before saving the dispute details.')
      return
    }
    const otherParty = project.clientId === userId ? project.proposals[0]?.freelancerId : project.clientId
    if (!otherParty) {
      fail(response, 409, 'PROJECT_NOT_HIRED', 'A dispute requires a hired freelancer.')
      return
    }
    const result = await prisma.$transaction(async (transaction) => {
      const dispute = await transaction.dispute.create({
        data: {
          projectId: project.id,
          openedBy: userId,
          reason: input.reason,
          deadlineToRespond: new Date(Date.now() + 7 * 86_400_000),
        },
      })
      const changed = await transaction.project.updateMany({
        where: { id: project.id, status: { in: [ProjectStatus.IN_PROGRESS, ProjectStatus.AWAITING_REVIEW] } },
        data: { status: ProjectStatus.DISPUTED },
      })
      if (changed.count !== 1) throw new Error('Project state changed while opening dispute')
      if (project.escrow) {
        await transaction.escrow.update({
          where: { projectId: project.id },
          data: { status: EscrowStatus.DISPUTED },
        })
      }
      await transaction.activityLog.create({
        data: {
          projectId: project.id,
          actorId: userId,
          type: 'DISPUTE_OPENED',
          title: 'Dispute opened',
          detail: input.reason,
        },
      })
      await transaction.notification.create({
        data: {
          userId: otherParty,
          type: 'DISPUTE_OPENED',
          title: 'A dispute was opened',
          detail: `A dispute was opened for ${project.title}.`,
          link: `/workspace/${project.id}`,
        },
      })
      return dispute
    })
    response.status(201).json({ dispute: result })
  } catch (error) {
    if (error instanceof Error && error.message === 'Project state changed while opening dispute') {
      fail(response, 409, 'INVALID_PROJECT_STATE', 'The project changed state. Refresh and try again.')
      return
    }
    next(error)
  }
})

decisionsRouter.get('/disputes/:disputeId', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const userId = currentUserId(request, response)
  if (!userId) return
  const disputeId = routeParam(request, 'disputeId')
  if (!disputeId) {
    fail(response, 404, 'DISPUTE_NOT_FOUND', 'This dispute could not be found.')
    return
  }
  try {
    const dispute = await prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        project: {
          select: {
            id: true,
            title: true,
            clientId: true,
            proposals: {
              where: { status: ProposalStatus.ACCEPTED },
              select: { freelancerId: true },
              take: 1,
            },
          },
        },
        opener: { select: { id: true, name: true } },
        evidence: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    })
    if (!dispute) {
      fail(response, 404, 'DISPUTE_NOT_FOUND', 'This dispute could not be found.')
      return
    }
    const isParticipant = dispute.project.clientId === userId ||
      dispute.project.proposals.some((proposal) => proposal.freelancerId === userId)
    if (!isParticipant) {
      fail(response, 403, 'FORBIDDEN', 'Only the project participants can view this dispute.')
      return
    }
    response.json({ dispute })
  } catch (error) {
    next(error)
  }
})

decisionsRouter.post('/disputes/:disputeId/evidence', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const userId = currentUserId(request, response)
  if (!userId) return
  const disputeId = routeParam(request, 'disputeId')
  if (!disputeId) {
    fail(response, 404, 'DISPUTE_NOT_FOUND', 'This dispute could not be found.')
    return
  }
  const input = validate(evidenceInput, request.body, response)
  if (!input) return
  try {
    const dispute = await prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        project: {
          select: {
            clientId: true,
            proposals: {
              where: { freelancerId: userId, status: ProposalStatus.ACCEPTED },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
    })
    if (!dispute) {
      fail(response, 404, 'DISPUTE_NOT_FOUND', 'This dispute could not be found.')
      return
    }
    if (dispute.project.clientId !== userId && dispute.project.proposals.length === 0) {
      fail(response, 403, 'FORBIDDEN', 'Only project participants can submit evidence.')
      return
    }
    if (dispute.status !== DisputeStatus.OPEN && dispute.status !== DisputeStatus.UNDER_REVIEW) {
      fail(response, 409, 'DISPUTE_CLOSED', 'Evidence can no longer be added to this dispute.')
      return
    }
    const evidence = await prisma.disputeEvidence.create({
      data: {
        disputeId,
        userId,
        text: input.text,
        ...(input.fileUrl ? { fileUrl: input.fileUrl } : {}),
      },
    })
    response.status(201).json({ evidence })
  } catch (error) {
    next(error)
  }
})

decisionsRouter.post('/projects/:projectId/reviews', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const userId = currentUserId(request, response)
  if (!userId) return
  const projectId = routeParam(request, 'projectId')
  if (!projectId) {
    fail(response, 404, 'PROJECT_NOT_FOUND', 'This project could not be found.')
    return
  }
  const input = validate(reviewInput, request.body, response)
  if (!input) return
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        proposals: {
          where: { status: ProposalStatus.ACCEPTED },
          select: { freelancerId: true },
          take: 1,
        },
      },
    })
    if (!project) {
      fail(response, 404, 'PROJECT_NOT_FOUND', 'This project could not be found.')
      return
    }
    if (project.status !== ProjectStatus.COMPLETED) {
      fail(response, 409, 'PROJECT_NOT_COMPLETE', 'Reviews can be submitted after the project is completed.')
      return
    }
    const freelancerId = project.proposals[0]?.freelancerId
    if (!freelancerId || ![project.clientId, freelancerId].includes(userId)) {
      fail(response, 403, 'FORBIDDEN', 'Only the project participants can leave a review.')
      return
    }
    const expectedReviewee = userId === project.clientId ? freelancerId : project.clientId
    if (input.revieweeId !== expectedReviewee) {
      fail(response, 400, 'INVALID_REVIEW_TARGET', 'Reviews must be for the other project participant.')
      return
    }

    const review = await prisma.$transaction(async (transaction) => {
      const created = await transaction.review.create({
        data: {
          projectId,
          reviewerId: userId,
          revieweeId: expectedReviewee,
          rating: input.rating,
          comment: input.comment,
        },
      })
      const aggregate = await transaction.review.aggregate({
        where: { revieweeId: expectedReviewee },
        _avg: { rating: true },
        _count: { _all: true },
      })
      const average = new Prisma.Decimal(aggregate._avg.rating ?? 0).toDecimalPlaces(2)
      if (expectedReviewee === freelancerId) {
        await transaction.freelancerProfile.update({
          where: { userId: expectedReviewee },
          data: { ratingAvg: average, ratingCount: aggregate._count._all },
        })
      } else {
        await transaction.clientProfile.update({
          where: { userId: expectedReviewee },
          data: { ratingAvg: average },
        })
      }
      return created
    })
    response.status(201).json({ review })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      fail(response, 409, 'REVIEW_EXISTS', 'You have already reviewed this project.')
      return
    }
    next(error)
  }
})
