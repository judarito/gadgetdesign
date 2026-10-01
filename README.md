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

## Preparación de producción

La migración es aditiva e idempotente:

```sh
npm run setup:admin
```

Ejecuta este comando de forma controlada antes de desplegar cambios de esquema.

## URL de uso

La URL pública usa el código corto de la entidad:

```txt
https://dominio/codigo-corto
```

Las URLs anteriores con categoría, GUID o alias siguen siendo compatibles.

## Despliegue

```sh
netlify deploy --build --prod
```

El despliegue incluye `dist` y las Functions declaradas en `netlify.toml`.
