import argon2 from 'argon2'
import { Prisma, UserRole } from '@prisma/client'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { getAddress, isAddress, verifyMessage } from 'ethers'
import type { NextFunction, Request, Response } from 'express'
import { Router } from 'express'
import { SignJWT, jwtVerify } from 'jose'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { prisma } from './db.js'
import { logger } from './logger.js'

const ACCESS_COOKIE = 'freelancia_access'
const REFRESH_COOKIE = 'freelancia_refresh'
const ACCESS_TTL_SECONDS = 15 * 60
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60
const ISSUER = 'freelancia-api'
const AUDIENCE = 'freelancia-web'

const signupSchema = z.object({
  email: z.email().transform((email) => email.trim().toLowerCase()),
  password: z.string().min(6).max(128),
  name: z.string().trim().min(1).max(80),
  role: z.enum(['client', 'freelancer']),
})

const loginSchema = z.object({
  email: z.email().transform((email) => email.trim().toLowerCase()),
  password: z.string().min(6).max(128),
})

const profileSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  title: z.string().trim().max(120).nullable().optional(),
  bio: z.string().trim().max(2000).nullable().optional(),
  location: z.string().trim().max(120).nullable().optional(),
})

const settingsSchema = z.object({
  email: z.boolean().optional(),
  push: z.boolean().optional(),
  productUpdates: z.boolean().optional(),
})

const roleSchema = z.object({ role: z.enum(['client', 'freelancer']) })
const siweNonceInput = z.object({
  address: z.string().refine(isAddress, 'Provide a valid wallet address'),
  chainId: z.number().int().positive().optional(),
  role: z.enum(['client', 'freelancer']).default('freelancer'),
})
const siweVerifyInput = z.object({
  message: z.string().min(1).max(2048),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
})

type AppRole = 'client' | 'freelancer'
type SessionPayload = { userId: string; type: 'access' | 'refresh' }
const roleMap: Record<AppRole, UserRole> = {
  client: UserRole.CLIENT,
  freelancer: UserRole.FREELANCER,
}

const cookieOptions = (maxAge: number, path: string) => ({
  httpOnly: true,
  secure: process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === 'true'
    : process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path,
  maxAge: maxAge * 1000,
})

function jwtSecret(kind: 'access' | 'refresh') {
  const name = kind === 'access' ? 'JWT_ACCESS_SECRET' : 'JWT_REFRESH_SECRET'
  const configured = process.env[name]
  if (
    configured &&
    configured.length >= 32 &&
    !configured.startsWith('replace-with-') &&
    !configured.startsWith('local-development-only-')
  ) {
    return new TextEncoder().encode(configured)
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${name} must be set to at least 32 characters in production`)
  }
  return new TextEncoder().encode(`local-development-only-${kind}-secret-change-me`)
}

const tokenDigest = (token: string) =>
  createHash('sha256').update(token).digest('hex')

async function createToken(userId: string, type: SessionPayload['type']) {
  const secret = jwtSecret(type)
  const lifetime = type === 'access' ? ACCESS_TTL_SECONDS : REFRESH_TTL_SECONDS
  return new SignJWT({ type })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(randomUUID())
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${lifetime}s`)
    .sign(secret)
}

async function verifyToken(token: string, type: SessionPayload['type']) {
  const { payload } = await jwtVerify(token, jwtSecret(type), {
    issuer: ISSUER,
    audience: AUDIENCE,
  })
  if (payload.type !== type || typeof payload.sub !== 'string') {
    throw new Error('Invalid token')
  }
  return payload.sub
}

export async function authenticateAccessToken(token: string) {
  try {
    return await verifyToken(token, 'access')
  } catch {
    return undefined
  }
}

function setAuthCookies(response: Response, accessToken: string, refreshToken: string) {
  response.cookie(ACCESS_COOKIE, accessToken, cookieOptions(ACCESS_TTL_SECONDS, '/'))
  response.cookie(
    REFRESH_COOKIE,
    refreshToken,
    cookieOptions(REFRESH_TTL_SECONDS, '/api/v1/auth'),
  )
}

function clearAuthCookies(response: Response) {
  response.clearCookie(ACCESS_COOKIE, cookieOptions(0, '/'))
  response.clearCookie(REFRESH_COOKIE, cookieOptions(0, '/api/v1/auth'))
}

