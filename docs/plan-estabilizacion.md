# Plan de estabilizacion y pendientes

Este documento sirve como lista de control para cerrar los pendientes detectados
antes de fusionar cambios a `main` y desplegar en produccion.

## Reglas de ejecucion

- Trabajar en `dev`.
- No ejecutar comandos destructivos contra produccion sin confirmar el destino.
- Marcar una casilla solo despues de completar su criterio de aceptacion.
- Registrar la evidencia y el commit al terminar cada bloque.
- No fusionar a `main` mientras falle la validacion local o alguna prueba critica.

## Estado rapido

- [ ] Bloque 0: preparar y validar el entorno local.
- [x] Bloque 1: corregir y cubrir la ejecucion local de Netlify Functions.
- [x] Bloque 2: cerrar el portal del cliente y la creacion de fichas pendientes.
- [x] Bloque 3: definir y aplicar el comportamiento de clientes/categorias inactivos.
- [x] Bloque 4: retirar las columnas heredadas de propietario.
- [ ] Bloque 5: cerrar riesgos de seguridad y consistencia.
- [ ] Bloque 6: validar, revisar y preparar el PR.
- [ ] Bloque 7: migrar produccion y fusionar manualmente.

## Bloque 0: preparar el entorno

- [x] Confirmar rama y remoto:

  ```sh
  git branch --show-current
  git status --short
  git fetch origin
  git log --oneline --decorate -5
  ```

  La rama actual es `dev` y el remoto es `origin`. `git fetch origin` queda
  pendiente porque este entorno no permite escribir `.git/FETCH_HEAD`.

- [x] Confirmar que la base local se usa antes de probar:

  ```sh
  npm run setup:local
  ```

- [x] Revisar que `.env` no contenga credenciales de produccion para las pruebas
  locales.

**Aceptacion:** se trabaja en `dev`, la base de prueba es local y el estado del
repositorio queda entendido antes de modificar codigo. El bloque queda abierto
hasta poder actualizar la referencia remota con `git fetch origin`.

## Bloque 1: hacer reproducible la validacion local

- [x] Diagnosticar el bloqueo del puerto `9999` al iniciar
  `netlify functions:serve`.
- [x] Confirmar que no existe otro proceso ocupando el puerto.
- [x] Si el entorno lo requiere, permitir una variable de puerto local, por
  ejemplo `NETLIFY_FUNCTIONS_PORT`, y usarla tanto en `scripts/devLocal.mjs`
  como en `scripts/testFunctions.mjs`.
- [x] Ejecutar:

  ```sh
  npm run test:functions
  npm run build
  ```

- [x] Ejecutar `npm run test:deploy-smoke` y confirmar que usa la respuesta local
  esperada.

**Aceptacion:** las Functions arrancan localmente, la suite termina con exito y
el build genera `dist/` sin errores. Verificado el 2026-10-09 con
`NETLIFY_FUNCTIONS_PORT=10099 npm run test:functions`, `npm run build` y
`npm run test:deploy-smoke`.

## Bloque 2: portal y fichas pendientes

- [x] Implementar en el portal el formulario para crear una ficha.
- [x] Validar que la categoria exista y este activa.
- [x] Validar que la sesion solo pueda crear fichas para su propio cliente.
- [x] Crear la ficha con estado `pendiente`.
- [x] Aplicar los limites documentados: 50 fichas totales y 5 pendientes por
  cliente.
- [x] Mostrar en el portal que la ficha esta pendiente y no es publica.
- [x] Mostrarla en el panel dentro del filtro de pendientes.
- [x] Permitir aprobarla o descartarla desde el panel.
- [x] Mantener el mismo `short_code` al aprobarla.
- [x] Agregar pruebas de Function para autorizacion, limites, colisiones y
  transiciones de estado.
- [x] Agregar una prueba E2E que cree una ficha desde el portal, la apruebe y
  la consulte publicamente.

**Aceptacion:** un cliente puede proponer una ficha, el administrador puede
aprobarla y solo una ficha aprobada se publica.

