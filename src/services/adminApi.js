import { getTursoClient } from './tursoClient'
import { normalizeDataType } from './dataTypes'
import { generateShortCode } from './shortCode'
import {
  CATEGORY_CODE_MAX_LENGTH,
  IDENTIFICATION_MAX_LENGTH,
  sanitizeText,
  validateCategoryCode,
} from './validation'

const CATEGORY_NAME_MAX_LENGTH = 50
const SUGGESTION_NAME_MAX_LENGTH = 50
const ADMIN_PASSWORD_MIN_LENGTH = 12
const ADMIN_PASSWORD_MAX_LENGTH = 128
const ADMIN_SESSION_KEY = 'gadgetdesign-admin-session'
const DEFAULT_PAGE_SIZE = 10
const MAX_PAGE_SIZE = 50

export function hasAdminSession() {
  return sessionStorage.getItem(ADMIN_SESSION_KEY) === 'authenticated'
}

export function createAdminSession() {
  sessionStorage.setItem(ADMIN_SESSION_KEY, 'authenticated')
}

export function clearAdminSession() {
  sessionStorage.removeItem(ADMIN_SESSION_KEY)
}

export async function verifyAdminPassword(password) {
  const safePassword = validatePassword(password)
  const credential = await getAdminCredential()
  if (!credential) throw new Error('El administrador aún no está configurado.')

  const candidateHash = await derivePasswordHash(
    safePassword,
    credential.salt,
    credential.iterations,
  )

  return constantTimeEqual(candidateHash, credential.passwordHash)
}

export async function changeAdminPassword(currentPassword, newPassword) {
  const isValid = await verifyAdminPassword(currentPassword)
  if (!isValid) throw new Error('La contraseña actual no es correcta.')

  const safePassword = validatePassword(newPassword)
  const salt = randomHex(16)
  const iterations = 210000
  const passwordHash = await derivePasswordHash(safePassword, salt, iterations)
  const db = getTursoClient()

  await db.execute({
    sql: `UPDATE AdminCredentials
          SET password_hash = ?, salt = ?, iterations = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = 1`,
    args: [passwordHash, salt, iterations],
  })
}

export async function listCategoryOptions() {
  const db = getTursoClient()
  const result = await db.execute({
    sql: 'SELECT id, name, active, code FROM Categorias ORDER BY name',
    args: [],
  })

  return result.rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    code: String(row.code),
    active: Boolean(row.active),
  }))
}

