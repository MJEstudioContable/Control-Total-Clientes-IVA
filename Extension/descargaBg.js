// Descarga de formularios IVA (DDJJ ya presentadas): lado service worker.
//
// Se carga con importScripts('formulario120.js', 'sesionBg.js', 'descargaBg.js')
// desde background.js y comparte su ámbito global: usa LOGIN_URL, MARANGATU_HOST,
// ALLOWED_APP_ORIGINS, getVerifiedSenderOrigin, abrirLogin y (de sesionBg.js)
// emitirEstado, publicarAviso, mensajePanel y rucCoincide.
//
// El recorrido por Marangatu (Consultas -> Visión Integral -> Búsqueda -> 211
// -> tabla de DDJJ -> imprimir cada formulario) lo hace descargaContent.js, el
// content script probado de "Marangatu Pro", con sus etapas guardadas en
// chrome.storage.local. Este archivo sólo:
//  - recibe el pedido: de la app (mensajería externa APP_IVA_DESCARGAR) o del
//    popup (POPUP_DESCARGA_INICIAR, con la sesión ya iniciada);
//  - desde la app, abre el login y, apenas la pestaña entra a Marangatu, le
//    manda INICIAR_DESCARGA_IVA al content script;
//  - atiende los mensajes del content script (abrir el formulario en otra
//    pestaña, abrir el siguiente, errores, fin) y publica el avance, que ve la
//    app por el puerto 'eku-app' y el popup por chrome.storage.session;
//  - cancela al instante (APP_DESCARGA_CANCELAR / POPUP_DESCARGA_CANCELAR).
// Las credenciales nunca se guardan.

const DESCARGA_KEY = 'ivaDescarga';
const DESCARGA_ESTADO_KEY = 'ivaDescargaEstado';
const ETAPA_KEY = 'eku_descarga_etapa'; // misma clave que descargaContent.js
const DESCARGA_TTL_MS = 30 * 60 * 1000;
const DESCARGA_MAX_PERIODOS = 24;

const puertosApp = new Set();

