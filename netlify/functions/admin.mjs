import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'
import { getDb } from './_lib/db.mjs'
import { purgeCategoryCache, purgeEntityCache, purgeEntityCaches } from './_lib/cache.mjs'
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
import { getClientIp, getCookie } from './_lib/http.mjs'
import { normalizeDataType } from '../../src/services/dataTypes.js'
import { isReservedPath } from '../../src/services/routes.js'
import { generateUniqueShortCode, generateUniqueShortCodes } from '../../src/services/shortCode.js'
import {
  CATEGORY_CODE_MAX_LENGTH,
  IDENTIFICATION_MAX_LENGTH,
  sanitizeText,
  validateCategoryCode,
} from '../../src/services/validation.js'

const CATEGORY_NAME_MAX_LENGTH = 50
const SUGGESTION_NAME_MAX_LENGTH = 50
const CLIENT_NAME_MAX_LENGTH = 100
const CLIENT_EMAIL_MAX_LENGTH = 254
const CLIENT_PHONE_MAX_LENGTH = 30
const ADMIN_PASSWORD_MIN_LENGTH = 12
const ADMIN_PASSWORD_MAX_LENGTH = 128
const DEFAULT_PAGE_SIZE = 10
const MAX_PAGE_SIZE = 50
const BULK_ENTITY_LIMIT = 200
const BULK_PREFIX_MAX_LENGTH = 150

