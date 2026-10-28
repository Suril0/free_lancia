import 'dotenv/config'
import argon2 from 'argon2'
import {
  AiVerdict,
  NotificationType,
  Prisma,
  PrismaClient,
  ProjectStatus,
  ProposalStatus,
  UserRole,
} from '@prisma/client'

const prisma = new PrismaClient()

const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000)

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('Set DATABASE_URL before seeding the database.')
  }
  const password = process.env.DEMO_PASSWORD ?? 'FreelanciaDemo2026!'
  const passwordHash = await argon2.hash(password)

  const clientSeeds = [
    { id: 'demo-client', email: 'client@freelancia.dev', name: 'Elena Rossi', location: 'Lisbon, PT', rating: '4.90', spent: '8400.000000' },
    { id: 'seed-client-marcus', email: 'marcus.chen@freelancia.dev', name: 'Marcus Chen', location: 'San Francisco, US', rating: '4.80', spent: '12400.000000' },
    { id: 'seed-client-sofia', email: 'sofia.patel@freelancia.dev', name: 'Sofia Patel', location: 'London, UK', rating: '4.95', spent: '16200.000000' },
    { id: 'seed-client-noah', email: 'noah.williams@freelancia.dev', name: 'Noah Williams', location: 'Austin, US', rating: '4.70', spent: '2900.000000' },
    { id: 'seed-client-amara', email: 'amara.okafor@freelancia.dev', name: 'Amara Okafor', location: 'Toronto, CA', rating: '4.90', spent: '7200.000000' },
    { id: 'seed-client-liam', email: 'liam.cooper@freelancia.dev', name: 'Liam Cooper', location: 'Dublin, IE', rating: '4.85', spent: '4100.000000' },
  ] as const

  const clients = new Map<string, string>()
  for (const client of clientSeeds) {
    const user = await prisma.user.upsert({
      where: { email: client.email },
      update: {
        name: client.name,
        location: client.location,
        roles: [UserRole.CLIENT],
        activeRole: UserRole.CLIENT,
        passwordHash,
        emailVerified: true,
        clientProfile: {
          upsert: {
            create: {
              paymentVerified: client.id !== 'seed-client-noah',
              projectsPosted: 1,
              totalSpent: client.spent,
              ratingAvg: client.rating,
            },
            update: {
              paymentVerified: client.id !== 'seed-client-noah',
              projectsPosted: 1,
              totalSpent: client.spent,
              ratingAvg: client.rating,
            },
          },
        },
      },
      create: {
        id: client.id,
        email: client.email,
        passwordHash,
        name: client.name,
        location: client.location,
        roles: [UserRole.CLIENT],
        activeRole: UserRole.CLIENT,
        emailVerified: true,
        clientProfile: {
          create: {
            paymentVerified: client.id !== 'seed-client-noah',
            projectsPosted: 1,
            totalSpent: client.spent,
            ratingAvg: client.rating,
          },
        },
        notificationPreference: { create: {} },
      },
      select: { id: true },
    })
    clients.set(client.name, user.id)
    await prisma.notificationPreference.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: {},
    })
  }

  const freelancerSeeds = [
    { id: 'demo-freelancer', email: 'freelancer@freelancia.dev', name: 'Maya Chen', title: 'Frontend developer', rating: '4.90', jobs: 42, price: '95.000000', deliveryDays: 10, skills: ['React', 'TypeScript', 'Tailwind CSS'], earned: '8420.000000' },
    { id: 'seed-freelancer-daniel', email: 'daniel.okafor@freelancia.dev', name: 'Daniel Okafor', title: 'Product designer', rating: '4.80', jobs: 31, price: '100.000000', deliveryDays: 12, skills: ['Figma', 'UX Design', 'Prototyping'], earned: '7200.000000' },
    { id: 'seed-freelancer-ines', email: 'ines.martin@freelancia.dev', name: 'Ines Martin', title: 'Full-stack engineer', rating: '5.00', jobs: 27, price: '110.000000', deliveryDays: 8, skills: ['React', 'Node.js', 'API'], earned: '9150.000000' },
    { id: 'seed-freelancer-jon', email: 'jon.bell@freelancia.dev', name: 'Jon Bell', title: 'Web developer', rating: '4.70', jobs: 19, price: '90.000000', deliveryDays: 14, skills: ['JavaScript', 'CSS', 'Accessibility'], earned: '4820.000000' },
    { id: 'seed-freelancer-priya', email: 'priya.shah@freelancia.dev', name: 'Priya Shah', title: 'UX engineer', rating: '4.90', jobs: 36, price: '105.000000', deliveryDays: 9, skills: ['UX Design', 'React', 'Figma'], earned: '7680.000000' },
  ] as const

  const freelancers = new Map<string, string>()
  for (const person of freelancerSeeds) {
    const user = await prisma.user.upsert({
      where: { email: person.email },
      update: {
        name: person.name,
        title: person.title,
        roles: [UserRole.FREELANCER],
        activeRole: UserRole.FREELANCER,
        passwordHash,
        emailVerified: true,
        freelancerProfile: {
          upsert: {
            create: {
              skills: [...person.skills],
              ratingAvg: person.rating,
              ratingCount: person.jobs,
              completedProjects: person.jobs,
              successRate: '98.00',
              totalEarned: person.earned,
              price: person.price,
              deliveryDays: person.deliveryDays,
              badges: person.name === 'Maya Chen' ? ['Top 5% talent', 'Fast responder', 'Identity verified'] : [],
            },
            update: {
              skills: [...person.skills],
              ratingAvg: person.rating,
              ratingCount: person.jobs,
              completedProjects: person.jobs,
              successRate: '98.00',
              totalEarned: person.earned,
              price: person.price,
              deliveryDays: person.deliveryDays,
              badges: person.name === 'Maya Chen' ? ['Top 5% talent', 'Fast responder', 'Identity verified'] : [],
            },
          },
        },
      },
      create: {
        id: person.id,
        email: person.email,
        passwordHash,
        name: person.name,
        title: person.title,
        roles: [UserRole.FREELANCER],
        activeRole: UserRole.FREELANCER,
        emailVerified: true,
        freelancerProfile: {
          create: {
            skills: [...person.skills],
            ratingAvg: person.rating,
            ratingCount: person.jobs,
            completedProjects: person.jobs,
            successRate: '98.00',
            totalEarned: person.earned,
            price: person.price,
            deliveryDays: person.deliveryDays,
            badges: person.name === 'Maya Chen' ? ['Top 5% talent', 'Fast responder', 'Identity verified'] : [],
          },
        },
        notificationPreference: { create: {} },
      },
      select: { id: true },
    })
    freelancers.set(person.name, user.id)
    await prisma.notificationPreference.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: {},
    })
  }

  const projectSeeds = [
    { ref: 'FL-2048', title: 'Build a responsive portfolio website', description: 'Design and build a polished portfolio for a product designer, with a fast, accessible experience on every device.', budget: '100.000000', days: 14, skills: ['React', 'TypeScript', 'Tailwind CSS'], proposalCount: 3, client: 'Elena Rossi', status: ProjectStatus.AWAITING_REVIEW, featured: true },
    { ref: 'FL-2049', title: 'Redesign a fintech onboarding flow', description: 'Turn our existing onboarding into a clear, trustworthy five-step journey with responsive screens.', budget: '450.000000', days: 10, skills: ['Figma', 'UX Design', 'Prototyping'], proposalCount: 3, client: 'Marcus Chen', status: ProjectStatus.OPEN, featured: true },
    { ref: 'FL-2050', title: 'React analytics dashboard', description: 'Build a responsive analytics dashboard with charts, filters, and export-ready reporting.', budget: '680.000000', days: 21, skills: ['React', 'Data Viz', 'API'], proposalCount: 3, client: 'Sofia Patel', status: ProjectStatus.OPEN, featured: true },
    { ref: 'FL-2051', title: 'Illustrate a web3 learning guide', description: 'Create a friendly set of editorial illustrations for a beginner-focused digital finance guide.', budget: '320.000000', days: 12, skills: ['Illustration', 'Branding', 'Figma'], proposalCount: 3, client: 'Noah Williams', status: ProjectStatus.OPEN, featured: false },
    { ref: 'FL-2052', title: 'Design system audit and cleanup', description: 'Review our component library, find inconsistencies, and deliver a prioritized cleanup plan.', budget: '520.000000', days: 18, skills: ['Design Systems', 'Accessibility'], proposalCount: 3, client: 'Amara Okafor', status: ProjectStatus.OPEN, featured: false },
    { ref: 'FL-2053', title: 'Conversion copy for SaaS homepage', description: 'Rewrite our homepage to clarify positioning and turn more trial visitors into qualified leads.', budget: '240.000000', days: 7, skills: ['Copywriting', 'SaaS', 'SEO'], proposalCount: 3, client: 'Liam Cooper', status: ProjectStatus.OPEN, featured: false },
  ] as const

  const projects = new Map<string, string>()
  for (const [index, project] of projectSeeds.entries()) {
    const clientId = clients.get(project.client)
    if (!clientId) throw new Error(`Missing seeded client: ${project.client}`)

    const record = await prisma.project.upsert({
      where: { publicRef: project.ref },
      update: {
        clientId,
        title: project.title,
        description: project.description,
        budget: project.budget,
        deadline: daysFromNow(project.days),
        durationDays: project.days,
        skills: [...project.skills],
        status: project.status,
        featured: project.featured,
        proposalCount: project.proposalCount,
      },
      create: {
        id: `seed-project-${project.ref.toLowerCase()}`,
        clientId,
        title: project.title,
        description: project.description,
        budget: project.budget,
        deadline: daysFromNow(project.days),
        durationDays: project.days,
        skills: [...project.skills],
        status: project.status,
        featured: project.featured,
        proposalCount: project.proposalCount,
        publicRef: project.ref,
        createdAt: new Date(Date.now() - index * 86_400_000),
      },
      select: { id: true },
    })
    projects.set(project.ref, record.id)

    const requirementsByRef: Record<string, string[]> = {
      'FL-2048': ['Responsive layout', 'About section', 'Projects section', 'Contact form', 'Mobile support'],
      'FL-2049': ['Five-step onboarding flow', 'Accessible form controls', 'Responsive mobile screens'],
      'FL-2050': ['Analytics dashboard', 'Interactive filters', 'Export-ready reporting'],
      'FL-2051': ['Consistent illustration style', 'Production-ready assets', 'Usage guidance'],
      'FL-2052': ['Component inventory', 'Accessibility findings', 'Prioritized cleanup plan'],
      'FL-2053': ['Clear value proposition', 'Conversion-focused homepage copy', 'SEO metadata'],
    }
    const requirements = requirementsByRef[project.ref] ?? []
    await prisma.requirement.deleteMany({ where: { projectId: record.id } })
    await prisma.requirement.createMany({
      data: requirements.map((text, order) => ({ projectId: record.id, text, order })),
    })
  }

  const demoProjectId = projects.get('FL-2048')
  const demoFreelancerId = freelancers.get('Maya Chen')
  const demoClientId = clients.get('Elena Rossi')
  if (!demoProjectId || !demoFreelancerId || !demoClientId) {
    throw new Error('Demo project participants were not seeded')
  }
  const demoRequirements = await prisma.requirement.findMany({
    where: { projectId: demoProjectId },
    orderBy: { order: 'asc' },
    select: { id: true, text: true },
  })
  if (demoRequirements.length === 0) throw new Error('Demo project requirements were not seeded')

  const proposalSeeds = [
    { ref: 'FL-2048', freelancer: 'Maya Chen', price: '100.000000', days: 14, status: ProposalStatus.ACCEPTED, message: 'I will deliver an accessible, responsive portfolio with tested layouts and clear handoff notes.' },
    { ref: 'FL-2048', freelancer: 'Daniel Okafor', price: '95.000000', days: 15, status: ProposalStatus.PENDING, message: 'I can pair a cohesive visual system with a polished portfolio experience.' },
    { ref: 'FL-2048', freelancer: 'Ines Martin', price: '100.000000', days: 12, status: ProposalStatus.PENDING, message: 'I will build the portfolio in React with responsive and accessibility checks.' },
    { ref: 'FL-2049', freelancer: 'Daniel Okafor', price: '440.000000', days: 10, status: ProposalStatus.PENDING, message: 'I can simplify the five-step flow and deliver a complete Figma prototype.' },
    { ref: 'FL-2049', freelancer: 'Priya Shah', price: '450.000000', days: 9, status: ProposalStatus.PENDING, message: 'I will focus on accessible form patterns and user confidence at each step.' },
    { ref: 'FL-2049', freelancer: 'Maya Chen', price: '430.000000', days: 12, status: ProposalStatus.PENDING, message: 'I can implement and validate a responsive onboarding prototype.' },
    { ref: 'FL-2050', freelancer: 'Ines Martin', price: '680.000000', days: 21, status: ProposalStatus.PENDING, message: 'I will deliver the dashboard, API integration, and responsive reporting views.' },
    { ref: 'FL-2050', freelancer: 'Maya Chen', price: '650.000000', days: 20, status: ProposalStatus.PENDING, message: 'I can build the React interface with clear loading and filter states.' },
    { ref: 'FL-2050', freelancer: 'Jon Bell', price: '620.000000', days: 21, status: ProposalStatus.PENDING, message: 'I will focus on performant charts and accessible dashboard controls.' },
    { ref: 'FL-2051', freelancer: 'Daniel Okafor', price: '320.000000', days: 12, status: ProposalStatus.PENDING, message: 'I can provide a consistent illustration direction with production-ready files.' },
    { ref: 'FL-2051', freelancer: 'Priya Shah', price: '300.000000', days: 11, status: ProposalStatus.PENDING, message: 'I will create friendly, accessible illustrations for the learning guide.' },
    { ref: 'FL-2051', freelancer: 'Jon Bell', price: '315.000000', days: 14, status: ProposalStatus.PENDING, message: 'I can build the supporting illustration assets and style guide.' },
    { ref: 'FL-2052', freelancer: 'Priya Shah', price: '520.000000', days: 18, status: ProposalStatus.PENDING, message: 'I will audit patterns, accessibility, and document a prioritized cleanup plan.' },
    { ref: 'FL-2052', freelancer: 'Maya Chen', price: '500.000000', days: 17, status: ProposalStatus.PENDING, message: 'I can inspect the component library and turn findings into practical fixes.' },
    { ref: 'FL-2052', freelancer: 'Ines Martin', price: '510.000000', days: 16, status: ProposalStatus.PENDING, message: 'I will assess the system across code, consistency, and documentation.' },
    { ref: 'FL-2053', freelancer: 'Jon Bell', price: '240.000000', days: 7, status: ProposalStatus.PENDING, message: 'I can make the SaaS value proposition clearer and improve page structure.' },
    { ref: 'FL-2053', freelancer: 'Daniel Okafor', price: '230.000000', days: 8, status: ProposalStatus.PENDING, message: 'I will align the homepage copy with a clear positioning and user journey.' },
    { ref: 'FL-2053', freelancer: 'Priya Shah', price: '235.000000', days: 7, status: ProposalStatus.PENDING, message: 'I can deliver concise conversion-focused copy and a clear content hierarchy.' },
  ] as const
  const seededProposalIds = new Map<string, string>()
  for (const [index, proposal] of proposalSeeds.entries()) {
    const projectId = projects.get(proposal.ref)
    const freelancerId = freelancers.get(proposal.freelancer)
    if (!projectId || !freelancerId) {
      throw new Error(`Missing seeded proposal participant for ${proposal.ref}`)
    }
    const record = await prisma.proposal.upsert({
      where: { projectId_freelancerId: { projectId, freelancerId } },
      update: {
        price: proposal.price,
        deliveryDays: proposal.days,
        coverMessage: proposal.message,
        status: proposal.status,
      },
      create: {
        id: `seed-proposal-${proposal.ref.toLowerCase()}-${proposal.freelancer.toLowerCase().replaceAll(' ', '-')}`,
        projectId,
        freelancerId,
        price: proposal.price,
        deliveryDays: proposal.days,
        coverMessage: proposal.message,
        status: proposal.status,
        createdAt: new Date(Date.now() - (index + 1) * 3_600_000),
      },
      select: { id: true, freelancerId: true },
    })
    seededProposalIds.set(`${proposal.ref}:${proposal.freelancer}`, record.id)
  }
  const shortlistedProposalId = seededProposalIds.get('FL-2049:Daniel Okafor')
  const fintechClientId = clients.get('Marcus Chen')
  if (!shortlistedProposalId || !fintechClientId) {
    throw new Error('Missing proposal records for the demo shortlist')
  }
  await prisma.shortlist.upsert({
    where: { proposalId: shortlistedProposalId },
    update: { clientId: fintechClientId },
    create: {
      id: 'demo-shortlist-fl-2049-daniel',
      proposalId: shortlistedProposalId,
      clientId: fintechClientId,
    },
  })

  const demoMessages = [
    { id: 'demo-message-fl-2048-client', senderId: demoClientId, body: 'I have added the mobile layout and contact form requirements. Let me know if anything needs clarification.' },
    { id: 'demo-message-fl-2048-freelancer', senderId: demoFreelancerId, body: 'The responsive portfolio is ready for review. I checked the navigation and contact form on mobile and desktop.' },
  ] as const
  for (const [index, message] of demoMessages.entries()) {
    await prisma.message.upsert({
      where: { id: message.id },
      update: {
        projectId: demoProjectId,
        senderId: message.senderId,
        body: message.body,
        createdAt: new Date(Date.now() - (demoMessages.length - index) * 60_000),
      },
      create: {
        ...message,
        projectId: demoProjectId,
        createdAt: new Date(Date.now() - (demoMessages.length - index) * 60_000),
      },
    })
  }

  const submission = await prisma.submission.upsert({
    where: { id: 'demo-submission-fl-2048' },
    update: {
      projectId: demoProjectId,
      freelancerId: demoFreelancerId,
      notes: 'Responsive portfolio delivered with About, Projects, and Contact sections. Layout and navigation are tested on mobile and desktop.',
      requirementChecklist: demoRequirements.map(({ id }) => ({ requirementId: id, completed: true })),
      version: 1,
    },
    create: {
      id: 'demo-submission-fl-2048',
      projectId: demoProjectId,
      freelancerId: demoFreelancerId,
      notes: 'Responsive portfolio delivered with About, Projects, and Contact sections. Layout and navigation are tested on mobile and desktop.',
      requirementChecklist: demoRequirements.map(({ id }) => ({ requirementId: id, completed: true })),
      version: 1,
    },
    select: { id: true },
  })

  await prisma.aiReport.upsert({
    where: { id: 'demo-ai-report-fl-2048' },
    update: {
      submissionId: submission.id,
      score: 92,
      verdict: AiVerdict.PASS,
      qualityScore: 90,
      confidence: 94,
      perRequirement: demoRequirements.map((requirement) => ({
        requirementId: requirement.id,
        status: 'MET',
        evidence: 'Included in the submitted project checklist.',
      })) satisfies Prisma.InputJsonValue,
      summary: 'All five requested requirements are marked complete. The client should review the delivered work before making a decision.',
      advisoryOnly: true,
      modelId: 'demo-seed',
      promptVersion: 'demo-v1',
    },
    create: {
      id: 'demo-ai-report-fl-2048',
      submissionId: submission.id,
      score: 92,
      verdict: AiVerdict.PASS,
      qualityScore: 90,
      confidence: 94,
      perRequirement: demoRequirements.map((requirement) => ({
        requirementId: requirement.id,
        status: 'MET',
        evidence: 'Included in the submitted project checklist.',
      })) satisfies Prisma.InputJsonValue,
      summary: 'All five requested requirements are marked complete. The client should review the delivered work before making a decision.',
      advisoryOnly: true,
      modelId: 'demo-seed',
      promptVersion: 'demo-v1',
    },
  })

  await prisma.notification.deleteMany({
    where: { id: { in: ['demo-notification-funded', 'demo-notification-submitted', 'demo-notification-released'] } },
  })
  const notifications = [
    { id: 'demo-notification-hired', userId: demoFreelancerId, type: NotificationType.HIRED, title: 'You were hired', detail: 'Elena hired you for the Portfolio website project.', link: `/workspace/${demoProjectId}`, minutesAgo: 2 },
    { id: 'demo-notification-client-submitted', userId: demoClientId, type: NotificationType.WORK_SUBMITTED, title: 'Work submitted for review', detail: 'Maya submitted the seeded portfolio website deliverables.', link: `/workspace/${demoProjectId}`, minutesAgo: 3 },
    { id: 'demo-notification-client-proposal', userId: clients.get('Marcus Chen')!, type: NotificationType.SYSTEM, title: 'New proposal received', detail: 'Freelancers have submitted proposals for the fintech onboarding project.', link: `/projects/${projects.get('FL-2049')}`, minutesAgo: 30 },
    { id: 'demo-notification-ai-report', userId: demoFreelancerId, type: NotificationType.AI_REPORT_READY, title: 'Advisory report ready', detail: 'The seeded portfolio submission has an advisory review report.', link: `/workspace/${demoProjectId}`, minutesAgo: 45 },
  ] as const
  for (const notification of notifications) {
    await prisma.notification.upsert({
      where: { id: notification.id },
      update: {
        userId: notification.userId,
        type: notification.type,
        title: notification.title,
        detail: notification.detail,
        link: notification.link,
        createdAt: new Date(Date.now() - notification.minutesAgo * 60_000),
      },
      create: {
        id: notification.id,
        userId: notification.userId,
        type: notification.type,
        title: notification.title,
        detail: notification.detail,
        link: notification.link,
        createdAt: new Date(Date.now() - notification.minutesAgo * 60_000),
      },
    })
  }

  await prisma.transaction.deleteMany({
    where: { id: { in: ['demo-transaction-release', 'demo-transaction-fund', 'demo-transaction-refund', 'demo-transaction-pending'] } },
  })

  const testimonials = [
    { order: 1, quote: 'Freelancia removed the awkwardness from payment conversations. We both knew the funds were safe.', name: 'Olivia Hart', role: 'Founder, Linear Labs' },
    { order: 2, quote: 'The verification report helps clients review my work faster without replacing the human decision.', name: 'Theo Grant', role: 'Independent developer' },
    { order: 3, quote: 'I hired three specialists in a month and every milestone was transparent from start to finish.', name: 'Samira Noor', role: 'Product lead' },
  ] as const
  for (const testimonial of testimonials) {
    await prisma.testimonial.upsert({
      where: { order: testimonial.order },
      update: testimonial,
      create: testimonial,
    })
  }

  await prisma.activityLog.upsert({
    where: { id: 'demo-activity-submitted-fl-2048' },
    update: {
      projectId: demoProjectId,
      actorId: demoFreelancerId,
      type: 'SUBMITTED',
      title: 'Work submitted',
      detail: 'Maya submitted the first version for review.',
    },
    create: {
      id: 'demo-activity-submitted-fl-2048',
      projectId: demoProjectId,
      actorId: demoFreelancerId,
      type: 'SUBMITTED',
      title: 'Work submitted',
      detail: 'Maya submitted the first version for review.',
    },
  })

  console.info('Seeded demo marketplace data.')
}

main()
  .catch((error: unknown) => {
    console.error('Database seed failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
