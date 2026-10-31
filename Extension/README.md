# Ekuatia Login (extensión Chrome/Edge)

Puente exclusivo entre **Control Clientes** y Marangatu. Hace tres cosas:

1. **Login:** al pulsar el botón Marangatu de un cliente, Control Clientes
   envía el `R.U.C.` y la `Clave MH` por mensajería externa de Chromium. El
   service worker abre la página oficial de acceso e inyecta los datos una
   sola vez.
2. **Formulario 120 (IVA):** desde la ficha IVA del cliente, **Copiar a
   Marangatu** envía las casillas calculadas. Estando en el Formulario 120 de
   Marangatu, el ícono de la extensión → **Completar formulario** las escribe
   en sus campos y las marca en amarillo. **La extensión nunca presenta la
   declaración:** la revisión y el botón "Presentar" son siempre de la
   persona.
3. **Descarga de formularios IVA (v2.0):** baja como PDF las declaraciones de
   IVA ya presentadas de un cliente. Se puede pedir desde la ficha IVA de la
   app (**Descargar formularios**, con el avance en vivo) o desde el ícono de
   la extensión → **Descargar formularios IVA**, con la sesión del cliente ya
   iniciada. Recorre Consultas → Visión Integral → Búsqueda → 211 IVA General,
   lee la tabla de DDJJ y, por cada período pedido, abre el formulario en una
   pestaña propia y abre el diálogo de impresión: hay que elegir **Guardar como
   PDF**. Los archivos se llaman `{PREFIJO}_{AÑO}_{MES}_{RUC}.pdf`.

## Instalar

1. Abrí `chrome://extensions` (o `edge://extensions`).
2. Activá **Modo de desarrollador**.
3. Elegí **Cargar descomprimida** y seleccioná esta carpeta `Extension/`.
4. Verificá que el ID debajo del nombre sea
   **`dffknnjnidhfldehfalchalikfkjbehm`**.
5. Fijá el ícono en la barra (pieza de rompecabezas → alfiler) para tener a
   mano **Completar formulario**.

Después de modificar sus archivos, usá el botón **Recargar** de la extensión en
esa misma pantalla.

### ID fijo en todas las PCs

Desde la 2.3, `manifest.json` lleva una clave pública (`"key"`). Con ella
Chrome le da a la extensión descomprimida **el mismo ID en cualquier PC**
(`dffknnjnidhfldehfalchalikfkjbehm`), en lugar de uno distinto según la
carpeta. Así la app publicada usa un solo `VITE_MARANGATU_EXT_ID`.

- Si una PC tenía cargada una versión anterior (con otro ID): **Quitar** la
  extensión y volver a **Cargar descomprimida**. Un "Recargar" no cambia el ID.
- No borres ni cambies `"key"` del manifest: el ID cambiaría y habría que
  actualizar la variable en Vercel.
- La clave **privada** que corresponde a esa clave pública no está en el
  repositorio (ni debe estar). Sólo hace falta para empaquetar la extensión
  como `.crx` o para publicarla conservando el mismo ID; para usarla
  descomprimida no se necesita.

## Conectar con Control Clientes

1. En Vercel (Settings → Environment Variables) y en el `.env` local:
   `VITE_MARANGATU_EXT_ID=dffknnjnidhfldehfalchalikfkjbehm`.
2. Redeploy en Vercel (o reiniciá `npm run dev`): Vite incorpora el ID al
   compilar.
3. Usá el botón Marangatu desde una tarjeta de cliente, o **Copiar a
   Marangatu** desde su ficha IVA.

## Reconocimiento de páginas y relevamiento de navegación

Marangatu avanza por validaciones: algunos menús cambian la pantalla dentro de
la misma ventana y otros abren una ventana nueva. Para que las tareas (descargar
IVA, cargar el Formulario 120) puedan orientarse y retomar, hay dos piezas:

- **Reconocimiento (`paginas.js`):** `identificarPagina()` dice en qué pantalla
  está la pestaña (`INICIO`, `VISION_INTEGRAL`, `VISION_RESULTADO`, `LISTA_DDJJ`,
  `FORMULARIO_DDJJ`, `PRESENTAR_DECLARACION`, `FORMULARIO_120`, `LOGIN`…) según
  la ruta y marcadores de la página. El popup lo muestra en **Página actual**.
  Las reglas de `INICIO` (la página madre) son provisorias hasta relevar el portal.
- **Relevamiento (`relevamientoNav.js` + popup):** **Iniciar registro**, navegá el
  recorrido normal y **Copiar listado**. Registra la estructura de cada pantalla
  (ruta sin valores de consulta, menús, botones, tablas, nombres de campos), los
  clics, los cambios dentro de la misma ventana y si una página la abrió otra
  ventana; cada foto incluye la página reconocida. No registra valores de campos
  y omite el texto dentro de tablas, pero **revisá el listado antes de
  compartirlo**: un botón o enlace fuera de una tabla podría llevar un nombre.

Con ese listado se arma el mapa de rutas (cómo se pasa de una pantalla a otra y
si abre ventana nueva) y se ajusta el catálogo. El relevamiento sólo actúa
mientras está activado.

## Descarga de formularios IVA

- **Archivos:** `descargaContent.js` es el content script de "Marangatu Pro"
  (M-dulo-EXTIVA) con su máquina de etapas, guardadas en `chrome.storage.local`
  bajo `eku_descarga_etapa`: cada página de Marangatu retoma la etapa pendiente
  al cargar (Consultas → Visión Integral → Búsqueda → 211 → tabla de DDJJ →
  imprimir cada formulario). Sin etapa pendiente no hace nada. `descargaBg.js`
  (service worker) recibe el pedido, abre el login, le manda el inicio al
  content script, abre el formulario en otra pestaña cuando éste lo pide y
  publica el avance. `background.js` sólo lo carga con `importScripts`.
- **Mensajes de la app** (mismo control de origen que el resto del puente):
  `APP_PING`, `APP_IVA_DESCARGAR` (`ruc`, `nombre`, `periodos` AAAA-MM o
  `ultimos`, `prefijo`, `demora`, `user`/`pass` opcionales) y
  `APP_DESCARGA_CANCELAR`. Además la app abre un puerto `eku-app` y recibe
  `{ tipo: 'estado', estado }` en cada avance; si el service worker se duerme el
  puerto se cierra y la app lo reabre.
- **Estado:** un solo trabajo a la vez, en `chrome.storage.session` (se borra al
  cerrar el navegador y vence a los 30 min sin avance). Cancelar o cerrar la
  pestaña de Marangatu lo detiene.
- **Límites:** hasta 24 períodos por pedido. El navegador no informa si se
  guardó el PDF o se canceló el diálogo: al cerrarse el diálogo el formulario
  se cuenta como hecho.
- **Preferencias:** el popup recuerda sólo el prefijo y la demora entre
  formularios en `chrome.storage.local`.

## Sesión, pestaña única y panel en Marangatu

- **Una sola pestaña de trabajo:** el login, el Formulario 120 y la descarga
  reutilizan la pestaña de Marangatu que ya esté abierta (o crean una sola).
  La app ya no abre ventanas propias salvo que la extensión no responda.
- **Sesión limpia:** antes de entrar con un cliente se cierra la sesión que
  hubiera (Marangatu comparte la sesión entre pestañas) y se espera la pantalla
  de acceso. Si no se puede cerrar, se avisa y no se sigue.
- **Nunca se traba por la sesión previa:** desde la app, si no se puede cerrar
  la sesión que había (no se reconoce «Salir», o la pestaña se abrió antes de
  cargar la extensión: en ese caso se recarga sola) se sigue con esa sesión y se
  avisa. En ese caso, y si se entró a mano, un RUC distinto detiene la descarga;
  si la extensión entró con la clave del cliente, sólo avisa.
- **Recorrido real (relevamiento del 12/10):** inicio `/eset/` → «CONSULTAS» →
  «VISIÓN INTEGRAL DEL CONTRIBUYENTE» (ventana nueva, `mantenerAbmXsl.do`) →
  Búsqueda → fila 211 (otra ventana nueva, `consultarTransacciones.do`) → cada
  declaración (otra ventana, `consultarDDJJCompleta.do`). Por eso todas las
  ventanas que abre la tarea (en cadena) son parte de ella; la pestaña de lista
  pasa a ser la que informa los formularios encontrados.
