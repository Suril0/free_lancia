import assert from 'node:assert/strict'
import test from 'node:test'
import { Interface, type Provider, type TransactionReceipt } from 'ethers'
import { escrowAbi } from './client.js'
import { getArbiterWalletAddress, getChainConfig } from './config.js'
import {
  assertProviderChain,
  isTransactionHash,
  verifyDisputeRaisedReceipt,
  verifyDisputeResolutionReceipt,
  verifyPendingDisputeResolutionTransaction,
  verifyFundingReceipt,
  verifyRevisionRequestedReceipt,
  verifyReleaseReceipt,
  verifyWorkSubmittedReceipt,
} from './receipts.js'

const client = '0x0000000000000000000000000000000000000011'
const freelancer = '0x0000000000000000000000000000000000000022'
const contractAddress = '0x0000000000000000000000000000000000000033'
const txHash = `0x${'ab'.repeat(32)}`
const blockHash = `0x${'cd'.repeat(32)}`
const amount = 25_000_000n
const deadline = 1_800_000_000n

test('chain config requires a valid RPC, chain ID, and contract addresses', () => {
  assert.throws(() => getChainConfig({}))
  assert.deepEqual(
    getChainConfig({
      CHAIN_RPC_URL: 'https://rpc.example',
      CHAIN_ID: '11155111',
      ESCROW_CONTRACT_ADDRESS: contractAddress,
      PAYMENT_TOKEN_ADDRESS: freelancer,
      CHAIN_CONFIRMATIONS: '4',
    }),
    {
      rpcUrl: 'https://rpc.example',
      chainId: 11155111,
      escrowAddress: contractAddress,
      tokenAddress: freelancer,
      tokenDecimals: 6,
      confirmations: 4,
    },
  )
  assert.equal(getArbiterWalletAddress({ ARBITER_WALLET_ADDRESS: client }), client)
  assert.equal(getArbiterWalletAddress({}), undefined)
  assert.throws(() => getArbiterWalletAddress({ ARBITER_WALLET_ADDRESS: 'invalid' }), /valid wallet address/)
})

test('transaction hash validation accepts only 32-byte hex hashes', () => {
  assert.equal(isTransactionHash(txHash), true)
  assert.equal(isTransactionHash('0x1234'), false)
  assert.equal(isTransactionHash(42), false)
})

test('funding receipt verifies call, participants, event, canonical block, and confirmations', async () => {
  const contractInterface = new Interface(escrowAbi)
  const transactionData = contractInterface.encodeFunctionData('createEscrow', [
    freelancer,
    amount,
    deadline,
  ])
  const event = contractInterface.encodeEventLog(
    contractInterface.getEvent('EscrowCreated')!,
    [7n, client, freelancer, amount, deadline],
  )
  const receipt = {
    status: 1,
    blockNumber: 100,
    blockHash,
    logs: [{
      address: contractAddress,
      topics: event.topics,
      data: event.data,
      index: 0,
      transactionIndex: 0,
      blockNumber: 100,
      blockHash,
      transactionHash: txHash,
      removed: false,
    }],
  } as unknown as TransactionReceipt
  const provider = {
    getTransactionReceipt: async () => receipt,
    getTransaction: async () => ({
      to: contractAddress,
      from: client,
      data: transactionData,
    }),
    getBlock: async () => ({ hash: blockHash }),
    getBlockNumber: async () => 102,
    getNetwork: async () => ({ chainId: 31337n }),
  } as unknown as Provider

  const verified = await verifyFundingReceipt(provider, txHash, {
    contractAddress,
    clientAddress: client,
    freelancerAddress: freelancer,
    amount,
    deadline,
  }, 3)
  assert.equal(verified?.escrowId, 7n)
  assert.equal(verified?.confirmations, 3)
  assert.equal(verified?.confirmed, true)
  await assertProviderChain(provider, 31337)
  await assert.rejects(assertProviderChain(provider, 1), /different chain/)
  await assert.rejects(verifyFundingReceipt(provider, txHash, {
    contractAddress,
    clientAddress: client,
    freelancerAddress: freelancer,
    amount: amount + 1n,
    deadline,
  }, 3), /calldata/)
})

