const cleanText = (column) => `TRIM(
  REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    ${column},
    CHAR(9), ' '), CHAR(10), ' '), CHAR(13), ' '), CHAR(160), ' '),
    CHAR(8203), ''), CHAR(8204), ''), CHAR(8205), ''), CHAR(8288), ''), CHAR(65279), '')
)`

const invisibleCheck = (column) => [9, 10, 13, 160, 8203, 8204, 8205, 8288, 65279]
  .map((code) => `INSTR(${column}, CHAR(${code})) > 0`)
  .join(' OR ')

const managedTriggerNames = [
  'validate_categories_insert',
  'validate_categories_update',
  'validate_suggestions_insert',
  'validate_suggestions_update',
  'validate_entities_insert',
  'validate_entities_update',
  'validate_aliases_insert',
  'validate_aliases_update',
  'validate_clientes_insert',
  'validate_clientes_update',
  'validate_entity_route_insert',
  'validate_entity_route_update',
  'validate_alias_route_insert',
  'validate_alias_route_update',
]

export async function applyDataIntegrityConstraints(db) {
  await assertNoNormalizedDuplicates(db)
  await normalizeExistingData(db)
  await assertExistingDataIsValid(db)
  await createUniqueIndexes(db)
  await createValidationTriggers(db)
}

async function assertNoNormalizedDuplicates(db) {
  await assertNoDuplicates(
    db,
    `SELECT LOWER(${cleanText('Identificacion')}) AS normalized, GROUP_CONCAT(id) AS ids
     FROM Entidades
     GROUP BY LOWER(${cleanText('Identificacion')})
     HAVING COUNT(*) > 1
     LIMIT 1`,
    'identificaciones',
  )
  await assertNoDuplicates(
    db,
    `SELECT ${cleanText('token')} AS normalized, GROUP_CONCAT(id) AS ids
     FROM Entidades
     GROUP BY ${cleanText('token')}
     HAVING COUNT(*) > 1
     LIMIT 1`,
    'tokens',
  )
  await assertNoDuplicates(
    db,
    `SELECT ${cleanText('short_code')} AS normalized, GROUP_CONCAT(id) AS ids
     FROM Entidades
     WHERE short_code IS NOT NULL AND ${cleanText('short_code')} <> ''
     GROUP BY ${cleanText('short_code')}
     HAVING COUNT(*) > 1
     LIMIT 1`,
    'códigos cortos',
  )
  await assertNoDuplicates(
    db,
    `SELECT ${cleanText('code')} AS normalized, GROUP_CONCAT(id) AS ids
     FROM EntityAliases
     GROUP BY ${cleanText('code')}
     HAVING COUNT(*) > 1
     LIMIT 1`,
    'alias',
  )
  await assertNoDuplicates(
    db,
    `SELECT UPPER(${cleanText('code')}) AS normalized, GROUP_CONCAT(id) AS ids
     FROM Categorias
     GROUP BY UPPER(${cleanText('code')})
     HAVING COUNT(*) > 1
     LIMIT 1`,
    'códigos de categoría',
  )
  await assertNoDuplicates(
    db,
    `SELECT categoriaID || ':' || LOWER(${cleanText('name')}) AS normalized,
            GROUP_CONCAT(id) AS ids
     FROM CategoriaSugerencias
     GROUP BY categoriaID, LOWER(${cleanText('name')})
     HAVING COUNT(*) > 1
     LIMIT 1`,
    'sugerencias de una misma categoría',
  )
  await assertNoDuplicates(
    db,
    `SELECT LOWER(${cleanText('email')}) AS normalized, GROUP_CONCAT(id) AS ids
     FROM Clientes
     GROUP BY LOWER(${cleanText('email')})
     HAVING COUNT(*) > 1
     LIMIT 1`,
    'correos de clientes',
  )

  const routeCollision = await db.execute(`
    SELECT e.id AS entity_id, a.id AS alias_id
    FROM Entidades e
    INNER JOIN EntityAliases a
      ON ${cleanText('a.code')} = ${cleanText('e.token')}
      OR ${cleanText('a.code')} = ${cleanText('e.short_code')}
    LIMIT 1
  `)
  if (routeCollision.rows[0]) {
    throw new Error(
      `La migración encontró una ruta duplicada entre la entidad ${routeCollision.rows[0].entity_id} ` +
      `y el alias ${routeCollision.rows[0].alias_id}. Corrígela antes de continuar.`,
    )
  }

  const entityRouteCollision = await db.execute(`
    SELECT token_entity.id AS token_entity_id, short_entity.id AS short_entity_id
    FROM Entidades token_entity
    INNER JOIN Entidades short_entity
      ON ${cleanText('token_entity.token')} = ${cleanText('short_entity.short_code')}
    LIMIT 1
  `)
  if (entityRouteCollision.rows[0]) {
    throw new Error(
      `La migración encontró un token de la entidad ${entityRouteCollision.rows[0].token_entity_id} ` +
      `que coincide con el código corto de la entidad ${entityRouteCollision.rows[0].short_entity_id}.`,
    )
  }
}

