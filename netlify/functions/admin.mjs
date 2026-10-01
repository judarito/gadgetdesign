import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'
import { getDb } from './_lib/db.mjs'
import {
  HttpError,
  clearCookie,
  handleError,
  json,
  readJson,
  sessionCookie,
} from './_lib/http.mjs'
import {
  ADMIN_COOKIE,
  ADMIN_SESSION_SECONDS,
  requireAdmin,
  signSession,
  verifySession,
} from './_lib/security.mjs'
import { getCookie } from './_lib/http.mjs'
import { normalizeDataType } from '../../src/services/dataTypes.js'
import { generateUniqueShortCode } from '../../src/services/shortCode.js'
import {
  CATEGORY_CODE_MAX_LENGTH,
  IDENTIFICATION_MAX_LENGTH,
  sanitizeText,
  validateCategoryCode,
} from '../../src/services/validation.js'

const CATEGORY_NAME_MAX_LENGTH = 50
const SUGGESTION_NAME_MAX_LENGTH = 50
const ADMIN_PASSWORD_MIN_LENGTH = 12
const ADMIN_PASSWORD_MAX_LENGTH = 128
const DEFAULT_PAGE_SIZE = 10
const MAX_PAGE_SIZE = 50

export default async function handler(request) {
  try {
    const url = new URL(request.url)
    const action = url.searchParams.get('action') || 'session'

    if (request.method === 'GET' && action === 'session') {
      return json({ authenticated: Boolean(verifySession(getCookie(request, ADMIN_COOKIE), 'admin')) })
    }
    if (request.method === 'POST' && action === 'login') return await login(request, await readJson(request))
    if (request.method === 'POST' && action === 'logout') {
      return json({ ok: true }, 200, { 'set-cookie': clearCookie(ADMIN_COOKIE) })
    }

    requireAdmin(request)
    const body = request.method === 'GET' ? null : await readJson(request)
    const db = getDb()

    if (request.method === 'POST' && action === 'change-password') return await changePassword(db, body)
    if (request.method === 'GET' && action === 'category-options') return json(await listCategoryOptions(db))
    if (request.method === 'GET' && action === 'categories') return json(await listCategories(db, url.searchParams))
    if (request.method === 'POST' && action === 'save-category') return await saveCategory(db, body)
    if (request.method === 'DELETE' && action === 'delete-category') return await deleteCategory(db, body)
    if (request.method === 'GET' && action === 'suggestions') return json(await listSuggestions(db, url.searchParams))
    if (request.method === 'POST' && action === 'save-suggestion') return await saveSuggestion(db, body)
    if (request.method === 'DELETE' && action === 'delete-suggestion') return await deleteSuggestion(db, body)
    if (request.method === 'GET' && action === 'entities') return json(await listEntities(db, url.searchParams))
    if (request.method === 'POST' && action === 'create-entity') return await createEntity(db, body)
    if (request.method === 'PATCH' && action === 'update-entity') return await updateEntity(db, body)
    if (request.method === 'POST' && action === 'regenerate-entity') return await regenerateEntity(db, body)
    if (request.method === 'DELETE' && action === 'delete-entity') return await deleteEntity(db, body)

    throw new HttpError(404, 'Operación administrativa no encontrada.')
  } catch (error) {
    return handleError(error)
  }
}

