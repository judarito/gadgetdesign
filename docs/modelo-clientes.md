# Modelo de clientes y portal del cliente

Estado: **fases 1, 2 y 3 implementadas** y verificadas en el entorno de
pruebas. Pendiente el despliegue a producción (ver README, migraciones).

## Problema

Hoy la propiedad está desnormalizada dentro de la entidad. `Entidades` guarda
`owner_name`, `owner_email`, `owner_phone` y su propio `auth_version`, y la
sesión que emite el OTP está amarrada a **una sola ficha**:

```js
// netlify/functions/_lib/security.mjs
Number(session.entityId) === Number(entity.id) &&
Number(session.authVersion) === Number(entity.authVersion)
```

Consecuencia: un cliente con una moto y una mascota son dos fichas sin ninguna
relación. No existe forma de preguntar "¿qué tiene este señor?", ni de darle un
lugar donde administrar todo lo suyo. Una finca con 100 vacas son 100 fichas
sueltas, cada una con su correo repetido.

El modelo de entidades **sí sirve**: cada vaca es una entidad en la categoría
`Vacas`. Lo que falta es que el dueño exista como concepto.

## Decisiones tomadas

| Pregunta | Decisión |
| --- | --- |
| Alcance del portal | El cliente **consulta y edita los datos** de sus fichas. No crea ni borra fichas. |
| OTP desde el QR público | **Sigue siendo de esa ficha**. Escanear el QR de una vaca no da acceso al rebaño. |
| Alta de clientes | **Solo el admin** desde el panel. El cliente nunca se autorregistra. |
| Creación de fichas | **Las dos vías**: una por una (actual) y masiva por rango desde el admin. |

---

## 1. Modelo de datos

```sql
CREATE TABLE IF NOT EXISTS Clientes (
  id            INTEGER PRIMARY KEY,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL,
  phone         TEXT,
  active        NUMERIC NOT NULL DEFAULT 1,
  auth_version  INTEGER NOT NULL DEFAULT 1,   -- un solo punto de revocación
  created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_email_normalized
  ON Clientes (LOWER(TRIM(email)));

CREATE TABLE IF NOT EXISTS ClientAccessCodes (
  id           INTEGER PRIMARY KEY,
  cliente_id   INTEGER NOT NULL,
  code_hash    TEXT    NOT NULL,
  expires_at   INTEGER NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  consumed     NUMERIC NOT NULL DEFAULT 0,
  request_ip   TEXT    NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_client_access_codes_lookup
  ON ClientAccessCodes (cliente_id, created_at);

-- La limpieza por antigüedad no usa el índice anterior (empieza por cliente_id)
CREATE INDEX IF NOT EXISTS idx_client_access_codes_created
  ON ClientAccessCodes (created_at);

ALTER TABLE Entidades ADD COLUMN clienteID INTEGER REFERENCES Clientes (id);
CREATE INDEX IF NOT EXISTS idx_entidades_cliente ON Entidades (clienteID);
```

Notas:

- `Entidades.clienteID` admite `NULL`: una ficha sin cliente se comporta como
  hoy (página pública en solo lectura).
- Las columnas `owner_*` **se conservan** durante la fase 1 y se eliminan en una
  fase posterior. Ver §2.
- Se añade también `idx_entity_access_codes_created` sobre
  `EntityAccessCodes (created_at)`, porque la limpieza
  `DELETE ... WHERE created_at < ?` no puede usar el índice existente
  `(entity_id, created_at)`.
- **Las foreign keys no están activas.** `netlify/functions/_lib/db.mjs` crea el
  cliente sin `PRAGMA foreign_keys = ON`, y SQLite las trae desactivadas. Por eso
  `deleteCurrentEntity` borra códigos y alias a mano. Con `clienteID` se sigue el
  mismo estilo del proyecto: validar con triggers, no confiar en la FK.

### Validación en la base

Siguiendo el patrón de `scripts/schemaConstraints.mjs`, se añaden los triggers
`validate_clientes_insert` y `validate_clientes_update` con las mismas reglas
que ya se aplican a `owner_email`:

- `name` no vacío, sin espacios extremos, sin caracteres invisibles, ≤ 100
- `email` no vacío, ya en minúsculas y sin espacios extremos, ≤ 254
- `phone` ≤ 30, sin espacios extremos
- `auth_version >= 1`

---

## 2. Migración

Aditiva e idempotente, al estilo de `scripts/setupAdmin.mjs`.

```sql
-- 1. Tablas e índices de §1

-- 2. Alta de clientes a partir de los dueños ya existentes.
--    Agrupa por correo normalizado. Para cada campo toma el valor NO VACÍO más
--    reciente de cualquier ficha del grupo, no el de la ficha más reciente:
--    si la última ficha creada tiene el nombre vacío, no debe pisar el que ya
--    había. Si no hay ningún nombre, usa la parte local del correo.
INSERT INTO Clientes (name, email, phone)
SELECT
  COALESCE(
    (SELECT NULLIF(TRIM(e2.owner_name), '')
       FROM Entidades e2
      WHERE LOWER(TRIM(e2.owner_email)) = LOWER(TRIM(e.owner_email))
        AND NULLIF(TRIM(e2.owner_name), '') IS NOT NULL
      ORDER BY e2.id DESC LIMIT 1),
    CASE WHEN instr(LOWER(TRIM(e.owner_email)), '@') > 1
         THEN substr(LOWER(TRIM(e.owner_email)), 1,
                     instr(LOWER(TRIM(e.owner_email)), '@') - 1)
         ELSE LOWER(TRIM(e.owner_email)) END
  ),
  LOWER(TRIM(e.owner_email)),
  (SELECT NULLIF(TRIM(e3.owner_phone), '')
     FROM Entidades e3
    WHERE LOWER(TRIM(e3.owner_email)) = LOWER(TRIM(e.owner_email))
      AND NULLIF(TRIM(e3.owner_phone), '') IS NOT NULL
    ORDER BY e3.id DESC LIMIT 1)
FROM Entidades e
WHERE e.owner_email IS NOT NULL
  AND TRIM(e.owner_email) <> ''
  -- una sola fila conductora por correo; los valores salen de los subconsultas
  AND e.id = (
    SELECT MIN(e4.id) FROM Entidades e4
    WHERE LOWER(TRIM(e4.owner_email)) = LOWER(TRIM(e.owner_email))
  )
  -- guarda de idempotencia
  AND NOT EXISTS (
    SELECT 1 FROM Clientes c
    WHERE LOWER(TRIM(c.email)) = LOWER(TRIM(e.owner_email))
  );

-- 3. Vincular las fichas existentes. Las que no tienen correo quedan en NULL
--    y siguen en solo lectura.
UPDATE Entidades
SET clienteID = (
  SELECT c.id FROM Clientes c
  WHERE LOWER(TRIM(c.email)) = LOWER(TRIM(Entidades.owner_email))
)
WHERE clienteID IS NULL
  AND owner_email IS NOT NULL
  AND TRIM(owner_email) <> '';
```

Este SQL está probado sobre una base desechable con un caso que rompe la
primera versión que escribí: tres fichas del mismo correo donde la **más
reciente** tiene el nombre y el celular vacíos.

```
EJECUCIÓN 1 -> clientes:
    {"id":1,"name":"Carlos Mendoza","email":"cliente@example.com","phone":"+57 300 111"}
    {"id":2,"name":"finca","email":"finca@ejemplo.com","phone":"+57 311 222"}

EJECUCIÓN 2 (idempotencia) -> clientes = 2 ✅

FICHAS VINCULADAS:
    MOTO-1      -> clienteID = 1
    MOTO-2      -> clienteID = 1
    MASCOTA-1   -> clienteID = 1
    VACA-1      -> clienteID = 2
    VACA-2      -> clienteID = 2
    SIN-DUENO   -> clienteID = NULL (solo lectura)
```

La versión ingenua (`e.id = MAX(e2.id)` con `COALESCE` directo) guardaba
`name: "cliente"` y perdía `+57 300 111`, porque leía solo la fila más reciente.
Verificado y descartada.

