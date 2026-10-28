import {
  EscrowStatus,
  DisputeStatus,
  ProjectStatus,
  ProposalStatus,
  TransactionStatus,
  TransactionType,
  type PrismaClient,
} from '@prisma/client'
import { Interface, parseUnits, type Provider } from 'ethers'
import { Router, type Response } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import { requireAuth, type AuthenticatedRequest } from '../auth.js'
import { createChainClient, tokenAbi } from './client.js'
import { getArbiterWalletAddress, getChainConfig, type ChainConfig } from './config.js'
import {
  assertProviderChain,
  isTransactionHash,
  verifyFundingReceipt,
  verifyDisputeRaisedReceipt,
  verifyDisputeResolutionReceipt,
  verifyPendingDisputeResolutionTransaction,
  verifyReleaseReceipt,
  verifyRevisionRequestedReceipt,
  verifyWorkSubmittedReceipt,
} from './receipts.js'
import { reconcileKnownChainTransactions } from './indexer.js'

const txHashSchema = z.object({
  txHash: z.string().refine(isTransactionHash, 'Provide a 32-byte transaction hash').transform((hash) => hash.toLowerCase()),
})
const amountPattern = /^\d{1,12}(?:\.\d{1,6})?$/
const FEE_BPS = 200n
const BPS_DENOMINATOR = 10_000n

export interface ChainRouterDependencies {
  prisma: PrismaClient
  getConfig: () => ChainConfig
  getProvider: (config: ChainConfig) => Provider
}

const defaultDependencies: ChainRouterDependencies = {
  prisma,
  getConfig: getChainConfig,
  getProvider: (config) => createChainClient(config).provider,
}

