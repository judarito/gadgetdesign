import { getDb } from './_lib/db.mjs'
import { sendAccessCode } from './_lib/email.mjs'
import {
  HttpError,
  clearCookie,
  getClientIp,
  handleError,
  json,
  readJson,
  sessionCookie,
} from './_lib/http.mjs'
import {
  CLIENT_COOKIE,
  CLIENT_SESSION_SECONDS,
  OTP_SECONDS,
  generateOtp,
  getClientSession,
  hashOtp,
  requireClientSession,
  safeEqualHex,
  signSession,
} from './_lib/security.mjs'
import { CUSTOM_DATA_LIMIT, parseCustomData } from '../../src/services/customData.js'
import { sanitizeText } from '../../src/services/validation.js'

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 100
const OTP_LIMIT_PER_CLIENT = 5
const OTP_LIMIT_PER_IP = 10
const OTP_WINDOW_SECONDS = 900
const OTP_MAX_ATTEMPTS = 5
const OTP_RETENTION_SECONDS = 86400
const EMAIL_MAX_LENGTH = 254

export default async function handler(request) {
  try {
    const url = new URL(request.url)
    const action = url.searchParams.get('action') || 'context'

    if (request.method === 'POST' && action === 'request-code') {
      return await requestCode(request, await readJson(request))
    }
    if (request.method === 'POST' && action === 'verify-code') {
      return await verifyCode(request, await readJson(request))
    }
    if (request.method === 'POST' && action === 'logout') {
      return json({ ok: true }, 200, { 'set-cookie': clearCookie(CLIENT_COOKIE) })
    }
    if (request.method === 'GET' && action === 'context') {
      return await context(request, url.searchParams)
    }

    throw new HttpError(404, 'Operación no encontrada.')
  } catch (error) {
    return handleError(error)
  }
}

async function context(request, params) {
  const db = getDb()
  const session = getClientSession(request)
  const cliente = session ? await loadClient(db, session.clienteId) : null
  requireClientSession(request, cliente)

  return json(await buildContext(db, cliente, params), 200, {
    'netlify-cdn-cache-control': 'no-store',
  })
}

/**
 * Arma el listado sin comprobar la sesión: lo usan tanto `context` (que sí la
 * exige) como `verify-code`, donde la sesión todavía no existe porque se acaba
 * de emitir en la respuesta.
 */
async function buildContext(db, cliente, params) {
  const pageSize = clamp(Number.parseInt(params.get('pageSize'), 10) || DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE)
  const search = sanitizeText(params.get('search'))

  const clauses = ['e.clienteID = ?']
  const args = [cliente.id]
  if (search) {
    clauses.push('e.Identificacion LIKE ?')
    args.push(`%${search.slice(0, 200)}%`)
  }
  const where = `WHERE ${clauses.join(' AND ')}`

  const count = await db.execute({
    sql: `SELECT COUNT(*) AS total FROM Entidades e ${where}`,
    args,
  })
  const total = Number(count.rows[0]?.total || 0)
  const totalPages = Math.max(Math.ceil(total / pageSize), 1)
  const page = clamp(Number.parseInt(params.get('page'), 10) || 1, 1, totalPages)

  const result = await db.execute({
    sql: `SELECT e.id, e.Identificacion AS identificacion, e.short_code, e.custom_data,
                 c.id AS category_id, c.name AS category_name, c.code AS category_code
          FROM Entidades e
          INNER JOIN Categorias c ON c.id = e.categoriaID
          ${where}
          ORDER BY c.name, e.Identificacion
          LIMIT ? OFFSET ?`,
    args: [...args, pageSize, (page - 1) * pageSize],
  })

  return {
    cliente: { name: cliente.name, email: cliente.email },
    items: result.rows.map(mapEntity),
    total,
    totalPages,
    page,
    pageSize,
    customDataLimit: CUSTOM_DATA_LIMIT,
  }
}