// Los mensajes se atienden de a uno, para que dos avisos seguidos no se pisen
// el trabajo. Cancelar NO pasa por acá: tiene que ser inmediato.
let cadenaDescarga = Promise.resolve();
function encolar(fn) {
  cadenaDescarga = cadenaDescarga.then(fn).catch((e) => console.error('[Ekuatia] descarga:', e));
  return cadenaDescarga;
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Trabajo y estado -------------------------------------------------------

async function leerJob() {
  const d = await chrome.storage.session.get(DESCARGA_KEY);
  const job = d[DESCARGA_KEY];
  if (!job) return null;
  if (job.expiresAt < Date.now()) {
    await chrome.storage.session.remove(DESCARGA_KEY);
    await chrome.storage.local.remove(ETAPA_KEY);
    await publicar(null, { fase: 'error', error: 'La descarga venció por inactividad.', mensaje: 'La descarga venció por inactividad.' });
    return null;
  }
  return job;
}

// crear = true sólo al iniciar. Después, si el trabajo ya no está guardado (se
// canceló o terminó mientras algo seguía en vuelo) o es otro, no se guarda: así
// un aviso atrasado no puede revivirlo.
async function guardarJob(job, crear = false) {
  if (!crear) {
    const d = await chrome.storage.session.get(DESCARGA_KEY);
    const actual = d[DESCARGA_KEY];
    if (!actual || actual.id !== job.id) return false;
  }
  job.expiresAt = Date.now() + DESCARGA_TTL_MS;
  await chrome.storage.session.set({ [DESCARGA_KEY]: job });
  return true;
}

// Lo que ven la app (por el puerto) y el popup (por storage.onChanged).
async function publicar(job, extra = {}) {
  if (job && extra.activo !== false) {
    const d = await chrome.storage.session.get(DESCARGA_KEY);
    if (!d[DESCARGA_KEY] || d[DESCARGA_KEY].id !== job.id) return;
  }
  const base = job
    ? {
        activo: true,
        fase: job.fase,
        mensaje: job.mensaje || '',
        ruc: job.ruc,
        nombre: job.nombre,
        pedidos: job.state.selectionMode === 'custom' ? job.state.meses.length : job.state.selectionCount,
        total: job.total,
        hechos: job.hechos,
      }
    : { activo: false };
  // emitirEstado (sesionBg.js) lo guarda y lo reparte a la app y al panel de
  // Marangatu, junto con el cliente de la app, la sesión y los avisos.
  await emitirEstado({ ...base, ...extra, ts: Date.now() });
}

// Nunca informa "en curso" si no hay trabajo (evita un estado fantasma).
async function estadoActual() {
  const d = await chrome.storage.session.get([DESCARGA_ESTADO_KEY, DESCARGA_KEY]);
  const estado = d[DESCARGA_ESTADO_KEY] || { activo: false };
  const extras = await extrasDeEstado();
  if (estado.activo && !d[DESCARGA_KEY]) return { ...estado, ...extras, activo: false, fase: 'cancelado', mensaje: 'Descarga interrumpida.' };
  return { ...estado, ...extras };
}

async function terminar(job, extra) {
  await chrome.storage.session.remove(DESCARGA_KEY);
  await chrome.storage.local.remove(ETAPA_KEY);
  await publicar(job, { ...extra, activo: false });
}

async function fallar(job, error) {
  if (job.tabForm) { try { await chrome.tabs.remove(job.tabForm); } catch { /* ya cerrada */ } }
  await terminar(job, { fase: 'error', error, mensaje: error });
}

// --- Validación ---------------------------------------------------------------

// Sólo datos simples: RUC numérico, períodos AAAA-MM (o "últimos N"), prefijo
// de archivo seguro y demora entre 1 y 10 segundos. Arma el "state" con el
// formato que entiende descargaContent.js.
function validarDescarga(msg) {
  const ruc = String((msg && msg.ruc) || '').replace(/\D/g, '').slice(0, 12);
  let periodos = null;
  let ultimos = 0;
  if (Array.isArray(msg.periodos)) {
    const unicos = [...new Set(msg.periodos.map(String))];
    if (!unicos.length || unicos.length > DESCARGA_MAX_PERIODOS) return null;
    if (!unicos.every((p) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p))) return null;
    periodos = unicos;
  } else {
    ultimos = Number(msg.ultimos);
    if (!Number.isInteger(ultimos) || ultimos < 1 || ultimos > DESCARGA_MAX_PERIODOS) return null;
  }
  const prefijo = /^[A-Za-z0-9_-]{1,12}$/.test(String(msg.prefijo || 'IVA')) ? String(msg.prefijo || 'IVA') : 'IVA';
  const d = Number(msg.demora);
  const demora = Number.isInteger(d) && d >= 1 && d <= 10 ? d : 4;
  const nombre = String(msg.nombre || '').slice(0, 120);
  const meses = periodos ? periodos.map((p) => ({ anio: Number(p.slice(0, 4)), mes: Number(p.slice(5, 7)) })) : [];
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    ruc,
    nombre,
    origen: '',
    pedidos: periodos ? periodos.map((p) => `${p.slice(5, 7)}/${p.slice(0, 4)}`) : [],
    encontrados: [],
    state: {
      cliente: { ruc, nombre },
      cantidadMeses: periodos ? periodos.length : ultimos,
      meses,
      selectionMode: periodos ? 'custom' : 'last',
      selectionCount: ultimos,
      config: { prefix: prefijo, delay: demora },
    },
    fase: 'iniciando',
    mensaje: 'Abriendo Marangatu…',
    total: 0,
    hechos: 0,
    tabLista: null,
    tabForm: null,
    expiresAt: 0,
  };
}

// --- Inicio y cancelación -----------------------------------------------------

// Le manda el inicio al content script de la pestaña, con reintentos por si la
// página todavía no lo cargó.
async function enviarInicio(tabId, state) {
  for (let i = 0; i < 12; i += 1) {
    try {
      const r = await chrome.tabs.sendMessage(tabId, { action: 'INICIAR_DESCARGA_IVA', state });
      if (r && r.ok) return true;
    } catch { /* el content script todavía no está */ }
    await dormir(500);
  }
  return false;
}