async function login(request, payload) {
  const password = validatePassword(payload.password)
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)
  const ip = getClientIp(request)
  await db.execute({ sql: 'DELETE FROM AdminLoginAttempts WHERE created_at < ?', args: [now - 86400] })
  const attempts = await db.execute({
    sql: `SELECT COUNT(*) AS total FROM AdminLoginAttempts
          WHERE request_ip = ? AND succeeded = 0 AND created_at >= ?`,
    args: [ip, now - 900],
  })
  if (Number(attempts.rows[0]?.total || 0) >= 5) {
    throw new HttpError(429, 'Demasiados intentos. Espera 15 minutos antes de volver a intentar.')
  }

  const result = await db.execute('SELECT password_hash, salt, iterations FROM AdminCredentials WHERE id = 1 LIMIT 1')
  const credential = result.rows[0]
  if (!credential) throw new HttpError(503, 'El administrador aún no está configurado.')

  const candidate = pbkdf2Sync(password, Buffer.from(String(credential.salt), 'hex'), Number(credential.iterations), 32, 'sha256')
  const expected = Buffer.from(String(credential.password_hash), 'hex')
  if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
    await db.execute({
      sql: 'INSERT INTO AdminLoginAttempts (request_ip, succeeded, created_at) VALUES (?, 0, ?)',
      args: [ip, now],
    })
    throw new HttpError(401, 'La contraseña no es correcta.')
  }

  await db.execute({ sql: 'DELETE FROM AdminLoginAttempts WHERE request_ip = ?', args: [ip] })

  const token = signSession({ type: 'admin' }, ADMIN_SESSION_SECONDS)
  return json(
    { authenticated: true },
    200,
    { 'set-cookie': sessionCookie(ADMIN_COOKIE, token, ADMIN_SESSION_SECONDS) },
  )
}

async function changePassword(db, payload) {
  const currentPassword = validatePassword(payload.currentPassword)
  const newPassword = validatePassword(payload.newPassword)
  const result = await db.execute('SELECT password_hash, salt, iterations FROM AdminCredentials WHERE id = 1 LIMIT 1')
  const credential = result.rows[0]
  const candidate = pbkdf2Sync(currentPassword, Buffer.from(String(credential.salt), 'hex'), Number(credential.iterations), 32, 'sha256')
  const expected = Buffer.from(String(credential.password_hash), 'hex')
  if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
    throw new HttpError(401, 'La contraseña actual no es correcta.')
  }

  const salt = randomBytes(16)
  const iterations = 210000
  const passwordHash = pbkdf2Sync(newPassword, salt, iterations, 32, 'sha256').toString('hex')
  await db.execute({
    sql: `UPDATE AdminCredentials
          SET password_hash = ?, salt = ?, iterations = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = 1`,
    args: [passwordHash, salt.toString('hex'), iterations],
  })
  return json({ ok: true })
}

async function listCategoryOptions(db) {
  const result = await db.execute('SELECT id, name, active, code FROM Categorias ORDER BY name')
  return result.rows.map((row) => ({
    id: Number(row.id), name: String(row.name), code: String(row.code), active: Boolean(row.active),
  }))
}

async function listCategories(db, params) {
  const pagination = await resolvePagination(db, 'SELECT COUNT(*) AS total FROM Categorias', [], params)
  const result = await db.execute({
    sql: `SELECT c.id, c.name, c.active, c.code,
                 COUNT(DISTINCT e.id) AS entity_count,
                 COUNT(DISTINCT s.id) AS suggestion_count
          FROM Categorias c
          LEFT JOIN Entidades e ON e.categoriaID = c.id
          LEFT JOIN CategoriaSugerencias s ON s.categoriaID = c.id
          GROUP BY c.id, c.name, c.active, c.code
          ORDER BY c.name LIMIT ? OFFSET ?`,
    args: [pagination.pageSize, pagination.offset],
  })
  return pageResult(result.rows.map((row) => ({
    id: Number(row.id), name: String(row.name), code: String(row.code), active: Boolean(row.active),
    entityCount: Number(row.entity_count || 0), suggestionCount: Number(row.suggestion_count || 0),
  })), pagination)
}

