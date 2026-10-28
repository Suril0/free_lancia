import assert from 'node:assert/strict'
import test from 'node:test'
import { Wallet } from 'ethers'
import { parseSiweMessage, recoverSiweAddress } from './auth.js'

test('parses a bounded Freelancia SIWE message and recovers its signer', async () => {
  const wallet = Wallet.createRandom()
  const issuedAt = new Date()
  const message = [
    'localhost:5173 wants you to sign in with your Ethereum account:',
    wallet.address,
    '',
    'Sign in to Freelancia as a client and securely verify this wallet.',
    '',
    'URI: http://localhost:5173',
    'Version: 1',
    'Chain ID: 11155111',
    `Nonce: ${'a'.repeat(32)}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expiration Time: ${new Date(issuedAt.getTime() + 5 * 60_000).toISOString()}`,
  ].join('\n')
  const signature = await wallet.signMessage(message)
  const parsed = parseSiweMessage(message)

  assert.equal(parsed?.address, wallet.address)
  assert.equal(parsed?.role, 'client')
  assert.equal(parsed?.chainId, 11155111)
  assert.equal(recoverSiweAddress(message, signature), wallet.address)
  assert.equal(recoverSiweAddress(`${message}\n`, signature), undefined)
  assert.equal(recoverSiweAddress(message, `0x${'0'.repeat(130)}`), undefined)
})

test('rejects unsupported roles, short nonces, and malformed chain IDs', () => {
  const message = [
    'localhost:5173 wants you to sign in with your Ethereum account:',
    '0x0000000000000000000000000000000000000001',
    '',
    'Sign in to Freelancia as a admin and securely verify this wallet.',
    '',
    'URI: http://localhost:5173',
    'Version: 1',
    'Chain ID: 0',
    'Nonce: abc',
    `Issued At: ${new Date().toISOString()}`,
    `Expiration Time: ${new Date(Date.now() + 60_000).toISOString()}`,
  ].join('\n')
  assert.equal(parseSiweMessage(message), undefined)
})