export function createChainRouter(dependencies: ChainRouterDependencies = defaultDependencies) {
  const router = Router()
  const { prisma: db } = dependencies

  router.post('/projects/:projectId/prepare', requireAuth, async (request: AuthenticatedRequest, response, next) => {
    const userId = authenticatedUser(request, response)
    if (!userId) return
    const config = safeConfig(dependencies, response)
    if (!config) return
    try {
      const context = await getFundingContext(db, projectIdParam(request), userId, undefined, config.chainId)
      if (!context) return fail(response, 404, 'PROJECT_NOT_FOUND', 'An eligible project was not found.')
      if (context.error) return fail(response, 409, 'CHAIN_PRECONDITION', context.error)

      const provider = dependencies.getProvider(config)
      await assertProviderChain(provider, config.chainId)
      const block = await provider.getBlock('latest')
      if (!block) return fail(response, 503, 'CHAIN_UNAVAILABLE', 'Could not read the latest chain block.')
      const deadline = BigInt(Math.floor(context.project.deadline.getTime() / 1000))
      const now = BigInt(block.timestamp)
      if (deadline < now + 3600n || deadline > now + 365n * 24n * 3600n) {
        return fail(response, 409, 'INVALID_DEADLINE', 'The project deadline is outside the contract delivery window.')
      }

      const amount = parseUnits(context.amount, config.tokenDecimals)
      const escrowInterface = new Interface([
        'function createEscrow(address freelancer,uint256 amount,uint64 deadline) returns (uint256 escrowId)',
      ])
      const tokenInterface = new Interface(tokenAbi)
      response.json({
        chainId: config.chainId,
        contractAddress: config.escrowAddress,
        tokenAddress: config.tokenAddress,
        amount: amount.toString(),
        fee: ((amount * FEE_BPS) / BPS_DENOMINATOR).toString(),
        tokenDecimals: config.tokenDecimals,
        transactions: [
          {
            to: config.tokenAddress,
            data: tokenInterface.encodeFunctionData('approve', [config.escrowAddress, amount]),
            value: '0',
          },
          {
            to: config.escrowAddress,
            data: escrowInterface.encodeFunctionData('createEscrow', [
              context.freelancerAddress,
              amount,
              deadline,
            ]),
            value: '0',
          },
        ],
        confirmationsRequired: config.confirmations,
      })
    } catch (error) {
      next(error)
    }
  })

  router.post('/projects/:projectId/fund', requireAuth, async (request: AuthenticatedRequest, response, next) => {
    await confirmFunding(request, response, next, dependencies, db)
  })

  router.post('/projects/:projectId/confirm', requireAuth, async (request: AuthenticatedRequest, response, next) => {
    await confirmFunding(request, response, next, dependencies, db)
  })

  router.post('/projects/:projectId/submit-work/prepare', requireAuth, async (request: AuthenticatedRequest, response, next) => {
    const userId = authenticatedUser(request, response)
    if (!userId) return
    const config = safeConfig(dependencies, response)
    if (!config) return
    try {
      const context = await getFreelancerWorkContext(db, projectIdParam(request), userId)
      if (!context) return fail(response, 404, 'PROJECT_NOT_FOUND', 'An eligible project was not found.')
      if (!context.escrow?.onChainId) return fail(response, 409, 'ESCROW_NOT_FUNDED', 'A confirmed funded escrow is required.')
      if (context.freelancer.wallet?.chainId !== config.chainId) {
        return fail(response, 409, 'WALLET_CHAIN_MISMATCH', 'The linked freelancer wallet is not on the configured chain.')
      }
      if (context.escrow.status === EscrowStatus.SUBMITTED || context.escrow.status === EscrowStatus.AI_VERIFIED) {
        return fail(response, 409, 'WORK_ALREADY_SUBMITTED', 'Work has already been submitted on-chain.')
      }
      if (context.escrow.submittedTx) {
        return fail(response, 409, 'SUBMISSION_TX_PENDING', 'Confirm the existing submission transaction before starting another.')
      }
      const canSubmitWork = context.escrow.status === EscrowStatus.FUNDED ||
        context.escrow.status === EscrowStatus.IN_PROGRESS ||
        context.escrow.status === EscrowStatus.REVISION_REQUESTED
      if (!canSubmitWork) {
        return fail(response, 409, 'ESCROW_NOT_READY', 'This escrow is not ready for work submission.')
      }
      await assertProviderChain(dependencies.getProvider(config), config.chainId)
      const call = new Interface(['function submitWork(uint256 escrowId)'])
      response.json({
        chainId: config.chainId,
        transaction: {
          to: config.escrowAddress,
          data: call.encodeFunctionData('submitWork', [context.escrow.onChainId]),
          value: '0',
        },
        confirmationsRequired: config.confirmations,
      })
    } catch (error) {
      next(error)
    }
  })

  router.post('/projects/:projectId/submit-work/confirm', requireAuth, async (request: AuthenticatedRequest, response, next) => {
    const userId = authenticatedUser(request, response)
    if (!userId) return
    const input = txHashSchema.safeParse(request.body)
    if (!input.success) return fail(response, 400, 'VALIDATION_ERROR', 'Provide a valid transaction hash.')
    const config = safeConfig(dependencies, response)
    if (!config) return
    try {
      const context = await getFreelancerWorkContext(db, projectIdParam(request), userId)
      if (!context) return fail(response, 404, 'PROJECT_NOT_FOUND', 'An eligible project was not found.')
      if (!context.escrow?.onChainId || !context.freelancer.wallet) {
        return fail(response, 409, 'ESCROW_NOT_FUNDED', 'A confirmed funded escrow is required.')
      }
      if (context.freelancer.wallet.chainId !== config.chainId) {
        return fail(response, 409, 'WALLET_CHAIN_MISMATCH', 'The linked freelancer wallet is not on the configured chain.')
      }
      if (context.escrow.submittedTx && context.escrow.submittedTx !== input.data.txHash) {
        return fail(response, 409, 'SUBMISSION_ALREADY_RECORDED', 'A different submission transaction is already recorded.')
      }
      const provider = dependencies.getProvider(config)
      await assertProviderChain(provider, config.chainId)
      const result = await verifyWorkSubmittedReceipt(
        provider,
        input.data.txHash,
        config.escrowAddress,
        context.freelancer.wallet.address,
        context.escrow.onChainId,
        config.confirmations,
      )
      if (!result) return response.status(202).json({ status: 'PENDING', confirmations: 0 })
      if (
        result.confirmed &&
        context.escrow.status !== EscrowStatus.SUBMITTED &&
        context.escrow.status !== EscrowStatus.AI_VERIFIED
      ) {
        await db.$transaction(async (tx) => {
          await tx.escrow.update({
            where: { projectId: context.id },
            data: {
              status: EscrowStatus.SUBMITTED,
              submittedTx: input.data.txHash,
              revisionTx: null,
            },
          })
          await tx.activityLog.create({
            data: {
              projectId: context.id,
              actorId: userId,
              type: 'WORK_SUBMITTED_ON_CHAIN',
              title: 'Work submission confirmed on-chain',
              detail: `Confirmed on-chain transaction ${input.data.txHash}`,
            },
          })
          await tx.notification.create({
            data: {
              userId: context.clientId,
              type: 'WORK_SUBMITTED',
              title: 'Work submission confirmed',
              detail: `The escrow submission for ${context.title} was confirmed on-chain.`,
              link: `/workspace/${context.id}`,
            },
          })
        })
      } else if (!context.escrow.submittedTx) {
        await db.escrow.update({
          where: { projectId: context.id },
          data: { submittedTx: input.data.txHash },
        })
      }
      response.status(result.confirmed ? 200 : 202).json({
        status: result.confirmed ? 'CONFIRMED' : 'PENDING',
        confirmations: result.confirmations,
        confirmationsRequired: config.confirmations,
      })
    } catch (error) {
      if (error instanceof Error && isReceiptError(error)) {
        return fail(response, 422, 'INVALID_CHAIN_RECEIPT', error.message)
      }
      next(error)
    }
  })

  router.post('/projects/:projectId/disputes/prepare', requireAuth, async (request: AuthenticatedRequest, response, next) => {
    const userId = authenticatedUser(request, response)
    if (!userId) return
    const config = safeConfig(dependencies, response)
    if (!config) return
    try {
      const context = await getDisputeContext(db, projectIdParam(request), userId)
      if (!context) return fail(response, 404, 'PROJECT_NOT_FOUND', 'An eligible project was not found.')
      if (context.status !== ProjectStatus.IN_PROGRESS && context.status !== ProjectStatus.AWAITING_REVIEW) {
        return fail(response, 409, 'INVALID_PROJECT_STATE', 'A dispute cannot be opened in the current project state.')
      }
      if (!context.escrow?.onChainId || !context.wallet) {
        return fail(response, 409, 'ESCROW_NOT_FUNDED', 'A confirmed funded escrow and linked participant wallet are required.')
      }
      if (context.wallet.chainId !== config.chainId) {
        return fail(response, 409, 'WALLET_CHAIN_MISMATCH', 'The linked participant wallet is not on the configured chain.')
      }
      if (context.escrow.disputeTx && context.escrow.status !== EscrowStatus.DISPUTED) {
        return fail(response, 409, 'DISPUTE_TX_PENDING', 'Confirm the existing dispute transaction before starting another.')
      }
      const disputableStatuses: EscrowStatus[] = [
        EscrowStatus.FUNDED,
        EscrowStatus.IN_PROGRESS,
        EscrowStatus.SUBMITTED,
        EscrowStatus.AI_VERIFIED,
        EscrowStatus.APPROVED,
        EscrowStatus.REVISION_REQUESTED,
      ]
      if (!disputableStatuses.includes(context.escrow.status)) {
        return fail(response, 409, 'ESCROW_NOT_DISPUTABLE', 'This escrow cannot be disputed in its current state.')
      }
      await assertProviderChain(dependencies.getProvider(config), config.chainId)
      const call = new Interface(['function raiseDispute(uint256 escrowId)'])
      response.json({
        chainId: config.chainId,
        transaction: {
          to: config.escrowAddress,
          data: call.encodeFunctionData('raiseDispute', [context.escrow.onChainId]),
          value: '0',
        },
        confirmationsRequired: config.confirmations,
      })
    } catch (error) {
      next(error)
    }
  })

  router.post('/projects/:projectId/disputes/confirm', requireAuth, async (request: AuthenticatedRequest, response, next) => {
    const userId = authenticatedUser(request, response)
    if (!userId) return
    const input = txHashSchema.safeParse(request.body)
    if (!input.success) return fail(response, 400, 'VALIDATION_ERROR', 'Provide a valid transaction hash.')
    const config = safeConfig(dependencies, response)
    if (!config) return
    try {
      const context = await getDisputeContext(db, projectIdParam(request), userId)
      if (!context) return fail(response, 404, 'PROJECT_NOT_FOUND', 'An eligible project was not found.')
      if (!context.escrow?.onChainId || !context.wallet) {
        return fail(response, 409, 'ESCROW_NOT_FUNDED', 'A confirmed funded escrow and linked participant wallet are required.')
      }
      if (context.wallet.chainId !== config.chainId) {
        return fail(response, 409, 'WALLET_CHAIN_MISMATCH', 'The linked participant wallet is not on the configured chain.')
      }
      if (context.escrow.disputeTx && context.escrow.disputeTx !== input.data.txHash) {
        return fail(response, 409, 'DISPUTE_ALREADY_RECORDED', 'A different dispute transaction is already recorded.')
      }
      const provider = dependencies.getProvider(config)
      await assertProviderChain(provider, config.chainId)
      const result = await verifyDisputeRaisedReceipt(
        provider,
        input.data.txHash,
        config.escrowAddress,
        context.wallet.address,
        context.escrow.onChainId,
        config.confirmations,
      )
      if (!result) return response.status(202).json({ status: 'PENDING', confirmations: 0 })
      if (result.confirmed && context.escrow.status !== EscrowStatus.DISPUTED) {
        await db.escrow.update({
          where: { projectId: context.id },
          data: { status: EscrowStatus.DISPUTED, disputeTx: input.data.txHash },
        })
      } else if (!context.escrow.disputeTx) {
        await db.escrow.update({
          where: { projectId: context.id },
          data: { disputeTx: input.data.txHash },
        })
      }
      response.status(result.confirmed ? 200 : 202).json({
        status: result.confirmed ? 'CONFIRMED' : 'PENDING',
        confirmations: result.confirmations,
        confirmationsRequired: config.confirmations,
      })
    } catch (error) {
      if (error instanceof Error && isReceiptError(error)) {
        return fail(response, 422, 'INVALID_CHAIN_RECEIPT', error.message)
      }
      next(error)
    }
  })

  router.post('/projects/:projectId/disputes/resolve/prepare', requireAuth, async (request: AuthenticatedRequest, response, next) => {
    const userId = authenticatedUser(request, response)
    if (!userId) return
    const resolution = z.object({ releaseToFreelancer: z.boolean() }).safeParse(request.body)
    if (!resolution.success) return fail(response, 400, 'VALIDATION_ERROR', 'Select whether payment is released to the freelancer.')
    const config = safeConfig(dependencies, response)
    if (!config) return
    const arbiterAddress = requireArbiterAddress(response)
    if (!arbiterAddress) return
    try {
      const context = await getArbiterDisputeContext(db, projectIdParam(request))
      if (!context) return fail(response, 404, 'DISPUTE_NOT_FOUND', 'An open dispute for this project was not found.')
      if (context.dispute.status !== DisputeStatus.OPEN && context.dispute.status !== DisputeStatus.UNDER_REVIEW) {
        return fail(response, 409, 'DISPUTE_ALREADY_RESOLVED', 'This dispute is no longer open for a resolution.')
      }
      const wallet = await db.wallet.findUnique({ where: { userId }, select: { address: true, chainId: true } })
      if (!wallet || wallet.address.toLowerCase() !== arbiterAddress.toLowerCase()) {
        return fail(response, 403, 'ARBITER_ONLY', 'Only the configured arbiter wallet may resolve disputes.')
      }
      if (wallet.chainId !== config.chainId) {
        return fail(response, 409, 'WALLET_CHAIN_MISMATCH', 'The arbiter wallet is not on the configured chain.')
      }
      if (!context.escrow?.onChainId || context.escrow.status !== EscrowStatus.DISPUTED) {
        return fail(response, 409, 'ESCROW_NOT_DISPUTED', 'A confirmed on-chain dispute is required.')
      }
      if (context.dispute.resolutionTx) {
        return fail(response, 409, 'DISPUTE_ALREADY_RESOLVED', 'This dispute already has a resolution transaction.')
      }
      await assertProviderChain(dependencies.getProvider(config), config.chainId)
      const call = new Interface(['function resolveDispute(uint256 escrowId,bool releaseToFreelancer)'])
      response.json({
        chainId: config.chainId,
        transaction: {
          to: config.escrowAddress,
          data: call.encodeFunctionData('resolveDispute', [
            context.escrow.onChainId,
            resolution.data.releaseToFreelancer,
          ]),
          value: '0',
        },
        confirmationsRequired: config.confirmations,
      })
    } catch (error) {
      next(error)
    }
  })

  router.post('/projects/:projectId/disputes/resolve/confirm', requireAuth, async (request: AuthenticatedRequest, response, next) => {
    const userId = authenticatedUser(request, response)
    if (!userId) return
    const input = z.object({
      txHash: z.string().refine(isTransactionHash, 'Provide a 32-byte transaction hash').transform((hash) => hash.toLowerCase()),
      releaseToFreelancer: z.boolean(),
    }).strict().safeParse(request.body)
    if (!input.success) return fail(response, 400, 'VALIDATION_ERROR', 'Provide the resolution transaction and its selected outcome.')
    const config = safeConfig(dependencies, response)
    if (!config) return
    const arbiterAddress = requireArbiterAddress(response)
    if (!arbiterAddress) return
    try {
      const context = await getArbiterDisputeContext(db, projectIdParam(request))
      if (!context) return fail(response, 404, 'DISPUTE_NOT_FOUND', 'An open dispute for this project was not found.')
      const wallet = await db.wallet.findUnique({ where: { userId }, select: { address: true, chainId: true } })
      if (!wallet || wallet.address.toLowerCase() !== arbiterAddress.toLowerCase()) {
        return fail(response, 403, 'ARBITER_ONLY', 'Only the configured arbiter wallet may resolve disputes.')
      }
      if (wallet.chainId !== config.chainId) {
        return fail(response, 409, 'WALLET_CHAIN_MISMATCH', 'The arbiter wallet is not on the configured chain.')
      }
      if (context.dispute.status !== DisputeStatus.OPEN && context.dispute.status !== DisputeStatus.UNDER_REVIEW) {
        return fail(response, 409, 'DISPUTE_ALREADY_RESOLVED', 'This dispute is no longer open for a resolution.')
      }
      if (!context.escrow?.onChainId || context.escrow.status !== EscrowStatus.DISPUTED || !context.client.wallet) {
        return fail(response, 409, 'ESCROW_NOT_DISPUTED', 'A confirmed on-chain dispute and linked client wallet are required.')
      }
      if (context.dispute.resolutionTx && context.dispute.resolutionTx !== input.data.txHash) {
        return fail(response, 409, 'RESOLUTION_ALREADY_RECORDED', 'A different resolution transaction is already recorded.')
      }
      if (
        context.dispute.releaseToFreelancer !== null &&
        context.dispute.releaseToFreelancer !== input.data.releaseToFreelancer
      ) {
        return fail(response, 409, 'RESOLUTION_OUTCOME_MISMATCH', 'The resolution transaction outcome does not match the saved decision.')
      }
      const provider = dependencies.getProvider(config)
      await assertProviderChain(provider, config.chainId)
      const result = await verifyDisputeResolutionReceipt(
        provider,
        input.data.txHash,
        config.escrowAddress,
        arbiterAddress,
        context.escrow.onChainId,
        context.client.wallet.address,
        parseUnits(context.escrow.amount.toString(), config.tokenDecimals),
        config.confirmations,
      )
      if (!result) {
        const isValidPending = await verifyPendingDisputeResolutionTransaction(
          provider,
          input.data.txHash,
          config.escrowAddress,
          arbiterAddress,
          context.escrow.onChainId,
          input.data.releaseToFreelancer,
        )
        if (isValidPending && !context.dispute.resolutionTx) {
          await db.dispute.update({
            where: { id: context.dispute.id },
            data: {
              resolutionTx: input.data.txHash,
              releaseToFreelancer: input.data.releaseToFreelancer,
            },
          })
        }
        return response.status(202).json({ status: 'PENDING', confirmations: 0 })
      }
      if (result.releaseToFreelancer !== input.data.releaseToFreelancer) {
        return fail(response, 422, 'RESOLUTION_OUTCOME_MISMATCH', 'The transaction outcome differs from the selected resolution.')
      }
      if (!result.confirmed) {
        await db.dispute.update({
          where: { id: context.dispute.id },
          data: { resolutionTx: input.data.txHash, releaseToFreelancer: result.releaseToFreelancer },
        })
        return response.status(202).json({
          status: 'PENDING',
          confirmations: result.confirmations,
          confirmationsRequired: config.confirmations,
        })
      }

      const type = result.releaseToFreelancer ? TransactionType.RELEASE : TransactionType.REFUND
      const status = result.releaseToFreelancer ? DisputeStatus.RESOLVED_TO_FREELANCER : DisputeStatus.RESOLVED_TO_CLIENT
      const escrowStatus = result.releaseToFreelancer ? EscrowStatus.PAID : EscrowStatus.REFUNDED
      const projectStatus = result.releaseToFreelancer ? ProjectStatus.COMPLETED : ProjectStatus.CANCELLED
      const resolution = result.releaseToFreelancer
        ? 'Resolved by the configured arbiter in favor of the freelancer.'
        : 'Resolved by the configured arbiter in favor of the client.'
      const existingTransaction = await db.transaction.findUnique({ where: { txHash: input.data.txHash } })
      if (existingTransaction && (
        existingTransaction.userId !== userId ||
        existingTransaction.projectId !== context.id ||
        existingTransaction.type !== type
      )) {
        return fail(response, 409, 'TRANSACTION_ALREADY_RECORDED', 'This transaction hash is already associated with another operation.')
      }
      await db.$transaction(async (tx) => {
        await tx.dispute.update({
          where: { id: context.dispute.id },
          data: { status, resolution, resolutionTx: input.data.txHash, releaseToFreelancer: result.releaseToFreelancer },
        })
        await tx.escrow.update({
          where: { projectId: context.id },
          data: { status: escrowStatus },
        })
        await tx.project.update({
          where: { id: context.id },
          data: { status: projectStatus },
        })
        await tx.transaction.upsert({
          where: { txHash: input.data.txHash },
          create: {
            userId,
            projectId: context.id,
            type,
            amount: context.escrow!.amount,
            status: TransactionStatus.CONFIRMED,
            txHash: input.data.txHash,
            blockNumber: BigInt(result.receipt.blockNumber),
          },
          update: {
            status: TransactionStatus.CONFIRMED,
            blockNumber: BigInt(result.receipt.blockNumber),
          },
        })
        await tx.activityLog.create({
          data: {
            projectId: context.id,
            actorId: userId,
            type: 'DISPUTE_RESOLVED',
            title: 'Dispute resolved on-chain',
            detail: `${resolution} Transaction ${input.data.txHash}`,
          },
        })
        await tx.notification.createMany({
          data: [context.clientId, context.freelancerId].map((recipientId) => ({
            userId: recipientId,
            type: 'SYSTEM' as const,
            title: 'Dispute resolved',
            detail: resolution,
            link: `/workspace/${context.id}`,
          })),
        })
      })
      response.json({
        status: 'CONFIRMED',
        outcome: result.releaseToFreelancer ? 'RELEASED_TO_FREELANCER' : 'REFUNDED_TO_CLIENT',
        confirmations: result.confirmations,
        confirmationsRequired: config.confirmations,
      })
    } catch (error) {
      if (error instanceof Error && isReceiptError(error)) {
        return fail(response, 422, 'INVALID_CHAIN_RECEIPT', error.message)
      }
      next(error)
    }
  })

  router.post('/projects/:projectId/revision/prepare', requireAuth, async (request: AuthenticatedRequest, response, next) => {
    const userId = authenticatedUser(request, response)
    if (!userId) return
    const config = safeConfig(dependencies, response)
    if (!config) return
    try {
      const context = await getReleaseContext(db, projectIdParam(request), userId)
      if (!context) return fail(response, 404, 'PROJECT_NOT_FOUND', 'An eligible project was not found.')
      if (!context.escrow?.onChainId || !context.client.wallet) {
        return fail(response, 409, 'ESCROW_NOT_FUNDED', 'A confirmed funded escrow is required.')
      }
      if (context.client.wallet.chainId !== config.chainId) {
        return fail(response, 409, 'WALLET_CHAIN_MISMATCH', 'The linked client wallet is not on the configured chain.')
      }
      if (context.escrow.revisionTx && context.escrow.status !== EscrowStatus.REVISION_REQUESTED) {
        return fail(response, 409, 'REVISION_TX_PENDING', 'Confirm the existing revision transaction before starting another.')
      }
      if (context.escrow.status !== EscrowStatus.SUBMITTED && context.escrow.status !== EscrowStatus.AI_VERIFIED) {
        return fail(response, 409, 'WORK_NOT_SUBMITTED', 'Only submitted work can receive an on-chain revision request.')
      }
      await assertProviderChain(dependencies.getProvider(config), config.chainId)
      const call = new Interface(['function requestRevision(uint256 escrowId)'])
      response.json({
        chainId: config.chainId,
        transaction: {
          to: config.escrowAddress,
          data: call.encodeFunctionData('requestRevision', [context.escrow.onChainId]),
          value: '0',
        },
        confirmationsRequired: config.confirmations,
      })
    } catch (error) {
      next(error)
    }
  })

  router.post('/projects/:projectId/revision/confirm', requireAuth, async (request: AuthenticatedRequest, response, next) => {
    const userId = authenticatedUser(request, response)
    if (!userId) return
    const input = txHashSchema.safeParse(request.body)
    if (!input.success) return fail(response, 400, 'VALIDATION_ERROR', 'Provide a valid transaction hash.')
    const config = safeConfig(dependencies, response)
    if (!config) return
    try {
      const context = await getReleaseContext(db, projectIdParam(request), userId)
      if (!context) return fail(response, 404, 'PROJECT_NOT_FOUND', 'An eligible project was not found.')
      if (!context.escrow?.onChainId || !context.client.wallet) {
        return fail(response, 409, 'ESCROW_NOT_FUNDED', 'A confirmed funded escrow is required.')
      }
      if (context.client.wallet.chainId !== config.chainId) {
        return fail(response, 409, 'WALLET_CHAIN_MISMATCH', 'The linked client wallet is not on the configured chain.')
      }
      if (context.escrow.revisionTx && context.escrow.revisionTx !== input.data.txHash) {
        return fail(response, 409, 'REVISION_ALREADY_RECORDED', 'A different revision transaction is already recorded.')
      }
      const provider = dependencies.getProvider(config)
      await assertProviderChain(provider, config.chainId)
      const result = await verifyRevisionRequestedReceipt(
        provider,
        input.data.txHash,
        config.escrowAddress,
        context.client.wallet.address,
        context.escrow.onChainId,
        config.confirmations,
      )
      if (!result) return response.status(202).json({ status: 'PENDING', confirmations: 0 })
      if (result.confirmed && context.escrow.status !== EscrowStatus.REVISION_REQUESTED) {
        await db.$transaction(async (tx) => {
          await tx.escrow.update({
            where: { projectId: context.id },
            data: {
              status: EscrowStatus.REVISION_REQUESTED,
              submittedTx: null,
              revisionTx: input.data.txHash,
            },
          })
          await tx.activityLog.create({
            data: {
              projectId: context.id,
              actorId: userId,
              type: 'REVISION_REQUESTED_ON_CHAIN',
              title: 'On-chain revision request confirmed',
              detail: `Confirmed on-chain transaction ${input.data.txHash}`,
            },
          })
        })
      } else if (!context.escrow.revisionTx) {
        await db.escrow.update({
          where: { projectId: context.id },
          data: { revisionTx: input.data.txHash },
        })
      }
      response.status(result.confirmed ? 200 : 202).json({
        status: result.confirmed ? 'CONFIRMED' : 'PENDING',
        confirmations: result.confirmations,
        confirmationsRequired: config.confirmations,
      })
    } catch (error) {
      if (error instanceof Error && isReceiptError(error)) {
        return fail(response, 422, 'INVALID_CHAIN_RECEIPT', error.message)
      }
      next(error)
    }
  })

  router.post('/projects/:projectId/release/prepare', requireAuth, async (request: AuthenticatedRequest, response, next) => {
    const userId = authenticatedUser(request, response)
    if (!userId) return
    const config = safeConfig(dependencies, response)
    if (!config) return
    try {
      const context = await getReleaseContext(db, projectIdParam(request), userId)
      if (!context) return fail(response, 404, 'PROJECT_NOT_FOUND', 'An eligible project was not found.')
      if (context.client.wallet?.chainId !== config.chainId) {
        return fail(response, 409, 'WALLET_CHAIN_MISMATCH', 'The linked client wallet is not on the configured chain.')
      }
      if (!context.escrow?.onChainId || context.escrow.status !== EscrowStatus.APPROVED) {
        return fail(response, 409, 'ESCROW_NOT_APPROVED', 'The escrow is not approved for release.')
      }
      const call = new Interface(['function release(uint256 escrowId)'])
      response.json({
        chainId: config.chainId,
        contractAddress: config.escrowAddress,
        transaction: {
          to: config.escrowAddress,
          data: call.encodeFunctionData('release', [context.escrow.onChainId]),
          value: '0',
        },
        confirmationsRequired: config.confirmations,
      })
    } catch (error) {
      next(error)
    }
  })

  router.post('/projects/:projectId/release-confirm', requireAuth, async (request: AuthenticatedRequest, response, next) => {
    const userId = authenticatedUser(request, response)
    if (!userId) return
    const input = txHashSchema.safeParse(request.body)
    if (!input.success) return fail(response, 400, 'VALIDATION_ERROR', 'Provide a valid transaction hash.')
    const config = safeConfig(dependencies, response)
    if (!config) return
    try {
      const context = await getReleaseContext(db, projectIdParam(request), userId)
      if (!context) return fail(response, 404, 'PROJECT_NOT_FOUND', 'An eligible project was not found.')
      if (!context.escrow?.onChainId || !context.client.wallet) {
        return fail(response, 409, 'ESCROW_NOT_FUNDED', 'A confirmed funded escrow is required.')
      }
      if (context.client.wallet.chainId !== config.chainId) {
        return fail(response, 409, 'WALLET_CHAIN_MISMATCH', 'The linked client wallet is not on the configured chain.')
      }
      if (
        context.escrow.status !== EscrowStatus.APPROVED &&
        !(context.escrow.status === EscrowStatus.PAID && context.escrow.releasedTx === input.data.txHash)
      ) {
        return fail(response, 409, 'ESCROW_NOT_APPROVED', 'The escrow is not approved for release.')
      }
      const provider = dependencies.getProvider(config)
      await assertProviderChain(provider, config.chainId)
      const result = await verifyReleaseReceipt(
        provider,
        input.data.txHash,
        config.escrowAddress,
        context.client.wallet.address,
        context.escrow.onChainId,
        config.confirmations,
      )
      if (!result) return response.status(202).json({ status: 'PENDING', confirmations: 0 })

      const confirmed = result.confirmed
      const previous = await db.transaction.findUnique({ where: { txHash: input.data.txHash } })
      if (context.escrow.releasedTx && context.escrow.releasedTx !== input.data.txHash) {
        return fail(response, 409, 'RELEASE_ALREADY_RECORDED', 'A different release transaction is already recorded.')
      }
      const transaction = await persistTransaction(db, {
        userId,
        projectId: context.id,
        txHash: input.data.txHash,
        amount: context.escrow.amount.toString(),
        type: TransactionType.RELEASE,
        blockNumber: result.receipt.blockNumber,
        status: confirmed ? TransactionStatus.CONFIRMED : TransactionStatus.PENDING,
      })
      if (confirmed) {
        await db.$transaction(async (tx) => {
          await tx.escrow.update({
            where: { projectId: context.id },
            data: { status: EscrowStatus.PAID, releasedTx: input.data.txHash },
          })
          if (previous?.status !== TransactionStatus.CONFIRMED) {
            await tx.activityLog.create({
              data: {
                projectId: context.id,
                actorId: userId,
                type: 'PAYMENT_RELEASED',
                title: 'Escrow payment released',
                detail: `Confirmed on-chain transaction ${input.data.txHash}`,
              },
            })
          }
        })
      } else {
        await db.escrow.update({
          where: { projectId: context.id },
          data: { releasedTx: input.data.txHash },
        })
      }
      await reconcileKnownChainTransactions(db, provider, config, config.confirmations, context.id)
      response.status(confirmed ? 200 : 202).json({
        status: confirmed ? 'CONFIRMED' : 'PENDING',
        confirmations: result.confirmations,
        confirmationsRequired: config.confirmations,
        transaction,
      })
    } catch (error) {
      if (error instanceof Error && isReceiptError(error)) {
        return fail(response, 422, 'INVALID_CHAIN_RECEIPT', error.message)
      }
      next(error)
    }
  })

  return router
}