const includeProfiles = {
  wallet: true,
  clientProfile: true,
  freelancerProfile: true,
  notificationPreference: true,
} as const

type AuthUserRecord = Prisma.UserGetPayload<{ include: typeof includeProfiles }>

function serializeUser(user: AuthUserRecord) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    title: user.title,
    bio: user.bio,
    location: user.location,
    roles: user.roles.map((role) => role.toLowerCase()),
    activeRole: user.activeRole.toLowerCase(),
    emailVerified: user.emailVerified,
    wallet: user.wallet ? {
      address: user.wallet.address,
      chainId: user.wallet.chainId,
      verifiedAt: user.wallet.verifiedAt.toISOString(),
    } : null,
    clientProfile: user.clientProfile,
    freelancerProfile: user.freelancerProfile
      ? {
          ...user.freelancerProfile,
          ratingAvg: String(user.freelancerProfile.ratingAvg),
          successRate: String(user.freelancerProfile.successRate),
          totalEarned: String(user.freelancerProfile.totalEarned),
        }
      : null,
    settings: user.notificationPreference,
  }
}

function sendError(
  response: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  response.status(status).json({ code, message, ...(details ? { details } : {}) })
}

function parseInput<T>(
  schema: z.ZodType<T>,
  body: unknown,
  response: Response,
): T | undefined {
  const result = schema.safeParse(body)
  if (!result.success) {
    sendError(response, 400, 'VALIDATION_ERROR', 'Please check the submitted details.', result.error.flatten())
    return undefined
  }
  return result.data
}

export function parseSiweMessage(message: string) {
  const match = message.match(
    /^([^\n]+) wants you to sign in with your Ethereum account:\n(0x[0-9a-fA-F]{40})\n\nSign in to Freelancia as a (client|freelancer) and securely verify this wallet\.\n\nURI: (https?:\/\/[^\n]+)\nVersion: 1\nChain ID: ([1-9]\d*)\nNonce: ([a-fA-F0-9]{32})\nIssued At: ([^\n]+)\nExpiration Time: ([^\n]+)$/,
  )
  if (!match) return undefined
  const issuedAt = Date.parse(match[7] ?? '')
  const expirationTime = Date.parse(match[8] ?? '')
  const chainId = Number(match[5])
  if (!Number.isSafeInteger(chainId) || !Number.isFinite(issuedAt) || !Number.isFinite(expirationTime)) {
    return undefined
  }

  try {
    return {
      domain: match[1]!,
      address: getAddress(match[2]!),
      role: match[3] as AppRole,
      uri: new URL(match[4]!).origin,
      chainId,
      nonce: match[6]!,
      issuedAt,
      expirationTime,
    }
  } catch {
    return undefined
  }
}

export function recoverSiweAddress(message: string, signature: string) {
  try {
    const parsed = parseSiweMessage(message)
    const recovered = getAddress(verifyMessage(message, signature))
    return parsed && recovered === parsed.address ? recovered : undefined
  } catch {
    return undefined
  }
}

function issueRefreshSession(response: Response, userId: string) {
  return createToken(userId, 'refresh').then(async (refreshToken) => {
    await prisma.refreshSession.create({
      data: {
        userId,
        tokenHash: tokenDigest(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
      },
    })
    const accessToken = await createToken(userId, 'access')
    setAuthCookies(response, accessToken, refreshToken)
  })
}

export interface AuthenticatedRequest extends Request {
  authUserId?: string
}

function getAuthenticatedUserId(request: AuthenticatedRequest, response: Response) {
  if (!request.authUserId) {
    sendError(response, 401, 'UNAUTHENTICATED', 'Sign in to continue.')
    return undefined
  }
  return request.authUserId
}

export async function requireAuth(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
) {
  const token = request.cookies?.[ACCESS_COOKIE]
  if (typeof token !== 'string') {
    sendError(response, 401, 'UNAUTHENTICATED', 'Sign in to continue.')
    return
  }
  try {
    request.authUserId = await verifyToken(token, 'access')
    next()
  } catch {
    sendError(response, 401, 'UNAUTHENTICATED', 'Your session has expired. Sign in again.')
  }
}

export const authRouter = Router()

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { code: 'RATE_LIMITED', message: 'Too many authentication attempts. Try again later.' },
})