- **Sesión:** el encabezado muestra el NOMBRE del usuario (menú
  `#navbarDropdownMenuLink`), no el RUC; «Cerrar sesión» está dentro de ese menú
  y el panel lo abre para buscarlo.
- **Un cliente a la vez:** con una tarea en curso, un segundo pedido responde
  `TAREA_EN_CURSO` (o `DESCARGA_EN_CURSO`). Sólo la pestaña dueña de la descarga
  actúa sobre su etapa (`ETAPA_PERMISO`): otra pestaña de Marangatu abierta a
  mano no la ejecuta.
- **RUC de la sesión:** al entrar desde la app, si la sesión es de otro RUC que
  el pedido se detiene la descarga y se avisa en la app y en el panel. Desde el
  popup sólo se avisa (un contador puede consultar clientes con su propia
  sesión). Si no se logra leer ningún RUC no se bloquea nada.
- **Panel flotante** (`panelContent.js`, Shadow DOM, se oculta al imprimir y no
  aparece en el formulario presentado): muestra el cliente de la app, la sesión
  y los RUC leídos, la pantalla actual y el avance de la tarea; permite cancelar
  y cerrar la sesión, y al terminar ofrece «Cerrar sesión / Dejar abierta».
- **App ↔ extensión:** la app informa el cliente abierto (`APP_CONTEXTO`) y
  puede pedir `APP_CERRAR_SESION`; ambos lados reciben el mismo estado (tarea,
  `contexto`, `sesion`, `aviso`) por el puerto `eku-app` y por `eku-panel`.
- **Provisorio:** el control «Salir» y la ubicación del RUC en el encabezado se
  buscan por heurística (enlaces `logout…`, textos «Salir», «Cerrar sesión»…).
  Se ajustan con el relevamiento de navegación.

## Formulario 120: correspondencia de casillas

`formulario120.js` tiene `MAPA_CASILLAS` (casilla → selector CSS del campo en
Marangatu) y `FORMATO_IMPORTE`. Mientras una casilla no esté en el mapa, se
intenta reconocer por `id`/`name` del tipo `casilla10`, `cas_10` o `c10`. Si
no aparece, se informa como "no encontrada" y no se escribe en ningún otro
campo. Los campos de sólo lectura (los calcula el formulario) no se tocan.

Para completar el mapa:

1. Iniciá sesión en Marangatu y abrí el Formulario 120 **sin cargar datos**.
2. Ícono de la extensión → **Relevar formulario** → **Copiar listado**.
3. El listado tiene, por cada campo, su `id`, `name`, etiqueta y el texto de
   la fila. **No incluye valores ni contraseñas.** Revisalo antes de
   compartirlo y pasalo a quien mantiene la app para armar el mapa.

Si el formulario está dividido en pasos o pestañas, relevá cada paso.

## Origen autorizado

La extensión admite mensajes sólo desde estos orígenes exactos:

- `http://localhost:3000` (desarrollo). El manifest declara
  `http://localhost/*` porque los patrones de Chrome no aceptan puertos, pero
  el service worker vuelve a validar el origen completo y rechaza cualquier
  otro puerto.
- `https://control-clientes-iva.vercel.app` (app publicada en Vercel).

Los deploys de vista previa de Vercel (un subdominio distinto en cada deploy)
quedan afuera a propósito: la extensión sólo funciona desde la dirección de
producción.

Para sumar otro origen (por ejemplo un dominio propio) hay que agregarlo en
`ALLOWED_APP_ORIGINS` (background.js) **y** en
`externally_connectable.matches` (manifest.json), y recargar la extensión. No
debe agregarse un comodín de dominios ni un puerto ficticio.

## Permisos

- `scripting`: inyecta el login y las casillas únicamente en Marangatu.
- `tabs`: abre la página oficial, espera a que cargue y detecta si la
  pestaña activa es Marangatu.