test('funding receipt waits for finality and rejects receipts from a reorganized block', async () => {
  const contractInterface = new Interface(escrowAbi)
  const transactionData = contractInterface.encodeFunctionData('createEscrow', [
    freelancer,
    amount,
    deadline,
  ])
  const event = contractInterface.encodeEventLog(
    contractInterface.getEvent('EscrowCreated')!,
    [8n, client, freelancer, amount, deadline],
  )
  const receipt = {
    status: 1,
    blockNumber: 100,
    blockHash,
    logs: [{
      address: contractAddress,
      topics: event.topics,
      data: event.data,
    }],
  } as unknown as TransactionReceipt
  const provider = {
    getTransactionReceipt: async () => receipt,
    getTransaction: async () => ({ to: contractAddress, from: client, data: transactionData }),
    getBlock: async () => ({ hash: blockHash }),
    getBlockNumber: async () => 100,
  } as unknown as Provider
  const expected = { contractAddress, clientAddress: client, freelancerAddress: freelancer, amount, deadline }

  const pending = await verifyFundingReceipt(provider, txHash, expected, 2)
  assert.equal(pending?.confirmed, false)
  assert.equal(pending?.confirmations, 1)

  const reorganizedProvider = {
    ...provider,
    getBlock: async () => ({ hash: `0x${'ef'.repeat(32)}` }),
  } as unknown as Provider
  await assert.rejects(
    verifyFundingReceipt(reorganizedProvider, txHash, expected, 2),
    /canonical chain/,
  )
})

test('release receipt verifies the client call and matching escrow release event', async () => {
  const contractInterface = new Interface(escrowAbi)
  const data = contractInterface.encodeFunctionData('release', [9n])
  const event = contractInterface.encodeEventLog(
    contractInterface.getEvent('EscrowReleased')!,
    [9n, 24_500_000n, 500_000n],
  )
  const receipt = {
    status: 1,
    blockNumber: 100,
    blockHash,
    logs: [{ address: contractAddress, topics: event.topics, data: event.data }],
  } as unknown as TransactionReceipt
  const provider = {
    getTransactionReceipt: async () => receipt,
    getTransaction: async () => ({ to: contractAddress, from: client, data, value: 0n }),
    getBlock: async () => ({ hash: blockHash }),
    getBlockNumber: async () => 104,
  } as unknown as Provider

  const verified = await verifyReleaseReceipt(provider, txHash, contractAddress, client, 9n, 3)
  assert.equal(verified?.confirmed, true)
  assert.equal(verified?.escrowId, 9n)
})

test('work submission receipt verifies the freelancer call and event', async () => {
  const contractInterface = new Interface(escrowAbi)
  const data = contractInterface.encodeFunctionData('submitWork', [10n])
  const event = contractInterface.encodeEventLog(
    contractInterface.getEvent('WorkSubmitted')!,
    [10n, freelancer],
  )
  const receipt = {
    status: 1,
    blockNumber: 100,
    blockHash,
    logs: [{ address: contractAddress, topics: event.topics, data: event.data }],
  } as unknown as TransactionReceipt
  const provider = {
    getTransactionReceipt: async () => receipt,
    getTransaction: async () => ({ to: contractAddress, from: freelancer, data, value: 0n }),
    getBlock: async () => ({ hash: blockHash }),
    getBlockNumber: async () => 102,
  } as unknown as Provider

  const verified = await verifyWorkSubmittedReceipt(provider, txHash, contractAddress, freelancer, 10n, 3)
  assert.equal(verified?.confirmed, true)
  await assert.rejects(
    verifyWorkSubmittedReceipt(provider, txHash, contractAddress, client, 10n, 3),
    /freelancer wallet/,
  )
})

