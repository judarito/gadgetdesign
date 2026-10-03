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

  const entityOtpMark = logs.length
  await request('entity', 'request-code', { method: 'POST', body: route })
  const code = await waitForOtp(entityOtpMark)
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
    sql: 'UPDATE Clientes SET email = ? WHERE id = 1',
    args: ['Cliente@Example.com'],
  }), 'La base debe exigir correos normalizados en los clientes.')
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

  const entityColumns = (await db.execute('PRAGMA table_info(Entidades)')).rows.map((row) => row.name)
  const legacyColumns = ['owner_name', 'owner_email', 'owner_phone'].filter((name) => entityColumns.includes(name))
  assert(legacyColumns.length === 0,
    `Las columnas heredadas del propietario ya no deben existir: ${legacyColumns.join(', ')}.`)
  assert(entityColumns.includes('clienteID'), 'La ficha debe apuntar a su cliente.')
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
  assert(entities.items[0].clientEmail === 'cliente@example.com', 'El administrador debe recibir los datos de contacto.')
  await expectStatus(() => request('admin', 'create-entity', {
    method: 'POST', cookie: adminCookie,
    body: { identification: 'local-001', categoryId: 1, clienteId: null },
  }), 409, 'No debe permitir identificaciones duplicadas.')

  // --- Modelo de clientes -------------------------------------------------
  const clients = await request('admin', 'clients', { cookie: adminCookie })
  assert(clients.items.length === 1 && clients.items[0].email === 'cliente@example.com',
    'El cliente creado por la migración desde owner_email debe aparecer en el listado.')
  assert(clients.items[0].entityCount === 1, 'El cliente debe mostrar cuántas fichas tiene.')

  await expectStatus(() => request('admin', 'delete-client', {
    method: 'DELETE', cookie: adminCookie, body: { id: 1 },
  }), 409, 'No debe eliminar un cliente que tenga fichas asignadas.')

  // Vía de compatibilidad: sin `clienteId`, un correo suelto crea el cliente.
  const implicit = await request('admin', 'create-entity', {
    method: 'POST', cookie: adminCookie,
    body: {
      identification: 'IMPLICITA-01',
      categoryId: 1,
      ownerName: 'Dueño Implícito',
      ownerEmail: 'implicito@example.com',
      ownerPhone: '+57 300 111 2233',
    },
  })
  assert(Number.isInteger(implicit.clienteId),
    'Un correo suelto debe crear el cliente y vincular la ficha.')
  const implicitClients = await request('admin', 'clients', {
    cookie: adminCookie, query: { search: 'implicito' },
  })
  assert(implicitClients.items.length === 1 && implicitClients.items[0].phone === '+57 300 111 2233',
    'El cliente creado por la vía de compatibilidad debe guardar el celular.')

  const newClient = await request('admin', 'save-client', {
    method: 'POST', cookie: adminCookie,
    body: { name: 'Finca El Paraíso', email: 'finca@example.com', phone: '+57 311 222 3344', active: true },
  })
  assert(Number.isInteger(newClient.id), 'Crear un cliente debe devolver su id.')

  await expectStatus(() => request('admin', 'save-client', {
    method: 'POST', cookie: adminCookie,
    body: { name: 'Duplicado', email: 'FINCA@example.com', active: true },
  }), 409, 'No debe permitir dos clientes con el mismo correo.')

  await request('admin', 'save-category', {
    method: 'POST', cookie: adminCookie, body: { name: 'Motos', code: 'MOTO', active: true },
  })

  // Una categoría con un código reservado dejaría su URL larga inalcanzable.
  await expectStatus(() => request('admin', 'save-category', {
    method: 'POST', cookie: adminCookie, body: { name: 'Reservada', code: 'ADMIN', active: true },
  }), 400, 'No debe permitir un código de categoría que ocupa una ruta reservada.')

  const categoryOptions = await request('admin', 'category-options', { cookie: adminCookie })
  const motoCategoryId = categoryOptions.find((category) => category.code === 'MOTO').id

  const bulk = await request('admin', 'bulk-create-entities', {
    method: 'POST', cookie: adminCookie,
    body: { categoryId: motoCategoryId, clienteId: newClient.id, prefix: 'MOTO-', from: 1, to: 3, pad: 3 },
  })
  assert(bulk.created === 3 && bulk.first === 'MOTO-001' && bulk.last === 'MOTO-003',
    'La creación masiva debe generar todo el rango.')

  await expectStatus(() => request('admin', 'bulk-create-entities', {
    method: 'POST', cookie: adminCookie,
    body: { categoryId: motoCategoryId, clienteId: newClient.id, prefix: 'MOTO-', from: 3, to: 5, pad: 3 },
  }), 409, 'La creación masiva debe abortar si el rango pisa identificaciones existentes.')

  const clientEntities = await request('admin', 'entities', {
    cookie: adminCookie, query: { clienteId: newClient.id, pageSize: 50 },
  })
  assert(clientEntities.total === 3, 'El filtro por cliente debe devolver solo sus fichas.')

  const single = await request('admin', 'create-entity', {
    method: 'POST', cookie: adminCookie,
    body: { identification: 'MOTO-010', categoryId: motoCategoryId, clienteId: newClient.id },
  })
  assert(typeof single.shortCode === 'string' && single.clienteId === newClient.id,
    'Crear una ficha desde el panel debe vincularla al cliente elegido.')

  const orphan = await request('admin', 'create-entity', {
    method: 'POST', cookie: adminCookie,
    body: { identification: 'SIN-DUENO-01', categoryId: motoCategoryId, clienteId: null },
  })
  const orphanContext = await request('entity', 'context', { query: { token: orphan.shortCode } })
  assert(!orphanContext.auth.canRequestCode && !orphanContext.auth.authorized,
    'Una ficha sin cliente debe quedar en solo lectura.')

  // Un PATCH que no menciona al cliente no debe dejarlo huérfano.
  const singleId = (await request('admin', 'entities', {
    cookie: adminCookie, query: { search: 'MOTO-010' },
  })).items[0].id
  await request('admin', 'update-entity', {
    method: 'PATCH', cookie: adminCookie,
    body: { id: singleId, identification: 'MOTO-010', categoryId: motoCategoryId },
  })
  const afterPartial = await request('admin', 'entities', {
    cookie: adminCookie, query: { search: 'MOTO-010' },
  })
  assert(afterPartial.items[0].clienteId === newClient.id,
    'Un PATCH sin clienteId no debe desvincular la ficha de su cliente.')

  const moto1 = clientEntities.items.find((item) => item.identification === 'MOTO-001')
  const moto2 = clientEntities.items.find((item) => item.identification === 'MOTO-002')

  // --- Portal del cliente -------------------------------------------------
  await expectStatus(() => request('client', 'context'), 401,
    'El portal debe exigir sesión para listar las fichas.')

  // Anti-enumeración: un correo desconocido responde igual y no envía nada.
  const unknownMark = logs.length
  const unknown = await request('client', 'request-code', {
    method: 'POST', body: { email: 'desconocido@example.com' },
  })
  assert(unknown.ok === true, 'Un correo desconocido debe responder igual que uno válido.')
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert(!logs.slice(unknownMark).includes('Código local para'),
    'Un correo desconocido no debe generar ningún envío.')

  const portalMark = logs.length
  await request('client', 'request-code', {
    method: 'POST', body: { email: 'finca@example.com' },
  })
  const portalCode = await waitForOtp(portalMark)

  await expectStatus(() => request('client', 'verify-code', {
    method: 'POST', body: { email: 'finca@example.com', code: '000000' },
  }), 400, 'Un código incorrecto debe rechazarse en el portal.')

  // Un código incorrecto, un correo sin código pendiente y un correo que no
  // existe deben responder exactamente igual: si no, el endpoint sirve para
  // averiguar qué direcciones están registradas.
  const wrongCode = await statusOf(() => request('client', 'verify-code', {
    method: 'POST', body: { email: 'finca@example.com', code: '000001' },
  }))
  const unknownEmail = await statusOf(() => request('client', 'verify-code', {
    method: 'POST', body: { email: 'desconocido@example.com', code: '000001' },
  }))
  assert(wrongCode.status === 400 && unknownEmail.status === 400
    && wrongCode.message === unknownEmail.message,
  'Un código incorrecto y un correo desconocido deben dar la misma respuesta.')

  const portalLogin = await request('client', 'verify-code', {
    method: 'POST', body: { email: 'finca@example.com', code: portalCode }, includeResponse: true,
  })
  const clientCookie = getCookieHeader(portalLogin.response)
  assert(clientCookie.startsWith('gd_client_session='),
    'El portal debe emitir su propia cookie de sesión.')
  assert(portalLogin.data.cliente.email === 'finca@example.com', 'El portal debe saludar al cliente.')
  assert(portalLogin.data.total === 4, 'El portal debe listar todas las fichas del cliente.')

  const noPending = await statusOf(() => request('client', 'verify-code', {
    method: 'POST', body: { email: 'finca@example.com', code: '000002' },
  }))
  assert(noPending.status === 400 && noPending.message === unknownEmail.message,
    'Un correo registrado sin código pendiente debe responder igual que uno desconocido.')

  // El límite por cliente no puede delatar el correo con un 429: se agota en
  // silencio y la respuesta sigue siendo la misma.
  for (let extra = 0; extra < 5; extra += 1) {
    const repeated = await request('client', 'request-code', {
      method: 'POST', body: { email: 'finca@example.com' },
    })
    assert(repeated.ok === true,
      'Agotar el límite por cliente no debe cambiar la respuesta de request-code.')
  }

  const portalContext = await request('client', 'context', {
    cookie: clientCookie, includeResponse: true,
  })
  assert(portalContext.data.total === 4, 'El listado del portal debe mantenerse con la sesión.')
  assert(portalContext.response.headers.get('netlify-cdn-cache-control') === 'no-store',
    'El listado del portal nunca debe cachearse en el CDN.')

  const portalSearch = await request('client', 'context', {
    cookie: clientCookie, query: { search: 'MOTO-002' },
  })
  assert(portalSearch.total === 1 && portalSearch.items[0].identificacion === 'MOTO-002',
    'El buscador del portal debe filtrar las fichas del cliente.')

  // La ficha se abre desbloqueada con la sesión del portal.
  const unlocked = await request('entity', 'context', {
    query: { token: moto1.shortCode }, cookie: clientCookie, includeResponse: true,
  })
  assert(unlocked.data.auth.authorized, 'Abrir una ficha desde el portal debe verla autorizada.')
  assert(unlocked.response.headers.get('netlify-cdn-cache-control') === 'no-store',
    'Una lectura con sesión de portal no debe servirse desde la caché pública.')

  // La sesión del portal cubre todas las fichas del cliente.
  const byClient1 = await request('entity', 'create-data', {
    method: 'POST', cookie: clientCookie,
    body: { token: moto1.shortCode, data: { key: 'Cilindraje', value: '150', dataType: 'number' } },
  })
  assert(byClient1.entity.customData.some((item) => item.key === 'Cilindraje'),
    'La sesión del cliente debe poder editar una de sus fichas.')
  const byClient2 = await request('entity', 'create-data', {
    method: 'POST', cookie: clientCookie,
    body: { token: moto2.shortCode, data: { key: 'Placa', value: 'ABC12D', dataType: 'text' } },
  })
  assert(byClient2.entity.customData.some((item) => item.key === 'Placa'),
    'La sesión del cliente debe alcanzar también sus otras fichas.')

  // Mínimo privilegio: ni la sesión de otra ficha ni la de otro cliente sirven.
  await expectStatus(() => request('entity', 'create-data', {
    method: 'POST', cookie: clientCookie,
    body: { token: 'Local001', data: { key: 'Intruso', value: 'No', dataType: 'text' } },
  }), 401, 'La sesión de un cliente no debe editar fichas de otro cliente.')

  await expectStatus(() => request('entity', 'create-data', {
    method: 'POST', cookie: entityCookie,
    body: { token: moto1.shortCode, data: { key: 'Intruso', value: 'No', dataType: 'text' } },
  }), 401, 'La sesión de una ficha no debe servir para otra ficha del mismo cliente.')

  // El portal administra los datos, pero no borra la ficha entera: eso destruye
  // también todos sus datos y exige haber entrado por el enlace de la ficha.
  await expectStatus(() => request('entity', 'delete-entity', {
    method: 'DELETE', cookie: clientCookie,
    body: { token: moto2.shortCode, confirmation: moto2.identification },
  }), 401, 'El portal no debe poder borrar la ficha entera.')
  const stillThere = await request('entity', 'context', { query: { token: moto2.shortCode } })
  assert(stillThere.entity?.identificacion === moto2.identification,
    'La ficha debe seguir existiendo tras el intento desde el portal.')

  // Cambiar el correo es cambiar la credencial: corta las sesiones abiertas.
  await request('admin', 'save-client', {
    method: 'POST', cookie: adminCookie,
    body: { id: newClient.id, name: 'Finca El Paraíso', email: 'nueva@example.com', phone: '', active: true },
  })
  await expectStatus(() => request('entity', 'create-data', {
    method: 'POST', cookie: clientCookie,
    body: { token: moto1.shortCode, data: { key: 'Tras cambio', value: 'No', dataType: 'text' } },
  }), 401, 'Cambiar el correo del cliente debe cortar sus sesiones.')
  await expectStatus(() => request('client', 'context', { cookie: clientCookie }), 401,
    'El portal debe cerrar la sesión cuando cambia el correo.')

  // Desactivar al cliente deja sus fichas en solo lectura, sin borrar nada.
  await request('admin', 'save-client', {
    method: 'POST', cookie: adminCookie,
    body: { id: newClient.id, name: 'Finca El Paraíso', email: 'nueva@example.com', active: false },
  })
  const deactivated = await request('entity', 'context', { query: { token: moto1.shortCode } })
  assert(!deactivated.auth.canRequestCode && !deactivated.auth.authorized,
    'Un cliente desactivado debe dejar sus fichas en solo lectura.')

  // --- Límites de la creación masiva -------------------------------------
  await expectStatus(() => request('admin', 'bulk-create-entities', {
    method: 'POST', cookie: adminCookie,
    body: { categoryId: motoCategoryId, clienteId: 1, prefix: 'X-', from: 1, to: 201, pad: 3 },
  }), 400, 'La creación masiva debe rechazar un rango mayor que el límite.')

  await expectStatus(() => request('admin', 'bulk-create-entities', {
    method: 'POST', cookie: adminCookie,
    body: {
      categoryId: motoCategoryId, clienteId: 1,
      prefix: 'X'.repeat(151), from: 1, to: 2, pad: 3,
    },
  }), 400, 'La creación masiva debe rechazar un prefijo demasiado largo.')

  // El lote grande ejercita la generación de códigos cortos en bloque, que es
  // el único camino que se comporta distinto a escala.
  const bigBulk = await request('admin', 'bulk-create-entities', {
    method: 'POST', cookie: adminCookie,
    body: { categoryId: motoCategoryId, clienteId: 1, prefix: 'LOTE-', from: 1, to: 100, pad: 3 },
  })
  assert(bigBulk.created === 100 && bigBulk.first === 'LOTE-001' && bigBulk.last === 'LOTE-100',
    'La creación masiva debe generar cien fichas de una vez.')

  const firstPage = await request('admin', 'entities', {
    cookie: adminCookie, query: { search: 'LOTE-', pageSize: 50, page: 1 },
  })
  const secondPage = await request('admin', 'entities', {
    cookie: adminCookie, query: { search: 'LOTE-', pageSize: 50, page: 2 },
  })
  const codes = new Set([...firstPage.items, ...secondPage.items].map((item) => item.shortCode))
  assert(firstPage.total === 100, 'Las cien fichas del lote deben existir y paginarse en dos páginas.')
  assert(codes.size === 100, 'Los cien códigos cortos deben ser únicos.')

  // El portal pagina de 50 en 50: un cliente con más fichas debe poder verlas
  // todas, no solo la primera página.
  const ownerMark = logs.length
  await request('client', 'request-code', { method: 'POST', body: { email: 'cliente@example.com' } })
  const ownerCode = await waitForOtp(ownerMark)
  const ownerLogin = await request('client', 'verify-code', {
    method: 'POST', body: { email: 'cliente@example.com', code: ownerCode }, includeResponse: true,
  })
  const ownerCookie = getCookieHeader(ownerLogin.response)
  const ownerPage1 = await request('client', 'context', { cookie: ownerCookie })
  const ownerPage2 = await request('client', 'context', { cookie: ownerCookie, query: { page: 2 } })
  const ownerPage3 = await request('client', 'context', { cookie: ownerCookie, query: { page: 3 } })
  assert(ownerPage1.total === 101 && ownerPage1.items.length === 50,
    'El portal debe paginar cuando el cliente tiene más de 50 fichas.')
  assert(ownerPage2.items.length === 50, 'La segunda página del portal debe traer las siguientes 50.')
  assert(ownerPage3.items.length === 1, 'La última página del portal debe traer el resto.')

  // Reactivar al cliente no debe devolver la validez a las sesiones ni a los
  // códigos que había antes de desactivarlo.
  await request('admin', 'save-client', {
    method: 'POST', cookie: adminCookie,
    body: { id: newClient.id, name: 'Finca El Paraíso', email: 'nueva@example.com', active: true },
  })
  await expectStatus(() => request('client', 'context', { cookie: clientCookie }), 401,
    'Reactivar al cliente no debe resucitar las sesiones anteriores.')

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
  console.log('✓ Cliente migrado desde owner_email y vinculación de fichas')
  console.log('✓ CRUD de clientes con correo único y borrado bloqueado')
  console.log('✓ Creación masiva por rango con detección de colisiones')
  console.log('✓ Autorización por pertenencia (sesión de cliente y de ficha)')
  console.log('✓ Revocación al cambiar el correo y solo lectura al desactivar')
  console.log('✓ Portal del cliente: OTP propio y listado de sus fichas')
  console.log('✓ Anti-enumeración en el portal (correo desconocido = misma respuesta)')
  console.log('✓ La ficha se abre desbloqueada con la sesión del portal')
  console.log('✓ La lectura con sesión de portal nunca se sirve desde la caché pública')
  console.log('✓ El portal pagina cuando el cliente tiene más de 50 fichas')
  console.log('✓ Los errores del portal no distinguen correos registrados')
  console.log('✓ El portal no borra la ficha entera; eso exige la sesión de la ficha')
  console.log('✓ Un PATCH parcial no desvincula la ficha de su cliente')
  console.log('✓ Reactivar un cliente no resucita sus sesiones anteriores')
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

async function waitForOtp(since = 0) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    // Solo lo registrado después de la petición: si no, devolvería el código de
    // una prueba anterior que sigue en el log.
    const match = logs.slice(since).match(/Código local para .*?: (\d{6})/)
    if (match) return match[1]
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`No se encontró el OTP en la consola.\n${logs.slice(-4000)}`)
}

/** Estado y mensaje de una peticion que puede fallar, sin lanzar. */
async function statusOf(callback) {
  try {
    await callback()
    return { status: 200, message: '' }
  } catch (error) {
    const match = String(error.message).match(/: (\d{3}) (.*)$/)
    return { status: Number(match?.[1] || 0), message: match?.[2] || String(error.message) }
  }
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
