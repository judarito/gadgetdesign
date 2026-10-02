import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { createClient } from '@libsql/client'
import { loadEnv } from 'vite'
import { applyDataIntegrityConstraints } from './schemaConstraints.mjs'

const env = loadEnv('', process.cwd(), '')
const url = env.TURSO_URL || env.VITE_TURSO_URL
const authToken = env.TURSO_TOKEN || env.VITE_TURSO_TOKEN

if (!url || !authToken) {
  throw new Error('Faltan TURSO_URL o TURSO_TOKEN en .env.')
}

const db = createClient({ url, authToken })

await db.execute(`CREATE TABLE IF NOT EXISTS AdminCredentials (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  iterations INTEGER NOT NULL DEFAULT 210000,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`)

await db.execute(`CREATE TABLE IF NOT EXISTS AdminLoginAttempts (
  id INTEGER PRIMARY KEY,
  request_ip TEXT NOT NULL,
  succeeded NUMERIC NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
)`)

await db.execute(
  'CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_ip_time ON AdminLoginAttempts (request_ip, created_at)',
)

await db.execute(`CREATE TABLE IF NOT EXISTS CategoriaSugerencias (
  id INTEGER PRIMARY KEY,
  categoriaID INTEGER NOT NULL,
  name TEXT(50) NOT NULL,
  active NUMERIC NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  data_type TEXT NOT NULL DEFAULT 'text',
  CONSTRAINT constraint_CategoriaSugerencias_Cat
    FOREIGN KEY (categoriaID) REFERENCES Categorias (id),
  CONSTRAINT unique_CategoriaSugerencias_name
    UNIQUE (categoriaID, name)
)`)

const suggestionColumns = await db.execute('PRAGMA table_info(CategoriaSugerencias)')
const hasDataType = suggestionColumns.rows.some((column) => column.name === 'data_type')

if (!hasDataType) {
  await db.execute(
    "ALTER TABLE CategoriaSugerencias ADD COLUMN data_type TEXT NOT NULL DEFAULT 'text'",
  )
  await db.execute({
    sql: `UPDATE CategoriaSugerencias
          SET data_type = 'date'
          WHERE categoriaID = (SELECT id FROM Categorias WHERE code = 'VEH' LIMIT 1)
            AND name IN (?, ?)`,
    args: ['Vencimiento SOAT', 'Vencimiento tecnomecanica'],
  })
}

await db.execute(
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_entidades_categoria_token ON Entidades (categoriaID, token)',
)
await db.execute(
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_entidades_token ON Entidades (token)',
)

const entityColumns = await db.execute('PRAGMA table_info(Entidades)')
const hasShortCode = entityColumns.rows.some((column) => column.name === 'short_code')

if (!hasShortCode) {
  await db.execute('ALTER TABLE Entidades ADD COLUMN short_code TEXT')
}

const entitySecurityColumns = [
  ['owner_name', 'TEXT'],
  ['owner_email', 'TEXT'],
  ['owner_phone', 'TEXT'],
  ['auth_version', 'INTEGER NOT NULL DEFAULT 1'],
]

for (const [name, definition] of entitySecurityColumns) {
  if (!entityColumns.rows.some((column) => column.name === name)) {
    await db.execute(`ALTER TABLE Entidades ADD COLUMN ${name} ${definition}`)
  }
}

await db.execute(`CREATE TABLE IF NOT EXISTS EntityAccessCodes (
  id INTEGER PRIMARY KEY,
  entity_id INTEGER NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed NUMERIC NOT NULL DEFAULT 0,
  request_ip TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CONSTRAINT constraint_EntityAccessCodes_Entity
    FOREIGN KEY (entity_id) REFERENCES Entidades (id) ON DELETE CASCADE
)`)

await db.execute(
  'CREATE INDEX IF NOT EXISTS idx_entity_access_codes_lookup ON EntityAccessCodes (entity_id, created_at)',
)

await db.execute(`CREATE TABLE IF NOT EXISTS EntityAliases (
  id INTEGER PRIMARY KEY,
  entity_id INTEGER NOT NULL,
  code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT constraint_EntityAliases_Entity
    FOREIGN KEY (entity_id) REFERENCES Entidades (id) ON DELETE CASCADE
)`)

await db.execute(
  'CREATE INDEX IF NOT EXISTS idx_entity_aliases_entity ON EntityAliases (entity_id)',
)

async function generateUniqueShortCode() {
  let shortCode
  let exists = true

  while (exists) {
    shortCode = randomBytes(6).toString('base64url')
    const duplicate = await db.execute({
      sql: `SELECT 1 FROM Entidades WHERE short_code = ?
            UNION ALL
            SELECT 1 FROM EntityAliases WHERE code = ?
            LIMIT 1`,
      args: [shortCode, shortCode],
    })
    exists = duplicate.rows.length > 0
  }

  return shortCode
}

const entitiesWithoutShortCode = await db.execute(
  "SELECT id FROM Entidades WHERE short_code IS NULL OR TRIM(short_code) = ''",
)

for (const entity of entitiesWithoutShortCode.rows) {
  const shortCode = await generateUniqueShortCode()

  await db.execute({
    sql: 'UPDATE Entidades SET short_code = ? WHERE id = ?',
    args: [shortCode, entity.id],
  })
}

const entitiesWithLongCode = await db.execute(
  'SELECT id, short_code FROM Entidades WHERE LENGTH(short_code) > 8',
)

for (const entity of entitiesWithLongCode.rows) {
  await db.execute({
    sql: 'INSERT OR IGNORE INTO EntityAliases (entity_id, code) VALUES (?, ?)',
    args: [entity.id, entity.short_code],
  })

  const shortCode = await generateUniqueShortCode()
  await db.execute({
    sql: 'UPDATE Entidades SET short_code = ? WHERE id = ?',
    args: [shortCode, entity.id],
  })
}

await db.execute(
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_entidades_categoria_short_code ON Entidades (categoriaID, short_code)',
)
await db.execute(
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_entidades_short_code ON Entidades (short_code)',
)

await applyDataIntegrityConstraints(db)

const existing = await db.execute('SELECT id FROM AdminCredentials WHERE id = 1 LIMIT 1')

if (existing.rows.length) {
  console.log('La credencial administrativa ya existe. No se modificó la contraseña.')
} else {
  const temporaryPassword = randomBytes(15).toString('base64url')
  const salt = randomBytes(16).toString('hex')
  const iterations = 210000
  const passwordHash = pbkdf2Sync(temporaryPassword, Buffer.from(salt, 'hex'), iterations, 32, 'sha256').toString('hex')

  await db.execute({
    sql: `INSERT INTO AdminCredentials (id, password_hash, salt, iterations)
          VALUES (1, ?, ?, ?)`,
    args: [passwordHash, salt, iterations],
  })

  console.log(`Contraseña temporal del administrador: ${temporaryPassword}`)
  console.log('Inicia sesión en /admin y cámbiala desde Seguridad.')
}

db.close()
