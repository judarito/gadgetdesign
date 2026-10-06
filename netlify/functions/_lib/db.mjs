import { createClient } from '@libsql/client'

let client

export function getDb() {
  // El archivo local se usa cuando LOCAL_TURSO_URL está definida.
  //
  // La condición anterior era `process.env.CONTEXT !== 'production'`, pero
  // CONTEXT no existe en este runtime de Functions: era siempre verdadera, así
  // que en la práctica decidía solo LOCAL_TURSO_URL. Se deja explícito porque el
  // riesgo no es teórico: si alguien copia `.env.example` tal cual en las
  // variables de un sitio de Netlify, las Functions usarían un archivo efímero
  // en lugar de Turso y la aplicación parecería haber perdido todos los datos.
  // Los dos sitios están comprobados y no la tienen configurada.
  const useLocalDatabase = Boolean(process.env.LOCAL_TURSO_URL)
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
