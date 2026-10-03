import { createClient } from '@libsql/client'
import { loadEnv } from 'vite'
import { applyDataIntegrityConstraints } from './schemaConstraints.mjs'

/**
 * Elimina las columnas heredadas owner_name, owner_email y owner_phone.
 *
 * Va aparte de `setup:admin` a propósito: `setup:admin` es aditivo e idempotente
 * y se puede ejecutar con el código anterior todavía en producción, mientras que
 * esto es destructivo y solo tiene sentido cuando ya corre el código que lee y
 * escribe el dueño en `Clientes`.
 */

const env = loadEnv('', process.cwd(), '')
const url = env.TURSO_URL || env.VITE_TURSO_URL
const authToken = env.TURSO_TOKEN || env.VITE_TURSO_TOKEN

if (!url || !authToken) {
  throw new Error('Faltan TURSO_URL o TURSO_TOKEN en .env.')
}

const host = String(url).split('//')[1]?.split('.')[0] || String(url)
console.log(`Base de datos destino: ${host}`)

// Este script borra columnas de forma irreversible. Si el destino no es
// claramente de pruebas, hay que decirlo a propósito: así un despiste al
// exportar las variables —que es la única protección que había hasta ahora— no
// se lleva por delante las columnas que el código en producción todavía lee.
const esDestinoDePruebas = String(url).startsWith('file:') || host.includes('-dev')

if (!esDestinoDePruebas && process.env.CONFIRM_DESTRUCTIVE !== 'si') {
  console.error('')
  console.error(`  Esta base NO parece de pruebas: ${host}`)
  console.error('  Este comando elimina owner_name, owner_email y owner_phone.')
  console.error('  Si es lo que quieres, repítelo así:')
  console.error('')
  console.error('    CONFIRM_DESTRUCTIVE=si npm run setup:drop-legacy')
  console.error('')
  process.exit(1)
}

const LEGACY_COLUMNS = ['owner_name', 'owner_email', 'owner_phone']

const db = createClient({ url, authToken })

const columns = await db.execute('PRAGMA table_info(Entidades)')
const present = LEGACY_COLUMNS.filter((name) => columns.rows.some((column) => column.name === name))

if (!present.length) {
  console.log('No quedan columnas heredadas. Nada que eliminar.')
  db.close()
  process.exit(0)
}

// Antes de borrar nada: si alguna ficha tiene correo heredado pero no quedó
// vinculada a un cliente, eliminar la columna perdería a su dueño.
//
// La consulta se condiciona a que `owner_email` siga existiendo para que el
// script se pueda reanudar: si un intento anterior murió después de borrarla,
// volver a ejecutarlo debe poder terminar el trabajo en vez de fallar con
// "no such column".
if (present.includes('owner_email')) {
  const pending = await db.execute(`SELECT COUNT(*) AS total FROM Entidades
    WHERE clienteID IS NULL
      AND owner_email IS NOT NULL
      AND TRIM(owner_email) <> ''`)

  const orphans = Number(pending.rows[0]?.total || 0)
  if (orphans) {
    throw new Error(
      `Hay ${orphans} fichas con correo heredado y sin cliente vinculado. ` +
      'Ejecuta antes "npm run setup:admin" para crear los clientes.',
    )
  }
}

// SQLite bloquea DROP COLUMN si algún trigger nombra la columna, así que los
// triggers se recrean primero con su definición actual, que ya no las usa.
await applyDataIntegrityConstraints(db)

for (const name of present) {
  await db.execute(`ALTER TABLE Entidades DROP COLUMN ${name}`)
  console.log(`Columna eliminada: ${name}`)
}

const remaining = (await db.execute('PRAGMA table_info(Entidades)')).rows.map((row) => row.name)
console.log(`Columnas de Entidades: ${remaining.join(', ')}`)
console.log('Listo. El dueño de cada ficha vive ahora en Clientes.')

db.close()
