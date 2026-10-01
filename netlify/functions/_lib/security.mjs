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
export const ADMIN_SESSION_SECONDS = 8 * 60 * 60
export const ENTITY_SESSION_SECONDS = 8 * 60 * 60
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

export function requireEntitySession(request, entity) {
  const session = getEntitySession(request)
  if (
    !session ||
    Number(session.entityId) !== Number(entity.id) ||
    Number(session.authVersion) !== Number(entity.authVersion)
  ) {
    throw new HttpError(401, 'Valida el código enviado al correo para continuar.')
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
