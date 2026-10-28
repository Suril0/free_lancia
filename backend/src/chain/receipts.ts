import {
  Interface,
  getAddress,
  isHexString,
  type Provider,
  type TransactionReceipt,
} from 'ethers'
import { escrowAbi } from './client.js'

export interface ExpectedFunding {
  contractAddress: string
  clientAddress: string
  freelancerAddress: string
  amount: bigint
  deadline: bigint
}

export interface VerifiedEventReceipt {
  receipt: TransactionReceipt
  escrowId: bigint
  confirmations: number
  confirmed: boolean
}

export interface VerifiedDisputeResolution extends VerifiedEventReceipt {
  releaseToFreelancer: boolean
}

const contractInterface = new Interface(escrowAbi)

export function isTransactionHash(value: unknown): value is string {
  return typeof value === 'string' && isHexString(value, 32)
}

export async function assertProviderChain(provider: Provider, chainId: number) {
  const network = await provider.getNetwork()
  if (network.chainId !== BigInt(chainId)) {
    throw new Error('The RPC provider is connected to a different chain')
  }
}

export async function verifyFundingReceipt(
  provider: Provider,
  txHash: string,
  expected: ExpectedFunding,
  requiredConfirmations: number,
): Promise<VerifiedEventReceipt | undefined> {
  const receipt = await provider.getTransactionReceipt(txHash)
  if (!receipt) return undefined
  if (receipt.status !== 1) throw new Error('The funding transaction reverted')
  await assertCanonicalReceipt(provider, receipt)

  const transaction = await provider.getTransaction(txHash)
  if (!transaction || !transaction.to || getAddress(transaction.to) !== getAddress(expected.contractAddress)) {
    throw new Error('The transaction was not sent to the configured escrow contract')
  }
  if (getAddress(transaction.from) !== getAddress(expected.clientAddress)) {
    throw new Error('The transaction was not sent by the project client wallet')
  }
  assertCreateEscrowCall(transaction.data, expected)

  const matches = receipt.logs.flatMap((log) => {
    if (getAddress(log.address) !== getAddress(expected.contractAddress)) return []
    try {
      const parsed = contractInterface.parseLog(log)
      if (parsed?.name !== 'EscrowCreated') return []
      const [escrowId, client, freelancer, amount, deadline] = parsed.args
      if (
        getAddress(String(client)) !== getAddress(expected.clientAddress) ||
        getAddress(String(freelancer)) !== getAddress(expected.freelancerAddress) ||
        BigInt(amount) !== expected.amount ||
        BigInt(deadline) !== expected.deadline
      ) return []
      return [BigInt(escrowId)]
    } catch {
      return []
    }
  })
  if (matches.length !== 1) throw new Error('The receipt does not contain the expected escrow creation event')

  const confirmations = await getConfirmations(provider, receipt)
  return {
    receipt,
    escrowId: matches[0]!,
    confirmations,
    confirmed: confirmations >= requiredConfirmations,
  }
}

export async function verifyReleaseReceipt(
  provider: Provider,
  txHash: string,
  contractAddress: string,
  clientAddress: string,
  expectedEscrowId: bigint,
  requiredConfirmations: number,
): Promise<VerifiedEventReceipt | undefined> {
  const receipt = await provider.getTransactionReceipt(txHash)
  if (!receipt) return undefined
  if (receipt.status !== 1) throw new Error('The release transaction reverted')
  await assertCanonicalReceipt(provider, receipt)

  const transaction = await provider.getTransaction(txHash)
  if (!transaction || !transaction.to || getAddress(transaction.to) !== getAddress(contractAddress)) {
    throw new Error('The transaction was not sent to the configured escrow contract')
  }
  if (getAddress(transaction.from) !== getAddress(clientAddress)) {
    throw new Error('The transaction was not sent by the project client wallet')
  }

  let decoded: ReturnType<Interface['parseTransaction']>
  try {
    decoded = contractInterface.parseTransaction({ data: transaction.data, value: transaction.value })
  } catch {
    decoded = null
  }
  if (decoded?.name !== 'release' || BigInt(decoded.args[0]) !== expectedEscrowId) {
    throw new Error('The transaction does not release this escrow')
  }

  const matches = receipt.logs.filter((log) => {
    if (getAddress(log.address) !== getAddress(contractAddress)) return false
    try {
      const parsed = contractInterface.parseLog(log)
      return parsed?.name === 'EscrowReleased' && BigInt(parsed.args[0]) === expectedEscrowId
    } catch {
      return false
    }
  })
  if (matches.length !== 1) throw new Error('The receipt does not contain the expected escrow release event')
  const confirmations = await getConfirmations(provider, receipt)
  return {
    receipt,
    escrowId: expectedEscrowId,
    confirmations,
    confirmed: confirmations >= requiredConfirmations,
  }
}