async function requestCode(request, payload) {
  const db = getDb()
  const email = normalizeEmail(payload.email)
  if (!email) throw new HttpError(400, 'Escribe un correo válido.')

  const now = Math.floor(Date.now() / 1000)
  const ip = getClientIp(request)

  // La respuesta es siempre la misma exista o no el correo: este endpoint
  // recibe una dirección de cualquiera y no debe servir para descubrir clientes.
  const cliente = await findClientByEmail(db, email)
  if (!cliente || !cliente.active) return json({ ok: true })

  await db.execute({
    sql: 'DELETE FROM ClientAccessCodes WHERE created_at < ?',
    args: [now - OTP_RETENTION_SECONDS],
  })

  const limits = await db.execute({
    sql: `SELECT
            SUM(CASE WHEN cliente_id = ? THEN 1 ELSE 0 END) AS client_requests,
            SUM(CASE WHEN request_ip = ? THEN 1 ELSE 0 END) AS ip_requests
          FROM ClientAccessCodes
          WHERE created_at >= ?`,
    args: [cliente.id, ip, now - OTP_WINDOW_SECONDS],
  })
  const limit = limits.rows[0]
  if (
    Number(limit?.client_requests || 0) >= OTP_LIMIT_PER_CLIENT ||
    Number(limit?.ip_requests || 0) >= OTP_LIMIT_PER_IP
  ) {
    throw new HttpError(429, 'Se solicitaron demasiados códigos. Espera 15 minutos.')
  }

  const code = generateOtp()
  const inserted = await db.execute({
    sql: `INSERT INTO ClientAccessCodes
          (cliente_id, code_hash, expires_at, attempts, consumed, request_ip, created_at)
          VALUES (?, ?, ?, 0, 0, ?, ?)`,
    args: [cliente.id, hashOtp('client', cliente.id, code), now + OTP_SECONDS, ip, now],
  })

  try {
    await sendAccessCode({ to: cliente.email, code, identification: cliente.name })
  } catch (error) {
    if (inserted.lastInsertRowid !== undefined) {
      await db.execute({
        sql: 'DELETE FROM ClientAccessCodes WHERE id = ?',
        args: [inserted.lastInsertRowid],
      }).catch(() => {})
    }
    throw error
  }

  return json({ ok: true })
}

async function verifyCode(request, payload) {
  const db = getDb()
  const email = normalizeEmail(payload.email)
  const code = String(payload.code || '').trim()
  if (!email) throw new HttpError(400, 'Escribe un correo válido.')
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, 'Escribe el código de seis dígitos.')

  const cliente = await findClientByEmail(db, email)
  if (!cliente) throw new HttpError(400, 'El código no es correcto o venció.')

  const now = Math.floor(Date.now() / 1000)
  const result = await db.execute({
    sql: `SELECT id, code_hash, attempts
          FROM ClientAccessCodes
          WHERE cliente_id = ? AND consumed = 0 AND expires_at >= ?
          ORDER BY id DESC LIMIT 1`,
    args: [cliente.id, now],
  })
  const accessCode = result.rows[0]
  if (!accessCode) throw new HttpError(400, 'El código venció. Solicita uno nuevo.')
  if (Number(accessCode.attempts) >= OTP_MAX_ATTEMPTS) {
    throw new HttpError(429, 'El código fue bloqueado por demasiados intentos.')
  }

  if (!safeEqualHex(String(accessCode.code_hash), hashOtp('client', cliente.id, code))) {
    await db.execute({
      sql: 'UPDATE ClientAccessCodes SET attempts = attempts + 1 WHERE id = ?',
      args: [accessCode.id],
    })
    throw new HttpError(400, 'El código no es correcto.')
  }

  // La comprobación de estado va después de validar el código: si fuera antes,
  // el mensaje confirmaría qué correos están registrados.
  if (!cliente.active) throw new HttpError(403, 'Esta cuenta está inactiva. Contacta al administrador.')

  await db.execute({ sql: 'UPDATE ClientAccessCodes SET consumed = 1 WHERE id = ?', args: [accessCode.id] })
  const token = signSession({
    type: 'client',
    clienteId: cliente.id,
    ver: cliente.authVersion,
  }, CLIENT_SESSION_SECONDS)

  const response = await buildContext(db, cliente, new URLSearchParams())

  return json(response, 200, {
    'set-cookie': sessionCookie(CLIENT_COOKIE, token, CLIENT_SESSION_SECONDS),
    'netlify-cdn-cache-control': 'no-store',
  })
}

async function loadClient(db, clienteId) {
  const result = await db.execute({
    sql: `SELECT id, name, email, phone, active, auth_version
          FROM Clientes WHERE id = ? LIMIT 1`,
    args: [clienteId],
  })
  return result.rows[0] ? mapClient(result.rows[0]) : null
}

async function findClientByEmail(db, email) {
  const result = await db.execute({
    sql: `SELECT id, name, email, phone, active, auth_version
          FROM Clientes WHERE LOWER(TRIM(email)) = ? LIMIT 1`,
    args: [email],
  })
  return result.rows[0] ? mapClient(result.rows[0]) : null
}

function mapClient(row) {
  return {
    id: Number(row.id),
    name: String(row.name),
    email: String(row.email),
    phone: String(row.phone || ''),
    active: Boolean(row.active),
    authVersion: Number(row.auth_version || 1),
  }
}

function mapEntity(row) {
  const customData = parseCustomData(row.custom_data)
  return {
    id: Number(row.id),
    identificacion: String(row.identificacion),
    shortCode: String(row.short_code || ''),
    categoryId: Number(row.category_id),
    categoryName: String(row.category_name),
    categoryCode: String(row.category_code),
    dataCount: customData.length,
    protectedCount: customData.filter((item) => item.protected).length,
  }
}

function normalizeEmail(value) {
  const email = sanitizeText(value).toLowerCase()
  if (!email || email.length > EMAIL_MAX_LENGTH) return ''
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}