También está comprobado que `ALTER TABLE ... ADD COLUMN clienteID INTEGER
REFERENCES Clientes (id)` es aceptado por libSQL (SQLite solo lo permite si el
valor por defecto es `NULL`, que es el caso).

**Antes de aplicar** hay que ejecutar la comprobación de duplicados ya existente
en `assertNoNormalizedDuplicates`: dos fichas con el mismo correo pero distinto
nombre no son un error, pero sí lo sería un correo que colisione tras
normalizar. La migración aborta si detecta algo raro, no normaliza a ciegas.

### Orden de aplicación

1. Migración en la base de **pruebas** → pruebas funcionales.
2. Merge del PR → despliegue.
3. Migración en **producción**, y solo después el despliegue que la requiere.

Como la migración es puramente aditiva, aplicarla antes del despliegue no
molesta al código viejo que sigue corriendo.

### Compatibilidad y rollback

Durante la fase 1 el panel **escribe en las dos partes**: crea/actualiza el
cliente y sigue rellenando `owner_name/email/phone`. Así, si hay que revertir el
despliegue, el código anterior encuentra los datos donde los espera. En la fase 2
se deja de escribir `owner_*` y en la fase 3 se eliminan las columnas junto con
sus triggers y sus comprobaciones en `schemaConstraints.mjs`.

---

## 3. Autorización

`auth_version` se muda de `Entidades` a `Clientes`. Un solo interruptor: cambiar
el correo de un cliente o forzar el cierre invalida **todas** sus sesiones, en
todas sus fichas.

### Sesiones

| Cookie | Payload | Alcance |
| --- | --- | --- |
| `gd_entity_session` | `{type:'entity', entityId, clienteId, ver}` | Solo esa ficha |
| `gd_client_session` | `{type:'client', clienteId, ver}` | Todas las fichas del cliente |

`ver` es `Clientes.auth_version` en ambos casos.

### Autorización por pertenencia

`requireEntitySession` se sustituye por `requireEntityAccess(request, entity,
cliente)`, que acepta cualquiera de las dos sesiones:

```
sesión de cliente  &&  sesión.clienteId === cliente.id  &&  sesión.ver === cliente.auth_version
sesión de entidad  &&  sesión.entityId  === entity.id
                   &&  sesión.clienteId === cliente.id  &&  sesión.ver === cliente.auth_version
```

Sobre una ficha concreta las dos sesiones dan los mismos permisos. La diferencia
es el **alcance**: la sesión de entidad no sirve para las demás fichas. Si en el
futuro el portal gana poderes que la página pública no tiene (crear fichas), esos
poderes se reservan a la sesión de cliente.

`canRequestCode` pasa de `Boolean(entity.ownerEmail)` a `Boolean(cliente)`.

---

## 4. API

### Nuevo: `netlify/functions/client.mjs`

| Acción | Método | Sesión | Respuesta |
| --- | --- | --- | --- |
| `context` | GET | cliente | `{cliente:{name}, entities:[...], categories:[...]}` |
| `request-code` | POST | — | `{ok:true}` **siempre** |
| `verify-code` | POST | — | contexto + cookie `gd_client_session` |
| `logout` | POST | — | `{ok:true}` + borra la cookie |

### Modificado: `netlify/functions/entity.mjs`

- `getContext` autoriza con `requireEntityAccess` y acepta la sesión de cliente.
- `request-code` resuelve el correo a través del cliente.
- `logout` borra **las dos** cookies: hoy solo borra la de entidad, así que un
  usuario del portal que pulse "Salir" en la ficha seguiría con sesión abierta.
- Las mutaciones (`create-data`, `update-data`, `delete-data`) **no cambian de
  forma**: el portal las llama con el `token`/`shortCode` de cada ficha, que ya
  tiene en su listado. No hacen falta endpoints nuevos.

### Modificado: `netlify/functions/admin.mjs`

