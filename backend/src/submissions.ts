import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { EscrowStatus, ProjectStatus, ProposalStatus, UserRole } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { prisma } from './db.js'
import { requireAuth, type AuthenticatedRequest } from './auth.js'
import { logger } from './logger.js'
import { enqueueSubmissionVerification } from './verification-queue.js'

export const submissionsRouter = Router()
const MAX_FILE_SIZE = 25 * 1024 * 1024
const allowedContentTypes = [
  'application/pdf',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
] as const

const presignSchema = z.object({
  contentType: z.enum(allowedContentTypes),
  sizeBytes: z.number().int().min(1).max(MAX_FILE_SIZE),
})

const submissionSchema = z.object({
  notes: z.string().trim().min(1).max(5000),
  repoUrl: z.url().max(2048).refine((url) => url.startsWith('https://')).nullable().optional(),
  liveUrl: z.url().max(2048).refine((url) => url.startsWith('https://')).nullable().optional(),
  files: z.array(z.string().min(1).max(512)).max(10).default([]),
  requirementChecklist: z.array(z.object({
    requirementId: z.string().min(1).max(128),
    completed: z.boolean(),
  }).strict()).max(30),
}).strict()

function fail(response: Response, status: number, code: string, message: string) {
  response.status(status).json({ code, message })
}

function param(request: Request, key: string) {
  const value = request.params[key]
  return typeof value === 'string' ? value : undefined
}

function authenticatedId(request: AuthenticatedRequest, response: Response) {
  if (!request.authUserId) {
    fail(response, 401, 'UNAUTHENTICATED', 'Sign in to continue.')
    return undefined
  }
  return request.authUserId
}

function storageConfiguration() {
  const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env
  if (!S3_REGION || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    throw new Error('S3 upload storage is not configured.')
  }
  return {
    bucket: S3_BUCKET,
    client: new S3Client({
      region: S3_REGION,
      ...(S3_ENDPOINT ? { endpoint: S3_ENDPOINT, forcePathStyle: true } : {}),
      credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
    }),
  }
}

async function hasAcceptedProjectAssignment(projectId: string, freelancerId: string) {
  const acceptedProposal = await prisma.proposal.findFirst({
    where: { projectId, freelancerId, status: ProposalStatus.ACCEPTED },
    select: { id: true },
  })
  return Boolean(acceptedProposal)
}

async function uploadedFilesAreValid(keys: string[], userId: string, projectId: string) {
  if (!validFileKeys(keys, userId, projectId)) return false
  if (!keys.length) return true
  const { bucket, client } = storageConfiguration()
  const objects = await Promise.all(keys.map((key) =>
    client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })),
  ))
  return objects.every((object) =>
    typeof object.ContentLength === 'number' &&
    object.ContentLength > 0 &&
    object.ContentLength <= MAX_FILE_SIZE &&
    allowedContentTypes.includes(object.ContentType as typeof allowedContentTypes[number]),
  )
}

function validFileKeys(keys: string[], userId: string, projectId: string) {
  const prefix = `submissions/${userId}/${projectId}/`
  return new Set(keys).size === keys.length && keys.every((key) =>
    key.startsWith(prefix) && !key.includes('..') && !key.includes('\\'),
  )
}

submissionsRouter.use(requireAuth)