export async function verifyWorkSubmittedReceipt(
  provider: Provider,
  txHash: string,
  contractAddress: string,
  freelancerAddress: string,
  expectedEscrowId: bigint,
  requiredConfirmations: number,
): Promise<VerifiedEventReceipt | undefined> {
  const receipt = await provider.getTransactionReceipt(txHash)
  if (!receipt) return undefined
  if (receipt.status !== 1) throw new Error('The submission transaction reverted')
  await assertCanonicalReceipt(provider, receipt)

  const transaction = await provider.getTransaction(txHash)
  if (!transaction?.to || getAddress(transaction.to) !== getAddress(contractAddress)) {
    throw new Error('The transaction was not sent to the configured escrow contract')
  }
  if (getAddress(transaction.from) !== getAddress(freelancerAddress)) {
    throw new Error('The transaction was not sent by the assigned freelancer wallet')
  }
  let decoded: ReturnType<Interface['parseTransaction']>
  try {
    decoded = contractInterface.parseTransaction({ data: transaction.data, value: transaction.value })
  } catch {
    decoded = null
  }
  if (decoded?.name !== 'submitWork' || BigInt(decoded.args[0]) !== expectedEscrowId) {
    throw new Error('The transaction does not submit work for this escrow')
  }

  const matches = receipt.logs.filter((log) => {
    if (getAddress(log.address) !== getAddress(contractAddress)) return false
    try {
      const parsed = contractInterface.parseLog(log)
      return parsed?.name === 'WorkSubmitted' &&
        BigInt(parsed.args[0]) === expectedEscrowId &&
        getAddress(String(parsed.args[1])) === getAddress(freelancerAddress)
    } catch {
      return false
    }
  })
  if (matches.length !== 1) throw new Error('The receipt does not contain the expected work submission event')

  const confirmations = await getConfirmations(provider, receipt)
  return { receipt, escrowId: expectedEscrowId, confirmations, confirmed: confirmations >= requiredConfirmations }
}

export async function verifyRevisionRequestedReceipt(
  provider: Provider,
  txHash: string,
  contractAddress: string,
  clientAddress: string,
  expectedEscrowId: bigint,
  requiredConfirmations: number,
): Promise<VerifiedEventReceipt | undefined> {
  const receipt = await provider.getTransactionReceipt(txHash)
  if (!receipt) return undefined
  if (receipt.status !== 1) throw new Error('The revision transaction reverted')
  await assertCanonicalReceipt(provider, receipt)

  const transaction = await provider.getTransaction(txHash)
  if (!transaction?.to || getAddress(transaction.to) !== getAddress(contractAddress)) {
    throw new Error('The transaction was not sent to the configured escrow contract')
  }
  if (getAddress(transaction.from) !== getAddress(clientAddress)) {
    throw new Error('The transaction was not sent by the project client wallet')
  }
  let decoded: ReturnType<Interface['parseTransaction']>
  try {
    decoded = contractInterface.parseTransaction({ data: transaction.data, value: transaction.value })
  } catch {
    decoded = null
  }
  if (decoded?.name !== 'requestRevision' || BigInt(decoded.args[0]) !== expectedEscrowId) {
    throw new Error('The transaction does not request a revision for this escrow')
  }

  const matches = receipt.logs.filter((log) => {
    if (getAddress(log.address) !== getAddress(contractAddress)) return false
    try {
      const parsed = contractInterface.parseLog(log)
      return parsed?.name === 'RevisionRequested' &&
        BigInt(parsed.args[0]) === expectedEscrowId &&
        getAddress(String(parsed.args[1])) === getAddress(clientAddress)
    } catch {
      return false
    }
  })
  if (matches.length !== 1) throw new Error('The receipt does not contain the expected revision event')

  const confirmations = await getConfirmations(provider, receipt)
  return { receipt, escrowId: expectedEscrowId, confirmations, confirmed: confirmations >= requiredConfirmations }
}

