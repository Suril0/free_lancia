import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { logger } from '../logger.js'

const endpoint = process.env.S3_ENDPOINT
const bucket = process.env.S3_BUCKET
const accessKeyId = process.env.S3_ACCESS_KEY_ID
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY

if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
  throw new Error('S3 bucket initialization is not configured.')
}

const client = new S3Client({
  endpoint,
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
})

function isBucketAlreadyCreated(error: unknown) {
  return error instanceof Error
    && ['BucketAlreadyExists', 'BucketAlreadyOwnedByYou'].includes(error.name)
}

async function initializeBucket() {
  try {
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }))
        logger.info({ bucket }, 'Created S3 bucket')
        return
      } catch (error) {
        if (isBucketAlreadyCreated(error)) {
          logger.info({ bucket }, 'S3 bucket already exists')
          return
        }
        if (attempt === 30) throw error
        logger.warn({ attempt, error }, 'S3 is not ready; retrying bucket creation')
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
    }
  } finally {
    client.destroy()
  }
}

initializeBucket().catch((error: unknown) => {
  logger.error({ error, bucket }, 'Could not initialize S3 bucket')
  process.exitCode = 1
})
