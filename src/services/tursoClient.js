import { createClient } from '@libsql/client/web'

const TURSO_URL = __TURSO_URL__
const TURSO_TOKEN = __TURSO_TOKEN__

let client

export function getTursoClient() {
  if (!TURSO_URL || !TURSO_TOKEN) {
    throw new Error('Faltan TURSO_URL o TURSO_TOKEN en las variables de entorno.')
  }

  client ??= createClient({
    url: TURSO_URL,
    authToken: TURSO_TOKEN,
  })

  return client
}
