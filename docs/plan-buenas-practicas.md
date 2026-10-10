# Plan de buenas practicas y calidad

Lista de control para mejorar la mantenibilidad, seguridad y confiabilidad del
proyecto antes de fusionar cambios a `main`.

## Reglas de ejecucion

- Trabajar exclusivamente en `dev`.
- No tocar produccion durante este plan.
- Marcar una casilla solo despues de ejecutar y registrar su evidencia.
- Cada bloque debe terminar con pruebas pasando y un commit pequeno.
- No crear abstracciones nuevas si el cambio no reduce complejidad real.

## Estado rapido

- [x] Bloque 0: linea base y herramientas.
- [x] Bloque 1: invalidacion de sesiones administrativas.
- [x] Bloque 2: calidad estatica y scripts de validacion.
- [x] Bloque 3: seguridad y manejo de errores.
- [ ] Bloque 4: modularizacion gradual del frontend.
- [ ] Bloque 5: cobertura E2E y aislamiento de datos.
- [ ] Bloque 6: documentacion y preparacion del PR.

## Bloque 0: linea base y herramientas

- [ ] Confirmar rama, remoto y working tree:

  ```sh
  git branch --show-current
  git status --short --branch
  git log --oneline --decorate -5
  ```

- [ ] Ejecutar la validacion actual:

  ```sh
  npm run test:functions
  npm run test:deploy-smoke
  npm run build
  ```

- [ ] Registrar versiones de Node, npm, Vite, Playwright y Netlify CLI.
- [ ] Confirmar que no hay secretos en el diff ni archivos locales rastreados.

**Aceptacion:** la rama es `dev`, el estado inicial esta limpio o documentado,
y las pruebas de referencia pasan antes de cambiar codigo.

Verificado el 2026-10-10 en `dev`. Pasaron `npm run test:functions`,
`npm run test:deploy-smoke`, `npm run build` y `git diff --check`. Node es
`v22.23.2`, npm `10.9.8`, Vite `8.3.2` y Playwright `1.55.0`. Netlify CLI
no pudo escribir su configuracion global por permisos del entorno, pero no
afecta las pruebas del proyecto. El plan nuevo aun no esta committeado.

## Bloque 1: invalidacion de sesiones administrativas

- [ ] Agregar `session_version` a `AdminCredentials` con migracion idempotente.
- [ ] Incluir la version en la cookie firmada al iniciar sesion.
- [ ] Hacer que `requireAdmin()` compare la version de la cookie con Turso.
- [ ] Incrementar la version al cambiar la contraseña.
- [ ] Invalidar tambien las sesiones al ejecutar una rotacion administrativa.
- [ ] Cubrir login, acceso autorizado, cambio de contraseña y cookie antigua.
- [ ] Ejecutar la migracion primero en la base local y despues en `dev`.

**Aceptacion:** una cookie administrativa emitida antes del cambio de
contraseña recibe `401`; una cookie nueva funciona correctamente.

Implementado y verificado localmente y en `gadgetdesign-dev` el 2026-10-10.
La prueba rota la contraseña, rechaza la cookie anterior, inicia sesión con la
nueva y restaura la contraseña de pruebas. La migracion idempotente se aplico
contra `gadgetdesign-dev-jricardo`; las E2E remotas seleccionadas pasaron 3/3.

## Bloque 2: calidad estatica y validacion automatica

- [ ] Añadir ESLint compatible con Vue 3 y `script setup`.
- [ ] Añadir un comando `npm run lint`.
- [ ] Añadir chequeo de tipos o, si se mantiene JavaScript, una validacion
  equivalente de imports y sintaxis.
- [ ] Añadir `npm run verify` que ejecute lint, Functions, smoke test y build.
- [x] Configurar el mismo comando para el PR de `dev` hacia `main`.
- [ ] Corregir advertencias reales sin hacer una refactorizacion masiva.

**Aceptacion:** `npm run verify` termina sin errores y puede ejecutarse desde
una instalacion limpia.