// Comprueba que la sesión abierta sea la del cliente pedido. Si el panel no
// puede leer ningún RUC no se bloquea nada (no se puede saber); si lee alguno y
// ninguno coincide, la descarga no debe seguir: sería de otro cliente.
async function verificarSesion(tabId, job) {
  if (!job.ruc) return { ok: true };
  const s = await mensajePanel(tabId, { action: 'PANEL_LEER_SESION' }, 6);
  const rucs = s && s.ok && Array.isArray(s.rucs) ? s.rucs : [];
  if (!rucs.length || rucs.some((r) => rucCoincide(job.ruc, r))) return { ok: true };
  return {
    ok: false,
    error: `La sesión abierta en Marangatu es de otro contribuyente (RUC ${rucs.join(', ')}) y se pidió el ${job.ruc}. Se detuvo la descarga: cerrá la sesión e intentá de nuevo.`,
  };
}

// Desde la app: espera a que la pestaña entre a Marangatu (login automático o a
// mano) y recién ahí manda el inicio. Se vuelve a armar si el service worker se
// durmió en el medio (ver el final del archivo).
let esperandoEntrada = null;
function arrancarCuandoEntre(tabId, jobId) {
  if (esperandoEntrada) chrome.tabs.onUpdated.removeListener(esperandoEntrada);
  let enviando = false;
  const alActualizar = async (id, info, tab) => {
    if (id !== tabId || info.status !== 'complete' || enviando) return;
    let url;
    try { url = new URL(tab.url || ''); } catch { return; }
    if (url.hostname !== MARANGATU_HOST || url.pathname.includes('/login')) return;
    enviando = true;
    const job = await leerJob();
    if (!job || job.id !== jobId) {
      chrome.tabs.onUpdated.removeListener(alActualizar);
      if (esperandoEntrada === alActualizar) esperandoEntrada = null;
      return;
    }
    const v = await verificarSesion(tabId, job);
    if (!v.ok) {
      // Se detiene sólo si la sesión no la abrió la extensión con la clave del
      // cliente (entró a mano o se siguió con una sesión previa). Si entró con la
      // clave del cliente, una diferencia es más probable que sea un número mal
      // leído del encabezado que otro cliente: se avisa y se sigue.
      if (job.estricto) {
        chrome.tabs.onUpdated.removeListener(alActualizar);
        if (esperandoEntrada === alActualizar) esperandoEntrada = null;
        await fallar(job, v.error);
        return;
      }
      await publicarAviso(v.error);
    }
    const ok = await enviarInicio(tabId, job.state);
    enviando = false;
    if (!ok) return; // sigue esperando la próxima página
    chrome.tabs.onUpdated.removeListener(alActualizar);
    if (esperandoEntrada === alActualizar) esperandoEntrada = null;
    const vigente = await leerJob();
    if (vigente && vigente.id === jobId) {
      vigente.fase = 'navegando';
      vigente.mensaje = 'Navegando en Marangatu…';
      if (await guardarJob(vigente)) await publicar(vigente);
    }
  };
  esperandoEntrada = alActualizar;
  chrome.tabs.onUpdated.addListener(alActualizar);
  // Si la pestaña ya está dentro de Marangatu (sesión que se mantuvo), no va a
  // llegar ningún "complete" nuevo: se revisa ahora mismo.
  chrome.tabs.get(tabId).then((tab) => { if (tab && tab.status === 'complete') alActualizar(tabId, { status: 'complete' }, tab); }).catch(() => {});
}

