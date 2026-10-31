# Pendientes — Control Remoto Clientes

Estado de referencia: autenticación individual y configuración inicial de PIN probadas correctamente en localhost contra el Apps Script desplegado.

## Obligatorio antes de producción

- [ ] **Completar el alta de PIN de todos los usuarios.**
  - Cada celda de `Usuarios!C` debe contener un hash que comience con `v1:`.
  - Nunca escribir ni conservar PIN en texto claro dentro de la hoja.

- [ ] **Cerrar la autoactivación cuando todos tengan PIN.**
  - Ejecutar en Apps Script: `desactivarAccesoSinPin`.
  - Verificar en Script Properties:
    - `ALLOW_SELF_PIN_SETUP=false`
    - `ALLOW_PINLESS_LOGIN=false`

- [ ] **Rotar el token global que sigue vigente durante testing.**
  1. Generar un token nuevo fuera del repositorio.
  2. Actualizar `API_TOKEN` en Script Properties.
  3. Actualizar `VITE_API_TOKEN` en el `.env` local.
  4. Recompilar frontend y APK.
  5. Retirar las compilaciones que contienen el token anterior.

- [ ] **Validar la política de sesión completa.**
  - Cinco PIN incorrectos bloquean durante 15 minutos.
  - Sesión inactiva durante 60 minutos.
  - Duración máxima de sesión de 4 horas.
  - Sesión revocada vuelve a la pantalla de acceso y limpia las filas en memoria.
  - Cambio de usuario limpia sesión, navegación y datos privados.

- [ ] **Probar permisos con cuentas reales de cada rol.**
  - `USUARIO`: edita datos permitidos, Presentado y Archivado; no cambia Encargado.
  - `ADMINISTRADOR` y `SUPERUSUARIO`: pueden asignar y cambiar Encargado.
  - Confirmar que el backend rechaza una asignación no autorizada, aunque se intente fuera de la interfaz.

## Unificación con Vencimientos IVA

- [ ] Agregar `AppsScript-Iva.gs` como archivo nuevo del proyecto de Apps
  Script, sumar las 2 líneas de `handleIvaAction` en `doPost` y publicar una
  nueva versión del Web App (ver README, "Instalar el módulo de IVA").
- [ ] `npm install` (se agregaron `jspdf` y `html2canvas`, que antes venían
  por CDN) y recompilar frontend y APK.
- [ ] Confirmar que la planilla mensual tiene columna de RUC y que el
  desfase hoja → período fiscal (`DESFASE_PERIODO_FISCAL = -1`) es el que
  usa la oficina.
- [ ] Si había datos en Netlify: correr `migrarDesdeVencimientosIvaNetlify`,
  verificar algunas fichas contra la app vieja y recién ahí dar de baja el
  sitio de Netlify y la variable `CLAVE_ACCESO`.
- [ ] Probar con cada rol: cargar una liquidación, descargar imagen/PDF,
  libro de compras y ventas, PDF del período, y que `USUARIO` no pueda
  cambiar colores/feriados/mora.

## Copiar el IVA al Formulario 120 de Marangatu

- [x] Botón **Copiar a Marangatu** en la ficha IVA, modal de revisión y envío
  a la extensión (`APP_IVA_PREPARE`); extensión con **Completar formulario**
  y **Relevar formulario** (v1.4).
- [ ] Relevar el Formulario 120 real (sin datos) y completar `MAPA_CASILLAS`
  y `FORMATO_IMPORTE` en `Extension/formulario120.js`.
- [ ] Confirmar contra el formulario real qué casillas se cargan a mano y
  cuáles calcula DNIT (`casillasFormulario120` en `src/iva/ivaCore.js` es
  provisoria; el Rubro 6 no tiene casilla asignada).
- [ ] Evaluar la navegación automática login → Formulario 120 del período
  (depende del menú de Marangatu).
- [ ] Agregar el origen de la app publicada a la extensión (ver su README).

## Aplicación Android

