import { Queue, Worker, type Job } from 'bullmq'
import { Redis } from 'ioredis'
import { AiVerdict, RequirementStatus } from '@prisma/client'
import { prisma } from './db.js'
import { logger } from './logger.js'
import { verifySubmission } from './ai/verifier.js'
import { scanSubmissionFiles } from './ai/scan-hook.js'

export const VERIFICATION_QUEUE_NAME = 'submission-verification'
export interface VerificationJobData {
  submissionId: string
}

let queue: Queue<VerificationJobData> | undefined

function redisConnection() {
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) throw new Error('REDIS_URL must be configured to use submission verification.')
  return new Redis(redisUrl, { maxRetriesPerRequest: null })
}

export function getVerificationQueue() {
  if (!queue) {
    queue = new Queue<VerificationJobData>(VERIFICATION_QUEUE_NAME, {
      connection: redisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    })
  }
  return queue
}

export async function enqueueSubmissionVerification(submissionId: string) {
  return getVerificationQueue().add('verify-submission', { submissionId })
}

async function processVerification(job: Job<VerificationJobData>) {
  const submission = await prisma.submission.findUnique({
    where: { id: job.data.submissionId },
    include: {
      project: { include: { requirements: { orderBy: { order: 'asc' } } } },
    },
  })
  if (!submission) throw new Error('Submission no longer exists.')

  const scanResult = await scanSubmissionFiles(submission.files)
  if (scanResult.status === 'infected') {
    throw new Error('Submission file failed the malware scan.')
  }

  const result = await verifySubmission({
    projectTitle: submission.project.title,
    projectDescription: submission.project.description,
    requirements: submission.project.requirements.map(({ id, text }) => ({ id, text })),
    notes: submission.notes,
    repoUrl: submission.repoUrl,
    liveUrl: submission.liveUrl,
    files: submission.files,
    requirementChecklist: submission.requirementChecklist,
  })
  await prisma.aiReport.create({
    data: {
      submissionId: submission.id,
      score: result.output.score,
      verdict: result.output.verdict as AiVerdict,
      qualityScore: result.output.qualityScore,
      confidence: result.output.confidence,
      perRequirement: result.output.perRequirement.map((item) => ({
        ...item,
        status: item.status as RequirementStatus,
      })),
      summary: result.output.summary,
      advisoryOnly: true,
      modelId: result.modelId,
      promptVersion: result.promptVersion,
    },
  })
  await prisma.notification.create({
    data: {
      userId: submission.freelancerId,
      type: 'AI_REPORT_READY',
      title: 'Submission review ready',
      detail: 'An advisory AI review is available. It does not determine payment or project status.',
      link: `/projects/${submission.projectId}`,
    },
  })
}

export function startVerificationWorker() {
  const worker = new Worker<VerificationJobData>(
    VERIFICATION_QUEUE_NAME,
    processVerification,
    { connection: redisConnection() },
  )
  worker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, error }, 'Submission verification job failed')
  })
  return worker
}

export async function closeVerificationQueue() {
  if (!queue) return
  await queue.close()
  queue = undefined
}