export async function listCategories({ page = 1, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const db = getTursoClient()
  const pagination = await resolvePagination(
    db,
    'SELECT COUNT(*) AS total FROM Categorias',
    [],
    page,
    pageSize,
  )
  const result = await db.execute({
    sql: `SELECT c.id, c.name, c.active, c.code,
                 COUNT(DISTINCT e.id) AS entity_count,
                 COUNT(DISTINCT s.id) AS suggestion_count
          FROM Categorias c
          LEFT JOIN Entidades e ON e.categoriaID = c.id
          LEFT JOIN CategoriaSugerencias s ON s.categoriaID = c.id
          GROUP BY c.id, c.name, c.active, c.code
          ORDER BY c.name
          LIMIT ? OFFSET ?`,
    args: [pagination.pageSize, pagination.offset],
  })

  return pageResult(result.rows.map(mapCategory), pagination)
}

export async function saveCategory(category) {
  const db = getTursoClient()
  const payload = validateCategory(category)

  if (category.id) {
    await db.execute({
      sql: 'UPDATE Categorias SET name = ?, code = ?, active = ? WHERE id = ?',
      args: [payload.name, payload.code, payload.active, Number(category.id)],
    })
  } else {
    await db.execute({
      sql: 'INSERT INTO Categorias (name, code, active) VALUES (?, ?, ?)',
      args: [payload.name, payload.code, payload.active],
    })
  }
}

export async function deleteCategory(categoryId) {
  const db = getTursoClient()
  const safeId = validateId(categoryId, 'categoría')
  const dependencies = await db.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM Entidades WHERE categoriaID = ?) AS entities,
            (SELECT COUNT(*) FROM CategoriaSugerencias WHERE categoriaID = ?) AS suggestions`,
    args: [safeId, safeId],
  })
  const row = dependencies.rows[0]

  if (Number(row.entities) > 0 || Number(row.suggestions) > 0) {
    throw new Error('No puedes eliminar una categoría que tenga entidades o sugerencias.')
  }

  await db.execute({ sql: 'DELETE FROM Categorias WHERE id = ?', args: [safeId] })
}

export async function listSuggestions(
  categoryId,
  { page = 1, pageSize = DEFAULT_PAGE_SIZE } = {},
) {
  const db = getTursoClient()
  const safeId = validateId(categoryId, 'categoría')
  const pagination = await resolvePagination(
    db,
    'SELECT COUNT(*) AS total FROM CategoriaSugerencias WHERE categoriaID = ?',
    [safeId],
    page,
    pageSize,
  )
  const result = await db.execute({
    sql: `SELECT id, categoriaID, name, active, sort_order, data_type
          FROM CategoriaSugerencias
          WHERE categoriaID = ?
          ORDER BY sort_order, id
          LIMIT ? OFFSET ?`,
    args: [safeId, pagination.pageSize, pagination.offset],
  })

  return pageResult(
    result.rows.map((row) => ({
      id: Number(row.id),
      categoryId: Number(row.categoriaID),
      name: String(row.name),
      active: Boolean(row.active),
      sortOrder: Number(row.sort_order),
      dataType: normalizeDataType(row.data_type),
    })),
    pagination,
  )
}

export async function saveSuggestion(suggestion) {
  const db = getTursoClient()
  const categoryId = validateId(suggestion.categoryId, 'categoría')
  const name = validateRequiredText(suggestion.name, SUGGESTION_NAME_MAX_LENGTH, 'Sugerencia')
  const active = suggestion.active ? 1 : 0
  const sortOrder = validateSortOrder(suggestion.sortOrder)
  const dataType = normalizeDataType(suggestion.dataType)

  if (suggestion.id) {
    await db.execute({
      sql: `UPDATE CategoriaSugerencias
            SET name = ?, active = ?, sort_order = ?, data_type = ?
            WHERE id = ? AND categoriaID = ?`,
      args: [name, active, sortOrder, dataType, Number(suggestion.id), categoryId],
    })
  } else {
    await db.execute({
      sql: `INSERT INTO CategoriaSugerencias (categoriaID, name, active, sort_order, data_type)
            VALUES (?, ?, ?, ?, ?)`,
      args: [categoryId, name, active, sortOrder, dataType],
    })
  }
}

export async function deleteSuggestion(suggestionId, categoryId) {
  const db = getTursoClient()
  const safeId = validateId(suggestionId, 'sugerencia')
  const safeCategoryId = validateId(categoryId, 'categoría')
  await db.execute({
    sql: 'DELETE FROM CategoriaSugerencias WHERE id = ? AND categoriaID = ?',
    args: [safeId, safeCategoryId],
  })
}

export async function listEntities({
  categoryId = null,
  search = '',
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
} = {}) {
  const db = getTursoClient()
  const clauses = []
  const args = []

  if (categoryId) {
    clauses.push('e.categoriaID = ?')
    args.push(validateId(categoryId, 'categoría'))
  }
  const safeSearch = sanitizeText(search)
  if (safeSearch) {
    clauses.push('(e.Identificacion LIKE ? OR e.token LIKE ? OR e.short_code LIKE ?)')
    const pattern = `%${safeSearch.slice(0, IDENTIFICATION_MAX_LENGTH)}%`
    args.push(pattern, pattern, pattern)
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const pagination = await resolvePagination(
    db,
    `SELECT COUNT(*) AS total FROM Entidades e ${where}`,
    args,
    page,
    pageSize,
  )
  const result = await db.execute({
    sql: `SELECT e.id, e.Identificacion AS identificacion, e.token, e.short_code,
                 e.categoriaID, c.name AS category_name, c.code AS category_code
          FROM Entidades e
          INNER JOIN Categorias c ON c.id = e.categoriaID
          ${where}
          ORDER BY e.id DESC
          LIMIT ? OFFSET ?`,
    args: [...args, pagination.pageSize, pagination.offset],
  })

  return pageResult(result.rows.map(mapEntity), pagination)
}

export async function createEntity(payload) {
  const db = getTursoClient()
  const identification = validateRequiredText(
    payload.identification,
    IDENTIFICATION_MAX_LENGTH,
    'Identificación',
  )
  const categoryId = validateId(payload.categoryId, 'categoría')
  const token = crypto.randomUUID()
  const shortCode = generateShortCode()

  await db.execute({
    sql: `INSERT INTO Entidades (Identificacion, token, short_code, categoriaID, custom_data)
          VALUES (?, ?, ?, ?, '[]')`,
    args: [identification, token, shortCode, categoryId],
  })

  return { token, shortCode }
}

export async function updateEntity(payload) {
  const db = getTursoClient()
  const id = validateId(payload.id, 'entidad')
  const identification = validateRequiredText(
    payload.identification,
    IDENTIFICATION_MAX_LENGTH,
    'Identificación',
  )
  const categoryId = validateId(payload.categoryId, 'categoría')

  await db.execute({
    sql: 'UPDATE Entidades SET Identificacion = ?, categoriaID = ? WHERE id = ?',
    args: [identification, categoryId, id],
  })
}

export async function regenerateEntityToken(entityId) {
  const db = getTursoClient()
  const id = validateId(entityId, 'entidad')
  const token = crypto.randomUUID()
  const shortCode = generateShortCode()
  await db.execute({
    sql: 'UPDATE Entidades SET token = ?, short_code = ? WHERE id = ?',
    args: [token, shortCode, id],
  })
  return { token, shortCode }
}

export async function deleteEntity(entityId) {
  const db = getTursoClient()
  const id = validateId(entityId, 'entidad')
  await db.execute({ sql: 'DELETE FROM Entidades WHERE id = ?', args: [id] })
}

async function getAdminCredential() {
  const db = getTursoClient()
  const result = await db.execute({
    sql: `SELECT password_hash, salt, iterations
          FROM AdminCredentials
          WHERE id = 1
          LIMIT 1`,
    args: [],
  })
  const row = result.rows[0]
  if (!row) return null

  return {
    passwordHash: String(row.password_hash),
    salt: String(row.salt),
    iterations: Number(row.iterations),
  }
}

async function derivePasswordHash(password, saltHex, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: hexToBytes(saltHex),
      iterations,
    },
    keyMaterial,
    256,
  )

  return bytesToHex(new Uint8Array(bits))
}

function validateCategory(category) {
  const name = validateRequiredText(category.name, CATEGORY_NAME_MAX_LENGTH, 'Nombre')
  const code = validateCategoryCode(category.code).toUpperCase()

  if (code.length > CATEGORY_CODE_MAX_LENGTH) {
    throw new Error(`Código no puede superar ${CATEGORY_CODE_MAX_LENGTH} caracteres.`)
  }

  return { name, code, active: category.active ? 1 : 0 }
}

function validatePassword(password) {
  const value = String(password ?? '')
  if (value.length < ADMIN_PASSWORD_MIN_LENGTH) {
    throw new Error(`La contraseña debe tener al menos ${ADMIN_PASSWORD_MIN_LENGTH} caracteres.`)
  }
  if (value.length > ADMIN_PASSWORD_MAX_LENGTH) {
    throw new Error(`La contraseña no puede superar ${ADMIN_PASSWORD_MAX_LENGTH} caracteres.`)
  }
  return value
}

function validateRequiredText(value, maxLength, label) {
  const safeValue = sanitizeText(value)
  if (!safeValue) throw new Error(`${label} es obligatorio.`)
  if (safeValue.length > maxLength) {
    throw new Error(`${label} no puede superar ${maxLength} caracteres.`)
  }
  return safeValue
}

function validateId(value, label) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`El ID de ${label} no es válido.`)
  return id
}

function validateSortOrder(value) {
  const order = Number(value)
  if (!Number.isInteger(order) || order < 0 || order > 9999) {
    throw new Error('El orden debe ser un número entre 0 y 9999.')
  }
  return order
}

function mapCategory(row) {
  return {
    id: Number(row.id),
    name: String(row.name),
    code: String(row.code),
    active: Boolean(row.active),
    entityCount: Number(row.entity_count || 0),
    suggestionCount: Number(row.suggestion_count || 0),
  }
}

function mapEntity(row) {
  return {
    id: Number(row.id),
    identification: String(row.identificacion),
    token: String(row.token),
    shortCode: String(row.short_code || ''),
    categoryId: Number(row.categoriaID),
    categoryName: String(row.category_name),
    categoryCode: String(row.category_code),
  }
}

async function resolvePagination(db, countSql, countArgs, requestedPage, requestedPageSize) {
  const pageSize = Math.min(
    Math.max(Number.parseInt(requestedPageSize, 10) || DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE,
  )
  const countResult = await db.execute({ sql: countSql, args: countArgs })
  const total = Number(countResult.rows[0]?.total || 0)
  const totalPages = Math.max(Math.ceil(total / pageSize), 1)
  const page = Math.min(
    Math.max(Number.parseInt(requestedPage, 10) || 1, 1),
    totalPages,
  )

  return { total, totalPages, page, pageSize, offset: (page - 1) * pageSize }
}

function pageResult(items, pagination) {
  return {
    items,
    total: pagination.total,
    totalPages: pagination.totalPages,
    page: pagination.page,
    pageSize: pagination.pageSize,
  }
}

function randomHex(byteLength) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength))
  return bytesToHex(bytes)
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(value) {
  if (!/^[a-f0-9]+$/i.test(value) || value.length % 2 !== 0) {
    throw new Error('La configuración de seguridad no es válida.')
  }
  return new Uint8Array(value.match(/.{2}/g).map((byte) => Number.parseInt(byte, 16)))
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}