- [ ] Incrementar `versionCode` y `versionName` antes de distribuir una actualización.
- [ ] Ejecutar `npm run build` con el `.env` correcto.
- [ ] Ejecutar `npx cap sync android`.
- [ ] Compilar, firmar e instalar un APK actualizado desde Android Studio.
- [ ] Probar alta inicial, login, cambio de usuario, expiración y permisos desde el teléfono.
- [ ] No seguir utilizando el APK antiguo: no entiende el contrato de sesiones individuales.

## Recuperación y gestión de usuarios

- [x] Agregar una opción autenticada **Cambiar mi PIN**.
  - Implementada en `AppsScript-Code-auth-PROPUESTA.gs` (acción `changePin`),
    `src/api.js`, `src/components/SettingsDialog.jsx` y `src/App.jsx`.
  - Vive dentro del modal **Configuración**, junto con el tema claro/oscuro.
  - El cambio de usuario queda donde estaba (píldora de usuario en la barra),
    sin exponerlo para usuarios normales en el panel de Configuración.
  - Falta desplegar el backend actualizado y probar contra el Web App real.
- [x] Evaluar un panel exclusivo para `SUPERUSUARIO` que restablezca un PIN temporal y fuerce su cambio.
  - Implementado en `AppsScript-Code-auth-PROPUESTA.gs` (acciones `adminListUsers` y `adminResetPin` con hash `v1-temp:`), `src/api.js`, `src/components/SettingsDialog.jsx` y `src/App.jsx`.
  - Cuando un usuario ingresa con PIN temporal (`mustChangePin: true`), se abre automáticamente el diálogo de cambio obligatorio de PIN antes de continuar.
- [x] Implementar baja/reactivación de usuarios y revocación inmediata de todas sus sesiones.
  - Implementado en `AppsScript-Code-auth-PROPUESTA.gs` (acciones `adminSetUserActive` sobre columna D `ESTADO` y `adminRevokeUserSessions`) y expuesto en Configuración para `SUPERUSUARIO`.
- [x] Evaluar validación al recuperar el foco y bloqueo `fail closed` cuando no se pueda renovar autorización.
  - En `src/App.jsx`, al volver a la pestaña (`visibilitychange` / `focus`) se valida la sesión contra el servidor de inmediato (con throttle de 5 s) y se fuerza el cierre (`fail closed`) si expiró por tiempo/inactividad o si falla reiteradamente la renovación.

### Recuperación manual disponible actualmente

1. Crear temporalmente `PIN_SETUP_USER` y `PIN_SETUP_VALUE` en Script Properties.
2. Ejecutar `aplicarPinPendienteDesdeProperties`.
3. La función reemplaza el hash, revoca las sesiones y elimina ambas propiedades temporales.
4. Se establece un PIN nuevo; el PIN anterior no se recupera ni se muestra.

## Migración a la nueva interfaz (UI ejecutiva)

Estado: la UI ejecutiva es la que se monta en `src/main.jsx`
(`uiMode="executive"`). La lista anterior (`ClientList`) ya no existe como
archivo, así que lo que no se haya reimplementado en `ExecutiveDashboard`
quedó fuera de la aplicación aunque su CSS siga en `styles.css`.

### Migrado

- [x] **Legibilidad del texto.** El tema ejecutivo fijaba tamaños de 7, 8, 9
  y 10px en 39 reglas. Ahora hay una escala tipográfica con tokens
  (`--rx-fs-*` en `preview.css`), con **12px como mínimo**, y todos los
  contenedores que tenían alto/ancho fijo pasaron a medirse en `em` o
  `minmax()` para que nada se corte al agrandar.
- [x] **Tamaño de texto configurable.** Configuración → Preferencias →
  *Tamaño de texto* (Compacto / Normal / Grande / Extra). Se guarda por
  dispositivo (`src/uiPreferences.js`) y multiplica toda la escala vía
  `--ui-font-scale`.
- [x] **Zoom del sistema habilitado.** `index.html` ya no usa
  `maximum-scale=1, user-scalable=no`, que impedía agrandar con el pellizco.