export async function verifyDisputeRaisedReceipt(
  provider: Provider,
  txHash: string,
  contractAddress: string,
  participantAddress: string,
  expectedEscrowId: bigint,
  requiredConfirmations: number,
): Promise<VerifiedEventReceipt | undefined> {
  const receipt = await provider.getTransactionReceipt(txHash)
  if (!receipt) return undefined
  if (receipt.status !== 1) throw new Error('The dispute transaction reverted')
  await assertCanonicalReceipt(provider, receipt)

  const transaction = await provider.getTransaction(txHash)
  if (!transaction?.to || getAddress(transaction.to) !== getAddress(contractAddress)) {
    throw new Error('The transaction was not sent to the configured escrow contract')
  }
  if (getAddress(transaction.from) !== getAddress(participantAddress)) {
    throw new Error('The transaction was not sent by a project participant wallet')
  }
  let decoded: ReturnType<Interface['parseTransaction']>
  try {
    decoded = contractInterface.parseTransaction({ data: transaction.data, value: transaction.value })
  } catch {
    decoded = null
  }
  if (decoded?.name !== 'raiseDispute' || BigInt(decoded.args[0]) !== expectedEscrowId) {
    throw new Error('The transaction does not raise a dispute for this escrow')
  }

  const matches = receipt.logs.filter((log) => {
    if (getAddress(log.address) !== getAddress(contractAddress)) return false
    try {
      const parsed = contractInterface.parseLog(log)
      return parsed?.name === 'DisputeRaised' &&
        BigInt(parsed.args[0]) === expectedEscrowId &&
        getAddress(String(parsed.args[1])) === getAddress(participantAddress)
    } catch {
      return false
    }
  })
  if (matches.length !== 1) throw new Error('The receipt does not contain the expected dispute event')

  const confirmations = await getConfirmations(provider, receipt)
  return { receipt, escrowId: expectedEscrowId, confirmations, confirmed: confirmations >= requiredConfirmations }
}

