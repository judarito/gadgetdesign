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
import { purgeEntityCache } from './_lib/cache.mjs'
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
      return json({ ok: true }, 200, { 'set-cookie': clearCookie(CLIENT_COOKIE, request) })
    }
    if (request.method === 'GET' && action === 'context') {
      return await context(request, url.searchParams)
    }
    if (request.method === 'POST' && action === 'deactivate-entity') {
      return await deactivateOwnEntity(request, await readJson(request))
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
    sql: `SELECT e.id, e.Identificacion AS display_name, e.short_code, e.custom_data, e.status,
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

/**
 * Respuesta de `request-code`, siempre con la misma forma para no revelar qué
 * correos están registrados.
 *
 * En el entorno de pruebas el código se entrega por consola y la canalización de
 * logs de Netlify pierde líneas: se ha observado un código generado en la base
 * cuyo aviso nunca apareció, con tres vecinos sí publicados. Con
 * `OTP_DEV_HINT=true` se devuelve también en la respuesta para que el portal lo
 * muestre. Lleva doble candado: además hace falta que el modo de entrega sea
 * `console`, que es justo lo que producción no usa, así que producción no puede
 * cumplir las dos condiciones ni por descuido.
 *
 * Un correo sin cliente recibe un código inventado: si el campo solo lo llevaran
 * los correos registrados, la respuesta volvería a distinguirlos.
 */
function accessCodeResponse(code = null) {
  const muestraElCodigo = process.env.OTP_DEV_HINT === 'true'
    && (process.env.OTP_DELIVERY_MODE || 'resend') === 'console'

  return muestraElCodigo ? { ok: true, devCode: code || generateOtp() } : { ok: true }
}

async function requestCode(request, payload) {
  const db = getDb()
  const email = normalizeEmail(payload.email)
  if (!email) throw new HttpError(400, 'Escribe un correo válido.')

  const now = Math.floor(Date.now() / 1000)
  const ip = getClientIp(request)

  await db.batch([
    { sql: 'DELETE FROM ClientOtpRequests WHERE created_at < ?', args: [now - OTP_RETENTION_SECONDS] },
    { sql: 'DELETE FROM ClientAccessCodes WHERE created_at < ?', args: [now - OTP_RETENTION_SECONDS] },
  ], 'write')

  // El límite por IP se registra y se evalúa para TODAS las peticiones, exista o
  // no el correo, y es el único que puede responder 429. Si dependiera de que el
  // correo exista, la diferencia entre 200 y 429 lo delataría. Va en su propia
  // tabla, sin foreign key, porque tiene que admitir correos desconocidos.
  const recent = await db.execute({
    sql: 'SELECT COUNT(*) AS total FROM ClientOtpRequests WHERE request_ip = ? AND created_at >= ?',
    args: [ip, now - OTP_WINDOW_SECONDS],
  })
  if (Number(recent.rows[0]?.total || 0) >= OTP_LIMIT_PER_IP) {
    throw new HttpError(429, 'Se solicitaron demasiados códigos. Espera 15 minutos.')
  }
  await db.execute({
    sql: 'INSERT INTO ClientOtpRequests (request_ip, created_at) VALUES (?, ?)',
    args: [ip, now],
  })

  const cliente = await findClientByEmail(db, email)

  // A partir de aquí la respuesta es siempre {ok:true}, exista o no el correo y
  // haya agotado o no su límite por cliente. Ese límite solo decide si se envía
  // el correo: un 429 aquí volvería a distinguir los correos registrados.
  if (!cliente || !cliente.active) return json(accessCodeResponse())

  const perClient = await db.execute({
    sql: 'SELECT COUNT(*) AS total FROM ClientAccessCodes WHERE cliente_id = ? AND created_at >= ?',
    args: [cliente.id, now - OTP_WINDOW_SECONDS],
  })
  if (Number(perClient.rows[0]?.total || 0) >= OTP_LIMIT_PER_CLIENT) return json(accessCodeResponse())

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

  return json(accessCodeResponse(code))
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
  // Un solo mensaje para todos los casos negativos. Distinguir "no existe el
  // correo" de "no hay código pendiente" convertiría este endpoint en un
  // comprobador de direcciones registradas. El bloqueo por intentos tampoco
  // puede responder 429: solo ocurre en correos que existen.
  if (!accessCode) throw new HttpError(400, 'El código no es correcto o venció.')
  if (Number(accessCode.attempts) >= OTP_MAX_ATTEMPTS) {
    throw new HttpError(400, 'El código no es correcto o venció.')
  }

  if (!safeEqualHex(String(accessCode.code_hash), hashOtp('client', cliente.id, code))) {
    await db.execute({
      sql: 'UPDATE ClientAccessCodes SET attempts = attempts + 1 WHERE id = ?',
      args: [accessCode.id],
    })
    throw new HttpError(400, 'El código no es correcto o venció.')
  }

  // La comprobación de estado va después de validar el código: si fuera antes,
  // el mensaje confirmaría qué correos están registrados.
  if (!cliente.active) throw new HttpError(403, 'Esta cuenta está inactiva. Contacta al administrador.')

  // Consumo atómico: si dos peticiones llegan a la vez con el mismo código,
  // solo la que consigue marcarlo pasa. Sin el `consumed = 0` en el WHERE las
  // dos leerían la fila y las dos emitirían sesión.
  const claimed = await db.execute({
    sql: 'UPDATE ClientAccessCodes SET consumed = 1 WHERE id = ? AND consumed = 0',
    args: [accessCode.id],
  })
  if (!Number(claimed.rowsAffected)) throw new HttpError(400, 'El código no es correcto o venció.')

  const token = signSession({
    type: 'client',
    clienteId: cliente.id,
    ver: cliente.authVersion,
  }, CLIENT_SESSION_SECONDS)

  const response = await buildContext(db, cliente, new URLSearchParams())

  return json(response, 200, {
    'set-cookie': sessionCookie(CLIENT_COOKIE, token, CLIENT_SESSION_SECONDS, request),
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

/**
 * El cliente desactiva una ficha suya. Solo puede apagarla: volver a activarla es
 * del administrador, que es quien publica. La pertenencia se comprueba contra la
 * sesión, no contra el cuerpo de la petición, y la escritura va condicionada al
 * dueño en el propio WHERE para que no haya ventana entre comprobar y escribir.
 */
async function deactivateOwnEntity(request, payload) {
  const db = getDb()
  // Igual que `context`: hay que cargar el cliente para que la comprobación vea
  // su estado y su versión de sesión, no solo que la cookie esté firmada.
  const session = getClientSession(request)
  const cliente = session ? await loadClient(db, session.clienteId) : null
  requireClientSession(request, cliente)

  const token = String(payload.token || '').trim()
  if (!token) throw new HttpError(400, 'Falta la ficha.')

  // La pertenencia va en el WHERE: así la propia consulta no puede devolver una
  // ficha ajena, y no hay ventana entre comprobar el dueño y escribir.
  const found = await db.execute({
    sql: `SELECT id, status FROM Entidades
          WHERE (short_code = ? OR token = ?) AND clienteID = ?
          LIMIT 1`,
    args: [token, token, cliente.id],
  })
  const entity = found.rows[0]
  if (!entity) throw new HttpError(404, 'No se encontró esa ficha entre las tuyas.')

  // Idempotente: si ya está apagada no se toca nada.
  if (String(entity.status) !== 'activa') return json({ ok: true, status: String(entity.status) })

  await db.execute({
    sql: "UPDATE Entidades SET status = 'inactiva' WHERE id = ? AND clienteID = ?",
    args: [Number(entity.id), cliente.id],
  })
  await purgeEntityCache(Number(entity.id))

  return json({ ok: true, status: 'inactiva' })
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
    displayName: String(row.display_name),
    shortCode: String(row.short_code || ''),
    categoryId: Number(row.category_id),
    categoryName: String(row.category_name),
    categoryCode: String(row.category_code),
    dataCount: customData.length,
    protectedCount: customData.filter((item) => item.protected).length,
    status: String(row.status || 'activa'),
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