async function confirmFunding(
  request: AuthenticatedRequest,
  response: Response,
  next: (error?: unknown) => void,
  dependencies: ChainRouterDependencies,
  db: PrismaClient,
) {
  const userId = authenticatedUser(request, response)
  if (!userId) return
  const input = txHashSchema.safeParse(request.body)
  if (!input.success) return fail(response, 400, 'VALIDATION_ERROR', 'Provide a valid transaction hash.')
  const config = safeConfig(dependencies, response)
  if (!config) return
  try {
    const context = await getFundingContext(db, projectIdParam(request), userId, input.data.txHash, config.chainId)
    if (!context) return fail(response, 404, 'PROJECT_NOT_FOUND', 'An eligible project was not found.')
    if (context.error) return fail(response, 409, 'CHAIN_PRECONDITION', context.error)
    const provider = dependencies.getProvider(config)
    await assertProviderChain(provider, config.chainId)
    const result = await verifyFundingReceipt(provider, input.data.txHash, {
      contractAddress: config.escrowAddress,
      clientAddress: context.client.wallet!.address,
      freelancerAddress: context.freelancerAddress,
      amount: parseUnits(context.amount, config.tokenDecimals),
      deadline: BigInt(Math.floor(context.project.deadline.getTime() / 1000)),
    }, config.confirmations)
    if (!result) return response.status(202).json({ status: 'PENDING', confirmations: 0 })

    const confirmed = result.confirmed
    const previous = await db.transaction.findUnique({ where: { txHash: input.data.txHash } })
    const transaction = await persistTransaction(db, {
      userId,
      projectId: context.project.id,
      txHash: input.data.txHash,
      amount: context.amount,
      type: TransactionType.FUND,
      blockNumber: result.receipt.blockNumber,
      status: confirmed ? TransactionStatus.CONFIRMED : TransactionStatus.PENDING,
    })
    if (confirmed) {
      await db.$transaction(async (tx) => {
        const existingEscrow = await tx.escrow.findUnique({ where: { projectId: context.project.id } })
        if (existingEscrow) {
          if (existingEscrow.fundedTx !== input.data.txHash || existingEscrow.onChainId !== result.escrowId) {
            throw new Error('The project already has a different confirmed funding transaction')
          }
        } else {
          await tx.escrow.create({
            data: {
              projectId: context.project.id,
              contractAddress: config.escrowAddress,
              onChainId: result.escrowId,
              amount: context.amount,
              fee: formatUnitsFloor(parseUnits(context.amount, config.tokenDecimals) * FEE_BPS / BPS_DENOMINATOR, config.tokenDecimals),
              status: EscrowStatus.FUNDED,
              fundedTx: input.data.txHash,
            },
          })
        }
        if (previous?.status !== TransactionStatus.CONFIRMED) {
          await tx.activityLog.create({
            data: {
              projectId: context.project.id,
              actorId: userId,
              type: 'ESCROW_FUNDED',
              title: 'Escrow funded',
              detail: `Confirmed on-chain transaction ${input.data.txHash}`,
            },
          })
        }
      })
    }
    await reconcileKnownChainTransactions(db, provider, config, config.confirmations, context.project.id)
    response.status(confirmed ? 200 : 202).json({
      status: confirmed ? 'CONFIRMED' : 'PENDING',
      confirmations: result.confirmations,
      confirmationsRequired: config.confirmations,
      escrowId: result.escrowId.toString(),
      transaction,
    })
  } catch (error) {
    if (error instanceof Error && isReceiptError(error)) {
      return fail(response, 422, 'INVALID_CHAIN_RECEIPT', error.message)
    }
    next(error)
  }
}

