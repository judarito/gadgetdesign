import { isReservedPath } from './routes'

const SHORT_CODE_LENGTH = 8
const SHORT_CODE_BYTES = 6
const MAX_GENERATION_ATTEMPTS = 16
const ALPHANUMERIC_EDGE = /^[A-Za-z0-9][\s\S]*[A-Za-z0-9]$/

/**
 * Código corto de 8 caracteres base64url.
 *
 * Se descartan los que empiezan o terminan en guion: el código se imprime en la
 * etiqueta del QR y un guion suelto se lee como un signo. También se descarta
 * cualquier código que ocupara una ruta reservada; hoy es imposible porque las
 * rutas reservadas son más cortas que el código, pero el guardia evita que un
 * nombre reservado futuro deje una ficha inalcanzable.
 */
export function generateShortCode() {
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const bytes = crypto.getRandomValues(new Uint8Array(SHORT_CODE_BYTES))
    const binary = String.fromCharCode(...bytes)
    const code = btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')
      .slice(0, SHORT_CODE_LENGTH)

    if (ALPHANUMERIC_EDGE.test(code) && !isReservedPath(code)) return code
  }

  throw new Error('No fue posible generar un código corto válido.')
}

export async function generateUniqueShortCode(db) {
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const code = generateShortCode()
    const duplicate = await db.execute({
      sql: `SELECT 1 FROM Entidades WHERE short_code = ?
            UNION ALL
            SELECT 1 FROM EntityAliases WHERE code = ?
            LIMIT 1`,
      args: [code, code],
    })

    if (duplicate.rows.length === 0) return code
  }

  throw new Error('No fue posible generar un código corto único.')
}

/**
 * Genera varios códigos cortos únicos de una vez, para la creación masiva.
 * Comprueba las colisiones del lote completo en una sola consulta en lugar de
 * una por ficha.
 */
export async function generateUniqueShortCodes(db, count) {
  const accepted = new Set()
  let rounds = 0

  while (accepted.size < count) {
    if (rounds++ > MAX_GENERATION_ATTEMPTS * 4) {
      throw new Error('No fue posible generar los códigos cortos únicos.')
    }

    const batch = []
    const seen = new Set(accepted)
    while (batch.length < count - accepted.size) {
      const code = generateShortCode()
      if (seen.has(code)) continue
      seen.add(code)
      batch.push(code)
    }

    const placeholders = batch.map(() => '?').join(', ')
    const taken = await db.execute({
      sql: `SELECT short_code AS code FROM Entidades WHERE short_code IN (${placeholders})
            UNION ALL
            SELECT code FROM EntityAliases WHERE code IN (${placeholders})`,
      args: [...batch, ...batch],
    })
    const takenCodes = new Set(taken.rows.map((row) => String(row.code)))

    for (const code of batch) {
      if (!takenCodes.has(code)) accepted.add(code)
    }
  }

  return [...accepted]
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value),
  )
}