- [x] **Rendimiento de la lista.** La tabla renderizaba todas las filas de
  una vez (~3.600 nodos con 300 clientes). Ahora usa virtualización con
  `@tanstack/react-virtual` —la dependencia ya estaba instalada y sin
  usar—, la fila es un componente memoizado y el estado derivado de cada
  fila se calcula una sola vez en un `Map` en lugar de recalcularse dentro
  del `sort` y del render.
- [x] **Búsqueda sin trabas.** El input tiene estado propio y la lista se
  actualiza con `useDeferredValue`, así escribir no espera al filtrado.
- [x] **Acciones rápidas en la lista.** Presentado y Archivado se marcan
  desde la fila, con sello de usuario y reversión automática si el guardado
  falla (equivalente al swipe de la versión anterior).
- [x] **Filtros avanzados.** Vencimiento, estado y encargado volvieron en el
  panel *Más filtros*; usan el contexto compartido, así que lo que se elige
  también aplica en "Asignar clientes".
- [x] **Resumen por vencimiento.** Panel con presentados/pendientes por día;
  cada día filtra la cartera.
- [x] **Botón de Marangatu.** `openMarangatuLogin()` y
  `findClaveMarangatuColumn()` habían quedado como código muerto: ningún
  componente los llamaba, pese a que el README lo listaba como función
  vigente. Vuelve a estar en la cabecera del detalle del cliente.

### Pendiente de esta migración

- [ ] **Probar las acciones rápidas contra el backend real.** Se validaron
  contra un mock local; falta confirmar el guardado y el sello de usuario
  contra el Apps Script desplegado.
- [x] **Definir qué pasa con el orden manual (`sortBy`).** Se expuso el
  selector de orden (A–Z / vencimiento) conectado a `sortBy`.
- [x] **Limpiar el CSS huérfano de la interfaz anterior.** Eliminadas las
  clases sin uso en JSX (`client-card*`, `client-list`, `swipe-*`,
  `summary-*`, `filters-sheet-*`, `status-badge-*`, `toggle-switch-*`, etc.)
  y los activos muertos (`src/assets/hero.png`, `src/assets/vite.svg`,
  `public/icons.svg`, `public/favicon.svg`).
- [x] **Revisar el resto de pantallas con la escala nueva.** Todas las reglas
  tipográficas de `styles.css` y los estilos inline de `ClientDetail`,
  `AssignClients`, `NewClient` y los pickers ahora acompañan `--ui-font-scale`
  con mínimo base de 12px.

## Funciones pendientes fuera de autenticación

- [x] Implementar `action: "create"` en el backend antes de habilitar definitivamente el alta de nuevos clientes.
- [ ] Configurar el ID definitivo de la extensión donde corresponda.
- [ ] Definir, si se necesita una aplicación de PC, el puerto/origen y protocolo del puente local.
- [x] Revisar los warnings heredados del lint y el estado de dependencias con `npm audit` en una tarea separada.
  - `npm run lint` pasó de 8 warnings a **0 warnings / 0 errores**: los `set-state-in-effect`
    de los pickers (Year/Name/Month), del contexto (`ClientsContext`) y del menú mobile en
    `App.jsx`, más un falso positivo de `react/only-export-components` (deshabilitado puntualmente
    con su justificación). Los pickers cargan una sola vez al montar y reintentan solo con su botón.
  - `npm audit`: 3 vulnerabilidades **moderate** (dev-only, cadena `@capacitor/cli` → `xcode` →
    `uuid` <11.1.1). Sin fix disponible en la versión publicada de Capacitor; no aplica a la app
    compilada ni al APK. Re-evaluar al actualizar Capacitor.
- [x] Actualizar la documentación general del `README.md`, que todavía describe el flujo inicial del proyecto.
  - Describe autenticación por PIN, sesión, roles, lista, detalle,
    asignación, panel ejecutivo, Configuración y notas de seguridad.

## Operación y respaldo

