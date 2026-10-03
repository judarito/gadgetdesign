# Gadget Design

Aplicación Vue con Vuetify y Vite para administrar información vinculada a
códigos QR. El frontend se comunica con Netlify Functions y solo las Functions
acceden a Turso, Resend y las claves privadas.

## Arquitectura

```txt
Navegador -> Netlify Functions -> Turso / Resend
```

- `netlify/functions/entity.mjs`: consulta pública, OTP y CRUD autorizado.
- `netlify/functions/admin.mjs`: autenticación y administración.
- Los datos marcados como protegidos se cifran antes de guardarse.
- Las sesiones usan cookies `HttpOnly` y `SameSite=Strict`.

## Comandos

```sh
npm install
npm run setup:local
npm run dev
npm run build
npm run test:functions
```

La entidad local de prueba queda disponible en `http://localhost:5173/Local001`.

## Variables de entorno

Copia `.env.example` a `.env` y configura:

```sh
TURSO_URL=libsql://your-database.turso.io
TURSO_TOKEN=your_turso_auth_token
APP_AUTH_SECRET=64_hex_characters
DATA_ENCRYPTION_KEY=64_hex_characters
OTP_DELIVERY_MODE=console
LOCAL_TURSO_URL=file:/tmp/gadgetdesign-local.db
RESEND_API_KEY=
RESEND_FROM=Gadget Design <acceso@example.com>
```

Para producción configura en Netlify, con alcance `Functions`:

```txt
TURSO_URL
TURSO_TOKEN
APP_AUTH_SECRET
DATA_ENCRYPTION_KEY
OTP_DELIVERY_MODE=resend
RESEND_API_KEY
RESEND_FROM
```

No configures `LOCAL_TURSO_URL` en producción. Las variables privadas no se
incluyen en el bundle del navegador.

### Caché de las lecturas públicas

La lectura anónima de una ficha se puede cachear 60 s en el CDN, y esa caché
solo se activa si el entorno tiene `NETLIFY_PURGE_API_TOKEN`, que es lo que
permite invalidarla al escribir:

- **Con token** (el runtime desplegado lo tiene): la lectura pública se sirve de
  caché y se purga por etiquetas en cada edición, cambio de cliente o borrado.
- **Sin token** (tu equipo en local): la lectura responde `no-store`, siempre
  fresca.

En local no configures ese token: haría que las Functions intentaran purgar la
caché del sitio al que está vinculado el repositorio, que es el de producción.

El condicional existe por un motivo: durante un tiempo la purga no se ejecutaba
—el guardia consultaba `CONTEXT`, que no existe en este runtime— y cada escritura
dejaba la página pública mostrando datos viejos hasta que expiraba el TTL, hasta
60 segundos viendo una ficha ya borrada. Ante la duda, mejor no cachear.

### Entorno de pruebas (rama `dev`)

El sitio `gadgetdesign-dev` usa una base de datos Turso propia y secretos
distintos a los de producción. Para ejecutar migraciones o scripts contra esa
base desde tu equipo:

```sh
cp .env.dev.example .env.dev.local   # completa TURSO_TOKEN con:
                                     #   turso db tokens create gadgetdesign-dev
set -a && . ./.env.dev.local && set +a
npm run setup:admin
```

`.env.dev.local` está ignorado por git. Al exportar las variables, `loadEnv` de
Vite les da prioridad sobre `.env`, así que el script apunta a la base de
pruebas y nunca a la de producción. Verifícalo antes de ejecutar algo
destructivo:

```sh
set -a && . ./.env.dev.local && set +a
node -e "import('vite').then(v => console.log(v.loadEnv('', process.cwd(), '').TURSO_URL))"
```

## Migraciones de esquema

La migración es aditiva e idempotente y se aplica igual en la base de pruebas y
en la de producción:

```sh
npm run setup:admin
```