submissionsRouter.post('/projects/:projectId/uploads/presign', async (request, response, next) => {
  const userId = authenticatedId(request, response)
  const projectId = param(request, 'projectId')
  if (!userId || !projectId) return
  const parsed = presignSchema.safeParse(request.body)
  if (!parsed.success) {
    fail(response, 400, 'VALIDATION_ERROR', 'Use an allowed file type and a size of 25 MB or less.')
    return
  }

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { status: true },
    })
    if (!project) {
      fail(response, 404, 'PROJECT_NOT_FOUND', 'Project not found.')
      return
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { activeRole: true, roles: true } })
    if (
      !user?.roles.includes(UserRole.FREELANCER) ||
      user.activeRole !== UserRole.FREELANCER ||
      !await hasAcceptedProjectAssignment(projectId, userId) ||
      (project.status !== ProjectStatus.IN_PROGRESS && project.status !== ProjectStatus.AWAITING_REVIEW)
    ) {
      fail(response, 403, 'NOT_ASSIGNED_FREELANCER', 'Only the assigned freelancer can upload submission files.')
      return
    }

    const { bucket, client } = storageConfiguration()
    const key = `submissions/${userId}/${projectId}/${randomUUID()}`
    const presigned = await createPresignedPost(client, {
      Bucket: bucket,
      Key: key,
      Expires: 300,
      Fields: { 'Content-Type': parsed.data.contentType },
      Conditions: [
        ['content-length-range', 1, parsed.data.sizeBytes],
        ['eq', '$Content-Type', parsed.data.contentType],
      ],
    })
    response.status(201).json({
      uploadUrl: presigned.url,
      fields: presigned.fields,
      objectKey: key,
      expiresInSeconds: 300,
      malwareScan: 'pending',
    })
  } catch (error) {
    next(error)
  }
})

submissionsRouter.post('/projects/:projectId/submissions', async (request, response, next) => {
  const userId = authenticatedId(request, response)
  const projectId = param(request, 'projectId')
  if (!userId || !projectId) return
  const parsed = submissionSchema.safeParse(request.body)
  if (!parsed.success) {
    fail(response, 400, 'VALIDATION_ERROR', 'Please check the submitted details.')
    return
  }

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { requirements: { orderBy: { order: 'asc' } }, escrow: true },
    })
    if (!project) {
      fail(response, 404, 'PROJECT_NOT_FOUND', 'Project not found.')
      return
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { activeRole: true, roles: true } })
    if (
      !user?.roles.includes(UserRole.FREELANCER) ||
      user.activeRole !== UserRole.FREELANCER ||
      !await hasAcceptedProjectAssignment(projectId, userId)
    ) {
      fail(response, 403, 'NOT_ASSIGNED_FREELANCER', 'Only the assigned freelancer can submit work.')
      return
    }
    if (project.status !== ProjectStatus.IN_PROGRESS && project.status !== ProjectStatus.AWAITING_REVIEW) {
      fail(response, 409, 'PROJECT_NOT_ACCEPTING_SUBMISSIONS', 'This project is not accepting submissions.')
      return
    }
    if (
      !project.escrow?.onChainId ||
      (
        project.escrow.status !== EscrowStatus.FUNDED &&
        project.escrow.status !== EscrowStatus.IN_PROGRESS &&
        project.escrow.status !== EscrowStatus.REVISION_REQUESTED
      )
    ) {
      fail(response, 409, 'ESCROW_NOT_FUNDED', 'A confirmed on-chain escrow is required before work can be submitted.')
      return
    }
    if (!await uploadedFilesAreValid(parsed.data.files, userId, projectId)) {
      fail(response, 400, 'INVALID_FILE_KEYS', 'Files must be uploaded using this project’s presigned upload endpoint.')
      return
    }
    const expectedIds = project.requirements.map(({ id }) => id).sort()
    const checklistIds = parsed.data.requirementChecklist.map(({ requirementId }) => requirementId).sort()
    if (
      expectedIds.length !== checklistIds.length ||
      expectedIds.some((id, index) => id !== checklistIds[index])
    ) {
      fail(response, 400, 'INVALID_REQUIREMENT_CHECKLIST', 'Include each project requirement exactly once.')
      return
    }

    const submission = await prisma.$transaction(async (transaction) => {
      const latest = await transaction.submission.findFirst({
        where: { projectId },
        orderBy: { version: 'desc' },
        select: { version: true },
      })
      const created = await transaction.submission.create({
        data: {
          projectId,
          freelancerId: userId,
          notes: parsed.data.notes,
          repoUrl: parsed.data.repoUrl ?? null,
          liveUrl: parsed.data.liveUrl ?? null,
          files: parsed.data.files,
          requirementChecklist: parsed.data.requirementChecklist,
          version: (latest?.version ?? 0) + 1,
        },
        include: { aiReports: { orderBy: { createdAt: 'desc' }, take: 1 } },
      })
      await transaction.project.update({
        where: { id: projectId },
        data: { status: ProjectStatus.AWAITING_REVIEW },
      })
      await transaction.activityLog.create({
        data: {
          projectId,
          actorId: userId,
          type: 'WORK_SUBMITTED',
          title: 'Work submitted',
          detail: `Submission version ${created.version} was sent for review.`,
        },
      })
      await transaction.notification.create({
        data: {
          userId: project.clientId,
          type: 'WORK_SUBMITTED',
          title: 'Work submitted for review',
          detail: `A new submission is ready for ${project.title}.`,
          link: `/workspace/${projectId}`,
        },
      })
      return created
    })
    let job: Awaited<ReturnType<typeof enqueueSubmissionVerification>> | undefined
    try {
      job = await enqueueSubmissionVerification(submission.id)
    } catch (error) {
      logger.error({ error, submissionId: submission.id }, 'Could not queue submission verification')
    }
    response.status(201).json({
      submission,
      verification: {
        status: job ? 'queued' : 'unavailable',
        ...(job ? { jobId: job.id } : {}),
        advisoryOnly: true,
      },
    })
  } catch (error) {
    next(error)
  }
})