Se añadieron ESLint para Vue 3, `npm run lint`, `npm run check:syntax` y
`npm run verify`. La suite quedó limpia después de corregir un bloque `catch`
vacío y documentar una expresión regular que elimina caracteres de control.
El runner acepta `VITE_PORT` y `NETLIFY_FUNCTIONS_PORT` para evitar conflictos
con otra instancia local. El 2026-10-10 `VITE_PORT=5174
NETLIFY_FUNCTIONS_PORT=10001 npm run verify` pasó completo: lint, sintaxis en
34 archivos, Functions, smoke post-deploy y build. El mismo comando queda
configurado en `.github/workflows/verify.yml` para PRs hacia `main` y pushes a
`dev`; usa `npm ci` y no requiere secretos ni acceso a Turso remoto.

## Bloque 3: seguridad y errores

- [ ] Revisar todos los endpoints para confirmar autenticacion y autorizacion
  antes de acceder a datos.
- [ ] Confirmar que ningun dato protegido aparezca en logs, errores, HTML
  inicial, respuestas anonimas o cabeceras de cache.
- [ ] Revisar limites de tamaño, paginacion, filtros y payloads JSON.
- [ ] Evitar mensajes que permitan enumerar clientes, fichas o correos.
- [ ] Revisar que los errores 5xx no expongan SQL, tokens ni credenciales.
- [ ] Agregar pruebas de regresion para cada hallazgo.

**Aceptacion:** el backend conserva respuestas genericas ante errores internos,
las rutas protegidas rechazan acceso sin sesión y los datos sensibles no salen
por ninguna respuesta pública.

Avance 2026-10-10: `readJson` limita los cuerpos JSON a 256 KiB y devuelve
`413` antes de ejecutar lógica o escribir en Turso. `handleError` quedó cubierto
contra filtración de mensajes internos en respuestas `5xx`. También se
verificaron `no-store`, datos protegidos ausentes en la respuesta pública,
anti-enumeración y autorización de las rutas mediante `testFunctions.mjs`.
El inventario manual confirmó que `health` y el contexto público son las únicas
rutas anónimas; las mutaciones de ficha, portal y panel exigen sus sesiones.
Los logs de errores 5xx y de purga ya no imprimen objetos de error completos.
La suite pasó con los puertos locales alternativos.

## Bloque 4: modularizacion gradual del frontend

- [ ] Extraer el encabezado y acciones públicas de `App.vue`.
- [ ] Extraer el listado y editor de datos personalizados.
- [ ] Extraer los diálogos de acceso, alta y eliminación.
- [ ] Extraer QR y preparación de impresión del panel administrativo.
- [ ] Mantener los componentes por debajo de un tamaño razonable, sin cambiar
  comportamiento ni estilos innecesariamente.
- [ ] Verificar desktop y móvil después de cada extracción.

**Aceptacion:** cada componente conserva pruebas y responsabilidades claras,
el build no aumenta errores y no hay regresiones visuales evidentes.

Avance 2026-10-10: se extrajo `src/components/Print3dDialog.vue` con sus
controles, métricas, descargas SVG/STL y estilos responsive. `AdminApp.vue` lo
usa como componente presentacional y el template legado ya fue retirado.
También se extrajo `src/components/QrPreviewDialog.vue`, incluyendo la
previsualización, URL pública y acceso a preparación de impresión; sus estilos
ya no están duplicados en `AdminApp.vue`. `npm run lint` y `npm run build`
pasan. Después se extrajo `src/components/CategoryDialog.vue`, conservando el
borrador, validaciones de formulario y submit en `AdminApp.vue`; sus estilos
locales evitan depender del alcance CSS del padre. Siguen pendientes los
diálogos de entidades, clientes y lote, además del listado/editor. También se
extrajo `src/components/SuggestionDialog.vue`, con los tipos de información
recibidos por prop y el mismo contrato de submit controlado por el padre.
Finalmente se extrajo `src/components/EntityDialog.vue`, incluyendo la
selección de cliente, alta de cliente y vista previa de URL; el padre conserva
el submit y la lógica de negocio. También se extrajo
`src/components/ClientDialog.vue`, manteniendo en el padre la persistencia y
las notificaciones. Finalmente se extrajo `src/components/BulkEntityDialog.vue`
con la vista previa de rangos y diseño responsive; el padre conserva la
creación y sus resultados. Queda pendiente el listado/editor de datos
personalizados.