async function getFundingContext(
  db: PrismaClient,
  projectId: string,
  userId: string,
  confirmingTx?: string,
  chainId?: number,
) {
  if (!projectId) return undefined
  const project = await db.project.findFirst({
    where: { id: projectId, clientId: userId },
    include: {
      client: { include: { wallet: true } },
      escrow: true,
      proposals: {
        where: { status: ProposalStatus.ACCEPTED },
        include: { freelancer: { include: { wallet: true } } },
        take: 1,
      },
    },
  })
  if (!project) return undefined
  if (!project.client.wallet) return { project, error: 'Link a verified client wallet before funding.' } as const
  if (chainId !== undefined && project.client.wallet.chainId !== chainId) {
    return { project, error: 'The linked client wallet is not on the configured chain.' } as const
  }
  if (project.escrow && project.escrow.fundedTx !== confirmingTx) {
    return { project, error: 'This project already has an escrow.' } as const
  }
  if (project.status !== ProjectStatus.IN_PROGRESS) return { project, error: 'Only an active project with an accepted proposal can be funded.' } as const
  const accepted = project.proposals[0]
  if (!accepted) return { project, error: 'The project has no accepted proposal.' } as const
  if (!accepted.freelancer.wallet) return { project, error: 'The accepted freelancer must link a verified wallet.' } as const
  if (chainId !== undefined && accepted.freelancer.wallet.chainId !== chainId) {
    return { project, error: 'The linked freelancer wallet is not on the configured chain.' } as const
  }
  const amount = accepted.price.toString()
  if (!amountPattern.test(amount)) return { project, error: 'The accepted proposal amount is incompatible with the token precision.' } as const
  if (project.client.wallet.address.toLowerCase() === accepted.freelancer.wallet.address.toLowerCase()) {
    return { project, error: 'The client and freelancer wallets must be different.' } as const
  }
  return {
    project,
    client: project.client,
    freelancerAddress: accepted.freelancer.wallet.address,
    amount,
  }
}

