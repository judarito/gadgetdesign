const SHORT_CODE_LENGTH = 8
const SHORT_CODE_BYTES = 6
const MAX_GENERATION_ATTEMPTS = 16

export function generateShortCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(SHORT_CODE_BYTES))
  const binary = String.fromCharCode(...bytes)

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
    .slice(0, SHORT_CODE_LENGTH)
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

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value),
  )
}
