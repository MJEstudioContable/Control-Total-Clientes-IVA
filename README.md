# Control Remoto Clientes

PWA para gestionar la cartera de clientes de un estudio contable.
Frontend React/Vite con autenticación individual por PIN, acceso por
períodos, edición optimista de la planilla y una vista ejecutiva de
solo lectura.

## Qué incluye la versión actual

- **Inicio de sesión por PIN** por usuario, con sesión individual y
  expiración por inactividad/máxima duración.
- **Alta inicial de PIN** durante la configuración (sujeta a las
  propiedades del backend).
- Selección de **año y mes** según las planillas disponibles.
- **Panel del período** con métricas, prioridades, carga por equipo,
  resumen por vencimiento y la cartera completa de clientes.
  - Búsqueda por nombre o RUC y filtros rápidos.
  - **Más filtros**: vencimiento, estado y encargado (compartidos con
    "Asignar clientes").
  - **Acciones rápidas**: marcar Presentado y Archivado desde la fila,
    sin abrir el cliente.
  - Lista **virtualizada**: sólo se dibujan las filas visibles, así el
    período se mantiene fluido aunque tenga cientos de clientes.
- **Detalle de cliente** con edición de campos, acceso a **Marangatu** y
  vista de solo lectura en el preview ejecutivo.
- **Asignar clientes** (roles con permiso).
- **Configuración** con tema claro/oscuro, **tamaño de texto**
  (Compacto / Normal / Grande / Extra) y cambio de PIN.
- **Marangatu** con apertura del login de la SET y autocompletado
  cuando la extensión está instalada.
- **Vencimientos IVA** (antes, la app aparte `vencimientos-iva`): pestaña
  propia del período para cargar la liquidación de IVA de cada cliente
  (Formulario 120), calcular el vencimiento por el último dígito del RUC
  según el Calendario Perpetuo de la DNIT, la mora, y generar la ficha para
  el cliente (imagen, PDF, texto o WhatsApp), el libro de compras/ventas y
  el PDF del período. Desde el detalle de un cliente, **Liquidación IVA**
  abre directamente la suya.

## Cómo se reparten las funciones

| Sección | Función | Dónde guarda |
|---|---|---|
| Clientes / Estadísticas / Asignar | Control de la cartera: encargado, Presentado, Archivado, Marangatu | Planilla mensual del año (como siempre) |
| Vencimientos IVA | Liquidación, vencimiento, mora, ficha y libros | Hojas `IVA AAAA-MM`, `IVA Clientes` e `IVA Config` |

- La **lista de clientes es una sola**: la planilla del mes elegido. El IVA
  identifica a cada cliente por su **RUC sin DV** (columna tipo "R.U.C.";
  el DV puede venir con guion o en una columna "DV").
- La hoja mensual es el mes en que vencen las obligaciones; el IVA que se
  liquida es el del **período fiscal anterior** (hoja "Octubre" → período
  septiembre). Se puede cambiar de período con las flechas. El desfase está
  en `DESFASE_PERIODO_FISCAL` (`src/iva/IvaModule.jsx`).
- El acceso es el mismo PIN de siempre. Cualquier usuario carga
  liquidaciones; colores, feriados, mora y nombre del estudio sólo los
  cambian `ADMINISTRADOR` y `SUPERUSUARIO`.
- Por defecto las hojas de IVA se crean en la planilla de administración.
  Para usar una planilla aparte, poné su ID en la Script Property
  `IVA_SPREADSHEET_ID`.

### Instalar el módulo de IVA en Apps Script

El módulo vive en su propio archivo, así que no hace falta reemplazar el
`Code.gs` que ya está publicado:

1. En el proyecto de Apps Script: **+ → Secuencia de comandos**, llamarla
   `Iva` y pegar el contenido de `AppsScript-Iva.gs`.