async function iniciarDescarga(msg, { tabId = null, user = '', pass = '' } = {}) {
  if (await leerJob()) return { ok: false, error: 'DESCARGA_EN_CURSO' };
  const job = validarDescarga(msg);
  if (!job) return { ok: false, error: 'datos de descarga inválidos' };
  await chrome.storage.local.remove(ETAPA_KEY); // sin restos de una descarga anterior
  // Pestañas ya abiertas: las nuevas (id mayor) pueden ser parte de la tarea.
  try { job.tabBase = Math.max(0, ...(await chrome.tabs.query({})).map((t) => t.id)); } catch { job.tabBase = 0; }

  if (tabId) {
    // Desde el popup: la persona ya está en Marangatu con sesión iniciada.
    let tab = null;
    try { tab = await chrome.tabs.get(tabId); } catch { /* sin pestaña */ }
    let host = '';
    try { host = new URL((tab && tab.url) || '').hostname; } catch { /* sin URL */ }
    if (host !== MARANGATU_HOST) return { ok: false, error: 'La pestaña activa no es Marangatu.' };
    job.origen = 'popup';
    job.tabLista = tabId;
    // Desde el popup la sesión puede ser legítimamente de otro RUC (un contador
    // que consulta clientes): sólo se avisa, no se detiene.
    const vp = await verificarSesion(tabId, job);
    if (!vp.ok) await publicarAviso(vp.error);
    job.fase = 'navegando';
    job.mensaje = 'Navegando en Marangatu…';
    await guardarJob(job, true);
    await publicar(job);
    if (!(await enviarInicio(tabId, job.state))) {
      const error = 'No se pudo comunicar con la página de Marangatu. Refrescá la página e intentá de nuevo.';
      await fallar(job, error);
      return { ok: false, error };
    }
    return { ok: true };
  }

  // Desde la app: se abre el login (con credenciales si vienen).
  job.origen = 'app';
  await guardarJob(job, true);
  await publicar(job);
  const alAbrir = (id, r) => encolar(async () => {
    const j = await leerJob();
    if (!j || j.id !== job.id) return;
    // Estricto: la sesión no la abrió la extensión con la clave del cliente.
    j.estricto = !user || !!(r && r.sesionActiva);
    j.tabLista = id;
    await guardarJob(j);
    arrancarCuandoEntre(id, j.id);
  });
  job.mensaje = 'Preparando la sesión de Marangatu…';
  await guardarJob(job);
  await publicar(job);
  // La preparación (cerrar una sesión previa, volver al acceso, entrar) puede
  // tardar: se responde ya y el resultado llega por el estado. Un error la
  // termina con el mensaje (el trabajo todavía no tiene pestaña).
  abrirLogin(user, pass, alAbrir, { permitirSesionActiva: true }).then((r) => {
    if (r && r.ok) return;
    return encolar(async () => {
      const j = await leerJob();
      if (j && j.id === job.id) await fallar(j, (r && r.error === 'TAREA_EN_CURSO') ? 'Ya hay otra tarea preparando Marangatu.' : ((r && r.error) || 'No se pudo preparar la sesión de Marangatu.'));
    });
  });
  return { ok: true };
}

// Cancelar no pasa por la cola: borra el trabajo y la etapa del content script
// ya mismo y deja el estado en "cancelado", aunque no hubiera trabajo (así no
// queda un "en curso" fantasma en la app ni en el popup).
async function cancelarDescarga() {
  if (esperandoEntrada) { chrome.tabs.onUpdated.removeListener(esperandoEntrada); esperandoEntrada = null; }
  const d = await chrome.storage.session.get(DESCARGA_KEY);
  const job = d[DESCARGA_KEY];
  await chrome.storage.session.remove(DESCARGA_KEY);
  await chrome.storage.local.remove(ETAPA_KEY);
  if (job && job.tabForm) { try { await chrome.tabs.remove(job.tabForm); } catch { /* ya cerrada */ } }
  await publicar(null, { fase: 'cancelado', mensaje: 'Descarga cancelada.' });
  return { ok: true };
}

// --- Avisos del content script ----------------------------------------------------

const hrefValido = (h) => {
  try { const u = new URL(h); return u.protocol === 'https:' && u.hostname === MARANGATU_HOST; } catch { return false; }
};