async function assertNoDuplicates(db, sql, label) {
  const result = await db.execute(sql)
  const duplicate = result.rows[0]
  if (!duplicate) return

  throw new Error(
    `La migración encontró ${label} duplicados después de normalizar: ` +
    `"${duplicate.normalized}" en los IDs ${duplicate.ids}. Corrige esos registros antes de continuar.`,
  )
}

async function normalizeExistingData(db) {
  await db.batch([
    `UPDATE Categorias
     SET name = ${cleanText('name')}, code = UPPER(${cleanText('code')})`,
    `UPDATE CategoriaSugerencias
     SET name = ${cleanText('name')}, data_type = LOWER(${cleanText('data_type')})`,
    `UPDATE Entidades
     SET Identificacion = ${cleanText('Identificacion')},
         token = ${cleanText('token')},
         short_code = CASE WHEN short_code IS NULL THEN NULL ELSE ${cleanText('short_code')} END,
         owner_name = CASE WHEN owner_name IS NULL THEN NULL ELSE ${cleanText('owner_name')} END,
         owner_email = CASE WHEN owner_email IS NULL THEN NULL ELSE LOWER(${cleanText('owner_email')}) END,
         owner_phone = CASE WHEN owner_phone IS NULL THEN NULL ELSE ${cleanText('owner_phone')} END`,
    `UPDATE EntityAliases SET code = ${cleanText('code')}`,
    `UPDATE Clientes
     SET name = ${cleanText('name')},
         email = LOWER(${cleanText('email')}),
         phone = CASE WHEN phone IS NULL THEN NULL ELSE ${cleanText('phone')} END`,
  ], 'write')
}

async function assertExistingDataIsValid(db) {
  const checks = [
    {
      sql: `SELECT id FROM Categorias
            WHERE name = '' OR LENGTH(name) > 50 OR code = '' OR LENGTH(code) > 20
               OR code GLOB '*[^A-Z0-9_-]*' LIMIT 1`,
      message: 'Hay una categoría vacía, demasiado larga o con un código inválido.',
    },
    {
      sql: `SELECT id FROM CategoriaSugerencias
            WHERE name = '' OR LENGTH(name) > 50 OR sort_order < 0 OR sort_order > 9999
               OR data_type NOT IN ('text', 'date', 'number', 'email', 'tel', 'url') LIMIT 1`,
      message: 'Hay una sugerencia con nombre, orden o tipo inválido.',
    },
    {
      sql: `SELECT id FROM Entidades
            WHERE Identificacion = '' OR LENGTH(Identificacion) > 200
               OR token = '' OR LENGTH(token) > 40 OR token GLOB '*[^A-Za-z0-9_-]*'
               OR (short_code IS NOT NULL AND (short_code = '' OR LENGTH(short_code) > 8 OR short_code GLOB '*[^A-Za-z0-9_-]*'))
               OR LENGTH(COALESCE(owner_name, '')) > 100
               OR LENGTH(COALESCE(owner_email, '')) > 254
               OR LENGTH(COALESCE(owner_phone, '')) > 30
               OR LENGTH(COALESCE(custom_data, '')) > 5000
               OR auth_version < 1 LIMIT 1`,
      message: 'Hay una entidad con campos vacíos, demasiado largos o inválidos.',
    },
    {
      sql: `SELECT id FROM EntityAliases
            WHERE code = '' OR LENGTH(code) > 40 OR code GLOB '*[^A-Za-z0-9_-]*' LIMIT 1`,
      message: 'Hay un alias vacío, demasiado largo o inválido.',
    },
    {
      sql: `SELECT id FROM Clientes
            WHERE name = '' OR LENGTH(name) > 100
               OR email = '' OR LENGTH(email) > 254
               OR LENGTH(COALESCE(phone, '')) > 30
               OR auth_version < 1 LIMIT 1`,
      message: 'Hay un cliente con nombre, correo o celular inválido.',
    },
    {
      // Las foreign keys de SQLite vienen desactivadas, así que la integridad
      // de clienteID se comprueba aquí y con los triggers.
      sql: `SELECT e.id FROM Entidades e
            WHERE e.clienteID IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM Clientes c WHERE c.id = e.clienteID)
            LIMIT 1`,
      message: 'Hay una entidad apuntando a un cliente que no existe.',
    },
  ]

  for (const check of checks) {
    const result = await db.execute(check.sql)
    if (result.rows[0]) throw new Error(`${check.message} Registro ID ${result.rows[0].id}.`)
  }
}

