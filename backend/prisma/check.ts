import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('Set DATABASE_URL before checking the database.')
  }

  await prisma.$queryRaw`SELECT 1`
  const demoProject = await prisma.project.findUnique({
    where: { publicRef: 'FL-2048' },
    include: {
      requirements: true,
      proposals: { where: { status: 'ACCEPTED' } },
      submissions: {
        include: { aiReports: true },
      },
      messages: true,
    },
  })
  if (
    !demoProject ||
    demoProject.requirements.length === 0 ||
    demoProject.proposals.length === 0 ||
    demoProject.submissions.length === 0 ||
    demoProject.submissions.every((submission) => submission.aiReports.length === 0) ||
    demoProject.messages.length === 0
  ) {
    throw new Error('Database is reachable, but seeded marketplace workspace data is incomplete. Run npm run db:seed.')
  }

  const counts = await Promise.all([
    prisma.user.count(),
    prisma.freelancerProfile.count(),
    prisma.clientProfile.count(),
    prisma.project.count(),
    prisma.proposal.count(),
    prisma.escrow.count(),
    prisma.submission.count(),
    prisma.aiReport.count(),
    prisma.dispute.count(),
    prisma.message.count(),
    prisma.review.count(),
    prisma.transaction.count(),
    prisma.notification.count(),
    prisma.activityLog.count(),
  ])

  console.info('Database connection and seeded workspace checks passed.')
  console.info({
    users: counts[0],
    freelancerProfiles: counts[1],
    clientProfiles: counts[2],
    projects: counts[3],
    proposals: counts[4],
    escrows: counts[5],
    submissions: counts[6],
    aiReports: counts[7],
    disputes: counts[8],
    messages: counts[9],
    reviews: counts[10],
    transactions: counts[11],
    notifications: counts[12],
    activityEntries: counts[13],
  })
}

main()
  .catch((error: unknown) => {
    console.error('Database check failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
