// Puente con la extensión "Ekuatia Login" (Marangatu / SET).
//
// Abre el login de la SET y, si la extensión está instalada y configurada
// (MARANGATU_EXT_ID), le pasa las credenciales por mensajería externa: un
// canal en memoria que nunca las deja en la URL, el historial ni el
// portapapeles. Si no hay extensión, igual abre la página para cargar el
// login a mano.
import { MARANGATU_LOGIN_URL, MARANGATU_EXT_ID } from './config';

// La extensión reutiliza UNA pestaña de Marangatu y cierra la sesión que hubiera;
// por eso sólo se abre una ventana propia cuando la extensión no responde. Si
// responde con un rechazo (otra tarea en curso, sesión que no se pudo cerrar) no
// se abre nada más: se avisa con onError(mensaje).
export function openMarangatuLogin({ user, pass }, onError) {
  const runtime = typeof chrome !== 'undefined' ? chrome.runtime : undefined;
  if (MARANGATU_EXT_ID && runtime?.sendMessage) {
    try {
      runtime.sendMessage(MARANGATU_EXT_ID, { action: 'APP_AUTO_LOGIN', user, pass }, (resp) => {
        if (runtime.lastError || resp?.error === 'sin usuario') {
          window.open(MARANGATU_LOGIN_URL, '_blank', 'noopener');
        } else if (!resp?.ok && onError) {
          onError(mensajeDeError(resp?.error));
        }
      });
      return 'extension';
    } catch {
      // cae al fallback de navegador
    }
  }
  window.open(MARANGATU_LOGIN_URL, '_blank', 'noopener');
  return 'browser';
}

// Le pasa a la extensión las casillas del Formulario 120 de un cliente. La
// extensión las guarda sólo en memoria (chrome.storage.session, con
// vencimiento) hasta que se pulsa "Completar formulario" en Marangatu, y
// abre el login con las credenciales si vienen. Resuelve { ok, error }.
export function sendIvaToMarangatu({ ruc, nombre, periodo, casillas, control = [], credentials }) {
  const runtime = typeof chrome !== 'undefined' ? chrome.runtime : undefined;
  if (!MARANGATU_EXT_ID || !runtime?.sendMessage) {
    return Promise.resolve({ ok: false, error: 'NO_EXTENSION' });
  }
  return new Promise((resolve) => {
    try {
      runtime.sendMessage(
        MARANGATU_EXT_ID,
        {
          action: 'APP_IVA_PREPARE',
          ruc,
          nombre,
          periodo,
          casillas: casillas.map(({ cas, valor }) => ({ cas, valor })),
          control: control.map(({ cas, valor }) => ({ cas, valor })),
          user: credentials?.user || '',
          pass: credentials?.pass || '',
        },
        (resp) => {
          if (runtime.lastError) resolve({ ok: false, error: 'NO_EXTENSION' });
          else resolve(resp?.ok ? { ok: true } : { ok: false, error: resp?.error || 'ERROR' });
        }
      );
    } catch {
      resolve({ ok: false, error: 'NO_EXTENSION' });
    }
  });
}

// ---------------------------------------------------------------------------
// Descarga de formularios IVA (DDJJ ya presentadas)
//
// Dos canales con la extensión:
//  - mensajes sueltos (ping, pedir, cancelar), que responden { ok, error };
//  - un puerto ('eku-app') por el que la extensión empuja el avance, para que
//    la pantalla reaccione sin consultar. Si el service worker de la extensión
//    se duerme el puerto se cierra y acá se reabre solo (recibe el estado).
// Sin extensión (o sin VITE_MARANGATU_EXT_ID) todo resuelve NO_EXTENSION.
// ---------------------------------------------------------------------------

// Texto para mostrar de los errores que devuelve la extensión.
export function mensajeDeError(error) {
  if (error === 'TAREA_EN_CURSO') return 'Hay una tarea en curso en Marangatu. Cancelala o esperá a que termine.';
  if (error === 'DESCARGA_EN_CURSO') return 'Ya hay una descarga en curso.';
  if (error === 'WA_TELEFONO') return 'El número de WhatsApp del cliente no es válido. Revisalo en la ficha.';
  if (error === 'WA_IMAGEN' || error === 'WA_IMAGEN_GRANDE') return 'No se pudo preparar la imagen de la ficha para WhatsApp.';
  if (error === 'WA_ORIGEN') return 'La extensión no reconoce esta dirección de la app. Actualizala (Recargar en chrome://extensions).';
  return error || 'La extensión no pudo completar el pedido.';
}

