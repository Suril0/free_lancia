import { Contract, Interface, JsonRpcProvider, type Provider } from 'ethers'
import type { ChainConfig } from './config.js'

export const escrowAbi = [
  'function createEscrow(address freelancer,uint256 amount,uint64 deadline) returns (uint256 escrowId)',
  'function submitWork(uint256 escrowId)',
  'function requestRevision(uint256 escrowId)',
  'function raiseDispute(uint256 escrowId)',
  'function resolveDispute(uint256 escrowId,bool releaseToFreelancer)',
  'function release(uint256 escrowId)',
  'event EscrowCreated(uint256 indexed escrowId,address indexed client,address indexed freelancer,uint256 amount,uint64 deadline)',
  'event WorkSubmitted(uint256 indexed escrowId,address indexed freelancer)',
  'event RevisionRequested(uint256 indexed escrowId,address indexed client,uint256 revisionCount)',
  'event DisputeRaised(uint256 indexed escrowId,address indexed participant)',
  'event DisputeResolved(uint256 indexed escrowId,bool releasedToFreelancer)',
  'event EscrowRefunded(uint256 indexed escrowId,address indexed client,uint256 amount)',
  'event EscrowReleased(uint256 indexed escrowId,uint256 freelancerAmount,uint256 feeAmount)',
] as const

export const tokenAbi = ['function approve(address spender,uint256 amount) returns (bool)'] as const

export function createChainClient(config: ChainConfig): {
  provider: JsonRpcProvider
  escrow: Contract
  escrowInterface: Interface
} {
  const provider = new JsonRpcProvider(config.rpcUrl, config.chainId)
  const escrowInterface = new Interface(escrowAbi)
  return {
    provider,
    escrow: new Contract(config.escrowAddress, escrowAbi, provider),
    escrowInterface,
  }
}

export type ChainProvider = Provider