export default async function handler(request) {
  try {
    const url = new URL(request.url)
    const action = url.searchParams.get('action') || 'session'

    if (request.method === 'GET' && action === 'session') {
      return json({ authenticated: Boolean(verifySession(getCookie(request, ADMIN_COOKIE), 'admin')) })
    }
    if (request.method === 'POST' && action === 'login') return await login(request, await readJson(request))
    if (request.method === 'POST' && action === 'logout') {
      return json({ ok: true }, 200, { 'set-cookie': clearCookie(ADMIN_COOKIE, request) })
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
    if (request.method === 'GET' && action === 'clients') return json(await listClients(db, url.searchParams))
    if (request.method === 'GET' && action === 'client-options') return json(await listClientOptions(db))
    if (request.method === 'POST' && action === 'save-client') return await saveClient(db, body)
    if (request.method === 'DELETE' && action === 'delete-client') return await deleteClient(db, body)
    if (request.method === 'GET' && action === 'entities') return json(await listEntities(db, url.searchParams))
    if (request.method === 'POST' && action === 'create-entity') return await createEntity(db, body)
    if (request.method === 'POST' && action === 'bulk-create-entities') return await bulkCreateEntities(db, body)
    if (request.method === 'PATCH' && action === 'update-entity') return await updateEntity(db, body)
    if (request.method === 'POST' && action === 'regenerate-entity') return await regenerateEntity(db, body)
    if (request.method === 'DELETE' && action === 'delete-entity') return await deleteEntity(db, body)

    throw new HttpError(404, 'Operación administrativa no encontrada.')
  } catch (error) {
    return handleError(asDatabaseError(error))
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
    { 'set-cookie': sessionCookie(ADMIN_COOKIE, token, ADMIN_SESSION_SECONDS, request) },
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
  // Una categoría con un código reservado dejaría su URL larga
  // (/CODIGO/token) inalcanzable para siempre, porque el enrutador la trata
  // como una ruta de la aplicación.
  if (isReservedPath(code)) {
    throw new HttpError(400, `El código "${code}" está reservado por una ruta de la aplicación.`)
  }

  if (category.id) {
    const categoryId = validId(category.id, 'categoría')
    await db.execute({ sql: 'UPDATE Categorias SET name = ?, code = ?, active = ? WHERE id = ?', args: [name, code, active, categoryId] })
    await purgeCategoryCache(categoryId)
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
  await purgeCategoryCache(categoryId)
  return json({ ok: true })
}

async function deleteSuggestion(db, payload) {
  const categoryId = validId(payload.categoryId, 'categoría')
  await db.execute({ sql: 'DELETE FROM CategoriaSugerencias WHERE id = ? AND categoriaID = ?', args: [validId(payload.id, 'sugerencia'), categoryId] })
  await purgeCategoryCache(categoryId)
  return json({ ok: true })
}

async function listClients(db, params) {
  const clauses = []
  const args = []
  const search = sanitizeText(params.get('search'))
  if (search) {
    clauses.push(`(c.name LIKE ? OR c.email LIKE ? OR COALESCE(c.phone, '') LIKE ?)`)
    const pattern = `%${search.slice(0, IDENTIFICATION_MAX_LENGTH)}%`
    args.push(pattern, pattern, pattern)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const pagination = await resolvePagination(
    db,
    `SELECT COUNT(*) AS total FROM Clientes c ${where}`,
    args,
    params,
  )
  const result = await db.execute({
    sql: `SELECT c.id, c.name, c.email, c.phone, c.active, COUNT(e.id) AS entity_count
          FROM Clientes c
          LEFT JOIN Entidades e ON e.clienteID = c.id
          ${where}
          GROUP BY c.id, c.name, c.email, c.phone, c.active
          ORDER BY c.name, c.id LIMIT ? OFFSET ?`,
    args: [...args, pagination.pageSize, pagination.offset],
  })
  return pageResult(result.rows.map(mapClient), pagination)
}

async function listClientOptions(db) {
  const result = await db.execute(
    'SELECT id, name, email, active FROM Clientes ORDER BY name, id',
  )
  return result.rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    email: String(row.email),
    active: Boolean(row.active),
  }))
}

async function saveClient(db, client) {
  const name = requiredText(client.name, CLIENT_NAME_MAX_LENGTH, 'Nombre')
  const email = optionalText(client.email, CLIENT_EMAIL_MAX_LENGTH, 'Correo').toLowerCase()
  const phone = optionalText(client.phone, CLIENT_PHONE_MAX_LENGTH, 'Celular')

  if (!email) throw new HttpError(400, 'El correo es obligatorio.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Escribe un correo válido.')
  if (phone && !/^[0-9+() .-]{7,30}$/.test(phone)) throw new HttpError(400, 'Escribe un número de celular válido.')

  const active = client.active ? 1 : 0

  if (!client.id) {
    const inserted = await db.execute({
      sql: 'INSERT INTO Clientes (name, email, phone, active) VALUES (?, ?, ?, ?)',
      args: [name, email, phone, active],
    })
    return json({ ok: true, id: Number(inserted.lastInsertRowid) })
  }

  const id = validId(client.id, 'cliente')
  const current = await db.execute({
    sql: 'SELECT email, active FROM Clientes WHERE id = ? LIMIT 1',
    args: [id],
  })
  if (!current.rows[0]) throw new HttpError(404, 'No se encontró el cliente.')

  // Cambiar el correo o desactivar es cambiar la credencial de acceso: corta las
  // sesiones abiertas incrementando auth_version y descartando los códigos
  // pendientes. Sin esto, al reactivar volverían a servir los códigos y las
  // sesiones de antes de la desactivación.
  const emailChanged = String(current.rows[0].email || '').toLowerCase() !== email
  const activeChanged = Boolean(current.rows[0].active) !== Boolean(active)
  const revoke = emailChanged || !active

  await db.execute({
    sql: `UPDATE Clientes
          SET name = ?, email = ?, phone = ?, active = ?,
              auth_version = auth_version + ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
    args: [name, email, phone, active, revoke ? 1 : 0, id],
  })

  if (revoke) {
    await db.execute({ sql: 'DELETE FROM ClientAccessCodes WHERE cliente_id = ?', args: [id] })
  }
  // La lectura pública anónima se cachea 60 s y lleva dentro `canRequestCode`,
  // así que hay que purgar en los dos sentidos: al desactivar y al reactivar.
  if (emailChanged || activeChanged) await purgeClientEntitiesCache(db, id)

  return json({ ok: true, id })
}

async function deleteClient(db, payload) {
  const id = validId(payload.id, 'cliente')
  const dependencies = await db.execute({
    sql: 'SELECT COUNT(*) AS total FROM Entidades WHERE clienteID = ?',
    args: [id],
  })
  if (Number(dependencies.rows[0].total)) {
    throw new HttpError(409, 'No puedes eliminar un cliente que tenga fichas. Desactívalo en su lugar.')
  }

  await db.batch([
    { sql: 'DELETE FROM ClientAccessCodes WHERE cliente_id = ?', args: [id] },
    { sql: 'DELETE FROM Clientes WHERE id = ?', args: [id] },
  ], 'write')

  return json({ ok: true })
}

/**
 * Resuelve el cliente de una ficha. Acepta `clienteId` (lo que envía el panel)
 * y, por compatibilidad, un `ownerEmail` suelto: si no existe un cliente con
 * ese correo se crea, que es lo que hacía el formulario anterior.
 */
async function resolveClient(db, payload) {
  if (payload.clienteId) {
    const id = validId(payload.clienteId, 'cliente')
    const result = await db.execute({
      sql: 'SELECT id, name, email, phone, active FROM Clientes WHERE id = ? LIMIT 1',
      args: [id],
    })
    if (!result.rows[0]) throw new HttpError(404, 'No se encontró el cliente.')
    return mapClient(result.rows[0])
  }

  const email = optionalText(payload.ownerEmail, CLIENT_EMAIL_MAX_LENGTH, 'Correo').toLowerCase()
  if (!email) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Escribe un correo válido.')

  const existing = await db.execute({
    sql: 'SELECT id, name, email, phone, active FROM Clientes WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    args: [email],
  })
  if (existing.rows[0]) return mapClient(existing.rows[0])

  const name = optionalText(payload.ownerName, CLIENT_NAME_MAX_LENGTH, 'Nombre del propietario')
  const phone = optionalText(payload.ownerPhone, CLIENT_PHONE_MAX_LENGTH, 'Celular')
  const inserted = await db.execute({
    sql: 'INSERT INTO Clientes (name, email, phone, active) VALUES (?, ?, ?, 1)',
    args: [name || email.slice(0, email.indexOf('@')), email, phone],
  })
  return {
    id: Number(inserted.lastInsertRowid),
    name: name || email.slice(0, email.indexOf('@')),
    email,
    phone,
    active: true,
  }
}

async function purgeClientEntitiesCache(db, clienteId) {
  const result = await db.execute({
    sql: 'SELECT id FROM Entidades WHERE clienteID = ?',
    args: [clienteId],
  })
  await purgeEntityCaches(result.rows.map((row) => Number(row.id)))
}

function mapClient(row) {
  return {
    id: Number(row.id),
    name: String(row.name),
    email: String(row.email),
    phone: String(row.phone || ''),
    active: Boolean(row.active),
    entityCount: Number(row.entity_count || 0),
  }
}

async function listEntities(db, params) {
  const clauses = []
  const args = []
  if (params.get('categoryId')) {
    clauses.push('e.categoriaID = ?')
    args.push(validId(params.get('categoryId'), 'categoría'))
  }
  if (params.get('clienteId')) {
    clauses.push('e.clienteID = ?')
    args.push(validId(params.get('clienteId'), 'cliente'))
  }
  const search = sanitizeText(params.get('search'))
  if (search) {
    clauses.push(`(e.Identificacion LIKE ? OR e.token LIKE ? OR e.short_code LIKE ?
                  OR cl.name LIKE ? OR cl.email LIKE ?)`)
    const pattern = `%${search.slice(0, IDENTIFICATION_MAX_LENGTH)}%`
    args.push(pattern, pattern, pattern, pattern, pattern)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const pagination = await resolvePagination(
    db,
    `SELECT COUNT(*) AS total FROM Entidades e
       LEFT JOIN Clientes cl ON cl.id = e.clienteID ${where}`,
    args,
    params,
  )
  const result = await db.execute({
    sql: `SELECT e.id, e.Identificacion AS identificacion, e.token, e.short_code,
                 e.categoriaID, e.clienteID,
                 cl.name AS client_name, cl.email AS client_email, cl.phone AS client_phone,
                 c.name AS category_name, c.code AS category_code
          FROM Entidades e
          INNER JOIN Categorias c ON c.id = e.categoriaID
          LEFT JOIN Clientes cl ON cl.id = e.clienteID
          ${where} ORDER BY e.id DESC LIMIT ? OFFSET ?`,
    args: [...args, pagination.pageSize, pagination.offset],
  })
  return pageResult(result.rows.map(mapEntity), pagination)
}

async function createEntity(db, payload) {
  const identification = requiredText(payload.identification, IDENTIFICATION_MAX_LENGTH, 'Identificación')
  const categoryId = validId(payload.categoryId, 'categoría')
  const cliente = await resolveClient(db, payload)
  await ensureUniqueIdentification(db, identification)
  const token = await generateUniqueToken(db)
  const shortCode = await generateUniqueShortCode(db)
  await db.execute({
    sql: `INSERT INTO Entidades
          (Identificacion, token, short_code, categoriaID, custom_data, auth_version, clienteID)
          VALUES (?, ?, ?, ?, '[]', 1, ?)`,
    args: [identification, token, shortCode, categoryId, cliente?.id ?? null],
  })
  return json({ token, shortCode, clienteId: cliente?.id ?? null })
}

/**
 * Crea un rango de fichas de una vez, para el caso de la finca con muchas
 * cabezas. Valida las colisiones del lote completo antes de insertar nada.
 */
async function bulkCreateEntities(db, payload) {
  const categoryId = validId(payload.categoryId, 'categoría')
  const cliente = await resolveClient(db, payload)
  const prefix = sanitizeText(payload.prefix)
  if (!prefix) throw new HttpError(400, 'El prefijo es obligatorio.')
  if (prefix.length > BULK_PREFIX_MAX_LENGTH) {
    throw new HttpError(400, `El prefijo no puede superar ${BULK_PREFIX_MAX_LENGTH} caracteres.`)
  }

  const from = Number(payload.from)
  const to = Number(payload.to)
  const pad = Number(payload.pad ?? 3)
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) {
    throw new HttpError(400, 'El rango debe ser dos números enteros, con el final mayor o igual que el inicial.')
  }
  if (!Number.isInteger(pad) || pad < 1 || pad > 10) {
    throw new HttpError(400, 'El relleno debe ser un número entre 1 y 10.')
  }

  const total = to - from + 1
  if (total > BULK_ENTITY_LIMIT) {
    throw new HttpError(400, `No se pueden crear más de ${BULK_ENTITY_LIMIT} fichas de una vez.`)
  }

  const identifications = []
  for (let value = from; value <= to; value += 1) {
    const identification = `${prefix}${String(value).padStart(pad, '0')}`
    if (identification.length > IDENTIFICATION_MAX_LENGTH) {
      throw new HttpError(400, `La identificación "${identification}" supera ${IDENTIFICATION_MAX_LENGTH} caracteres.`)
    }
    identifications.push(identification)
  }

  const placeholders = identifications.map(() => '?').join(', ')
  const clash = await db.execute({
    sql: `SELECT Identificacion FROM Entidades
          WHERE LOWER(TRIM(Identificacion)) IN (${placeholders})`,
    args: identifications.map((value) => value.toLowerCase()),
  })
  if (clash.rows.length) {
    const shown = clash.rows.slice(0, 5).map((row) => String(row.Identificacion))
    const extra = clash.rows.length > shown.length ? ` y ${clash.rows.length - shown.length} más` : ''
    throw new HttpError(409, `Ya existen ${clash.rows.length} identificaciones en ese rango: ${shown.join(', ')}${extra}.`)
  }

  const shortCodes = await generateUniqueShortCodes(db, identifications.length)
  const rows = identifications.map((identification, index) => ({
    sql: `INSERT INTO Entidades
          (Identificacion, token, short_code, categoriaID, custom_data, auth_version, clienteID)
          VALUES (?, ?, ?, ?, '[]', 1, ?)`,
    args: [identification, crypto.randomUUID(), shortCodes[index], categoryId, cliente?.id ?? null],
  }))

  await db.batch(rows, 'write')

  return json({
    ok: true,
    created: rows.length,
    first: identifications[0],
    last: identifications[identifications.length - 1],
    clienteId: cliente?.id ?? null,
  })
}

async function updateEntity(db, payload) {
  const id = validId(payload.id, 'entidad')
  const identification = requiredText(payload.identification, IDENTIFICATION_MAX_LENGTH, 'Identificación')
  const categoryId = validId(payload.categoryId, 'categoría')
  await ensureUniqueIdentification(db, identification, id)
  const current = await db.execute({ sql: 'SELECT clienteID FROM Entidades WHERE id = ? LIMIT 1', args: [id] })
  if (!current.rows[0]) throw new HttpError(404, 'No se encontró la entidad.')

  const previousClientId = current.rows[0].clienteID === null ? null : Number(current.rows[0].clienteID)

  // Un PATCH que no menciona al cliente no debe desvincularlo. Solo se cambia si
  // el campo viene, aunque venga como null explícito: así una llamada parcial
  // (o un consumidor antiguo que solo mande identificación y categoría) no deja
  // la ficha huérfana y en solo lectura sin avisar.
  const touchesClient = 'clienteId' in payload || 'ownerEmail' in payload
  const cliente = touchesClient ? await resolveClient(db, payload) : null
  const nextClientId = touchesClient ? (cliente?.id ?? null) : previousClientId

  await db.execute({
    sql: `UPDATE Entidades
          SET Identificacion = ?, categoriaID = ?, clienteID = ?
          WHERE id = ?`,
    args: [identification, categoryId, nextClientId, id],
  })

  await purgeEntityCache(id)
  // Las demás fichas del cliente anterior pierden el enlace en su listado.
  if (previousClientId && previousClientId !== nextClientId) {
    await purgeClientEntitiesCache(db, previousClientId)
  }
  return json({ ok: true, clienteId: nextClientId })
}

async function regenerateEntity(db, payload) {
  const id = validId(payload.id, 'entidad')
  const token = await generateUniqueToken(db)
  const shortCode = await generateUniqueShortCode(db)
  await db.batch([
    { sql: 'DELETE FROM EntityAliases WHERE entity_id = ?', args: [id] },
    { sql: 'DELETE FROM EntityAccessCodes WHERE entity_id = ?', args: [id] },
    // Las sesiones ya no se revocan por ficha: viven en el cliente. Al cambiar
    // token y código corto la ruta anterior deja de resolver, que es lo que
    // corta el acceso a quien tenía el enlace viejo.
    { sql: 'UPDATE Entidades SET token = ?, short_code = ? WHERE id = ?', args: [token, shortCode, id] },
  ], 'write')
  await purgeEntityCache(id)
  return json({ token, shortCode })
}

async function deleteEntity(db, payload) {
  const id = validId(payload.id, 'entidad')
  await db.batch([
    { sql: 'DELETE FROM EntityAccessCodes WHERE entity_id = ?', args: [id] },
    { sql: 'DELETE FROM EntityAliases WHERE entity_id = ?', args: [id] },
    { sql: 'DELETE FROM Entidades WHERE id = ?', args: [id] },
  ], 'write')
  await purgeEntityCache(id)
  return json({ ok: true })
}

function mapEntity(row) {
  return {
    id: Number(row.id), identification: String(row.identificacion), token: String(row.token),
    shortCode: String(row.short_code || ''), categoryId: Number(row.categoriaID),
    categoryName: String(row.category_name), categoryCode: String(row.category_code),
    clienteId: row.clienteID === null || row.clienteID === undefined ? null : Number(row.clienteID),
    clientName: String(row.client_name || ''),
    clientEmail: String(row.client_email || ''),
    clientPhone: String(row.client_phone || ''),
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
          WHERE LOWER(TRIM(Identificacion)) = LOWER(TRIM(?)) AND (? IS NULL OR id <> ?)
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


function asBadRequest(callback) {
  try {
    return callback()
  } catch (error) {
    throw new HttpError(400, error.message)
  }
}

function asDatabaseError(error) {
  if (error instanceof HttpError) return error

  const message = String(error?.message || '')
  if (message.includes('idx_entidades_identification_normalized')) {
    return new HttpError(409, 'Ya existe una entidad con esa identificación.')
  }
  if (message.includes('idx_suggestions_name_normalized') || message.includes('CategoriaSugerencias.categoriaID')) {
    return new HttpError(409, 'Esta categoría ya tiene una sugerencia con ese nombre.')
  }
  if (message.includes('Categorias.code')) {
    return new HttpError(409, 'Ya existe una categoría con ese código.')
  }
  if (message.includes('idx_clientes_email_normalized') || message.includes('Clientes.email')) {
    return new HttpError(409, 'Ya existe un cliente con ese correo.')
  }
  if (message.includes('Entidades.token') || message.includes('Entidades.short_code')) {
    return new HttpError(409, 'El token o código corto ya está en uso.')
  }
  if (message.includes('El token o código corto ya existe en otra ruta.')) {
    return new HttpError(409, 'El token o código corto ya existe en otra ruta.')
  }
  if (message.includes('El alias ya existe como token o código corto.')) {
    return new HttpError(409, 'El alias ya existe como token o código corto.')
  }
  const validationMessages = [
    'Categoría inválida o sin normalizar.',
    'Sugerencia inválida o sin normalizar.',
    'Entidad inválida o sin normalizar.',
    'Alias inválido o sin normalizar.',
    'Cliente inválido o sin normalizar.',
  ]
  const validationMessage = validationMessages.find((candidate) => message.includes(candidate))
  return validationMessage ? new HttpError(400, validationMessage) : error
}