| Acción nueva | Descripción |
| --- | --- |
| `clients` | Listado paginado con nº de fichas por cliente |
| `client-options` | Listado simple para el selector del formulario |
| `save-client` | Alta y edición (nombre, correo, celular, activo) |
| `delete-client` | Solo si no tiene fichas (409 en caso contrario) |
| `bulk-create-entities` | Creación masiva por rango |

Cambios en las existentes:

- `create-entity` / `update-entity`: reciben `clienteId` en lugar de los tres
  campos `owner*`.
- `entities`: filtra por `clienteId` y la búsqueda pasa a incluir el nombre y el
  correo del cliente (JOIN con `Clientes`).
- Al cambiar el correo de un cliente, `auth_version = auth_version + 1` y se
  borran sus `ClientAccessCodes`. Es el equivalente del `emailChanged` actual,
  pero a nivel de cliente.

### Creación masiva

```
POST admin?action=bulk-create-entities
{ categoriaID, clienteId, prefix: "VACA-", from: 1, to: 100, pad: 3 }
```

- Identificación resultante: `VACA-001` … `VACA-100`.
- Límite por lote (p. ej. 200) para no agotar el tiempo de la Function.
- **Se validan las colisiones antes de insertar**: una sola consulta comprueba
  todas las identificaciones del rango y, si alguna existe, se aborta indicando
  cuáles. No se inserta nada a medias.
- Los `short_code` se generan en memoria y se comprueban en bloque, en lugar de
  una consulta por ficha como hace `generateUniqueShortCode`.
- La inserción va en un único `db.batch(..., 'write')`.

---

## 5. Caché: un detalle que rompe el portal si se olvida

La lectura pública se cachea 60 s en el CDN y la variación se declara así:

```js
// netlify/functions/_lib/cache.mjs
const CACHEABLE_CONTEXT_VARY = `query=action|categoryCode|token,cookie=${ENTITY_SESSION_COOKIE}`
```

Y en `entity.mjs`:

```js
const isAnonymous = !getCookie(request, ENTITY_COOKIE)
```

Si se añade la sesión de cliente y **no** se actualizan estas dos líneas, un
cliente que entre desde el portal recibirá la respuesta **anónima cacheada**: verá
sus datos protegidos enmascarados y creerá que el portal no funciona. Hay que
añadir `gd_client_session` a la variación y a la comprobación de anonimato.

---

## 6. Interfaz

### Panel de administración

- **Vista nueva "Clientes"**: tabla con nombre, correo, celular, nº de fichas y
  estado; alta, edición y borrado, con la misma paginación que las demás.
- **Diálogo de entidad**: los tres campos de propietario se sustituyen por un
  selector de cliente con una opción "＋ Nuevo cliente" en línea, para no salir
  del formulario.
- **Filtro por cliente** en la vista de entidades, y la búsqueda incluye su
  nombre y correo.
- **Diálogo de creación masiva**: categoría, cliente, prefijo, rango, tamaño de
  relleno, vista previa de la primera y la última identificación, y el total.

### Portal del cliente (nuevo `ClientApp.vue`)

```
/portal → escribe tu correo → OTP → tus fichas agrupadas por categoría

  🏍 Motos      ABC-12E   · 1/10 datos · [Abrir] [QR] [Copiar enlace]
  🐕 Mascotas   FIRU-01   · 3/10 datos · [Abrir] [QR] [Copiar enlace]
  🐄 Vacas      VACA-042  · 2/10 datos · [Abrir] [QR] [Copiar enlace]
```

**La edición ocurre en la página de la ficha, no en el portal.** Como la sesión
de cliente ya autoriza esa ficha, al abrir `/VACA-042` la página pública aparece
desbloqueada y con su editor completo. El portal es el índice; no se duplica el
editor de datos de `App.vue` (que son ~120 líneas de plantilla más su lógica).

Esto mantiene la fase 2 pequeña. Si más adelante se quiere editar sin salir del
portal, el paso natural es extraer el editor a un componente compartido
(`EntityDataPanel.vue`) y usarlo en los dos sitios; es un refactor, no un
requisito.

---

## 7. Rutas reservadas