async function getFreelancerWorkContext(db: PrismaClient, projectId: string, freelancerId: string) {
  if (!projectId) return undefined
  const project = await db.project.findFirst({
    where: {
      id: projectId,
      proposals: { some: { freelancerId, status: ProposalStatus.ACCEPTED } },
    },
    include: {
      escrow: true,
      client: { select: { id: true } },
      proposals: {
        where: { freelancerId, status: ProposalStatus.ACCEPTED },
        include: { freelancer: { include: { wallet: true } } },
        take: 1,
      },
    },
  })
  const freelancer = project?.proposals[0]?.freelancer
  if (!project || !freelancer) return undefined
  return { ...project, freelancer }
}

async function getDisputeContext(db: PrismaClient, projectId: string, userId: string) {
  if (!projectId) return undefined
  const project = await db.project.findFirst({
    where: {
      id: projectId,
      OR: [
        { clientId: userId },
        { proposals: { some: { freelancerId: userId, status: ProposalStatus.ACCEPTED } } },
      ],
    },
    include: {
      escrow: true,
      client: { include: { wallet: true } },
      proposals: {
        where: { status: ProposalStatus.ACCEPTED },
        include: { freelancer: { include: { wallet: true } } },
        take: 1,
      },
    },
  })
  const freelancer = project?.proposals[0]?.freelancer
  if (!project || !freelancer) return undefined
  const wallet = project.clientId === userId ? project.client.wallet : freelancer.wallet
  if (!wallet) return { ...project, wallet: undefined }
  return { ...project, wallet }
}