async function alAvisoDelContent(msg, tabId) {
  const job = await leerJob();
  if (!job) return { ok: false }; // cancelado: que el content no siga abriendo cosas

  switch (msg.action) {
    case 'FORMULARIOS_ENCONTRADOS': {
      const lista = Array.isArray(msg.periodos) ? msg.periodos.filter((p) => /^\d{2}\/\d{4}$/.test(String(p))).map(String) : [];
      job.encontrados = lista;
      job.total = lista.length;
      // La lista de declaraciones se abre en otra ventana: desde acá, ésa es la
      // "pestaña de lista" (a la que se vuelve para abrir el siguiente formulario
      // y cuyo cierre cancela la tarea).
      if (Number.isInteger(tabId) && tabId !== job.tabLista) {
        job.tabLista = tabId;
        job.tabsPropias = [...new Set([...(job.tabsPropias || []), tabId])].slice(-20);
      }
      job.fase = 'imprimiendo';
      job.mensaje = `Se encontraron ${lista.length} formulario(s).`;
      break;
    }
    case 'DESCARGANDO_FORMULARIO': {
      const idx = Number(msg.index);
      const tot = Number(msg.total);
      if (!Number.isInteger(idx) || !Number.isInteger(tot)) return { ok: false };
      job.total = tot;
      job.fase = 'imprimiendo';
      job.mensaje = `Formulario ${String(msg.periodo || '').slice(0, 7)} (${idx + 1} de ${tot}): elegí "Guardar como PDF"`;
      break;
    }
    case 'FORMULARIO_GUARDADO': {
      const idx = Number(msg.index);
      if (!Number.isInteger(idx)) return { ok: false };
      job.hechos = Math.max(job.hechos, idx + 1);
      job.mensaje = 'Preparando el siguiente formulario…';
      break;
    }
    case 'ABRIR_SIGUIENTE_FORMULARIO': {
      // Vuelve a la pestaña de lista y le pide que abra el próximo formulario.
      let destino = job.tabLista;
      if (!destino) {
        const tabs = (await chrome.tabs.query({ url: '*://marangatu.set.gov.py/*' })).sort((a, b) => a.id - b.id);
        destino = tabs[0] && tabs[0].id;
      }
      if (!destino) return { ok: false };
      try { await chrome.tabs.update(destino, { active: true }); } catch { return { ok: false }; }
      chrome.tabs.sendMessage(destino, { action: 'ABRIR_SIGUIENTE_FORMULARIO', state: msg.state }).catch(() => {});
      return { ok: true };
    }
    case 'OPEN_FORMULARIO_TAB': {
      if (!hrefValido(msg.href)) return { ok: false };
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const maxIndex = tabs.length ? Math.max(...tabs.map((t) => t.index)) : 0;
      // Ventana de 15 s en la que la pestaña nueva puede reclamar la etapa
      // (ETAPA_PERMISO, sesionBg.js); se guarda antes de abrirla.
      job.formPendienteHasta = Date.now() + 15000;
      if (!(await guardarJob(job))) return { ok: false };
      const tab = await chrome.tabs.create({ url: msg.href, active: true, index: maxIndex + 1 });
      job.tabForm = tab.id;
      job.formPendienteHasta = 0;
      if (!(await guardarJob(job))) { // se canceló mientras se abría la pestaña
        try { await chrome.tabs.remove(tab.id); } catch { /* ya cerrada */ }
        return { ok: false };
      }
      return { ok: true };
    }
    case 'DESCARGA_COMPLETA': {
      const faltan = job.pedidos.filter((p) => !job.encontrados.includes(p));
      const falt = faltan.length ? ` No se encontraron: ${faltan.join(', ')}.` : '';
      await terminar(job, { fase: 'terminado', mensaje: `Listo: ${job.hechos} formulario(s).${falt}` });
      return { ok: true };
    }
    case 'ERROR_AUTOMATIZACION':
      await fallar(job, String(msg.error || 'Error en la descarga.').slice(0, 300));
      return { ok: true };
    default:
      return { ok: false };
  }
  if (await guardarJob(job)) await publicar(job);
  return { ok: true };
}

