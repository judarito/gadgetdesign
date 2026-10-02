import { spawn } from 'node:child_process'
import { createClient } from '@libsql/client'
import { loadEnv } from 'vite'
import { applyDataIntegrityConstraints } from './schemaConstraints.mjs'

const env = loadEnv('', process.cwd(), '')
const server = spawn('npm', ['run', 'dev'], {
  cwd: process.cwd(),
  env: { ...process.env, XDG_CONFIG_HOME: '/tmp/netlify-config' },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
})

let logs = ''
server.stdout.on('data', (chunk) => {
  logs += chunk.toString()
  process.stdout.write(chunk)
})
server.stderr.on('data', (chunk) => {
  logs += chunk.toString()
  process.stderr.write(chunk)
})
server.on('error', (error) => { logs += `\n${error.stack}\n` })

try {
  await waitForServer()
  const route = { token: 'Local001' }

  const publicResult = await request('entity', 'context', { query: route, includeResponse: true })
  const publicContext = publicResult.data
  assert(publicContext.entity.identificacion === 'LOCAL-001', 'Debe cargar la entidad local.')
  const protectedItem = publicContext.entity.customData.find((item) => item.id === 'local-protected')
  assert(protectedItem.masked && protectedItem.value === '', 'El dato protegido debe llegar enmascarado.')
  assert(!('encryptedValue' in protectedItem), 'La API pública no debe exponer el texto cifrado.')
  assert(!publicContext.auth.authorized, 'La sesión pública no debe estar autorizada.')
  assert(publicResult.response.headers.get('cache-control') === 'no-store',
    'El navegador no debe almacenar la lectura pública.')
  const publicCdnCache = publicResult.response.headers.get('netlify-cdn-cache-control') || ''
  assert(publicCdnCache.includes('public') && publicCdnCache.includes('durable') && publicCdnCache.includes('s-maxage=60'),
    'La lectura pública debe usar caché durable de 60 segundos.')
  assert(!publicCdnCache.includes('stale-while-revalidate'),
    'La lectura pública no debe servir contenido vencido mientras revalida.')
  assert(publicResult.response.headers.get('netlify-cache-tag') === 'entity-1,category-1',
    'La lectura pública debe etiquetarse por entidad y categoría.')

  await expectStatus(() => request('entity', 'create-data', {
    method: 'POST', body: { ...route, data: { key: 'Sin permiso', value: 'No', dataType: 'text' } },
  }), 401, 'El CRUD público debe exigir autorización.')
  await expectStatus(() => request('entity', 'context', { query: { token: "' OR 1=1 --" } }), 400,
    'Una ruta inválida debe rechazarse sin ejecutar SQL.')

  await request('entity', 'request-code', { method: 'POST', body: route })
  const code = await waitForOtp()
  assert(/^\d{6}$/.test(code), 'Debe generarse un OTP de seis dígitos.')

  const verification = await request('entity', 'verify-code', {
    method: 'POST', body: { ...route, code }, includeResponse: true,
  })
  const entityCookie = getCookieHeader(verification.response)
  assert(entityCookie, 'La verificación debe crear una cookie HttpOnly.')
  assert(verification.data.auth.authorized, 'La respuesta debe quedar autorizada.')
  const revealed = verification.data.entity.customData.find((item) => item.id === 'local-protected')
  assert(revealed.value === 'POL-123456', 'El dato protegido debe revelarse después del OTP.')
  const authorizedContext = await request('entity', 'context', {
    query: route, cookie: entityCookie, includeResponse: true,
  })
  assert(authorizedContext.data.auth.authorized, 'La consulta con cookie debe conservar la autorización.')
  assert(authorizedContext.response.headers.get('netlify-cdn-cache-control') === 'no-store',
    'Una lectura autorizada nunca debe almacenarse en el CDN.')
  assert(!authorizedContext.response.headers.get('netlify-cache-tag'),
    'Una lectura autorizada no debe registrar etiquetas de caché.')

  const created = await request('entity', 'create-data', {
    method: 'POST', cookie: entityCookie,
    body: { ...route, data: { key: 'Dato secreto de prueba', value: 'VALOR-SENSIBLE', dataType: 'text', protected: true } },
  })
  const createdItem = created.entity.customData.find((item) => item.key === 'Dato secreto de prueba')
  assert(createdItem?.value === 'VALOR-SENSIBLE', 'El CRUD autorizado debe devolver el valor protegido.')

  const db = createClient({ url: env.LOCAL_TURSO_URL })
  const stored = await db.execute("SELECT custom_data FROM Entidades WHERE short_code = 'Local001'")
  assert(!String(stored.rows[0].custom_data).includes('VALOR-SENSIBLE'), 'El valor protegido no debe guardarse en texto plano.')

  await db.execute('DROP TRIGGER validate_categories_update')
  await db.execute({ sql: 'UPDATE Categorias SET name = ? WHERE id = 1', args: ['Vehículos\t'] })
  await applyDataIntegrityConstraints(db)
  const normalizedCategory = await db.execute('SELECT name, code FROM Categorias WHERE id = 1')
  assert(normalizedCategory.rows[0].name === 'Vehículos' && normalizedCategory.rows[0].code === 'VEH',
    'La migración debe conservar categorías normalizadas.')
  await expectDbFailure(() => db.execute({
    sql: `INSERT INTO Entidades
          (id, Identificacion, token, categoriaID, custom_data, short_code, auth_version)
          VALUES (99, ?, ?, 1, '[]', ?, 1)`,
    args: ['local-001', '22222222-2222-4222-8222-222222222222', 'Unique99'],
  }), 'La base debe impedir identificaciones duplicadas sin distinguir mayúsculas.')
  await expectDbFailure(() => db.execute({
    sql: 'UPDATE Categorias SET name = ? WHERE id = 1',
    args: ['Vehículos\t'],
  }), 'La base debe rechazar espacios invisibles en categorías.')
  await expectDbFailure(() => db.execute({
    sql: `INSERT INTO CategoriaSugerencias
          (categoriaID, name, active, sort_order, data_type) VALUES (1, ?, 1, 99, 'text')`,
    args: ['Dato\u200Binvisible'],
  }), 'La base debe rechazar caracteres invisibles en sugerencias.')
  await expectDbFailure(() => db.execute({
    sql: 'UPDATE Entidades SET owner_email = ? WHERE id = 1',
    args: ['Cliente@Example.com'],
  }), 'La base debe exigir correos normalizados.')
  await expectDbFailure(() => db.execute({
    sql: 'UPDATE Entidades SET Identificacion = ? WHERE id = 1',
    args: ['X'.repeat(201)],
  }), 'La base debe verificar las longitudes aunque se omita la Function.')
  await expectDbFailure(() => db.execute({
    sql: `INSERT INTO Entidades
          (id, Identificacion, token, categoriaID, custom_data, short_code, auth_version)
          VALUES (100, 'OTRA-ENTIDAD', ?, 1, '[]', 'Unique10', 1)`,
    args: ['11111111-1111-4111-8111-111111111111'],
  }), 'La base debe impedir tokens duplicados.')
  await expectDbFailure(() => db.execute({
    sql: `INSERT INTO Entidades
          (id, Identificacion, token, categoriaID, custom_data, short_code, auth_version)
          VALUES (101, 'RUTA-CRUZADA', 'Local001', 1, '[]', 'Unique11', 1)`,
    args: [],
  }), 'La base debe impedir que un token coincida con otro código corto.')

  await request('entity', 'update-data', {
    method: 'PATCH', cookie: entityCookie,
    body: { ...route, itemId: createdItem.id, data: { key: 'Dato secreto de prueba', value: 'VALOR-NUEVO', dataType: 'text', protected: true } },
  })
  const afterDelete = await request('entity', 'delete-data', {
    method: 'DELETE', cookie: entityCookie, body: { ...route, itemId: createdItem.id },
  })
  assert(!afterDelete.entity.customData.some((item) => item.id === createdItem.id), 'El dato de prueba debe eliminarse.')
  await expectStatus(() => request('entity', 'delete-data', {
    method: 'DELETE', cookie: entityCookie, body: { ...route, itemId: createdItem.id },
  }), 404, 'Eliminar un dato inexistente debe informar el conflicto.')
  db.close()

  const adminSession = await request('admin', 'session')
  assert(!adminSession.authenticated, 'El administrador debe iniciar sin sesión.')
  await expectStatus(() => request('admin', 'category-options'), 401,
    'Las operaciones administrativas deben exigir una sesión.')
  await expectStatus(() => request('admin', 'login', {
    method: 'POST', body: { password: 'ContraseñaIncorrecta!' },
  }), 401, 'Una contraseña incorrecta debe rechazarse.')
  const login = await request('admin', 'login', {
    method: 'POST', body: { password: 'GadgetLocal2026!' }, includeResponse: true,
  })
  const adminCookie = getCookieHeader(login.response)
  assert(adminCookie, 'El login administrativo debe crear una cookie segura.')
  const entities = await request('admin', 'entities', { cookie: adminCookie })
  assert(entities.items[0].ownerEmail === 'cliente@example.com', 'El administrador debe recibir los datos de contacto.')
  await expectStatus(() => request('admin', 'create-entity', {
    method: 'POST', cookie: adminCookie,
    body: { identification: 'local-001', categoryId: 1, ownerName: '', ownerEmail: '', ownerPhone: '' },
  }), 409, 'No debe permitir identificaciones duplicadas.')

  await expectStatus(() => request('entity', 'delete-entity', {
    method: 'DELETE', cookie: entityCookie,
    body: { ...route, confirmation: 'IDENTIFICADOR INCORRECTO' },
  }), 400, 'La eliminación completa debe exigir el identificador exacto.')
  const deletedEntity = await request('entity', 'delete-entity', {
    method: 'DELETE', cookie: entityCookie,
    body: { ...route, confirmation: 'LOCAL-001' }, includeResponse: true,
  })
  assert(deletedEntity.data.ok, 'La eliminación completa debe confirmar el resultado.')
  assert(deletedEntity.response.headers.get('set-cookie')?.includes('Max-Age=0'),
    'La eliminación completa debe cerrar la sesión de la entidad.')
  const missingEntity = await request('entity', 'context', { query: route })
  assert(!missingEntity.entity, 'La entidad eliminada no debe volver a consultarse.')

  console.log('✓ Lectura pública enmascarada')
  console.log('✓ Caché público durable y sesiones con no-store')
  console.log('✓ OTP local y cookie HttpOnly')
  console.log('✓ Revelado autorizado')
  console.log('✓ Cifrado AES-GCM en almacenamiento')
  console.log('✓ CRUD protegido')
  console.log('✓ Restricciones de integridad aplicadas directamente en la base')
  console.log('✓ Confirmaciones y eliminación completa transaccional')
  console.log('✓ Sesión administrativa serverless')
} finally {
  try {
    process.kill(-server.pid, 'SIGTERM')
  } catch {
    server.kill('SIGTERM')
  }
  await new Promise((resolve) => setTimeout(resolve, 500))
}

async function request(endpoint, action, options = {}) {
  const url = new URL(`http://localhost:5173/.netlify/functions/${endpoint}`)
  url.searchParams.set('action', action)
  for (const [key, value] of Object.entries(options.query || {})) url.searchParams.set(key, value)
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(10_000),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(`${endpoint}/${action}: ${response.status} ${data.error}`)
  return options.includeResponse ? { data, response } : data
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch('http://localhost:5173/.netlify/functions/admin?action=session', {
        signal: AbortSignal.timeout(1000),
      })
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`El entorno local no inició.\n${logs.slice(-4000)}`)
}

async function waitForOtp() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const match = logs.match(/Código local para .*?: (\d{6})/)
    if (match) return match[1]
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`No se encontró el OTP en la consola.\n${logs.slice(-4000)}`)
}

function getCookieHeader(response) {
  return response.headers.get('set-cookie')?.split(';')[0] || ''
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function expectStatus(callback, status, message) {
  try {
    await callback()
  } catch (error) {
    if (String(error.message).includes(`: ${status} `)) return
    throw error
  }
  throw new Error(message)
}

async function expectDbFailure(callback, message) {
  try {
    await callback()
  } catch {
    return
  }
  throw new Error(message)
}