async function getArbiterDisputeContext(db: PrismaClient, projectId: string) {
  if (!projectId) return undefined
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      escrow: true,
      client: { include: { wallet: true } },
      proposals: {
        where: { status: ProposalStatus.ACCEPTED },
        include: { freelancer: { include: { wallet: true } } },
        take: 1,
      },
      disputes: {
        where: { status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })
  const freelancer = project?.proposals[0]?.freelancer
  const dispute = project?.disputes[0]
  if (!project || !freelancer || !dispute) return undefined
  return { ...project, freelancerId: freelancer.id, dispute }
}

async function getReleaseContext(db: PrismaClient, projectId: string, userId: string) {
  if (!projectId) return undefined
  return db.project.findFirst({
    where: { id: projectId, clientId: userId },
    include: { escrow: true, client: { include: { wallet: true } } },
  })
}

function projectIdParam(request: AuthenticatedRequest) {
  const value = request.params.projectId
  return typeof value === 'string' ? value : ''
}

async function persistTransaction(
  db: PrismaClient,
  input: {
    userId: string
    projectId: string
    txHash: string
    amount: string
    type: TransactionType
    blockNumber: number
    status: TransactionStatus
  },
) {
  const existing = await db.transaction.findUnique({ where: { txHash: input.txHash } })
  if (existing && (existing.userId !== input.userId || existing.projectId !== input.projectId || existing.type !== input.type)) {
    throw new Error('The transaction hash is already associated with another operation')
  }
  return db.transaction.upsert({
    where: { txHash: input.txHash },
    create: {
      userId: input.userId,
      projectId: input.projectId,
      txHash: input.txHash,
      amount: input.amount,
      type: input.type,
      status: input.status,
      blockNumber: BigInt(input.blockNumber),
    },
    update: {
      status: existing?.status === TransactionStatus.CONFIRMED ? TransactionStatus.CONFIRMED : input.status,
      blockNumber: BigInt(input.blockNumber),
    },
  })
}