submissionsRouter.get('/projects/:projectId/submissions', async (request, response, next) => {
  const userId = authenticatedId(request, response)
  const projectId = param(request, 'projectId')
  if (!userId || !projectId) return

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { clientId: true },
    })
    if (!project) {
      fail(response, 404, 'PROJECT_NOT_FOUND', 'Project not found.')
      return
    }
    const isAssigned = await hasAcceptedProjectAssignment(projectId, userId)
    if (project.clientId !== userId && !isAssigned) {
      fail(response, 403, 'FORBIDDEN', 'You cannot view submissions for this project.')
      return
    }
    const submissions = await prisma.submission.findMany({
      where: { projectId },
      orderBy: { submittedAt: 'desc' },
      include: { aiReports: { orderBy: { createdAt: 'desc' }, take: 1 } },
    })
    response.json({ submissions })
  } catch (error) {
    next(error)
  }
})

submissionsRouter.get('/submissions/:submissionId', async (request, response, next) => {
  const userId = authenticatedId(request, response)
  const submissionId = param(request, 'submissionId')
  if (!userId || !submissionId) return

  try {
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        project: { select: { clientId: true } },
        aiReports: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    })
    if (!submission) {
      fail(response, 404, 'SUBMISSION_NOT_FOUND', 'Submission not found.')
      return
    }
    if (
      submission.freelancerId !== userId &&
      submission.project.clientId !== userId
    ) {
      fail(response, 403, 'FORBIDDEN', 'You cannot view this submission.')
      return
    }
    response.json({ submission })
  } catch (error) {
    next(error)
  }
})

submissionsRouter.post('/submissions/:submissionId/verify', async (request, response, next) => {
  const userId = authenticatedId(request, response)
  const submissionId = param(request, 'submissionId')
  if (!userId || !submissionId) return

  try {
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: { project: { select: { clientId: true } } },
    })
    if (!submission) {
      fail(response, 404, 'SUBMISSION_NOT_FOUND', 'Submission not found.')
      return
    }
    if (submission.freelancerId !== userId && submission.project.clientId !== userId) {
      fail(response, 403, 'FORBIDDEN', 'You cannot request a review for this submission.')
      return
    }
    const job = await enqueueSubmissionVerification(submission.id)
    response.status(202).json({ status: 'queued', jobId: job.id, advisoryOnly: true })
  } catch (error) {
    next(error)
  }
})
