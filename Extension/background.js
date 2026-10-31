// Service worker del puente "Ekuatia Login".
//
// Atiende exclusivamente pedidos externos de Control Clientes:
//  - APP_AUTO_LOGIN: la app manda { user, pass }; se abre el login de
//    Marangatu y se inyecta una sola vez.
//  - APP_IVA_PREPARE: la app manda las casillas del Formulario 120 de un
//    cliente. Se guardan en chrome.storage.session (memoria del navegador,
//    se borra al cerrarlo) con vencimiento, hasta que desde el popup se
//    pulsa "Completar formulario". Si vienen credenciales, además abre el
//    login como APP_AUTO_LOGIN.
// Las credenciales nunca se guardan, ni se colocan en la URL, el historial
// o el portapapeles.
// seleccionarObligacionIva y mostrarReferenciaIva viven en formulario120.js.
// La descarga de formularios IVA (APP_IVA_DESCARGAR, popup) vive en
// descargaBg.js, que comparte el ámbito global de este archivo. La pestaña de
// trabajo, el cierre de sesión y el estado compartido con la app viven en
// sesionBg.js.
importScripts('formulario120.js', 'sesionBg.js', 'descargaBg.js', 'whatsappBg.js');

const LOGIN_URL = 'https://marangatu.set.gov.py/eset/login';
const MARANGATU_HOST = 'marangatu.set.gov.py';
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const IVA_STORAGE_KEY = 'ivaPendiente';
const IVA_TTL_MS = 30 * 60 * 1000;
const MAX_CASILLAS = 120;

// Orígenes exactos de Control Clientes que pueden hablarle a la extensión:
// el servidor de desarrollo y la app publicada en Vercel. El manifest de
// Chrome no permite restringir un patrón por puerto; por eso allí se declara
// localhost y acá se exige el origen completo. Los deploys de vista previa de
// Vercel (otro subdominio en cada deploy) no se agregan a propósito.
const ALLOWED_APP_ORIGINS = new Set([
  'http://localhost:3000',
  'https://control-clientes-iva.vercel.app',
]);

chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (!msg || (msg.action !== 'APP_AUTO_LOGIN' && msg.action !== 'APP_IVA_PREPARE')) return false;

  const senderOrigin = getVerifiedSenderOrigin(sender);
  if (!senderOrigin || !ALLOWED_APP_ORIGINS.has(senderOrigin)) {
    sendResponse({ ok: false, error: 'origen no autorizado' });
    return false;
  }

  const user = String(msg.user || '').trim();
  const pass = String(msg.pass || '');

  if (msg.action === 'APP_AUTO_LOGIN' && !user) {
    sendResponse({ ok: false, error: 'sin usuario' });
    return true;
  }
  let pendiente = null;
  if (msg.action === 'APP_IVA_PREPARE') {
    pendiente = validarIva(msg);
    if (!pendiente) {
      sendResponse({ ok: false, error: 'datos del formulario inválidos' });
      return true;
    }
  }

  // Una sola tarea a la vez: con una descarga en curso no se toca la sesión.
  (async () => {
    if (await leerJob()) { sendResponse({ ok: false, error: 'TAREA_EN_CURSO' }); return; }
    if (pendiente) {
      try { await chrome.storage.session.set({ [IVA_STORAGE_KEY]: pendiente }); } catch { sendResponse({ ok: false, error: 'no se pudieron guardar los datos' }); return; }
    }
    // Después del login (automático o a mano) el Formulario 120 entra a
    // "Presentar Declaración". Se reutiliza la pestaña de Marangatu que haya.
    const r = await abrirLogin(user, pass, pendiente ? irAPresentarCuandoEntre : undefined);
    sendResponse(r && r.ok ? { ok: true } : { ok: false, error: (r && r.error) || 'No se pudo abrir Marangatu.' });
  })();
  return true;
});