Backend, integracion y formulario verificadas el 2026-10-09 con
`NETLIFY_FUNCTIONS_PORT=10099 npm run test:functions`. Queda pendiente una
prueba E2E contra el sitio remoto despues del siguiente deploy; el E2E local
paso en desktop y viewport movil de 390 px.

## Bloque 3: clientes y categorias inactivos

Decidir y documentar una sola regla. Recomendacion: una ficha solo es publica si
su estado es `activa`, su cliente esta activo y su categoria esta activa.

- [x] Confirmar la regla con el equipo: una ficha es pública solo si la ficha,
  el cliente y la categoría están activos.
- [x] Aplicarla en la consulta publica, no solo en el frontend.
- [x] Mantener el acceso administrativo a la ficha para poder reactivarla.
- [x] Purga de cache al activar o desactivar cliente, categoria o ficha.
- [x] Agregar pruebas para las combinaciones de estado.
- [ ] Actualizar `docs/fichas-cliente.md` con la decision final.

**Aceptacion:** ninguna ficha inactiva por su propio estado, cliente o categoria
se muestra publicamente; al reactivar las condiciones vuelve a funcionar el QR.

Verificado el 2026-10-09 con la suite de Functions y el build. El propietario
autorizado conserva acceso administrativo a la ficha aunque no sea publica.

## Bloque 4: retirar columnas heredadas

- [x] Ejecutar primero la migracion aditiva en la base de pruebas:

  ```sh
  set -a && . ./.env.dev.local && set +a
  npm run setup:admin
  ```

- [x] Revisar que todas las fichas con propietario tengan `clienteID` valido.
- [x] Ejecutar la suite completa contra la base de pruebas.
- [x] Ejecutar el borrado destructivo solo en pruebas:

  ```sh
  CONFIRM_DESTRUCTIVE=si npm run setup:drop-legacy
  ```

- [x] Confirmar que ninguna Function o interfaz dependa de `owner_name`,
  `owner_email` u `owner_phone`.
- [x] Actualizar la documentacion para reflejar que la eliminacion fue hecha.

**Aceptacion:** las columnas heredadas no existen, el portal, el panel y el CRUD
siguen funcionando y la suite pasa con el esquema final.

Verificado en local y en `gadgetdesign-dev` el 2026-10-09. La migración
aditiva y `setup:drop-legacy` fueron idempotentes; la base de pruebas ya no
contiene las columnas heredadas.

## Bloque 5: seguridad y consistencia

- [ ] Invalidar sesiones administrativas al cambiar la contraseña.
- [x] No devolver `emailHint` para clientes inactivos.
- [x] Corregir los contadores paginados para que usen los mismos filtros y joins
  que las listas.
- [x] Hacer que un dato personalizado invalido no oculte datos validos del mismo
  conjunto.
- [x] Verificar normalizacion en backend y base de datos: `trim`, minusculas,
  correos, categorias, sugerencias, identificaciones y tokens.
- [x] Verificar unicidad de identificaciones y tokens despues de normalizar.
- [x] Comprobar que datos protegidos nunca aparezcan en respuestas anonimas,
  cache, logs ni HTML inicial.
- [x] Comprobar que las operaciones CRUD invaliden cache y que el frontend use la
  respuesta actualizada.

**Aceptacion:** las pruebas de seguridad cubren sesiones, datos protegidos,
normalizacion, cache e invalidacion.

El bloque queda parcialmente abierto: cambiar la contraseña administrativa aún
no revoca cookies administrativas ya emitidas. Requiere añadir una versión de
sesión en `AdminCredentials`, hacer `requireAdmin` consultar esa versión y
migrar la tabla en local, pruebas y Turso antes de marcarlo completo.

## Bloque 6: validacion previa al PR

- [x] Ejecutar:

  ```sh
  npm run test:functions
  npm run test:deploy-smoke
  npm run build
  ```

- [x] Ejecutar los E2E contra el sitio de pruebas:

  ```sh
  E2E_BASE_URL=https://gadgetdesign-dev.netlify.app \
  DEV_ADMIN_PASSWORD='...' npm run test:e2e
  ```

- [x] Revisar manualmente en desktop y movil:
  - [ ] portal del cliente;
  - [ ] alta y aprobacion de ficha;
  - [ ] datos protegidos y OTP;
  - [ ] QR y URL corta;
  - [ ] datepicker;
  - [ ] paginacion del panel.
