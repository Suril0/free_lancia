import { EscrowStatus, TransactionStatus, TransactionType, type PrismaClient } from '@prisma/client'
import { parseUnits, type Provider } from 'ethers'
import type { ChainConfig } from './config.js'
import { verifyFundingReceipt, verifyReleaseReceipt } from './receipts.js'

/**
 * Reconciles the chain transactions already recorded by the API. This is
 * idempotent and checks the current canonical receipt each time it is called.
 * A full event-range indexer needs durable cursor and log identity storage.
 */
export async function reconcileKnownChainTransactions(
  prisma: PrismaClient,
  provider: Provider,
  config: ChainConfig,
  confirmations: number,
  projectId?: string,
) {
  const rows = await prisma.transaction.findMany({
    where: {
      ...(projectId ? { projectId } : {}),
      txHash: { not: null },
      type: { in: [TransactionType.FUND, TransactionType.RELEASE] },
    },
    include: { project: { include: { escrow: true, client: { include: { wallet: true } } } } },
  })

  for (const row of rows) {
    if (!row.txHash || !row.project) continue
    const project = row.project
    if (!project.client.wallet) continue
    try {
      if (row.type === TransactionType.FUND) {
        const escrow = project.escrow
        if (!escrow || escrow.fundedTx !== row.txHash) continue
        const verified = await verifyFundingReceipt(provider, row.txHash, {
          contractAddress: config.escrowAddress,
          clientAddress: project.client.wallet.address,
          freelancerAddress: await acceptedFreelancerAddress(prisma, project.id),
          amount: parseUnits(escrow.amount.toString(), config.tokenDecimals),
          deadline: BigInt(Math.floor(new Date(project.deadline).getTime() / 1000)),
        }, confirmations)
        if (!verified) continue
        await prisma.transaction.update({
          where: { id: row.id },
          data: {
            blockNumber: BigInt(verified.receipt.blockNumber),
            status: verified.confirmed ? TransactionStatus.CONFIRMED : TransactionStatus.PENDING,
          },
        })
      } else {
        const escrow = project.escrow
        if (!escrow?.onChainId || escrow.releasedTx !== row.txHash) continue
        const verified = await verifyReleaseReceipt(
          provider,
          row.txHash,
          config.escrowAddress,
          project.client.wallet.address,
          escrow.onChainId,
          confirmations,
        )
        if (!verified) continue
        const confirmed = verified.confirmed
        await prisma.$transaction(async (transaction) => {
          await transaction.transaction.update({
            where: { id: row.id },
            data: {
              blockNumber: BigInt(verified.receipt.blockNumber),
              status: confirmed ? TransactionStatus.CONFIRMED : TransactionStatus.PENDING,
            },
          })
          await transaction.escrow.update({
            where: { projectId: project.id },
            data: { status: confirmed ? EscrowStatus.PAID : EscrowStatus.APPROVED },
          })
        })
      }
    } catch {
      // Leave the last known database state intact on transient provider errors.
    }
  }
}

async function acceptedFreelancerAddress(prisma: PrismaClient, projectId: string) {
  const accepted = await prisma.proposal.findFirst({
    where: { projectId, status: 'ACCEPTED' },
    include: { freelancer: { include: { wallet: true } } },
  })
  if (!accepted?.freelancer.wallet) throw new Error('The accepted freelancer has no verified wallet')
  return accepted.freelancer.wallet.address
}