export async function verifyDisputeResolutionReceipt(
  provider: Provider,
  txHash: string,
  contractAddress: string,
  arbiterAddress: string,
  expectedEscrowId: bigint,
  expectedClientAddress: string,
  expectedAmount: bigint,
  requiredConfirmations: number,
): Promise<VerifiedDisputeResolution | undefined> {
  const receipt = await provider.getTransactionReceipt(txHash)
  if (!receipt) return undefined
  if (receipt.status !== 1) throw new Error('The dispute resolution transaction reverted')
  await assertCanonicalReceipt(provider, receipt)

  const transaction = await provider.getTransaction(txHash)
  if (!transaction?.to || getAddress(transaction.to) !== getAddress(contractAddress)) {
    throw new Error('The transaction was not sent to the configured escrow contract')
  }
  if (getAddress(transaction.from) !== getAddress(arbiterAddress)) {
    throw new Error('The transaction was not sent by the configured arbiter wallet')
  }
  let decoded: ReturnType<Interface['parseTransaction']>
  try {
    decoded = contractInterface.parseTransaction({ data: transaction.data, value: transaction.value })
  } catch {
    decoded = null
  }
  if (decoded?.name !== 'resolveDispute' || BigInt(decoded.args[0]) !== expectedEscrowId) {
    throw new Error('The transaction does not resolve this escrow dispute')
  }
  const releaseToFreelancer = Boolean(decoded.args[1])

  const resolutionEvents = receipt.logs.flatMap((log) => {
    if (getAddress(log.address) !== getAddress(contractAddress)) return []
    try {
      const parsed = contractInterface.parseLog(log)
      if (parsed?.name !== 'DisputeResolved' || BigInt(parsed.args[0]) !== expectedEscrowId) return []
      return [Boolean(parsed.args[1])]
    } catch {
      return []
    }
  })
  if (resolutionEvents.length !== 1 || resolutionEvents[0] !== releaseToFreelancer) {
    throw new Error('The receipt does not contain the expected dispute resolution event')
  }

  const outcomeEvents = receipt.logs.filter((log) => {
    if (getAddress(log.address) !== getAddress(contractAddress)) return false
    try {
      const parsed = contractInterface.parseLog(log)
      if (releaseToFreelancer) {
        return parsed?.name === 'EscrowReleased' && BigInt(parsed.args[0]) === expectedEscrowId
      }
      return parsed?.name === 'EscrowRefunded' &&
        BigInt(parsed.args[0]) === expectedEscrowId &&
        getAddress(String(parsed.args[1])) === getAddress(expectedClientAddress) &&
        BigInt(parsed.args[2]) === expectedAmount
    } catch {
      return false
    }
  })
  if (outcomeEvents.length !== 1) {
    throw new Error('The receipt does not contain the expected dispute payment outcome')
  }

  const confirmations = await getConfirmations(provider, receipt)
  return {
    receipt,
    escrowId: expectedEscrowId,
    confirmations,
    confirmed: confirmations >= requiredConfirmations,
    releaseToFreelancer,
  }
}

export async function verifyPendingDisputeResolutionTransaction(
  provider: Provider,
  txHash: string,
  contractAddress: string,
  arbiterAddress: string,
  expectedEscrowId: bigint,
  expectedReleaseToFreelancer: boolean,
) {
  const transaction = await provider.getTransaction(txHash)
  if (!transaction) return false
  if (!transaction.to || getAddress(transaction.to) !== getAddress(contractAddress)) {
    throw new Error('The transaction was not sent to the configured escrow contract')
  }
  if (getAddress(transaction.from) !== getAddress(arbiterAddress)) {
    throw new Error('The transaction was not sent by the configured arbiter wallet')
  }
  let decoded: ReturnType<Interface['parseTransaction']>
  try {
    decoded = contractInterface.parseTransaction({ data: transaction.data, value: transaction.value })
  } catch {
    decoded = null
  }
  if (
    decoded?.name !== 'resolveDispute' ||
    BigInt(decoded.args[0]) !== expectedEscrowId ||
    Boolean(decoded.args[1]) !== expectedReleaseToFreelancer
  ) {
    throw new Error('The transaction does not match the selected dispute resolution')
  }
  return true
}

export async function assertCanonicalReceipt(provider: Provider, receipt: TransactionReceipt) {
  const block = await provider.getBlock(receipt.blockNumber)
  if (!block || !block.hash || block.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
    throw new Error('The transaction receipt is not in the canonical chain')
  }
}

async function getConfirmations(provider: Provider, receipt: TransactionReceipt) {
  const head = await provider.getBlockNumber()
  return Math.max(0, head - receipt.blockNumber + 1)
}

function assertCreateEscrowCall(data: string, expected: ExpectedFunding) {
  let decoded: ReturnType<Interface['parseTransaction']>
  try {
    decoded = contractInterface.parseTransaction({ data })
  } catch {
    decoded = null
  }
  if (
    decoded?.name !== 'createEscrow' ||
    getAddress(String(decoded.args[0])) !== getAddress(expected.freelancerAddress) ||
    BigInt(decoded.args[1]) !== expected.amount ||
    BigInt(decoded.args[2]) !== expected.deadline
  ) {
    throw new Error('The transaction calldata does not match the expected project escrow')
  }
}