- [ ] Conservar el backup privado del `Code.gs` anterior mientras dure la migración.
- [ ] Conservar una versión anterior del Web App para rollback hasta terminar las pruebas.
- [ ] Mantener fuera de Git y del chat:
  - `API_TOKEN`;
  - `PIN_PEPPER`;
  - PIN reales;
  - IDs reales de planillas;
  - URLs privadas de despliegue.
- [ ] Al copiar `AppsScript-Code-auth-PROPUESTA.gs` a Apps Script, reemplazar localmente `REEMPLAZAR_POR_TU_ID_ACTUAL` y verificar el mapeo real de la pestaña `Planillas`.

## Estado de los hallazgos originales

- [ ] **Punto 1:** transporte POST y `doGet` bloqueado; falta rotar el token global antes de producción.
- [ ] **Punto 2:** autenticación y autorización implementadas; falta cerrar autoactivación, terminar pruebas y agregar gestión de bajas si se requiere.
- [x] **Punto 3:** extensión Marangatu convertida en puente sin persistencia independiente.
- [x] **Punto 4:** orígenes de la extensión restringidos a localhost.
- [x] **Punto 5:** backup Android desactivado.
- [x] **Punto 6:** archivo vacío eliminado.

## Descarga de formularios IVA (extensión v2.0)

- [ ] Recargar la extensión (`chrome://extensions` → Recargar) y probar con un
  cliente real: desde la ficha IVA → **Descargar formularios** y desde el
  popup de la extensión.
- [ ] Confirmar en Marangatu que Consultas → Visión Integral → Búsqueda → 211
  funciona con el portal actual (los selectores son del módulo original).
- [ ] Revisar cómo se comporta el diálogo de impresión: ¿recuerda el destino
  «Guardar como PDF» y la carpeta? Si pide confirmación en cada formulario,
  evaluar si alcanza o si hace falta otra vía.
- [x] Al publicar la app, agregar su origen exacto en `ALLOWED_APP_ORIGINS` y
  `externally_connectable` (vale también para la descarga y el puerto).

## Navegación estandarizada en Marangatu

- [ ] Correr el **relevamiento de navegación** en el portal real, con un cliente:
  iniciar registro → inicio (marcar «madre») → Consultas → Visión Integral →
  Búsqueda → 211 → lista de DDJJ → abrir un formulario → Presentar Declaración →
  Formulario 120. Copiar el listado, revisarlo y pasarlo.
- [ ] Con ese listado: confirmar la regla de `INICIO` (hoy provisoria), anotar
  qué pasos abren ventana nueva y armar el mapa de rutas.
- [ ] Fase 2 (después del mapa): navegador que vuelve a la madre y recalcula la
  ruta si la página no es la esperada (2 reintentos y pausa con aviso), con la
  descarga de IVA migrada y la versión actual como respaldo.


## Envío de la ficha por WhatsApp Web (extensión v2.2)

- [ ] Recargar la extensión (aceptar el permiso nuevo de `web.whatsapp.com`)
  y probar **Enviar por WhatsApp** con WhatsApp Web vinculado: que se abra el
  chat del número y la imagen aparezca sola en la vista previa.
- [ ] Si WhatsApp Web no acepta el pegado simulado, revisar los selectores
  del cuadro de mensaje en `Extension/whatsappBg.js` (mientras tanto, Ctrl+V).

## WhatsApp Web: una sola pestaña, sin recarga, texto e imagen (extensión v2.7)

Probado el 14/10/2026 contra WhatsApp Web real (chat propio, sin enviar):
abre el chat sin recargar, pega texto e imagen y queda la vista previa.

- [ ] `git pull` en la carpeta desde la que se cargó la extensión,
  `chrome://extensions` → Recargar y confirmar que diga **2.7**.
- [ ] Con WhatsApp Web abierto, enviar dos fichas seguidas a clientes
  distintos: misma pestaña, sin recarga, imagen + texto en la vista previa.
- [ ] Con WhatsApp Web cerrado: debe abrirse una sola pestaña y completar.
- [ ] Si alguna vez vuelve a recargar la pestaña, WhatsApp cambió sus
  funciones internas: revisar los nombres de módulo en `operarWhatsapp`.