function safeConfig(dependencies: ChainRouterDependencies, response: Response) {
  try {
    return dependencies.getConfig()
  } catch {
    fail(response, 503, 'CHAIN_NOT_CONFIGURED', 'On-chain payments are not configured.')
    return undefined
  }
}

function requireArbiterAddress(response: Response) {
  try {
    const address = getArbiterWalletAddress()
    if (!address) {
      fail(response, 503, 'ARBITER_NOT_CONFIGURED', 'Set ARBITER_WALLET_ADDRESS to enable on-chain dispute resolution.')
      return undefined
    }
    return address
  } catch (error) {
    fail(response, 503, 'ARBITER_NOT_CONFIGURED', error instanceof Error ? error.message : 'The arbiter wallet configuration is invalid.')
    return undefined
  }
}

function authenticatedUser(request: AuthenticatedRequest, response: Response) {
  if (!request.authUserId) {
    fail(response, 401, 'UNAUTHENTICATED', 'Sign in to continue.')
    return undefined
  }
  return request.authUserId
}

function fail(response: Response, status: number, code: string, message: string) {
  response.status(status).json({ code, message })
}

function isReceiptError(error: Error) {
  return /receipt|transaction|calldata|escrow creation|escrow release|canonical chain|client wallet|freelancer wallet|participant wallet|release this escrow|expected escrow|work submission|revision event|dispute event|different chain|already has a different confirmed funding/i.test(error.message)
}

function formatUnitsFloor(value: bigint, decimals: number) {
  const scale = 10n ** BigInt(decimals)
  const whole = value / scale
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

export const chainRouter = createChainRouter()