- `storage`: `chrome.storage.session` para las casillas pendientes y la
  descarga en curso; `chrome.storage.local` para el prefijo, la demora y la
  etapa de la descarga en curso (RUC, nombre, períodos y enlaces de los
  formularios; se borra al terminar o cancelar y vence a los 30 min).
- `content_scripts` (`descargaContent.js`): corre sólo en
  `https://marangatu.set.gov.py/*` y sólo actúa si hay una descarga en curso.
- `host_permissions`: limita la inyección a `https://marangatu.set.gov.py/*`
  y, desde la 2.2, a `https://web.whatsapp.com/*` (sólo para pegar la ficha;
  ver abajo).

## Envío de la ficha por WhatsApp Web (v2.2; una pestaña y sin recarga desde la 2.7)

Desde la ficha IVA, **Enviar por WhatsApp** (con "WhatsApp Web" elegido)
manda a la extensión el número del cliente, un mensaje corto y la imagen de
la ficha (`APP_WA_ENVIAR`, sólo desde los orígenes autorizados). La
extensión (`whatsappBg.js`):

1. **Si ya hay una pestaña de WhatsApp Web abierta, usa esa y no la recarga:**
   abre el chat del número con las funciones internas de WhatsApp Web
   (`WAWebCmd.openChatBottom`, `WAWebFindChatAction`, `WAWebWidFactory`,
   `WAWebQueryExistsJob`), pega el texto y pega la imagen. Queda la vista
   previa con la imagen y el texto como pie. **Si no hay ninguna**, abre una
   sola y hace lo mismo cuando WhatsApp termina de cargar. Si WhatsApp
   cambiara esas funciones internas, usa el método anterior (lleva esa misma
   pestaña a `/send?phone=…`), nunca una pestaña nueva. Se inyecta en el
   mundo de la página (`world: 'MAIN'`) porque esas funciones no se ven desde
   el mundo aislado de la extensión.
2. Muestra un aviso arriba de la página con el resultado.
3. **Nunca envía:** la persona revisa la vista previa y toca Enviar. Enviar
   mensajes automáticamente va contra las condiciones de uso de WhatsApp.

No hay content script permanente en WhatsApp Web: no se leen chats ni
mensajes. El pedido (número, texto e imagen) vive en
`chrome.storage.session` y se borra al pegar o a los 3 minutos. Sólo se
aceptan teléfonos de 8 a 15 dígitos e imágenes PNG.

Si WhatsApp cambia su página y el pegado no funciona, el aviso lo dice y la
imagen igual queda en el portapapeles (la app la copia antes de abrir el
chat): se pega con Ctrl+V. Con la app de escritorio de WhatsApp no hay pegado
automático (la extensión no puede actuar sobre otros programas).

## Seguridad

- **Credenciales:** nunca se guardan. El RUC y la clave existen sólo en
  memoria durante la apertura del login; no se colocan en la URL, el
  historial ni el portapapeles.
- **Casillas del Formulario 120:** se guardan en `chrome.storage.session`,
  que vive en la memoria del navegador (no en disco), se borra al cerrarlo y,
  además, vence a los 30 minutos. **Descartar datos** las elimina antes.
  Sólo se aceptan números (casilla e importe) y un período AAAA-MM válido.
- La extensión no usa `localStorage` ni archivos CSV y no conserva listas de
  clientes. En `chrome.storage.local` guarda el prefijo, la demora y la etapa de
  la descarga en curso (sin claves, y se borra al terminar o cancelar).
- `externally_connectable.matches` no admite sandboxes ni dominios con comodín;
  además, el service worker exige que el origen declarado y la URL remitente
  coincidan con la lista interna de orígenes exactos.
- Si un CSV con contraseñas fue compartido o versionado anteriormente, las
  claves afectadas deben rotarse y el archivo debe eliminarse también del
  historial correspondiente.

> La mensajería directa con la extensión funciona en Chrome, Edge y otros
> navegadores Chromium. Sin la extensión, Control Clientes abre Marangatu para
> realizar el acceso manual, y **Copiar lista** deja las casillas en el
> portapapeles para cargarlas a mano.