async function createUniqueIndexes(db) {
  await db.batch([
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_entidades_identification_normalized
     ON Entidades (LOWER(TRIM(Identificacion)))`,
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_entidades_token ON Entidades (token)',
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_entidades_short_code
     ON Entidades (short_code) WHERE short_code IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_suggestions_name_normalized
     ON CategoriaSugerencias (categoriaID, LOWER(TRIM(name)))`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_email_normalized
     ON Clientes (LOWER(TRIM(email)))`,
  ], 'write')
}

async function createValidationTriggers(db) {
  const categoryValidation = `
    NEW.name IS NULL OR NEW.name = '' OR NEW.name <> TRIM(NEW.name) OR LENGTH(NEW.name) > 50
    OR ${invisibleCheck('NEW.name')}
    OR NEW.code IS NULL OR NEW.code = '' OR NEW.code <> UPPER(TRIM(NEW.code))
    OR LENGTH(NEW.code) > 20 OR NEW.code GLOB '*[^A-Z0-9_-]*'
    OR ${invisibleCheck('NEW.code')}`
  const suggestionValidation = `
    NEW.name IS NULL OR NEW.name = '' OR NEW.name <> TRIM(NEW.name) OR LENGTH(NEW.name) > 50
    OR ${invisibleCheck('NEW.name')}
    OR NEW.sort_order < 0 OR NEW.sort_order > 9999
    OR NEW.data_type NOT IN ('text', 'date', 'number', 'email', 'tel', 'url')`
  const entityValidation = `
    NEW.Identificacion IS NULL OR NEW.Identificacion = ''
    OR NEW.Identificacion <> TRIM(NEW.Identificacion) OR LENGTH(NEW.Identificacion) > 200
    OR ${invisibleCheck('NEW.Identificacion')}
    OR NEW.token IS NULL OR NEW.token = '' OR NEW.token <> TRIM(NEW.token)
    OR LENGTH(NEW.token) > 40 OR NEW.token GLOB '*[^A-Za-z0-9_-]*'
    OR (NEW.short_code IS NOT NULL AND (
      NEW.short_code = '' OR NEW.short_code <> TRIM(NEW.short_code)
      OR LENGTH(NEW.short_code) > 8 OR NEW.short_code GLOB '*[^A-Za-z0-9_-]*'
    ))
    OR LENGTH(COALESCE(NEW.owner_name, '')) > 100
    OR (NEW.owner_name IS NOT NULL AND NEW.owner_name <> TRIM(NEW.owner_name))
    OR LENGTH(COALESCE(NEW.owner_email, '')) > 254
    OR (NEW.owner_email IS NOT NULL AND NEW.owner_email <> LOWER(TRIM(NEW.owner_email)))
    OR LENGTH(COALESCE(NEW.owner_phone, '')) > 30
    OR (NEW.owner_phone IS NOT NULL AND NEW.owner_phone <> TRIM(NEW.owner_phone))
    OR LENGTH(COALESCE(NEW.custom_data, '')) > 5000
    OR NEW.auth_version < 1`
  const aliasValidation = `
    NEW.code IS NULL OR NEW.code = '' OR NEW.code <> TRIM(NEW.code)
    OR LENGTH(NEW.code) > 40 OR NEW.code GLOB '*[^A-Za-z0-9_-]*'`
  const clientValidation = `
    NEW.name IS NULL OR NEW.name = '' OR NEW.name <> TRIM(NEW.name) OR LENGTH(NEW.name) > 100
    OR ${invisibleCheck('NEW.name')}
    OR NEW.email IS NULL OR NEW.email = '' OR NEW.email <> LOWER(TRIM(NEW.email))
    OR LENGTH(NEW.email) > 254
    OR LENGTH(COALESCE(NEW.phone, '')) > 30
    OR (NEW.phone IS NOT NULL AND NEW.phone <> TRIM(NEW.phone))
    OR NEW.auth_version < 1`

  await db.batch([
    ...managedTriggerNames.map((name) => `DROP TRIGGER IF EXISTS ${name}`),
    validationTrigger('validate_categories_insert', 'Categorias', 'INSERT', categoryValidation, 'Categoría inválida o sin normalizar.'),
    validationTrigger('validate_categories_update', 'Categorias', 'UPDATE', categoryValidation, 'Categoría inválida o sin normalizar.'),
    validationTrigger('validate_suggestions_insert', 'CategoriaSugerencias', 'INSERT', suggestionValidation, 'Sugerencia inválida o sin normalizar.'),
    validationTrigger('validate_suggestions_update', 'CategoriaSugerencias', 'UPDATE', suggestionValidation, 'Sugerencia inválida o sin normalizar.'),
    validationTrigger('validate_entities_insert', 'Entidades', 'INSERT', entityValidation, 'Entidad inválida o sin normalizar.'),
    validationTrigger('validate_entities_update', 'Entidades', 'UPDATE', entityValidation, 'Entidad inválida o sin normalizar.'),
    validationTrigger('validate_aliases_insert', 'EntityAliases', 'INSERT', aliasValidation, 'Alias inválido o sin normalizar.'),
    validationTrigger('validate_aliases_update', 'EntityAliases', 'UPDATE', aliasValidation, 'Alias inválido o sin normalizar.'),
    validationTrigger('validate_clientes_insert', 'Clientes', 'INSERT', clientValidation, 'Cliente inválido o sin normalizar.'),
    validationTrigger('validate_clientes_update', 'Clientes', 'UPDATE', clientValidation, 'Cliente inválido o sin normalizar.'),
    collisionTrigger('validate_entity_route_insert', 'INSERT'),
    collisionTrigger('validate_entity_route_update', 'UPDATE'),
    aliasCollisionTrigger('validate_alias_route_insert', 'INSERT'),
    aliasCollisionTrigger('validate_alias_route_update', 'UPDATE'),
  ], 'write')
}

function validationTrigger(name, table, operation, condition, message) {
  return `CREATE TRIGGER IF NOT EXISTS ${name}
          BEFORE ${operation} ON ${table}
          WHEN ${condition}
          BEGIN
            SELECT RAISE(ABORT, '${message}');
          END`
}

function collisionTrigger(name, operation) {
  return `CREATE TRIGGER IF NOT EXISTS ${name}
          BEFORE ${operation} ON Entidades
          WHEN NEW.token = NEW.short_code
            OR EXISTS (
              SELECT 1 FROM EntityAliases
              WHERE code = NEW.token OR (NEW.short_code IS NOT NULL AND code = NEW.short_code)
            )
            OR EXISTS (
              SELECT 1 FROM Entidades
              WHERE id <> COALESCE(NEW.id, -1)
                AND (short_code = NEW.token OR (NEW.short_code IS NOT NULL AND token = NEW.short_code))
            )
          BEGIN
            SELECT RAISE(ABORT, 'El token o código corto ya existe en otra ruta.');
          END`
}

function aliasCollisionTrigger(name, operation) {
  return `CREATE TRIGGER IF NOT EXISTS ${name}
          BEFORE ${operation} ON EntityAliases
          WHEN EXISTS (
            SELECT 1 FROM Entidades WHERE token = NEW.code OR short_code = NEW.code
          )
          BEGIN
            SELECT RAISE(ABORT, 'El alias ya existe como token o código corto.');
          END`
}
