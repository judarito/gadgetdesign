# Fichas con estado: el cliente propone, el administrador publica

Diseño previo a la implementación. Añade un **estado** a la ficha para que el
cliente pueda gobernar las suyas sin poder publicar por su cuenta.

> **Estado:** fase 1 **implementada y verificada contra la base de dev**. Esquema,
> backend y las tres interfaces. Pendiente la fase 2 (crear y aprobar) y, de la
> fase 1, un detalle que conviene decidir antes de publicar: el punto 8, sobre si
> desactivar un cliente o una categoría debe ocultar también sus fichas. No se ha
> tocado.

## 1. Qué resuelve

Hoy una ficha es pública desde que existe y solo el administrador decide sobre
ella. Con esto:

- El cliente puede **desactivar** una ficha suya, y deja de verse en público al
  instante.
- El cliente puede **crear** fichas, que nacen **pendientes** y no se publican
  hasta que el administrador las apruebe.
- Solo el administrador **activa**: tanto lo que el cliente creó como lo que el
  cliente desactivó.

## 2. Estados y transiciones

| Estado | Se ve en público | Quién lo pone |
| --- | --- | --- |
| `pendiente` | No | El sistema, cuando la crea el cliente |
| `activa` | Sí | El administrador al aprobar, y el sistema cuando la crea él |
| `inactiva` | No | El cliente al desactivar, o el administrador |

- El administrador crea → `activa`, igual que hoy.
- El cliente crea → `pendiente`.
- `pendiente` → `activa`: el administrador aprueba.
- `pendiente` → `inactiva`: el administrador la descarta sin borrarla.
- `activa` → `inactiva`: el cliente la desactiva, o el administrador.
- `inactiva` → `activa`: **solo el administrador**.

El cliente nunca lleva una ficha a `activa`. El borrado no cambia: sigue siendo
del administrador o de la sesión del QR.

## 3. Qué ve el público

Una ficha que no está `activa` **no sirve ningún dato**, ni siquiera los
públicos. El código corto no se regenera nunca, así que la URL es la misma. Hay
dos maneras de contarlo:

- **(a)** la ruta resuelve con un estado «no disponible», sin datos; **[implementada]**
- (b) la ruta deja de resolver y cae en «no encontrada».

**Se implementa (a)**, que es lo que se pregunta más abajo para confirmar: un QR
va pegado a un objeto físico, y quien lo escanee merece leer que la ficha está
desactivada en lugar de un «no encontrada» que parece un fallo. Con (b) el QR
muere en silencio y no se distingue de una URL mal escrita.

En los dos casos **no sale ni un dato**, ni siquiera enmascarado.

Dos precisiones para que la implementación no se ambigue:

- **El corte es solo para las lecturas anónimas.** El dueño sigue viendo y
  editando su ficha desde el portal: su sesión ya la autoriza. Lo que cambia no
  es quién puede administrarla, sino quién puede verla sin sesión.
- **Una ficha no activa tampoco admite el acceso por QR.** Si el código corto
  responde «no disponible», esa ruta no puede además pedir y verificar un código
  de acceso: no habría nada que revelar. Quien tenga el QR impreso no entra
  mientras esté desactivada; al reactivarla, vuelve a entrar con el mismo QR. Es
  la consecuencia de que el cliente pueda desactivar, y conviene tenerla presente
  porque un objeto en manos de otra persona deja de poder consultarse.

## 4. Esquema y migración (aditiva)

```sql
ALTER TABLE Entidades ADD COLUMN status TEXT NOT NULL DEFAULT 'activa'
```

- Las fichas que ya existen quedan `activa`: hoy son públicas y la migración no
  debe cambiar lo que se ve.
- Índice para el listado del administrador: `idx_entidades_status`.
- Triggers en `applyDataIntegrityConstraints` para que `status` solo admita los
  tres valores; SQLite no permite añadir un `CHECK` con `ALTER TABLE`.
- `setupLocal.mjs` crea la columna y el índice en la base local. Los ejemplos de
  fichas no activas los crea **cada prueba**, no la semilla: sembrarlos cambiaría
  los recuentos que la suite ya verifica sobre el cliente de prueba.