// Mientras haya casillas pendientes, en cada página de Marangatu se muestra
// la referencia (cliente y período) y, en "Presentar Declaración", se eligen
// 211 - IVA General, Mensual, año y mes. Se hace una vez por carga de página.
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete') return;
  let url;
  try { url = new URL(tab.url || ''); } catch { return; }
  if (url.hostname !== MARANGATU_HOST || url.pathname.includes('/login')) return;

  chrome.storage.session.get([IVA_STORAGE_KEY, DESCARGA_KEY], (data) => {
    // Las pestañas de una descarga en curso las maneja descargaBg.js: acá no
    // se completa ni se marca nada en ellas.
    const d = data && data[DESCARGA_KEY];
    if (d && (d.tabLista === tabId || d.tabForm === tabId)) return;
    const p = data && data[IVA_STORAGE_KEY];
    if (!p || p.expiresAt < Date.now()) return;
    const ref = referenciaPeriodo(p);
    // Formulario 120 abierto: se completa solo, únicamente en los campos
    // vacíos (nunca pisa lo que la persona ya escribió) y el resultado se
    // muestra en el recuadro de referencia.
    chrome.scripting.executeScript(
      { target: { tabId, allFrames: true }, func: completarFormulario120, args: [p.casillas, MAPA_CASILLAS, FORMATO_IMPORTE, p.control || [], true] },
      (frames) => {
        void chrome.runtime.lastError;
        const r = (frames || []).map((f) => f.result).find((x) => x && x.esFormulario);
        chrome.scripting.executeScript(
          { target: { tabId }, func: mostrarReferenciaIva, args: [{ ...ref, resultado: r || null }] },
          () => void chrome.runtime.lastError
        );
      }
    );
    if (url.pathname.includes('recibirDDJJContribuyente.do')) {
      chrome.scripting.executeScript(
        { target: { tabId }, func: seleccionarObligacionIva, args: [ref.anio, ref.mes] },
        () => void chrome.runtime.lastError
      );
    }
  });
});

// "2026-05" -> datos para la referencia: el IVA de mayo se presenta en junio.
function referenciaPeriodo(p) {
  const [anio, mes] = p.periodo.split('-').map(Number);
  const presenta = mes === 12 ? { m: 1, a: anio + 1 } : { m: mes + 1, a: anio };
  return {
    nombre: p.nombre || 'Cliente',
    ruc: p.ruc,
    anio,
    mes,
    mesTexto: MESES[mes - 1],
    periodoTexto: MESES[mes - 1] + ' ' + anio,
    presentaTexto: MESES[presenta.m - 1] + ' ' + presenta.a,
  };
}

// Espera a que la pestaña salga del login y, en la página de inicio, entra a
// "Presentar Declaración" (enlace recibirDDJJContribuyente.do, cuyo token
// _cyp es de la sesión: se toma del propio enlace de la página). Se rinde a
// los 3 minutos o cuando ya entró. No completa ni presenta nada.
const PRESENTAR_TIMEOUT_MS = 3 * 60 * 1000;

function irAPresentarCuandoEntre(tabId) {
  const limite = Date.now() + PRESENTAR_TIMEOUT_MS;
  const onUpdated = (id, info, tab) => {
    if (id !== tabId || info.status !== 'complete') return;
    if (Date.now() > limite) {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      return;
    }
    const url = String(tab.url || '');
    if (url.includes('/login') || url.includes('recibirDDJJContribuyente.do')) {
      if (url.includes('recibirDDJJContribuyente.do')) chrome.tabs.onUpdated.removeListener(onUpdated);
      return;
    }
    chrome.scripting.executeScript(
      { target: { tabId }, func: abrirPresentarDeclaracion },
      (res) => {
        if (!chrome.runtime.lastError && res && res[0] && res[0].result) {
          chrome.tabs.onUpdated.removeListener(onUpdated);
        }
      }
    );
  };
  chrome.tabs.onUpdated.addListener(onUpdated);
}