- [x] Revisar `git diff`, secretos y archivos generados.
- [x] Actualizar esta lista con resultados y evidencia.
- [ ] Crear PR `dev` hacia `main`.

**Aceptacion:** todas las pruebas pasan, no hay secretos en el diff y el PR
contiene solo cambios revisados.

El bloque queda abierto por la revisión manual pendiente y por crear el PR.
Los E2E remotos pasaron 6/6 el 2026-10-10 contra
`https://gadgetdesign-dev.netlify.app`.

## Bloque 7: produccion

- [ ] Revisar el PR y aprobarlo manualmente.
- [ ] Antes del merge, confirmar variables y base de datos de produccion.
- [ ] Ejecutar la migracion aditiva en produccion con el nombre explicito del
  destino.
- [ ] Fusionar el PR a `main`.
- [ ] Esperar el deploy de Netlify y revisar `health` y `deploy-smoke`.
- [ ] Ejecutar una prueba publica de lectura y una prueba autorizada controlada.
- [ ] Ejecutar `setup:drop-legacy` en produccion solo con confirmacion y solo
  despues de comprobar que el codigo desplegado ya no usa las columnas.
- [ ] Registrar URL del deploy, hora, commit y resultado.

**Aceptacion:** produccion esta desplegada, las Functions responden, las
migraciones quedaron aplicadas y no hay regresiones visibles.

## Registro de ejecucion

| Fecha | Bloque | Resultado | Evidencia / comando | Commit | Responsable |
| --- | --- | --- | --- | --- | --- |
|  | 0 |  |  |  |  |
|  | 1 |  |  |  |  |
|  | 2 |  |  |  |  |
|  | 3 |  |  |  |  |
|  | 4 |  |  |  |  |
|  | 5 |  |  |  |  |
|  | 6 |  |  |  |  |
|  | 7 |  |  |  |  |

## Incidencias y decisiones

Anotar aqui cualquier desviacion, decision aprobada o bloqueo antes de continuar
con el siguiente bloque.

- 2026-10-09: `git fetch origin` fue bloqueado por permisos del sandbox al
  escribir `.git/FETCH_HEAD`; no se modifico el repositorio remoto.
- 2026-10-09: `npm run setup:local` paso y preparo
  `file:/tmp/gadgetdesign-local.db`.
- 2026-10-09: el Bloque 1 paso. El sandbox bloquea listeners en `9999` y
  `10099` sin permisos ampliados; con permisos ampliados la suite completa paso
  usando `NETLIFY_FUNCTIONS_PORT=10099`.
- 2026-10-09: el backend y la suite del Bloque 2 pasaron. La interfaz compila,
  y el E2E local del formulario paso. El sitio remoto todavia tiene el deploy
  anterior y debe actualizarse antes de repetir ese escenario allí.
- 2026-10-09: el Bloque 3 paso. Se probaron ficha inactiva, cliente inactivo y
  categoria inactiva; en los tres casos la lectura publica queda no disponible y
  la solicitud de OTP se rechaza cuando corresponde.
- 2026-10-09: el Bloque 4 paso en `gadgetdesign-dev`. `setup:admin` no modifico
  la credencial existente y `setup:drop-legacy` confirmo que no quedan columnas
  heredadas.
- 2026-10-09: Bloque 5 parcial. Se corrigió el descarte global de datos
  personalizados corruptos y pasaron suite y build. Queda pendiente revocar
  sesiones administrativas al cambiar la contraseña.
- 2026-10-09: Bloque 6 parcial. Pasaron `git diff --check`,
  `npm run test:deploy-smoke`, `npm run build` y el E2E local. El E2E remoto no
  pudo encontrar `Nueva ficha` porque el sitio dev todavía usa el deploy previo.
- 2026-10-10: Se hizo explícita la rotación de la credencial de pruebas con
  `RESET_ADMIN_PASSWORD=true` y `DEV_ADMIN_PASSWORD`; se sincronizó Turso dev.
  La suite E2E remota pasó 6/6. Se estabilizó el login de Playwright esperando
  el panel o el formulario después de cada navegación.
