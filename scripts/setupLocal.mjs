import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { createClient } from '@libsql/client'
import { loadEnv } from 'vite'
import { applyDataIntegrityConstraints } from './schemaConstraints.mjs'

const env = loadEnv('', process.cwd(), '')
const url = env.LOCAL_TURSO_URL || 'file:/tmp/gadgetdesign-local.db'

const host = String(url).split('//')[1]?.split('.')[0] || String(url)
console.log(`Base de datos destino: ${host}`)

// Este script BORRA todas las tablas operativas antes de sembrar los datos de
// prueba, y ahora se ejecuta en cada build: `verify:deploy` llama a `test:functions`,
// que empieza por `setup:local`. Si alguien copiara `LOCAL_TURSO_URL` a las
// variables de un sitio de Netlify, cada despliegue vaciaría esa base. La
// comprobación va antes de crear el cliente, así que en ese caso ni se conecta.
const esDestinoDesechable = String(url).startsWith('file:')

if (!esDestinoDesechable && process.env.CONFIRM_DESTRUCTIVE !== 'si') {
  console.error('')
  console.error(`  Esta base NO es un archivo local: ${host}`)
  console.error('  Este comando BORRA todas las fichas, clientes y categorías antes')
  console.error('  de sembrar los datos de prueba, y se ejecuta en cada build.')
  console.error('  Si de verdad quieres vaciarla, repítelo así:')
  console.error('')
  console.error('    CONFIRM_DESTRUCTIVE=si npm run setup:local')
  console.error('')
  process.exit(1)
}

const db = createClient({ url })

await db.batch([
  `CREATE TABLE IF NOT EXISTS Categorias (
    id INTEGER PRIMARY KEY,
    name TEXT(50) NOT NULL,
    active NUMERIC NOT NULL DEFAULT 1,
    code TEXT(20) UNIQUE NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS Clientes (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    active NUMERIC NOT NULL DEFAULT 1,
    auth_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS Entidades (
    id INTEGER PRIMARY KEY,
    Identificacion TEXT(200) NOT NULL,
    token TEXT(40) NOT NULL,
    categoriaID INTEGER NOT NULL,
    custom_data TEXT NOT NULL DEFAULT '[]',
    short_code TEXT UNIQUE,
    auth_version INTEGER NOT NULL DEFAULT 1,
    clienteID INTEGER REFERENCES Clientes (id),
    FOREIGN KEY (categoriaID) REFERENCES Categorias (id)
  )`,
  `CREATE TABLE IF NOT EXISTS ClientAccessCodes (
    id INTEGER PRIMARY KEY,
    cliente_id INTEGER NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    consumed NUMERIC NOT NULL DEFAULT 0,
    request_ip TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (cliente_id) REFERENCES Clientes (id) ON DELETE CASCADE
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
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_email_normalized ON Clientes (LOWER(TRIM(email)))',
  'CREATE INDEX IF NOT EXISTS idx_entidades_cliente ON Entidades (clienteID)',
  'CREATE INDEX IF NOT EXISTS idx_client_access_codes_lookup ON ClientAccessCodes (cliente_id, created_at)',
  `CREATE TABLE IF NOT EXISTS ClientOtpRequests (
    id INTEGER PRIMARY KEY,
    request_ip TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_client_otp_requests_ip ON ClientOtpRequests (request_ip, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_client_access_codes_created ON ClientAccessCodes (created_at)',
  'CREATE INDEX IF NOT EXISTS idx_entity_access_codes_created ON EntityAccessCodes (created_at)',
], 'write')

// La base local puede venir de una versión anterior sin la columna.
const localEntityColumns = await db.execute('PRAGMA table_info(Entidades)')
if (!localEntityColumns.rows.some((column) => column.name === 'clienteID')) {
  await db.execute('ALTER TABLE Entidades ADD COLUMN clienteID INTEGER REFERENCES Clientes (id)')
}

// La base local es un entorno de pruebas desechable, así que se vacía antes de
// sembrar los datos: el resultado debe ser siempre el mismo para que la suite
// de integración pueda ejecutarse dos veces seguidas sin chocar con lo que
// dejó la ejecución anterior.
await db.batch([
  'DELETE FROM EntityAccessCodes',
  'DELETE FROM ClientAccessCodes',
  'DELETE FROM ClientOtpRequests',
  'DELETE FROM EntityAliases',
  'DELETE FROM Entidades',
  'DELETE FROM CategoriaSugerencias',
  'DELETE FROM Clientes',
  'DELETE FROM Categorias',
  'DELETE FROM AdminLoginAttempts',
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

// Cliente de prueba: es el dueño de la ficha local.
await db.execute(`INSERT INTO Clientes (id, name, email, phone, active, auth_version)
                  VALUES (1, 'Cliente Local', 'cliente@example.com', '+57 300 000 0000', 1, 1)
                  ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    email = excluded.email,
                    phone = excluded.phone,
                    active = excluded.active`)

const sampleData = JSON.stringify([
  { id: 'local-public', key: 'Color', value: 'Azul', dataType: 'text', protected: false },
  { id: 'local-protected', key: 'Número de póliza', value: 'POL-123456', dataType: 'text', protected: true },
])
await db.execute({
  sql: `INSERT INTO Entidades
        (id, Identificacion, token, categoriaID, custom_data, short_code, auth_version, clienteID)
        VALUES (1, 'LOCAL-001', '11111111-1111-4111-8111-111111111111', 1, ?,
                'Local001', 1, 1)
        ON CONFLICT(id) DO UPDATE SET
          Identificacion = excluded.Identificacion,
          token = excluded.token,
          categoriaID = excluded.categoriaID,
          custom_data = excluded.custom_data,
          short_code = excluded.short_code,
          auth_version = excluded.auth_version,
          clienteID = excluded.clienteID`,
  args: [sampleData],
})

await applyDataIntegrityConstraints(db)

// La base local puede venir de antes con las columnas heredadas. Se eliminan
// aquí para que el entorno de pruebas refleje el esquema objetivo: si el código
// volviera a necesitarlas, las pruebas fallarían.
const legacyColumns = ['owner_name', 'owner_email', 'owner_phone']
for (const name of legacyColumns) {
  const info = await db.execute('PRAGMA table_info(Entidades)')
  if (info.rows.some((column) => column.name === name)) {
    await db.execute(`ALTER TABLE Entidades DROP COLUMN ${name}`)
  }
}

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