- Al cambiar de estado **nunca** se toca `short_code` ni `token`: el QR ya
  impreso tiene que seguir sirviendo al reactivar.

## 5. API

### Portal (sesión de cliente)

- `GET context`: añade `status` a cada ficha, para poder etiquetarla.
- `GET category-options` (**nueva**): categorías activas. Hoy solo las ve el
  administrador y sin esto el cliente no puede elegir dónde crear.
- `POST create-entity` (**nueva**): el cliente crea una ficha suya.
  - El `clienteID` sale **siempre** de la sesión; si el cuerpo trae uno, se
    ignora.
  - La categoría debe existir y estar activa.
  - Nace `pendiente`; genera token y código corto como la del administrador.
- `POST deactivate-entity` (**nueva**): `activa` → `inactiva` sobre una ficha
  suya. Idempotente.

### Panel (sesión de administrador)

- `POST set-entity-status` (**nueva**): `pendiente` o `inactiva` → `activa`, y
  `activa` → `inactiva`.
- `GET entities`: acepta `status` como filtro y lo devuelve en cada fila.
- La creación del administrador sigue naciendo `activa`.

Cualquier cambio de estado purga la caché de la ficha; la purga por etiquetas ya
funciona desde el arreglo de `CONTEXT`.

## 6. Interfaz

**Portal.** Cada ficha muestra su estado cuando no está activa («Pendiente de
aprobación», «Desactivada»), un botón *Desactivar* en las activas, y un botón
*Añadir ficha* con un formulario mínimo (nombre visible y categoría). El cliente
**sí** puede abrir y editar sus fichas no activas: su sesión ya las autoriza. Lo
que cambia es que el público no las ve.

**Panel.** Filtro por estado, la cola de **pendientes** destacada arriba —es lo
único accionable— y un botón para activar o desactivar por fila.

## 7. Límites y seguridad

- Tope por cliente: **50 fichas en total** y **5 pendientes** a la vez.
- El cliente solo opera sobre fichas cuyo `clienteID` es el suyo. La pertenencia
  se comprueba en cada acción, no se deduce del cuerpo.
- Crear exige sesión de cliente y no permite crear en nombre de otro.
- El nombre visible se valida como hoy y la categoría debe estar activa.
- La creación del cliente pasa por el mismo control de colisiones de código
  corto que la del administrador.

## 8. Interacción con los otros dos estados (decisión pendiente)

Hoy:

- Desactivar un **cliente** no oculta sus fichas: solo le quita el acceso.
- Desactivar una **categoría** tampoco las oculta.

Si «no activo = no público» es la regla, lo coherente es que una ficha activa de
un cliente desactivado **no** se vea, y que una ficha activa en una categoría
desactivada **no** se vea.

Lo recomiendo por coherencia, pero **cambia el comportamiento actual** y puede
ocultar muchas fichas de golpe si alguien desactiva una categoría sin pensarlo.

## 9. Fases

1. **Estado y desactivar.** Columna, migración, triggers, `status` en el portal y
   en el panel, el cliente desactiva, el administrador activa, y el público deja
   de servir las no activas.
2. **Crear y aprobar.** `category-options` del portal, creación por el cliente
   (nace pendiente), cola de pendientes y aprobación en el panel, y los límites.

Cada fase se prueba contra la base de pruebas y se publica por el circuito
`dev` → PR → `main`, como el modelo de clientes.

## 10. Riesgos

- **El QR y el estado.** Reactivar conserva el código corto, así que el QR
  impreso sirve. Borrar sigue siendo irreversible.
- **Pendientes que se quedan ahí.** Si el cliente crea y nadie aprueba, la ficha
  se queda pendiente para siempre. De ahí la cola visible en el panel y el aviso
  en el portal.
- **Enumeración.** Con la opción (a) del punto 3, un código corto «no disponible»
  confirma que la ficha existe. Es información mínima y a cambio la página es
  honesta; queda anotado.
- **Migración.** El valor por defecto `activa` mantiene el comportamiento actual,
  así que el despliegue no cambia lo que se ve hasta que alguien desactive algo.