authRouter.use(authLimiter)

authRouter.post('/wallet/siwe/nonce', async (request: AuthenticatedRequest, response, next) => {
  const input = parseInput(siweNonceInput, request.body, response)
  if (!input) return
  try {
    const frontendUrl = new URL(process.env.FRONTEND_URL ?? 'http://localhost:5173')
    const address = getAddress(input.address)
    const chainId = input.chainId ?? Number(process.env.CHAIN_ID ?? '11155111')
    if (!Number.isSafeInteger(chainId) || chainId < 1) {
      sendError(response, 400, 'INVALID_CHAIN_ID', 'Provide a valid wallet chain ID.')
      return
    }
    let userId: string | undefined
    const accessToken = request.cookies?.[ACCESS_COOKIE]
    if (typeof accessToken === 'string') {
      try {
        userId = await verifyToken(accessToken, 'access')
      } catch {
        userId = undefined
      }
    }
    const nonce = randomBytes(16).toString('hex')
    const issuedAt = new Date()
    const message = [
      `${frontendUrl.host} wants you to sign in with your Ethereum account:`,
      address,
      '',
      `Sign in to Freelancia as a ${input.role} and securely verify this wallet.`,
      '',
      `URI: ${frontendUrl.origin}`,
      'Version: 1',
      `Chain ID: ${chainId}`,
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt.toISOString()}`,
      `Expiration Time: ${new Date(issuedAt.getTime() + 5 * 60_000).toISOString()}`,
    ].join('\n')
    await prisma.siweNonce.create({
      data: {
        ...(userId ? { userId } : {}),
        nonceHash: tokenDigest(nonce),
        expiresAt: new Date(issuedAt.getTime() + 5 * 60_000),
      },
    })
    response.json({ message, expiresAt: new Date(issuedAt.getTime() + 5 * 60_000).toISOString() })
  } catch (error) {
    next(error)
  }
})

authRouter.post('/wallet/siwe/verify', async (request: AuthenticatedRequest, response, next) => {
  const input = parseInput(siweVerifyInput, request.body, response)
  if (!input) return
  const parsedMessage = parseSiweMessage(input.message)
  if (!parsedMessage) {
    sendError(response, 400, 'INVALID_SIWE_MESSAGE', 'The wallet sign-in message is invalid.')
    return
  }
  try {
    const frontendUrl = new URL(process.env.FRONTEND_URL ?? 'http://localhost:5173')
    if (parsedMessage.domain !== frontendUrl.host || parsedMessage.uri !== frontendUrl.origin) {
      sendError(response, 400, 'SIWE_ORIGIN_MISMATCH', 'The wallet sign-in message was issued for another site.')
      return
    }
    const now = Date.now()
    if (
      parsedMessage.issuedAt > now + 60_000 ||
      parsedMessage.expirationTime <= now ||
      parsedMessage.expirationTime > parsedMessage.issuedAt + 6 * 60_000
    ) {
      sendError(response, 400, 'SIWE_EXPIRED', 'The wallet sign-in request has expired. Try again.')
      return
    }
    const recoveredAddress = recoverSiweAddress(input.message, input.signature)
    if (!recoveredAddress) {
      sendError(response, 401, 'SIWE_SIGNATURE_INVALID', 'The wallet signature is invalid.')
      return
    }
    const consumedAt = new Date()
    const nonce = await prisma.siweNonce.findFirst({
      where: { nonceHash: tokenDigest(parsedMessage.nonce), usedAt: null, expiresAt: { gt: consumedAt } },
      select: { id: true, userId: true },
    })
    if (!nonce) {
      sendError(response, 401, 'SIWE_NONCE_INVALID', 'The wallet sign-in request was already used or expired.')
      return
    }
    const consumed = await prisma.siweNonce.updateMany({
      where: { id: nonce.id, usedAt: null, expiresAt: { gt: consumedAt } },
      data: { usedAt: consumedAt },
    })
    if (consumed.count !== 1) {
      sendError(response, 401, 'SIWE_NONCE_INVALID', 'The wallet sign-in request was already used.')
      return
    }
    let userId: string
    let linked = false
    const accessToken = request.cookies?.[ACCESS_COOKIE]
    let sessionUserId: string | undefined
    if (typeof accessToken === 'string') {
      try {
        sessionUserId = await verifyToken(accessToken, 'access')
      } catch {
        sessionUserId = undefined
      }
    }
    if (nonce.userId) {
      if (sessionUserId !== nonce.userId) {
        sendError(response, 401, 'SIWE_SESSION_CHANGED', 'Sign in again before linking this wallet.')
        return
      }
      userId = nonce.userId
      const existingWallet = await prisma.wallet.findUnique({ where: { address: recoveredAddress } })
      if (existingWallet && existingWallet.userId !== userId) {
        sendError(response, 409, 'WALLET_IN_USE', 'This wallet is already linked to another account.')
        return
      }
      await prisma.wallet.upsert({
        where: { userId },
        create: { userId, address: recoveredAddress, chainId: parsedMessage.chainId, verifiedAt: consumedAt },
        update: { address: recoveredAddress, chainId: parsedMessage.chainId, verifiedAt: consumedAt },
      })
      linked = true
    } else {
      const existingWallet = await prisma.wallet.findUnique({
        where: { address: recoveredAddress },
        select: { userId: true },
      })
      if (existingWallet) {
        userId = existingWallet.userId
        await prisma.wallet.update({
          where: { address: recoveredAddress },
          data: { chainId: parsedMessage.chainId, verifiedAt: consumedAt },
        })
      } else {
        const shortAddress = `${recoveredAddress.slice(0, 6)}...${recoveredAddress.slice(-4)}`
        const role = roleMap[parsedMessage.role]
        const user = await prisma.user.create({
          data: {
            email: `${recoveredAddress.toLowerCase()}@wallet.freelancia.invalid`,
            name: `Wallet ${shortAddress}`,
              roles: [role],
              activeRole: role,
              wallet: {
                create: { address: recoveredAddress, chainId: parsedMessage.chainId, verifiedAt: consumedAt },
              },
              ...(role === UserRole.CLIENT
                ? { clientProfile: { create: {} } }
                : { freelancerProfile: { create: {} } }),
            notificationPreference: { create: {} },
          },
          select: { id: true },
        })
        userId = user.id
      }
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, include: includeProfiles })
    if (!user) {
      sendError(response, 401, 'UNAUTHENTICATED', 'This account is no longer available.')
      return
    }
    await issueRefreshSession(response, userId)
    response.json({ user: serializeUser(user), walletLinked: linked })
  } catch (error) {
    next(error)
  }
})

authRouter.post('/signup', async (request, response, next) => {
  const input = parseInput(signupSchema, request.body, response)
  if (!input) return

  try {
    const passwordHash = await argon2.hash(input.password)
    const role: AppRole = input.role
    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        name: input.name,
        roles: [roleMap[role]],
        activeRole: roleMap[role],
        ...(role === 'client'
          ? { clientProfile: { create: {} } }
          : { freelancerProfile: { create: {} } }),
        notificationPreference: { create: {} },
      },
      include: includeProfiles,
    })
    await issueRefreshSession(response, user.id)
    response.status(201).json({ user: serializeUser(user) })
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    ) {
      sendError(response, 409, 'EMAIL_IN_USE', 'An account with this email already exists.')
      return
    }
    next(error)
  }
})

authRouter.post('/login', async (request, response, next) => {
  const input = parseInput(loginSchema, request.body, response)
  if (!input) return

  try {
    const user = await prisma.user.findUnique({
      where: { email: input.email },
      include: includeProfiles,
    })
    if (!user?.passwordHash || !(await argon2.verify(user.passwordHash, input.password))) {
      sendError(response, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.')
      return
    }
    await issueRefreshSession(response, user.id)
    response.json({ user: serializeUser(user) })
  } catch (error) {
    next(error)
  }
})

authRouter.post('/refresh', async (request, response, next) => {
  const token = request.cookies?.[REFRESH_COOKIE]
  if (typeof token !== 'string') {
    clearAuthCookies(response)
    sendError(response, 401, 'UNAUTHENTICATED', 'Sign in to continue.')
    return
  }

  try {
    const userId = await verifyToken(token, 'refresh')
    const tokenHash = tokenDigest(token)
    const now = new Date()
    const session = await prisma.refreshSession.findFirst({
      where: { userId, tokenHash, revokedAt: null, expiresAt: { gt: now } },
      select: { id: true },
    })
    if (!session) {
      clearAuthCookies(response)
      sendError(response, 401, 'UNAUTHENTICATED', 'Your session has expired. Sign in again.')
      return
    }

    const nextRefreshToken = await createToken(userId, 'refresh')
    const nextAccessToken = await createToken(userId, 'access')
    const rotated = await prisma.$transaction(async (transaction) => {
      const result = await transaction.refreshSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: now },
      })
      if (result.count !== 1) return false
      await transaction.refreshSession.create({
        data: {
          userId,
          tokenHash: tokenDigest(nextRefreshToken),
          expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
        },
      })
      return true
    })
    if (!rotated) {
      clearAuthCookies(response)
      sendError(response, 401, 'UNAUTHENTICATED', 'Your session has already been renewed.')
      return
    }
    setAuthCookies(response, nextAccessToken, nextRefreshToken)
    response.json({ ok: true })
  } catch (error) {
    if (error instanceof Error && error.name === 'JWTExpired') {
      clearAuthCookies(response)
      sendError(response, 401, 'UNAUTHENTICATED', 'Your session has expired. Sign in again.')
      return
    }
    next(error)
  }
})

authRouter.post('/logout', async (request, response, next) => {
  const token = request.cookies?.[REFRESH_COOKIE]
  try {
    if (typeof token === 'string') {
      await prisma.refreshSession.updateMany({
        where: { tokenHash: tokenDigest(token), revokedAt: null },
        data: { revokedAt: new Date() },
      })
    }
    clearAuthCookies(response)
    response.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

authRouter.get('/me', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const userId = getAuthenticatedUserId(request, response)
  if (!userId) return
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: includeProfiles,
    })
    if (!user) {
      sendError(response, 401, 'UNAUTHENTICATED', 'This account is no longer available.')
      return
    }
    response.json({ user: serializeUser(user) })
  } catch (error) {
    next(error)
  }
})

authRouter.patch('/me', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const userId = getAuthenticatedUserId(request, response)
  if (!userId) return
  const input = parseInput(profileSchema, request.body, response)
  if (!input) return
  const data: Prisma.UserUpdateInput = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.bio !== undefined ? { bio: input.bio } : {}),
    ...(input.location !== undefined ? { location: input.location } : {}),
  }
  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data,
      include: includeProfiles,
    })
    response.json({ user: serializeUser(user) })
  } catch (error) {
    next(error)
  }
})

authRouter.patch('/me/role', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const userId = getAuthenticatedUserId(request, response)
  if (!userId) return
  const input = parseInput(roleSchema, request.body, response)
  if (!input) return
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { roles: true },
    })
    const requestedRole = roleMap[input.role]
    if (!user || !user.roles.includes(requestedRole)) {
      sendError(response, 403, 'ROLE_NOT_AVAILABLE', 'This account does not have that role.')
      return
    }
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { activeRole: requestedRole },
      include: includeProfiles,
    })
    response.json({ user: serializeUser(updated) })
  } catch (error) {
    next(error)
  }
})

authRouter.get('/me/settings', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const userId = getAuthenticatedUserId(request, response)
  if (!userId) return
  try {
    const settings = await prisma.notificationPreference.findUnique({
      where: { userId },
    })
    response.json({ settings })
  } catch (error) {
    next(error)
  }
})

authRouter.patch('/me/settings', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const userId = getAuthenticatedUserId(request, response)
  if (!userId) return
  const input = parseInput(settingsSchema, request.body, response)
  if (!input) return
  const data = {
    ...(input.email !== undefined ? { email: input.email } : {}),
    ...(input.push !== undefined ? { push: input.push } : {}),
    ...(input.productUpdates !== undefined
      ? { productUpdates: input.productUpdates }
      : {}),
  }
  try {
    const settings = await prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    })
    response.json({ settings })
  } catch (error) {
    next(error)
  }
})

export function unexpectedAuthError(error: unknown, _request: Request, response: Response, next: NextFunction) {
  if (response.headersSent) {
    next(error)
    return
  }
  const message = error instanceof Error ? error.message : 'Unknown error'
  logger.error({ err: error }, 'Unhandled API request error')
  response.status(500).json({
    code: 'INTERNAL_ERROR',
    message: 'The request could not be completed.',
    details: process.env.NODE_ENV === 'development' ? message : undefined,
  })
}