function enviarAExtension(mensaje) {
  const runtime = typeof chrome !== 'undefined' ? chrome.runtime : undefined;
  if (!MARANGATU_EXT_ID || !runtime?.sendMessage) {
    return Promise.resolve({ ok: false, error: 'NO_EXTENSION' });
  }
  return new Promise((resolve) => {
    try {
      runtime.sendMessage(MARANGATU_EXT_ID, mensaje, (resp) => {
        if (runtime.lastError) resolve({ ok: false, error: 'NO_EXTENSION' });
        else resolve(resp || { ok: false, error: 'ERROR' });
      });
    } catch {
      resolve({ ok: false, error: 'NO_EXTENSION' });
    }
  });
}

// ¿Está instalada y alcanzable? Resuelve { ok, version, descarga } o { ok: false }.
export function pingExtension() {
  return enviarAExtension({ action: 'APP_PING' });
}

// Pide bajar los formularios de IVA de un cliente. Con `periodos` (AAAA-MM) o
// con `ultimos` (cantidad de meses más recientes). Si el cliente tiene login
// (`credentials`: { user, pass }) la extensión inicia sesión sola.
export function pedirDescargaIva({ ruc, nombre, periodos, ultimos, prefijo, demora, credentials }) {
  return enviarAExtension({
    action: 'APP_IVA_DESCARGAR',
    ruc,
    nombre,
    ...(periodos ? { periodos } : { ultimos }),
    prefijo,
    demora,
    user: credentials?.user || '',
    pass: credentials?.pass || '',
  });
}

export function cancelarDescargaIva() {
  return enviarAExtension({ action: 'APP_DESCARGA_CANCELAR' });
}

// Le avisa a la extensión en qué cliente trabaja la app (para que el panel de
// Marangatu lo muestre y detecte una sesión de otro cliente). null = ninguno.
// Sólo viaja el RUC y el nombre, y se guarda en memoria del navegador.
export function enviarContextoApp(cliente) {
  return enviarAExtension({
    action: 'APP_CONTEXTO',
    ruc: cliente?.ruc || '',
    nombre: cliente?.nombre || '',
  });
}

// Cierra la sesión abierta en Marangatu (cancela antes la tarea en curso).
export function cerrarSesionMarangatu() {
  return enviarAExtension({ action: 'APP_CERRAR_SESION' });
}

// Escucha el avance de la descarga. callback(estado | null): null = no hay
// extensión. Devuelve la función para dejar de escuchar.
export function suscribirDescargaIva(callback) {
  const runtime = typeof chrome !== 'undefined' ? chrome.runtime : undefined;
  if (!MARANGATU_EXT_ID || !runtime?.connect) {
    callback(null);
    return () => {};
  }
  let puerto = null;
  let activo = true;
  let intentos = 0;
  let timer = null;

  const conectar = () => {
    if (!activo) return;
    try {
      puerto = runtime.connect(MARANGATU_EXT_ID, { name: 'eku-app' });
    } catch {
      callback(null);
      return;
    }
    puerto.onMessage.addListener((m) => {
      intentos = 0;
      if (m?.tipo === 'estado') callback(m.estado);
    });
    puerto.onDisconnect.addListener(() => {
      void runtime.lastError;
      puerto = null;
      if (!activo) return;
      intentos += 1;
      if (intentos > 5) { callback(null); return; } // sin extensión: no insistir
      timer = setTimeout(conectar, 800 * intentos);
    });
  };

  conectar();
  return () => {
    activo = false;
    clearTimeout(timer);
    try { puerto?.disconnect(); } catch { /* ya cerrado */ }
  };
}

// Envía la ficha por WhatsApp Web a través de la extensión: abre el chat del
// número con el texto escrito y pega la imagen. Quien envía es la persona.
// imagen: data URL PNG. Resuelve { ok } o { ok: false, error } (NO_EXTENSION).
export function enviarWhatsappExtension({ telefono, texto, imagen, nombre }) {
  return enviarAExtension({ action: 'APP_WA_ENVIAR', telefono, texto, imagen, nombre });
}
