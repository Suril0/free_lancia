import type { Server as HttpServer } from 'node:http'
import { Server, type DefaultEventsMap } from 'socket.io'
import { prisma } from './db.js'
import { authenticateAccessToken } from './auth.js'
import { logger } from './logger.js'

interface SocketData {
  userId?: string;
}

type RealtimeServer = Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>

let realtimeServer: RealtimeServer | undefined

export function attachRealtime(httpServer: HttpServer) {
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173'
  const io: RealtimeServer = new Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>(httpServer, {
    cors: { origin: frontendUrl, credentials: true },
  })
  realtimeServer = io
  io.use(async (socket, next) => {
    const cookieHeader = socket.handshake.headers.cookie
    const token = cookieHeader?.split(';').map((part) => part.trim())
      .find((part) => part.startsWith('freelancia_access='))
      ?.slice('freelancia_access='.length)
    let userId: string | undefined
    try {
      userId = token ? await authenticateAccessToken(decodeURIComponent(token)) : undefined
    } catch {
      userId = undefined
    }
    if (!userId) {
      next(new Error('Unauthorized'))
      return
    }
    socket.data.userId = userId
    next()
  })

  io.on('connection', (socket) => {
    const userId = socket.data.userId
    if (userId) void socket.join(`user:${userId}`)
    socket.on('project:join', async (projectId: unknown, acknowledge?: (result: { ok: boolean }) => void) => {
      if (typeof projectId !== 'string' || projectId.length > 64 || !userId) {
        acknowledge?.({ ok: false })
        return
      }
      try {
        const project = await prisma.project.findFirst({
          where: {
            id: projectId,
            OR: [
              { clientId: userId },
              { proposals: { some: { freelancerId: userId, status: 'ACCEPTED' } } },
            ],
          },
          select: { id: true },
        })
        if (!project) {
          acknowledge?.({ ok: false })
          return
        }
        await socket.join(`project:${project.id}`)
        acknowledge?.({ ok: true })
      } catch (error) {
        logger.error({ error, projectId, userId }, 'Could not authorize realtime project room')
        acknowledge?.({ ok: false })
      }
    })
    socket.on('project:leave', (projectId: unknown) => {
      if (typeof projectId === 'string') void socket.leave(`project:${projectId}`)
    })
  })

  return io
}

export function emitUserRealtime(userId: string, event: string, payload: unknown) {
  realtimeServer?.to(`user:${userId}`).emit(event, payload)
}

export function emitProjectRealtime(projectId: string, event: string, payload: unknown) {
  realtimeServer?.to(`project:${projectId}`).emit(event, payload)
}

export async function closeRealtime() {
  if (!realtimeServer) return
  const server = realtimeServer
  realtimeServer = undefined
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}
