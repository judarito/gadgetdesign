import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { createClient } from '@libsql/client'
import { loadEnv } from 'vite'

const env = loadEnv('', process.cwd(), '')
const url = env.LOCAL_TURSO_URL || 'file:/tmp/gadgetdesign-local.db'
const db = createClient({ url })

await db.batch([
  `CREATE TABLE IF NOT EXISTS Categorias (
    id INTEGER PRIMARY KEY,
    name TEXT(50) NOT NULL,
    active NUMERIC NOT NULL DEFAULT 1,
    code TEXT(20) UNIQUE NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS Entidades (
    id INTEGER PRIMARY KEY,
    Identificacion TEXT(200) NOT NULL,
    token TEXT(40) NOT NULL,
    categoriaID INTEGER NOT NULL,
    custom_data TEXT NOT NULL DEFAULT '[]',
    short_code TEXT UNIQUE,
    owner_name TEXT,
    owner_email TEXT,
    owner_phone TEXT,
    auth_version INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (categoriaID) REFERENCES Categorias (id)
  )`,
  `CREATE TABLE IF NOT EXISTS CategoriaSugerencias (
    id INTEGER PRIMARY KEY,
    categoriaID INTEGER NOT NULL,
    name TEXT(50) NOT NULL,
    active NUMERIC NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    data_type TEXT NOT NULL DEFAULT 'text',
    UNIQUE (categoriaID, name),
    FOREIGN KEY (categoriaID) REFERENCES Categorias (id)
  )`,
  `CREATE TABLE IF NOT EXISTS EntityAliases (
    id INTEGER PRIMARY KEY,
    entity_id INTEGER NOT NULL,
    code TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (entity_id) REFERENCES Entidades (id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS EntityAccessCodes (
    id INTEGER PRIMARY KEY,
    entity_id INTEGER NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    consumed NUMERIC NOT NULL DEFAULT 0,
    request_ip TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (entity_id) REFERENCES Entidades (id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS AdminCredentials (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    iterations INTEGER NOT NULL DEFAULT 210000,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS AdminLoginAttempts (
    id INTEGER PRIMARY KEY,
    request_ip TEXT NOT NULL,
    succeeded NUMERIC NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_ip_time ON AdminLoginAttempts (request_ip, created_at)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_entidades_token ON Entidades (token)',
], 'write')

await db.execute(`INSERT OR IGNORE INTO Categorias (id, name, active, code)
                  VALUES (1, 'Vehículos', 1, 'VEH')`)
await db.batch([
  { sql: `INSERT OR IGNORE INTO CategoriaSugerencias (id, categoriaID, name, active, sort_order, data_type)
          VALUES (1, 1, 'Vencimiento SOAT', 1, 10, 'date')`, args: [] },
  { sql: `INSERT OR IGNORE INTO CategoriaSugerencias (id, categoriaID, name, active, sort_order, data_type)
          VALUES (2, 1, 'Vencimiento tecnomecánica', 1, 20, 'date')`, args: [] },
  { sql: `INSERT OR IGNORE INTO CategoriaSugerencias (id, categoriaID, name, active, sort_order, data_type)
          VALUES (3, 1, 'Día Pico y placa', 1, 30, 'text')`, args: [] },
], 'write')

const sampleData = JSON.stringify([
  { id: 'local-public', key: 'Color', value: 'Azul', dataType: 'text', protected: false },
  { id: 'local-protected', key: 'Número de póliza', value: 'POL-123456', dataType: 'text', protected: true },
])
await db.execute({
  sql: `INSERT INTO Entidades
        (id, Identificacion, token, categoriaID, custom_data, short_code,
         owner_name, owner_email, owner_phone, auth_version)
        VALUES (1, 'LOCAL-001', '11111111-1111-4111-8111-111111111111', 1, ?,
                'Local001', 'Cliente Local', 'cliente@example.com', '+57 300 000 0000', 1)
        ON CONFLICT(id) DO UPDATE SET
          Identificacion = excluded.Identificacion,
          token = excluded.token,
          categoriaID = excluded.categoriaID,
          custom_data = excluded.custom_data,
          short_code = excluded.short_code,
          owner_name = excluded.owner_name,
          owner_email = excluded.owner_email,
          owner_phone = excluded.owner_phone,
          auth_version = excluded.auth_version`,
  args: [sampleData],
})

await db.execute('DELETE FROM EntityAccessCodes')
await db.execute('DELETE FROM AdminLoginAttempts')

const credential = await db.execute('SELECT id FROM AdminCredentials WHERE id = 1')
if (!credential.rows.length) {
  const password = 'GadgetLocal2026!'
  const salt = randomBytes(16)
  const iterations = 210000
  const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex')
  await db.execute({
    sql: 'INSERT INTO AdminCredentials (id, password_hash, salt, iterations) VALUES (1, ?, ?, ?)',
    args: [hash, salt.toString('hex'), iterations],
  })
}

console.log('Base local lista en /tmp/gadgetdesign-local.db')
console.log('Entidad de prueba: http://localhost:5173/Local001')
console.log('Administrador local: GadgetLocal2026!')
console.log('Los códigos de acceso se mostrarán en la consola local.')
db.close()
