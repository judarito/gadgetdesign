import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { createClient } from '@libsql/client'
import { loadEnv } from 'vite'
import { applyDataIntegrityConstraints, cleanText } from './schemaConstraints.mjs'

const env = loadEnv('', process.cwd(), '')
const url = env.TURSO_URL || env.VITE_TURSO_URL
const authToken = env.TURSO_TOKEN || env.VITE_TURSO_TOKEN

if (!url || !authToken) {
  throw new Error('Faltan TURSO_URL o TURSO_TOKEN en .env.')
}

// Este script es aditivo e idempotente, pero apuntarlo a la base equivocada
// sigue siendo un error caro: se ejecutó una vez creyendo que probaba en local y
// se aplicó a producción. Imprimir el destino no basta, así que hacia una base
// que no parece de pruebas hay que nombrarla a propósito.
const host = String(url).split('//')[1]?.split('.')[0] || String(url)
console.log(`Base de datos destino: ${host}`)

const esDestinoDePruebas = String(url).startsWith('file:') || host.includes('-dev')

if (!esDestinoDePruebas && process.env.CONFIRM_TARGET !== host) {
  console.error('')
  console.error(`  Esta base no parece de pruebas: ${host}`)
  console.error('  Si es la que quieres, nómbrala para que no se dé por supuesto:')
  console.error('')
  console.error(`    CONFIRM_TARGET=${host} npm run setup:admin`)
  console.error('')
  process.exit(1)
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

// owner_name/owner_email/owner_phone ya no se crean: el dueño vive en Clientes.
// Las bases que vienen de antes conservan esas columnas hasta que se ejecute
// `npm run setup:drop-legacy`.
const hasLegacyOwnerColumns = entityColumns.rows.some((column) => column.name === 'owner_email')

// auth_version sigue existiendo como columna histórica: la sesión ya no se
// revoca por ficha, pero la columna es NOT NULL y los triggers la validan.
if (!entityColumns.rows.some((column) => column.name === 'auth_version')) {
  await db.execute('ALTER TABLE Entidades ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1')
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

await db.execute(`CREATE TABLE IF NOT EXISTS Clientes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  active NUMERIC NOT NULL DEFAULT 1,
  auth_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`)

await db.execute(`CREATE TABLE IF NOT EXISTS ClientAccessCodes (
  id INTEGER PRIMARY KEY,
  cliente_id INTEGER NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed NUMERIC NOT NULL DEFAULT 0,
  request_ip TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CONSTRAINT constraint_ClientAccessCodes_Cliente
    FOREIGN KEY (cliente_id) REFERENCES Clientes (id) ON DELETE CASCADE
)`)

await db.execute(
  'CREATE INDEX IF NOT EXISTS idx_client_access_codes_lookup ON ClientAccessCodes (cliente_id, created_at)',
)
await db.execute(
  'CREATE INDEX IF NOT EXISTS idx_client_access_codes_created ON ClientAccessCodes (created_at)',
)

await db.execute(`CREATE TABLE IF NOT EXISTS ClientOtpRequests (
  id INTEGER PRIMARY KEY,
  request_ip TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`)

await db.execute(
  'CREATE INDEX IF NOT EXISTS idx_client_otp_requests_ip ON ClientOtpRequests (request_ip, created_at)',
)


// La limpieza por antigüedad no puede usar los índices que empiezan por id.
await db.execute(
  'CREATE INDEX IF NOT EXISTS idx_entity_access_codes_created ON EntityAccessCodes (created_at)',
)

if (!entityColumns.rows.some((column) => column.name === 'clienteID')) {
  await db.execute('ALTER TABLE Entidades ADD COLUMN clienteID INTEGER REFERENCES Clientes (id)')
}

await db.execute('CREATE INDEX IF NOT EXISTS idx_entidades_cliente ON Entidades (clienteID)')

// El estado de la ficha: lo que decide si se ve en público. El valor por defecto
// es `activa` para que migrar no cambie lo que ya se veía.
if (!entityColumns.rows.some((column) => column.name === 'status')) {
  await db.execute("ALTER TABLE Entidades ADD COLUMN status TEXT NOT NULL DEFAULT 'activa'")
}

await db.execute('CREATE INDEX IF NOT EXISTS idx_entidades_status ON Entidades (status)')

// Alta de clientes a partir de los dueños ya existentes. Solo aplica a bases
// que todavía tienen las columnas heredadas; en una base nueva no hay nada que
// migrar y esas columnas ya no se crean.
if (hasLegacyOwnerColumns) {
  // Agrupa por correo normalizado y, para cada campo, toma el valor NO VACÍO
  // más reciente de cualquier ficha del grupo: la última ficha creada puede
  // tener el nombre vacío y no debe pisar el que ya había.
  await db.execute(`INSERT INTO Clientes (name, email, phone)
SELECT
  substr(COALESCE(
    (SELECT NULLIF(TRIM(e2.owner_name), '')
       FROM Entidades e2
      WHERE LOWER(${cleanText('e2.owner_email')}) = LOWER(${cleanText('e.owner_email')})
        AND NULLIF(TRIM(e2.owner_name), '') IS NOT NULL
      ORDER BY e2.id DESC LIMIT 1),
    CASE WHEN instr(LOWER(${cleanText('e.owner_email')}), '@') > 1
         THEN substr(LOWER(${cleanText('e.owner_email')}), 1,
                     instr(LOWER(${cleanText('e.owner_email')}), '@') - 1)
         ELSE LOWER(${cleanText('e.owner_email')}) END
  ), 1, 100),
  LOWER(${cleanText('e.owner_email')}),
  (SELECT NULLIF(TRIM(e3.owner_phone), '')
     FROM Entidades e3
    WHERE LOWER(${cleanText('e3.owner_email')}) = LOWER(${cleanText('e.owner_email')})
      AND NULLIF(TRIM(e3.owner_phone), '') IS NOT NULL
    ORDER BY e3.id DESC LIMIT 1)
FROM Entidades e
WHERE e.owner_email IS NOT NULL
  AND TRIM(e.owner_email) <> ''
  -- Un correo que tras normalizar lleva un espacio dentro no es un correo
  -- valido: la app lo rechazaria siempre y ese cliente no podria entrar nunca.
  -- Se deja sin cliente para que el guardia de setup:drop-legacy lo reporte.
  AND INSTR(${cleanText('e.owner_email')}, ' ') = 0
  AND e.id = (
    SELECT MIN(e4.id) FROM Entidades e4
    WHERE LOWER(${cleanText('e4.owner_email')}) = LOWER(${cleanText('e.owner_email')})
  )
  AND NOT EXISTS (
    SELECT 1 FROM Clientes c
    WHERE LOWER(${cleanText('c.email')}) = LOWER(${cleanText('e.owner_email')})
  )`)

  // Vincula cada ficha con su cliente. Las fichas sin correo quedan en NULL y
  // siguen en modo solo lectura.
  await db.execute(`UPDATE Entidades
SET clienteID = (
  SELECT c.id FROM Clientes c
  WHERE LOWER(${cleanText('c.email')}) = LOWER(${cleanText('Entidades.owner_email')})
)
WHERE clienteID IS NULL
  AND owner_email IS NOT NULL
  AND TRIM(owner_email) <> ''
  AND INSTR(${cleanText('Entidades.owner_email')}, ' ') = 0`)
}

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