const AVISOS_CONTENT = new Set([
  'FORMULARIOS_ENCONTRADOS', 'DESCARGANDO_FORMULARIO', 'FORMULARIO_GUARDADO',
  'ABRIR_SIGUIENTE_FORMULARIO', 'OPEN_FORMULARIO_TAB', 'DESCARGA_COMPLETA', 'ERROR_AUTOMATIZACION',
]);

// --- Eventos del navegador --------------------------------------------------

chrome.tabs.onRemoved.addListener((tabId) => {
  encolar(async () => {
    const job = await leerJob();
    // La pestaña de formulario la cierra el propio content script al terminar de
    // imprimir: sólo se cancela si se cierra la pestaña de lista.
    if (job && tabId === job.tabLista) await cancelarDescarga();
  });
});

// Mensajes internos: content script y popup de la propia extensión.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || sender.id !== chrome.runtime.id) return false;

  if (sender.tab) {
    if (!AVISOS_CONTENT.has(msg.action) || !hrefValido(sender.tab.url || sender.url)) return false;
    encolar(async () => sendResponse(await alAvisoDelContent(msg, sender.tab.id)));
    return true;
  }

  if (msg.action === 'POPUP_DESCARGA_INICIAR') {
    encolar(async () => sendResponse(await iniciarDescarga(msg.datos || {}, { tabId: Number(msg.tabId) || null })));
    return true;
  }
  if (msg.action === 'POPUP_DESCARGA_CANCELAR') {
    cancelarDescarga().then(sendResponse);
    return true;
  }
  return false;
});

// Mensajes de la app. Mismo control de origen que el resto del puente.
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  const acciones = ['APP_PING', 'APP_IVA_DESCARGAR', 'APP_DESCARGA_CANCELAR'];
  if (!msg || !acciones.includes(msg.action)) return false;

  const origen = getVerifiedSenderOrigin(sender);
  if (!origen || !ALLOWED_APP_ORIGINS.has(origen)) {
    sendResponse({ ok: false, error: 'origen no autorizado' });
    return false;
  }

  if (msg.action === 'APP_PING') {
    estadoActual().then((descarga) => sendResponse({ ok: true, version: chrome.runtime.getManifest().version, descarga }));
    return true;
  }
  if (msg.action === 'APP_IVA_DESCARGAR') {
    const user = String(msg.user || '').trim();
    const pass = String(msg.pass || '');
    encolar(async () => sendResponse(await iniciarDescarga(msg, { user, pass })));
    return true;
  }
  cancelarDescarga().then(sendResponse);
  return true;
});

// Puerto para que la app reciba el avance en vivo. Si el service worker se
// duerme, el puerto se cierra y la app lo vuelve a abrir (recibe el estado).
chrome.runtime.onConnectExternal.addListener((port) => {
  const origen = getVerifiedSenderOrigin(port.sender);
  if (port.name !== 'eku-app' || !origen || !ALLOWED_APP_ORIGINS.has(origen)) {
    port.disconnect();
    return;
  }
  puertosApp.add(port);
  port.onDisconnect.addListener(() => puertosApp.delete(port));
  estadoActual().then((estado) => {
    try { port.postMessage({ tipo: 'estado', estado }); } catch { puertosApp.delete(port); }
  });
});

// Si el service worker se durmió con una descarga en curso: si seguía esperando
// que la pestaña entrara a Marangatu, vuelve a esperar; si no había trabajo,
// limpia un "en curso" que haya quedado en el estado.
leerJob().then(async (job) => {
  if (job) {
    if (job.origen === 'app' && job.fase === 'iniciando' && job.tabLista) arrancarCuandoEntre(job.tabLista, job.id);
    return;
  }
  const e = (await chrome.storage.session.get(DESCARGA_ESTADO_KEY))[DESCARGA_ESTADO_KEY];
  if (e && e.activo) await publicar(null, { fase: 'cancelado', mensaje: 'Descarga interrumpida.' });
});
