import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { createClient } from '@libsql/client'
import { loadEnv } from 'vite'

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

const entityColumns = await db.execute('PRAGMA table_info(Entidades)')
const hasShortCode = entityColumns.rows.some((column) => column.name === 'short_code')

if (!hasShortCode) {
  await db.execute('ALTER TABLE Entidades ADD COLUMN short_code TEXT')
}

const entitiesWithoutShortCode = await db.execute(
  "SELECT id FROM Entidades WHERE short_code IS NULL OR TRIM(short_code) = ''",
)

for (const entity of entitiesWithoutShortCode.rows) {
  let shortCode
  let exists = true

  while (exists) {
    shortCode = randomBytes(9).toString('base64url')
    const duplicate = await db.execute({
      sql: 'SELECT 1 FROM Entidades WHERE short_code = ? LIMIT 1',
      args: [shortCode],
    })
    exists = duplicate.rows.length > 0
  }

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