## Bloque 5: cobertura E2E y aislamiento

- [ ] Cubrir acceso público al portal.
- [ ] Cubrir OTP de ficha y revelado de datos protegidos.
- [ ] Cubrir agregar, editar y eliminar datos protegidos.
- [ ] Cubrir datepicker en viewport móvil.
- [ ] Cubrir QR, tamaño personalizado, descarga SVG y preparación STL.
- [ ] Cubrir paginación y filtros del panel.
- [ ] Usar identificadores únicos por prueba y limpieza garantizada en `finally`.
- [ ] Evitar dependencia de entidades permanentes compartidas.
- [ ] Evaluar un modo de OTP exclusivo para dev o un buzón de pruebas; nunca
  habilitarlo en producción.

**Aceptacion:** la suite E2E pasa dos veces consecutivas contra dev y no deja
clientes, fichas ni códigos de prueba abandonados.

Avance 2026-10-10: los escenarios E2E existentes cubren metadata, acceso al
portal, entidades duplicadas, QR/SVG, estados activa/inactiva/pendiente y alta
desde portal. La ejecución contra dev quedó bloqueada antes de iniciar porque
Playwright no está instalado en `node_modules` y `npx` no pudo descargarlo por
timeout de red. No se marca el bloque como completado hasta ejecutar la suite
dos veces contra dev.

## Bloque 6: documentacion y PR

- [ ] Actualizar README con comandos de desarrollo y verificacion.
- [ ] Documentar migraciones, variables requeridas y rotacion de secretos.
- [ ] Actualizar `docs/fichas-cliente.md` y el modelo de sesiones.
- [ ] Revisar diff, secretos, build-info y archivos generados.
- [ ] Ejecutar la suite final local y remota.
- [ ] Crear PR `dev` hacia `main` con resumen, riesgos y evidencia.
- [ ] No fusionar hasta revisar manualmente el checklist.

**Aceptacion:** el PR contiene solo cambios revisados, la validacion automatica
esta verde y toda migracion tiene instrucciones de rollback o recuperacion.

## Registro de ejecucion

| Fecha | Bloque | Resultado | Evidencia / comando | Commit | Responsable |
| --- | --- | --- | --- | --- | --- |
| 2026-10-10 | 0 | Completado | `npm run test:functions`, `npm run test:deploy-smoke`, `npm run build`, `git diff --check` | `90a81be` | Codex |
| 2026-10-10 | 1 | Completado | Rotacion de contraseña, rechazo de cookie anterior, migracion local/dev y E2E remotas 3/3 | `5fdfed3` | Codex |
| 2026-10-10 | 2 | Completado | `VITE_PORT=5174 NETLIFY_FUNCTIONS_PORT=10001 npm run verify` | Pendiente | Codex |
| 2026-10-10 | 3 | Completado | `413`, errores `5xx` genéricos, logs sin objetos sensibles, `no-store`, datos protegidos y autorización verificados | Pendiente | Codex |
|  | 1 |  |  |  |  |
|  | 2 |  |  |  |  |
|  | 3 |  |  |  |  |
|  | 4 |  |  |  |  |
|  | 5 |  |  |  |  |
|  | 6 |  |  |  |  |

## Decisiones y riesgos

- La invalidacion de sesiones administrativas es prioritaria porque reduce el
  riesgo de acceso persistente despues de una rotacion de contraseña.
- 2026-10-10: commit `90a81be` subido a `dev`; migracion de `session_version`
  aplicada en Turso dev; smoke E2E remoto de deploy, QR y aprobacion pendiente
  paso 3/3.
- La modularizacion se hara despues de cubrir comportamiento, para evitar que
  una refactorizacion grande oculte regresiones.
- Los modos de prueba para OTP deben estar limitados a `dev` y no devolver
  codigos en produccion bajo ninguna circunstancia.