// Inyectada en Marangatu: navega (en la misma pestaña) al enlace de
// "Presentar Declaración" si está en la página. Devuelve si lo encontró.
function abrirPresentarDeclaracion() {
  const link = document.querySelector('a[href*="recibirDDJJContribuyente.do"]')
    || [...document.querySelectorAll('a')].find((a) =>
      /presentar declaraci/i.test(a.title || a.getAttribute('data-tooltip') || ''));
  if (!link || !link.href) return false;
  location.href = link.href;
  return true;
}

// Sólo números: casilla (1 a 4 dígitos) e importe entero en guaraníes.
function validarIva(msg) {
  const periodo = String(msg.periodo || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) return null;
  const casillas = validarLista(msg.casillas, true);
  const control = validarLista(msg.control || [], false);
  if (!casillas || !control) return null;
  return {
    ruc: String(msg.ruc || '').replace(/\D/g, '').slice(0, 12),
    nombre: String(msg.nombre || '').slice(0, 120),
    periodo,
    casillas,
    control,
    expiresAt: Date.now() + IVA_TTL_MS,
  };
}

function validarLista(lista, obligatoria) {
  if (!Array.isArray(lista) || lista.length > MAX_CASILLAS || (obligatoria && !lista.length)) return null;
  const out = [];
  for (const c of lista) {
    const cas = String(c && c.cas);
    const valor = Number(c && c.valor);
    if (!/^\d{1,4}$/.test(cas) || !Number.isFinite(valor) || !Number.isInteger(valor)) return null;
    out.push({ cas, valor });
  }
  return out;
}

// Deja UNA pestaña de Marangatu en el acceso, sin sesión previa (sesionBg.js:
// reutiliza la que exista y cierra la sesión que hubiera), y entra con las
// credenciales si vienen. despues(tabId): opcional, se llama con la pestaña lista
// (ej. para seguir hasta "Presentar Declaración" una vez iniciada la sesión).
// Devuelve { ok, tabId } o { ok: false, error }.
function abrirLogin(user, pass, despues, opciones) {
  return conCandadoDeSesion(async () => {
    const r = await prepararPestanaLogin(opciones);
    if (!r.ok) { await publicarAviso(r.error); return r; }
    const tabId = r.tabId;
    if (r.aviso) await publicarAviso(r.aviso);
    if (despues) await despues(tabId, r);
    if (user && !r.sesionActiva) {
      // El formulario puede dibujarse tarde: se reintenta unas veces.
      for (let i = 0; i < 6; i += 1) {
        let res = null;
        try { res = await chrome.scripting.executeScript({ target: { tabId }, func: inyectarLogin, args: [user, pass] }); } catch { res = null; }
        if (res && res[0] && res[0].result) break;
        await dormir(400);
      }
    }
    return { ok: true, tabId, sesionActiva: !!r.sesionActiva };
  });
}

// Chrome informa tanto el origen como la URL de la página remitente. Ambos
// valores deben existir y coincidir: no se acepta un fallback permisivo cuando
// falta alguno, porque esta verificación protege la apertura automática.
function getVerifiedSenderOrigin(sender) {
  const declaredOrigin = normalizeHttpOrigin(sender?.origin);
  const urlOrigin = normalizeHttpOrigin(sender?.url);
  if (!declaredOrigin || !urlOrigin || declaredOrigin !== urlOrigin) return '';
  return declaredOrigin;
}

function normalizeHttpOrigin(value) {
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

// Se inyecta en la página de login (función serializada por executeScript).
function inyectarLogin(user, pass) {
  const u = document.querySelector(
    "input[type='text'], input[type='email'], input[name*='user'], input[id*='user']"
  );
  const p = document.querySelector(
    "input[type='password'], input[name*='pass'], input[id*='pass']"
  );
  if (!u || !p) return false;

  u.value = user;
  u.dispatchEvent(new Event('input', { bubbles: true }));
  p.value = pass;
  p.dispatchEvent(new Event('input', { bubbles: true }));

  setTimeout(() => {
    const btn = document.querySelector("button[type='submit'], input[type='submit']");
    if (btn) btn.click();
  }, 800);
  return true;
}
