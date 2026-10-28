import { getAddress } from 'ethers'

export interface ChainConfig {
  rpcUrl: string
  chainId: number
  escrowAddress: string
  tokenAddress: string
  tokenDecimals: number
  confirmations: number
}

export function getChainConfig(env: NodeJS.ProcessEnv = process.env): ChainConfig {
  const rpcUrl = env.CHAIN_RPC_URL
  const chainId = Number(env.CHAIN_ID)
  const confirmations = Number(env.CHAIN_CONFIRMATIONS ?? '3')
  const tokenDecimals = Number(env.PAYMENT_TOKEN_DECIMALS ?? '6')

  if (!rpcUrl || !/^https?:\/\//i.test(rpcUrl)) {
    throw new Error('CHAIN_RPC_URL must be an HTTP(S) provider URL')
  }
  if (!Number.isSafeInteger(chainId) || chainId < 1) {
    throw new Error('CHAIN_ID must be a positive integer')
  }
  if (!Number.isSafeInteger(confirmations) || confirmations < 1 || confirmations > 1000) {
    throw new Error('CHAIN_CONFIRMATIONS must be between 1 and 1000')
  }
  if (!Number.isSafeInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 18) {
    throw new Error('PAYMENT_TOKEN_DECIMALS must be between 0 and 18')
  }

  try {
    return {
      rpcUrl,
      chainId,
      escrowAddress: getAddress(requiredAddress(env.ESCROW_CONTRACT_ADDRESS, 'ESCROW_CONTRACT_ADDRESS')),
      tokenAddress: getAddress(requiredAddress(env.PAYMENT_TOKEN_ADDRESS, 'PAYMENT_TOKEN_ADDRESS')),
      tokenDecimals,
      confirmations,
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('ESCROW_CONTRACT_ADDRESS')) throw error
    if (error instanceof Error && error.message.startsWith('PAYMENT_TOKEN_ADDRESS')) throw error
    throw new Error('ESCROW_CONTRACT_ADDRESS and PAYMENT_TOKEN_ADDRESS must be valid addresses')
  }
}

export function getArbiterWalletAddress(env: NodeJS.ProcessEnv = process.env) {
  const value = env.ARBITER_WALLET_ADDRESS
  if (!value) return undefined
  try {
    return getAddress(value)
  } catch {
    throw new Error('ARBITER_WALLET_ADDRESS must be a valid wallet address')
  }
}

function requiredAddress(value: string | undefined, name: string) {
  if (!value) throw new Error(`${name} is required`)
  return value
}
