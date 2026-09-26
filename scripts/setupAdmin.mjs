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

await db.execute(
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_entidades_categoria_token ON Entidades (categoriaID, token)',
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