test('revision receipt verifies the client call and matching escrow event', async () => {
  const contractInterface = new Interface(escrowAbi)
  const data = contractInterface.encodeFunctionData('requestRevision', [11n])
  const event = contractInterface.encodeEventLog(
    contractInterface.getEvent('RevisionRequested')!,
    [11n, client, 1n],
  )
  const receipt = {
    status: 1,
    blockNumber: 100,
    blockHash,
    logs: [{ address: contractAddress, topics: event.topics, data: event.data }],
  } as unknown as TransactionReceipt
  const provider = {
    getTransactionReceipt: async () => receipt,
    getTransaction: async () => ({ to: contractAddress, from: client, data, value: 0n }),
    getBlock: async () => ({ hash: blockHash }),
    getBlockNumber: async () => 100,
  } as unknown as Provider

  const verified = await verifyRevisionRequestedReceipt(provider, txHash, contractAddress, client, 11n, 2)
  assert.equal(verified?.confirmed, false)
  assert.equal(verified?.confirmations, 1)
})

test('dispute receipt verifies the participant call and matching escrow event', async () => {
  const contractInterface = new Interface(escrowAbi)
  const data = contractInterface.encodeFunctionData('raiseDispute', [12n])
  const event = contractInterface.encodeEventLog(
    contractInterface.getEvent('DisputeRaised')!,
    [12n, freelancer],
  )
  const receipt = {
    status: 1,
    blockNumber: 100,
    blockHash,
    logs: [{ address: contractAddress, topics: event.topics, data: event.data }],
  } as unknown as TransactionReceipt
  const provider = {
    getTransactionReceipt: async () => receipt,
    getTransaction: async () => ({ to: contractAddress, from: freelancer, data, value: 0n }),
    getBlock: async () => ({ hash: blockHash }),
    getBlockNumber: async () => 100,
  } as unknown as Provider

  const verified = await verifyDisputeRaisedReceipt(provider, txHash, contractAddress, freelancer, 12n, 1)
  assert.equal(verified?.confirmed, true)
  await assert.rejects(
    verifyDisputeRaisedReceipt(provider, txHash, contractAddress, client, 12n, 1),
    /participant wallet/,
  )
})

test('dispute resolution verifies arbiter, selected outcome, payout event, and finality', async () => {
  const arbiter = '0x0000000000000000000000000000000000000044'
  const contractInterface = new Interface(escrowAbi)
  const cases = [
    {
      releaseToFreelancer: true,
      outcome: contractInterface.encodeEventLog(
        contractInterface.getEvent('EscrowReleased')!,
        [13n, 24_500_000n, 500_000n],
      ),
    },
    {
      releaseToFreelancer: false,
      outcome: contractInterface.encodeEventLog(
        contractInterface.getEvent('EscrowRefunded')!,
        [13n, client, amount],
      ),
    },
  ] as const

  for (const item of cases) {
    const data = contractInterface.encodeFunctionData('resolveDispute', [13n, item.releaseToFreelancer])
    const resolution = contractInterface.encodeEventLog(
      contractInterface.getEvent('DisputeResolved')!,
      [13n, item.releaseToFreelancer],
    )
    const receipt = {
      status: 1,
      blockNumber: 100,
      blockHash,
      logs: [
        { address: contractAddress, topics: item.outcome.topics, data: item.outcome.data },
        { address: contractAddress, topics: resolution.topics, data: resolution.data },
      ],
    } as unknown as TransactionReceipt
    const provider = {
      getTransactionReceipt: async () => receipt,
      getTransaction: async () => ({ to: contractAddress, from: arbiter, data, value: 0n }),
      getBlock: async () => ({ hash: blockHash }),
      getBlockNumber: async () => 102,
    } as unknown as Provider

    const verified = await verifyDisputeResolutionReceipt(
      provider, txHash, contractAddress, arbiter, 13n, client, amount, 3,
    )
    assert.equal(verified?.confirmed, true)
    assert.equal(verified?.releaseToFreelancer, item.releaseToFreelancer)
    assert.equal(await verifyPendingDisputeResolutionTransaction(
      provider, txHash, contractAddress, arbiter, 13n, item.releaseToFreelancer,
    ), true)
    await assert.rejects(
      verifyDisputeResolutionReceipt(provider, txHash, contractAddress, client, 13n, client, amount, 3),
      /arbiter wallet/,
    )
  }
})