Ejecútala de forma controlada antes de desplegar cambios de esquema. Para
apuntarla a la base de pruebas, exporta antes `.env.dev.local` como se explica
en [Entorno de pruebas](#entorno-de-pruebas-rama-dev).

### Retirar las columnas heredadas del propietario

El dueño de una ficha vive ahora en `Clientes`. Las columnas
`Entidades.owner_name`, `owner_email` y `owner_phone` quedaron como residuo y se
eliminan con un comando aparte, porque es destructivo y solo tiene sentido
cuando ya corre el código que lee el dueño en `Clientes`:

```sh
npm run setup:admin          # aditivo: crea Clientes y vincula las fichas
npm run setup:drop-legacy    # destructivo: elimina las columnas heredadas
```

El orden importa, y el script se protege solo: se niega a borrar si encuentra
una ficha con correo heredado y sin cliente vinculado, y recrea antes los
triggers porque SQLite bloquea `DROP COLUMN` si algún trigger nombra la columna.

Los dos comandos imprimen al empezar la base de datos contra la que van. Además,
`setup:drop-legacy` se niega a ejecutarse si el destino no parece de pruebas —una
URL `file:` o un host que contenga `-dev`— salvo que lo confirmes a propósito:

```sh
CONFIRM_DESTRUCTIVE=si npm run setup:drop-legacy
```

La diferencia es entre acordarte de exportar `.env.dev.local` y que el script lo
compruebe por ti. Un despiste ahí borraría las columnas que el código todavía en
producción lee.

En un despliegue, la secuencia segura es: `setup:admin` antes de fusionar el PR,
y `setup:drop-legacy` (con la confirmación) después de que el código nuevo esté
desplegado.

## URL de uso

La URL pública usa el código corto de la entidad:

```txt
https://dominio/codigo-corto
```

Las URLs anteriores con categoría, GUID o alias siguen siendo compatibles.

## Entornos

Cada rama despliega en un sitio de Netlify distinto:

| Entorno | Rama | Sitio Netlify | URL | Base de datos |
| --- | --- | --- | --- | --- |
| Producción | `main` | `gadgetdesign` | https://gadgetdesign.lat | Turso `gadgetdesign` |
| Pruebas | `dev` | `gadgetdesign-dev` | https://gadgetdesign-dev.netlify.app | Turso `gadgetdesign-dev` |

Los dos entornos no comparten secretos: usan `APP_AUTH_SECRET`,
`DATA_ENCRYPTION_KEY` y token de Turso diferentes. Un fallo en pruebas no puede
falsificar sesiones ni descifrar datos de producción.

El sitio de pruebas es público y no tiene protección por contraseña, por eso
trabaja contra su propia base de datos. El OTP se imprime en los logs de las
Functions (`OTP_DELIVERY_MODE=console`) en lugar de enviarse por correo.

Para leerlo sin abrir el panel de Netlify, la CLI sirve, pero hay que apuntarla al
sitio de pruebas: el repositorio está vinculado al de producción
(`.netlify/state.json`), así que **cualquier comando de Netlify lanzado desde la
raíz apunta a producción**. Desde un directorio vinculado a `gadgetdesign-dev`:

```sh
netlify logs --function client --since 5m
```

La ingesta tarda unos 20 segundos, así que si acabas de pedir el código espera un
poco o usa `--follow`.

Los *deploy previews* de pull request están **desactivados en el sitio de
producción** (`build_settings.skip_prs`): así el código de una rama sin fusionar
nunca se ejecuta contra la base de datos real. Un preview de producción usa las
variables de entorno de producción, de modo que un PR con una migración o un
endpoint destructivo afectaría datos reales antes de ser revisado.

El preview del PR sí se genera en el sitio de pruebas, que apunta a la base de
datos de pruebas:

```txt
https://deploy-preview-<numero-de-pr>--gadgetdesign-dev.netlify.app
```

## Flujo de trabajo

`main` está protegida en GitHub: no acepta commits directos y exige un pull
request (`enforce_admins` activo, sin force-push ni borrado). El despliegue a
producción solo ocurre cuando se fusiona un PR en `main`.

```sh
git checkout dev
# ... cambios ...
git commit -am "Describe el cambio"
git push origin dev            # -> despliega en el sitio de pruebas

# Abre el PR dev -> main en GitHub y fusíonalo manualmente cuando esté validado.
                               # -> despliega en producción
```

Antes de fusionar a `main`, ejecuta la suite de integración sobre el entorno
local:

```sh
npm run test:functions
```

No uses `netlify deploy --prod` desde tu equipo: publica el contenido local
saltándose la revisión del PR que protege `main`. El despliegue normal es un
`git push` a la rama correspondiente.
