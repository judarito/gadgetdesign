# Gadget Design

App Vue con Vuetify creada sobre Vite y conectada directamente a Turso desde el
frontend para despliegue estático en Netlify.

## Comandos

```sh
npm install
npm run dev
npm run build
```

## Variables de entorno

Crea un archivo `.env` con:

```sh
TURSO_URL=libsql://your-database.turso.io
TURSO_TOKEN=your_turso_auth_token
```

En Netlify configura esas mismas variables en `Site configuration > Environment
variables`.

Como la app es 100% frontend, el token queda incluido en el JavaScript generado.
Usa un token con el menor alcance posible para esta app.

## URL de uso

La app lee la categoría y el token desde la ruta:

```txt
https://dominio/codigo-categoria/token
```

Ejemplo local:

```txt
http://localhost:5173/mascotas/abc123
```
