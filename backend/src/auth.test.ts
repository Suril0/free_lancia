import assert from 'node:assert/strict'
import { once } from 'node:events'
import { after, before, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import { createApp } from './app.js'

const server = createApp().listen(0, '127.0.0.1')
let baseUrl: string

before(async () => {
  await once(server, 'listening')
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  server.close()
  await once(server, 'close')
})

test('protected account endpoints require a session', async () => {
  const response = await fetch(`${baseUrl}/api/v1/auth/me`)
  assert.equal(response.status, 401)
  assert.equal((await response.json()).code, 'UNAUTHENTICATED')
})

test('signup rejects invalid input before accessing the database', async () => {
  const response = await fetch(`${baseUrl}/api/v1/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email', password: 'short' }),
  })
  assert.equal(response.status, 400)
  assert.equal((await response.json()).code, 'VALIDATION_ERROR')
})

test('logout clears cookies when no session exists', async () => {
  const response = await fetch(`${baseUrl}/api/v1/auth/logout`, { method: 'POST' })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).ok, true)
  assert.match(response.headers.get('set-cookie') ?? '', /freelancia_access/)
})

test('project listings reject invalid pagination without a database query', async () => {
  const response = await fetch(`${baseUrl}/api/v1/projects?page=0`)
  assert.equal(response.status, 400)
  assert.equal((await response.json()).code, 'VALIDATION_ERROR')
})

test('project writes require authentication', async () => {
  const response = await fetch(`${baseUrl}/api/v1/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(response.status, 401)
  assert.equal((await response.json()).code, 'UNAUTHENTICATED')
})

test('project proposals require authentication', async () => {
  const response = await fetch(`${baseUrl}/api/v1/projects/example/proposals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(response.status, 401)
  assert.equal((await response.json()).code, 'UNAUTHENTICATED')
})