async function saveCategory(db, category) {
  const name = requiredText(category.name, CATEGORY_NAME_MAX_LENGTH, 'Nombre')
  const code = asBadRequest(() => validateCategoryCode(category.code)).toUpperCase()
  const active = category.active ? 1 : 0
  if (code.length > CATEGORY_CODE_MAX_LENGTH) throw new HttpError(400, `Código no puede superar ${CATEGORY_CODE_MAX_LENGTH} caracteres.`)

  if (category.id) {
    await db.execute({ sql: 'UPDATE Categorias SET name = ?, code = ?, active = ? WHERE id = ?', args: [name, code, active, validId(category.id, 'categoría')] })
  } else {
    await db.execute({ sql: 'INSERT INTO Categorias (name, code, active) VALUES (?, ?, ?)', args: [name, code, active] })
  }
  return json({ ok: true })
}

async function deleteCategory(db, payload) {
  const id = validId(payload.id, 'categoría')
  const dependencies = await db.execute({
    sql: `SELECT (SELECT COUNT(*) FROM Entidades WHERE categoriaID = ?) AS entities,
                 (SELECT COUNT(*) FROM CategoriaSugerencias WHERE categoriaID = ?) AS suggestions`,
    args: [id, id],
  })
  if (Number(dependencies.rows[0].entities) || Number(dependencies.rows[0].suggestions)) {
    throw new HttpError(409, 'No puedes eliminar una categoría que tenga entidades o sugerencias.')
  }
  await db.execute({ sql: 'DELETE FROM Categorias WHERE id = ?', args: [id] })
  return json({ ok: true })
}

async function listSuggestions(db, params) {
  const categoryId = validId(params.get('categoryId'), 'categoría')
  const pagination = await resolvePagination(db, 'SELECT COUNT(*) AS total FROM CategoriaSugerencias WHERE categoriaID = ?', [categoryId], params)
  const result = await db.execute({
    sql: `SELECT id, categoriaID, name, active, sort_order, data_type
          FROM CategoriaSugerencias WHERE categoriaID = ?
          ORDER BY sort_order, id LIMIT ? OFFSET ?`,
    args: [categoryId, pagination.pageSize, pagination.offset],
  })
  return pageResult(result.rows.map((row) => ({
    id: Number(row.id), categoryId: Number(row.categoriaID), name: String(row.name),
    active: Boolean(row.active), sortOrder: Number(row.sort_order), dataType: normalizeDataType(row.data_type),
  })), pagination)
}

async function saveSuggestion(db, suggestion) {
  const categoryId = validId(suggestion.categoryId, 'categoría')
  const name = requiredText(suggestion.name, SUGGESTION_NAME_MAX_LENGTH, 'Sugerencia')
  const active = suggestion.active ? 1 : 0
  const sortOrder = Number(suggestion.sortOrder)
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) throw new HttpError(400, 'El orden debe estar entre 0 y 9999.')
  const dataType = normalizeDataType(suggestion.dataType)

  if (suggestion.id) {
    await db.execute({ sql: 'UPDATE CategoriaSugerencias SET name = ?, active = ?, sort_order = ?, data_type = ? WHERE id = ? AND categoriaID = ?', args: [name, active, sortOrder, dataType, validId(suggestion.id, 'sugerencia'), categoryId] })
  } else {
    await db.execute({ sql: 'INSERT INTO CategoriaSugerencias (categoriaID, name, active, sort_order, data_type) VALUES (?, ?, ?, ?, ?)', args: [categoryId, name, active, sortOrder, dataType] })
  }
  return json({ ok: true })
}

async function deleteSuggestion(db, payload) {
  await db.execute({ sql: 'DELETE FROM CategoriaSugerencias WHERE id = ? AND categoriaID = ?', args: [validId(payload.id, 'sugerencia'), validId(payload.categoryId, 'categoría')] })
  return json({ ok: true })
}

