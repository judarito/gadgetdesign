# Plan: hoja de vida de entidades

## Objetivo

Convertir cada entidad en una ficha viva con datos actuales y un historial
cronológico de eventos. La solución debe funcionar para vehículos, mascotas y
otras categorías configurables, conservar trazabilidad y permitir una imagen
opcional por evento almacenada en Cloudinary.

## Alcance

### Incluye

- Historial de eventos por entidad.
- Tipos de evento configurables por categoría.
- Campos amigables y configurables por evento.
- Fecha, descripción, responsable, valor numérico y campos protegidos.
- Una imagen opcional por evento.
- Vista pública de hoja de vida.
- Gestión desde el portal autorizado y el panel administrativo.
- Cache pública invalidada después de cada cambio.
- Pruebas locales y contra `dev`.

### Fuera de alcance inicial

- Recordatorios y notificaciones automáticas.
- Integración con talleres, veterinarias o calendarios externos.
- Múltiples imágenes por evento.
- Migración de eventos históricos que no existan en los datos actuales.

## Ejemplos por categoría

### Vehículos

- Cambio de aceite.
- Cambio de batería.
- Revisión técnico-mecánica.
- Reparación.
- Renovación de SOAT.
- Cambio de llantas.

### Mascotas

- Vacuna.
- Visita veterinaria.
- Desparasitación.
- Tratamiento.
- Cirugía.
- Control de peso.

## Modelo funcional

Separar dos conceptos:

1. **Datos actuales:** información rápida y vigente, como placa, próximo
   vencimiento o peso actual.
2. **Eventos:** hechos ocurridos en el tiempo, como un cambio de aceite o una
   vacuna.

Un evento tendrá como mínimo:

- `id`.
- `entity_id`.
- `event_type_id`.
- `title`.
- `occurred_at`.
- `description` opcional.
- `created_at` y `updated_at`.
- `created_by` o tipo de actor.
- `archived_at` opcional.
- estado de protección.

Los campos variables del evento se almacenarán en una estructura validada y no
se confiará únicamente en el frontend.

## Cloudinary

Las imágenes se almacenarán en Cloudinary, no en Turso ni como Base64.

### Carpeta

```txt
gadgetdesign/events/{entityId}/{eventId}/imagen
```

### Metadatos guardados en Turso

- `public_id`.
- `secure_url`.
- formato MIME.
- tamaño.
- ancho y alto.
- fecha de carga.
- indicador de protección.

### Reglas

- Subida únicamente desde una Netlify Function autorizada.
- Validar MIME, tamaño máximo de 5 MB y dimensiones máximas.
- Aplicar compresión y redimensionamiento.
- Generar URL firmada para imágenes protegidas.
- Eliminar la imagen anterior al reemplazarla.
- Eliminar el recurso de Cloudinary si falla la escritura posterior en Turso.
- No exponer `CLOUDINARY_API_SECRET` en el navegador ni en Git.

Variables requeridas:

```txt
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
```

Configurar valores separados en local, `gadgetdesign-dev` y producción.

## Plan de ejecución

- [ ] Revisar los servicios actuales de entidades, datos personalizados,
      autorización y cache.
- [x] Definir los tipos base de eventos y los campos amigables por categoría.
- [x] Crear migración idempotente de `EntityEventTypes`, `EntityEvents`,
      `EntityEventValues` y `EntityEventImages`.
- [x] Crear índices por entidad, tipo de evento, fecha y estado archivado.
- [x] Crear Functions autorizadas para listar, crear, editar y archivar eventos.
- [x] Validar en backend nombres, tipos, longitudes, fechas y valores.
- [x] Crear el cliente server-side de Cloudinary.
- [x] Crear subida, reemplazo y eliminación de imágenes con compensación ante
      errores. La firma y el guardado de metadatos ya están listos.
- [x] Guardar en Turso solo los metadatos de Cloudinary.
- [x] Implementar control de acceso para imágenes protegidas.
- [x] Crear la vista pública “Hoja de vida” con resumen, datos actuales y
      línea de tiempo.
- [x] Añadir estado vacío por categoría y tipos de evento configurables.
- [x] Añadir controles públicos para crear, editar y archivar eventos.
- [x] Añadir preview, error, reemplazo y eliminación de imágenes.
- [x] Aplicar OTP a eventos y valores protegidos según las reglas existentes.
- [x] Invalidar cache por etiquetas después de cambios en eventos o imágenes.
- [x] Agregar pruebas de Functions para permisos y validaciones. Falta cubrir
      Cloudinary con un entorno de pruebas aislado.
- [ ] Agregar E2E para eventos, imágenes, protección y responsive.
- [ ] Ejecutar todo en local usando `.env` y base local.
- [ ] Aplicar la migración y configurar variables en `gadgetdesign-dev`.
- [ ] Probar contra `dev` y revisar logs, cache y recursos en Cloudinary.
- [ ] Crear PR hacia `main` solo después de que `dev` esté estable.

## Reglas de seguridad

- Nunca confiar en la categoría, tipo de evento o campos enviados por el
  navegador.
- Verificar sesión de entidad, cliente o administrador antes de cada operación.
- No incluir imágenes protegidas en respuestas anónimas.
- Usar `no-store` para sesiones y respuestas con información protegida.
- No registrar URLs firmadas, secretos, códigos OTP ni datos sensibles.
- Normalizar texto con `trim` y validar longitudes en backend.
- Archivar en lugar de eliminar eventos cuando se necesite conservar historial.

## Criterios de aceptación

- Un vehículo puede registrar varios mantenimientos ordenados por fecha.
- Una mascota puede registrar vacunas y visitas veterinarias.
- Cada evento puede tener una imagen opcional.
- Un usuario autorizado puede agregar, editar y archivar eventos.
- Un usuario no autorizado ve solo información pública y no puede obtener una
  imagen protegida.
- Una imagen reemplazada no deja recursos huérfanos en Cloudinary.
- Los cambios invalidan la lectura cacheada de la entidad.
- La vista funciona en móvil y escritorio.
- Las E2E pasan dos veces consecutivas contra `dev`.

## Decisiones pendientes

- Confirmar si los eventos se archivan siempre o si algunos pueden eliminarse.
- Confirmar si se permitirá más de una imagen por evento en una fase futura.
- Definir los campos base iniciales para cada categoría.