`main.js` decide por `pathname`:

```js
const isAdminRoute = window.location.pathname.replace(/\/+$/, '') === '/admin'
```

Hay que generalizarlo a una lista y añadir `/portal`:

```
/admin  → AdminApp.vue
/portal → ClientApp.vue
resto   → App.vue  (un segmento = código corto)
```

Dos arreglos que conviene hacer de paso:

- `/admin/cualquier-cosa` hoy cae en `App.vue` e intenta resolver una ficha con
  categoría `admin`. Debe dar un 404 de la aplicación.
- `generateUniqueShortCode` debe rechazar las palabras reservadas, para que
  ninguna ficha pueda ocupar `/portal`. Con 8 caracteres aleatorios es
  prácticamente imposible, pero el guardia cuesta una línea.

---

## 8. Seguridad

- **Anti-enumeración en el portal.** `request-code` responde `{ok:true}` siempre,
  exista o no el correo, y **no** devuelve la pista enmascarada. Hoy
  `entity.mjs` responde 404 si no encuentra la entidad y 409 si no tiene correo,
  lo cual en un endpoint que recibe un email es un oráculo para descubrir
  clientes. Se corrige en el portal y se documenta por qué el de la ficha sí
  puede seguir devolviendo 404.
- **Mínimo privilegio.** La sesión del QR es de una ficha; la del portal es del
  cliente. Ver §3.
- **Límites de uso.** Mismos topes que hoy, adaptados: 5 códigos por cliente y 10
  por IP cada 15 minutos, OTP de 10 minutos, 5 intentos por código.
- **Revocación.** `Clientes.auth_version` corta todas las sesiones de un cliente.
  Además, `active = 0` deja sus fichas en solo lectura sin borrar nada.
- **Borrado.** Un cliente con fichas no se elimina (409); se desactiva.

---

## 9. Plan de pruebas

Se amplía `scripts/testFunctions.mjs`, que hoy cubre 9 casos:

- Alta de cliente y asignación a dos fichas de categorías distintas.
- OTP de cliente → el contexto lista sus dos fichas.
- Con sesión de cliente se editan datos de **ambas** fichas.
- Con sesión de cliente **no** se pueden editar fichas de otro cliente.
- Con sesión de entidad **no** se puede editar otra ficha del mismo cliente.
- `request-code` con correo inexistente responde 200 (anti-enumeración).
- Cambiar el correo del cliente incrementa `auth_version` y las sesiones previas
  dejan de servir.
- Borrar un cliente con fichas devuelve 409.
- Un cliente con `active = 0` deja sus fichas en solo lectura.
- Creación masiva: 100 fichas, identificaciones y códigos cortos únicos, y un
  rango con colisiones que no inserta nada.
- Lectura desde el portal **no** recibe la respuesta anónima cacheada (§5).

---

## 10. Fases

| Fase | Contenido | Riesgo |
| --- | --- | --- |
| **1** | Tabla `Clientes` + migración + triggers + CRUD en el panel + selector en la ficha + creación masiva + autorización por pertenencia. La página pública no cambia de aspecto | Bajo, aditivo |
| **2** | `/portal`: OTP de cliente, listado agrupado, enlaces a las fichas desbloqueadas, arreglo de caché y de rutas reservadas | Medio |
| **3** | Dejar de escribir `owner_*`, eliminar sus columnas, triggers y comprobaciones | Medio |

Cada fase es un PR por el circuito `dev` → `main`.

## 11. Riesgos

| Riesgo | Mitigación |
| --- | --- |
| La migración agrupa mal a dos dueños distintos con el mismo correo | Es el comportamiento deseado: el correo identifica al cliente. Se revisa el listado de clientes resultante antes de desplegar |
| El despliegue va antes que la migración | La migración es aditiva; se aplica antes. El código nuevo falla claro si falta la tabla |
| Un cliente con muchas fichas ralentiza el portal | Paginación en `context` desde el principio |
| Duplicar el editor de datos en el portal | No se duplica: el portal enlaza a la ficha (§6) |