async function listEntities(db, params) {
  const clauses = []
  const args = []
  if (params.get('categoryId')) {
    clauses.push('e.categoriaID = ?')
    args.push(validId(params.get('categoryId'), 'categoría'))
  }
  const search = sanitizeText(params.get('search'))
  if (search) {
    clauses.push('(e.Identificacion LIKE ? OR e.token LIKE ? OR e.short_code LIKE ? OR e.owner_email LIKE ?)')
    const pattern = `%${search.slice(0, IDENTIFICATION_MAX_LENGTH)}%`
    args.push(pattern, pattern, pattern, pattern)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const pagination = await resolvePagination(db, `SELECT COUNT(*) AS total FROM Entidades e ${where}`, args, params)
  const result = await db.execute({
    sql: `SELECT e.id, e.Identificacion AS identificacion, e.token, e.short_code,
                 e.categoriaID, e.owner_name, e.owner_email, e.owner_phone,
                 c.name AS category_name, c.code AS category_code
          FROM Entidades e INNER JOIN Categorias c ON c.id = e.categoriaID
          ${where} ORDER BY e.id DESC LIMIT ? OFFSET ?`,
    args: [...args, pagination.pageSize, pagination.offset],
  })
  return pageResult(result.rows.map(mapEntity), pagination)
}

async function createEntity(db, payload) {
  const identification = requiredText(payload.identification, IDENTIFICATION_MAX_LENGTH, 'Identificación')
  const categoryId = validId(payload.categoryId, 'categoría')
  const owner = validateOwner(payload)
  await ensureUniqueIdentification(db, identification)
  const token = await generateUniqueToken(db)
  const shortCode = await generateUniqueShortCode(db)
  await db.execute({
    sql: `INSERT INTO Entidades
          (Identificacion, token, short_code, categoriaID, custom_data, owner_name, owner_email, owner_phone, auth_version)
          VALUES (?, ?, ?, ?, '[]', ?, ?, ?, 1)`,
    args: [identification, token, shortCode, categoryId, owner.name, owner.email, owner.phone],
  })
  return json({ token, shortCode })
}

async function updateEntity(db, payload) {
  const id = validId(payload.id, 'entidad')
  const identification = requiredText(payload.identification, IDENTIFICATION_MAX_LENGTH, 'Identificación')
  const categoryId = validId(payload.categoryId, 'categoría')
  const owner = validateOwner(payload)
  await ensureUniqueIdentification(db, identification, id)
  const current = await db.execute({ sql: 'SELECT owner_email FROM Entidades WHERE id = ? LIMIT 1', args: [id] })
  if (!current.rows[0]) throw new HttpError(404, 'No se encontró la entidad.')
  const emailChanged = String(current.rows[0].owner_email || '').toLowerCase() !== owner.email
  await db.execute({
    sql: `UPDATE Entidades
          SET Identificacion = ?, categoriaID = ?, owner_name = ?, owner_email = ?, owner_phone = ?,
              auth_version = auth_version + ?
          WHERE id = ?`,
    args: [identification, categoryId, owner.name, owner.email, owner.phone, emailChanged ? 1 : 0, id],
  })
  if (emailChanged) await db.execute({ sql: 'DELETE FROM EntityAccessCodes WHERE entity_id = ?', args: [id] })
  return json({ ok: true })
}

async function regenerateEntity(db, payload) {
  const id = validId(payload.id, 'entidad')
  const token = await generateUniqueToken(db)
  const shortCode = await generateUniqueShortCode(db)
  await db.batch([
    { sql: 'DELETE FROM EntityAliases WHERE entity_id = ?', args: [id] },
    { sql: 'DELETE FROM EntityAccessCodes WHERE entity_id = ?', args: [id] },
    { sql: 'UPDATE Entidades SET token = ?, short_code = ?, auth_version = auth_version + 1 WHERE id = ?', args: [token, shortCode, id] },
  ], 'write')
  return json({ token, shortCode })
}

async function deleteEntity(db, payload) {
  const id = validId(payload.id, 'entidad')
  await db.batch([
    { sql: 'DELETE FROM EntityAccessCodes WHERE entity_id = ?', args: [id] },
    { sql: 'DELETE FROM EntityAliases WHERE entity_id = ?', args: [id] },
    { sql: 'DELETE FROM Entidades WHERE id = ?', args: [id] },
  ], 'write')
  return json({ ok: true })
}

function validateOwner(payload) {
  const name = optionalText(payload.ownerName, 100, 'Nombre del propietario')
  const email = optionalText(payload.ownerEmail, 254, 'Correo').toLowerCase()
  const phone = optionalText(payload.ownerPhone, 30, 'Celular')
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Escribe un correo válido.')
  if (phone && !/^[0-9+() .-]{7,30}$/.test(phone)) throw new HttpError(400, 'Escribe un número de celular válido.')
  return { name, email, phone }
}

function mapEntity(row) {
  return {
    id: Number(row.id), identification: String(row.identificacion), token: String(row.token),
    shortCode: String(row.short_code || ''), categoryId: Number(row.categoriaID),
    categoryName: String(row.category_name), categoryCode: String(row.category_code),
    ownerName: String(row.owner_name || ''), ownerEmail: String(row.owner_email || ''),
    ownerPhone: String(row.owner_phone || ''),
  }
}

async function resolvePagination(db, countSql, countArgs, params) {
  const pageSize = Math.min(Math.max(Number.parseInt(params.get('pageSize'), 10) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
  const count = await db.execute({ sql: countSql, args: countArgs })
  const total = Number(count.rows[0]?.total || 0)
  const totalPages = Math.max(Math.ceil(total / pageSize), 1)
  const page = Math.min(Math.max(Number.parseInt(params.get('page'), 10) || 1, 1), totalPages)
  return { total, totalPages, page, pageSize, offset: (page - 1) * pageSize }
}

function pageResult(items, pagination) {
  return { items, total: pagination.total, totalPages: pagination.totalPages, page: pagination.page, pageSize: pagination.pageSize }
}

function validId(value, label) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, `El ID de ${label} no es válido.`)
  return id
}

function requiredText(value, max, label) {
  const text = sanitizeText(value)
  if (!text) throw new HttpError(400, `${label} es obligatorio.`)
  if (text.length > max) throw new HttpError(400, `${label} no puede superar ${max} caracteres.`)
  return text
}

function optionalText(value, max, label) {
  const text = sanitizeText(value)
  if (text.length > max) throw new HttpError(400, `${label} no puede superar ${max} caracteres.`)
  return text
}

function validatePassword(value) {
  const password = String(value || '')
  if (password.length < ADMIN_PASSWORD_MIN_LENGTH) throw new HttpError(400, `La contraseña debe tener al menos ${ADMIN_PASSWORD_MIN_LENGTH} caracteres.`)
  if (password.length > ADMIN_PASSWORD_MAX_LENGTH) throw new HttpError(400, `La contraseña no puede superar ${ADMIN_PASSWORD_MAX_LENGTH} caracteres.`)
  return password
}

async function ensureUniqueIdentification(db, identification, excludedId = null) {
  const result = await db.execute({
    sql: `SELECT 1 FROM Entidades
          WHERE LOWER(Identificacion) = LOWER(?) AND (? IS NULL OR id <> ?)
          LIMIT 1`,
    args: [identification, excludedId, excludedId],
  })
  if (result.rows.length) throw new HttpError(409, 'Ya existe una entidad con esa identificación.')
}

async function generateUniqueToken(db) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = crypto.randomUUID()
    const duplicate = await db.execute({ sql: 'SELECT 1 FROM Entidades WHERE token = ? LIMIT 1', args: [token] })
    if (!duplicate.rows.length) return token
  }
  throw new Error('No fue posible generar un token único.')
}

function getClientIp(request) {
  return String(
    request.headers.get('x-nf-client-connection-ip') ||
    request.headers.get('x-forwarded-for') ||
    'local',
  ).split(',')[0].trim().slice(0, 64)
}

function asBadRequest(callback) {
  try {
    return callback()
  } catch (error) {
    throw new HttpError(400, error.message)
  }
}
