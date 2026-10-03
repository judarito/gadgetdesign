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
Functions (`OTP_DELIVERY_MODE=console`) en lugar de enviarse por correo; se leen
en Netlify → Logs → Functions.

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