2. En `doPost` del `Code.gs`, justo antes de
   `return errorResponse('Acción desconocida: ' + action, 'UNKNOWN_ACTION');`,
   agregar:
   ```js
   const ivaResponse = handleIvaAction(action, body, sessionUser, sessionRole);
   if (ivaResponse) return ivaResponse;
   ```
3. **Implementar → Administrar implementaciones → editar → Nueva versión**
   (así la URL del Web App no cambia).

### Instalar el módulo de Marcaciones en Apps Script

Igual que el de IVA, en un archivo aparte (`AppsScript-Marcaciones.gs`): crear la
secuencia `Marcaciones`, pegar su contenido y agregar en `doPost`, antes del
`return errorResponse('Acción desconocida: ...')`:
```js
const marcacionesResponse = handleMarcacionesAction(action, body, sessionUser, sessionRole);
if (marcacionesResponse) return marcacionesResponse;
```
Luego, **Nueva versión** de la implementación. Guarda los horarios en la hoja
`Marcaciones Config` de la planilla de administración; sin esto la pestaña
funciona igual, pero los horarios quedan sólo en el navegador.

### Migrar los datos de la app de Netlify

Si ya había liquidaciones cargadas en `vencimientos-iva`, se traen una sola
vez desde el editor de Apps Script con `migrarDesdeVencimientosIvaNetlify`
(instrucciones en el comentario de la función). Después se puede dar de baja
el sitio de Netlify.

## Cómo correrlo

### 1. Instalar dependencias

```bash
npm install
```

### 2. Configurar la conexión

Copiá `.env.example` a `.env` y completá:

```ini
VITE_BACKEND_URL=https://script.google.com/.../exec
VITE_API_TOKEN=tu_token
VITE_MARANGATU_LOGIN_URL=https://marangatu.set.gov.py/eset/login
VITE_MARANGATU_EXT_ID=id_de_tu_extension
```

> `VITE_API_TOKEN` no es un secreto real frente al bundle: se
> incorpora al frontend. La validación fuerte la hace el backend.

### 3. Correr en desarrollo

```bash
npm run dev
```

Abrí `http://localhost:3000/`.

### 4. Build de producción

```bash
npm run build
```

La carpeta `dist/` es la que se sube al hosting / se sincroniza con
Capacitor.

## Roles

- `USUARIO`: lee/edita datos permitidos y puede marcar Presentado /
  Archivado. No cambia Encargado.
- `ADMINISTRADOR` y `SUPERUSUARIO`: además pueden asignar y cambiar
  Encargado.

## Estructura relevante

```text
src/
  App.jsx                 estructura de pantallas y sesión
  api.js                  llamadas al backend (POST)
  uiPreferences.js        preferencias locales (tamaño de texto)
  context/ClientsContext  estado compartido de planilla/equipo/filtros
  screens/                pickers, detalle, asignación, nuevo cliente
  ui-executive/           panel del período (interfaz actual)
  iva/                    Vencimientos IVA (cálculo, editor, ficha, PDF)
  components/             modales / utilidades de UI
AppsScript-Code-auth-PROPUESTA.gs   backend de referencia (Apps Script)
AppsScript-Iva.gs                   módulo de IVA del backend (archivo aparte)
AppsScript-Marcaciones.gs           horarios de Marcaciones del backend (archivo aparte)
```

La interfaz que se monta es la ejecutiva: `src/main.jsx` renderiza
`<App uiMode="executive" periodOverviewComponent={ExecutiveDashboard} />`.

## Notas de seguridad

- El backend debe estar con `ALLOW_SELF_PIN_SETUP=false` y
  `ALLOW_PINLESS_LOGIN=false` en producción.
- No subir al repo: `.env`, `API_TOKEN`, `PIN_PEPPER`, PIN reales,
  IDs de planillas ni URLs privadas de despliegue.
- La extensión de Marangatu solo debe permitir orígenes locales
  autorizados.

Para el detalle de pendientes, ver `PENDIENTES.md`.
