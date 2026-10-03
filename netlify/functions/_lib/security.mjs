import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto'
import { HttpError, getCookie } from './http.mjs'

export const ADMIN_COOKIE = 'gd_admin_session'
export const ENTITY_COOKIE = 'gd_entity_session'
export const CLIENT_COOKIE = 'gd_client_session'
export const ADMIN_SESSION_SECONDS = 8 * 60 * 60
export const ENTITY_SESSION_SECONDS = 8 * 60 * 60
export const CLIENT_SESSION_SECONDS = 8 * 60 * 60
export const OTP_SECONDS = 10 * 60

function authSecret() {
  const value = process.env.APP_AUTH_SECRET || ''
  if (value.length < 32) throw new Error('APP_AUTH_SECRET no está configurado correctamente.')
  return value
}

export function signSession(payload, seconds) {
  const body = Buffer.from(JSON.stringify({
    ...payload,
    exp: Math.floor(Date.now() / 1000) + seconds,
  })).toString('base64url')
  const signature = createHmac('sha256', authSecret()).update(body).digest('base64url')
  return `${body}.${signature}`
}

export function verifySession(token, expectedType) {
  if (!token) return null
  const [body, signature] = token.split('.')
  if (!body || !signature) return null

  const expected = createHmac('sha256', authSecret()).update(body).digest()
  const received = Buffer.from(signature, 'base64url')
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (payload.type !== expectedType || payload.exp <= Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

export function requireAdmin(request) {
  const session = verifySession(getCookie(request, ADMIN_COOKIE), 'admin')
  if (!session) throw new HttpError(401, 'La sesión administrativa expiró.')
  return session
}

export function getEntitySession(request) {
  return verifySession(getCookie(request, ENTITY_COOKIE), 'entity')
}

export function getClientSession(request) {
  return verifySession(getCookie(request, CLIENT_COOKIE), 'client')
}

/**
 * Sesión válida para escribir en una ficha concreta, o null.
 *
 * Sirven dos: la de la propia ficha (la que emite el OTP desde la página
 * pública) y la del cliente dueño (la del portal). Sobre esa ficha dan los
 * mismos permisos; la diferencia es el alcance, porque la de entidad no vale
 * para las demás fichas del cliente.
 */
function entityAccessSession(request, entity, cliente) {
  const version = Number(cliente?.authVersion)
  if (!cliente || !cliente.active || !Number.isFinite(version)) return null

  const clientSession = getClientSession(request)
  if (
    clientSession &&
    Number(clientSession.clienteId) === Number(cliente.id) &&
    Number(clientSession.ver) === version
  ) {
    return clientSession
  }

  const entitySession = getEntitySession(request)
  if (
    entitySession &&
    Number(entitySession.entityId) === Number(entity.id) &&
    Number(entitySession.clienteId) === Number(cliente.id) &&
    Number(entitySession.ver) === version
  ) {
    return entitySession
  }

  return null
}

export function hasEntityAccess(request, entity, cliente) {
  return Boolean(entityAccessSession(request, entity, cliente))
}

export function requireEntityAccess(request, entity, cliente) {
  const session = entityAccessSession(request, entity, cliente)
  if (!session) {
    throw new HttpError(401, 'Valida el código enviado al correo para continuar.')
  }
  return session
}

/** Sesión del portal, válida para todas las fichas del cliente. */
export function requireClientSession(request, cliente) {
  const session = getClientSession(request)
  if (
    !session ||
    !cliente ||
    Number(session.clienteId) !== Number(cliente.id) ||
    Number(session.ver) !== Number(cliente.authVersion)
  ) {
    throw new HttpError(401, 'Valida el código enviado a tu correo para continuar.')
  }
  return session
}

export function generateOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function hashOtp(entityId, code) {
  return createHmac('sha256', authSecret()).update(`${entityId}:${code}`).digest('hex')
}

export function safeEqualHex(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(left || '') || !/^[a-f0-9]{64}$/i.test(right || '')) return false
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}

function encryptionKey() {
  const source = process.env.DATA_ENCRYPTION_KEY || ''
  if (/^[a-f0-9]{64}$/i.test(source)) return Buffer.from(source, 'hex')
  if (source.length >= 32) return createHash('sha256').update(source).digest()
  throw new Error('DATA_ENCRYPTION_KEY no está configurada correctamente.')
}

export function encryptValue(value) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`
}

export function decryptValue(value) {
  const [version, iv, tag, encrypted] = String(value || '').split('.')
  if (version !== 'v1' || !iv || !tag || encrypted === undefined) {
    throw new Error('El dato protegido no tiene un formato válido.')
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

export function maskEmail(email) {
  const [local, domain] = String(email || '').split('@')
  if (!local || !domain) return ''
  const [domainName, ...suffix] = domain.split('.')
  return `${local.slice(0, 1)}***@${domainName.slice(0, 1)}***${suffix.length ? `.${suffix.join('.')}` : ''}`
}
