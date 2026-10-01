import { createClient } from '@libsql/client'

let client

export function getDb() {
  const useLocalDatabase = process.env.CONTEXT !== 'production' && process.env.LOCAL_TURSO_URL
  const url = useLocalDatabase ? process.env.LOCAL_TURSO_URL : process.env.TURSO_URL
  const authToken = useLocalDatabase ? undefined : process.env.TURSO_TOKEN

  if (!url || (!useLocalDatabase && !authToken)) {
    throw new Error('Faltan las credenciales privadas de Turso.')
  }

  client ??= createClient({
    url,
    authToken,
  })

  return client
}
