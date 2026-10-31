// Envío de la ficha de IVA por WhatsApp Web (service worker).
//
// Se carga con importScripts desde background.js y usa de ahí
// ALLOWED_APP_ORIGINS y getVerifiedSenderOrigin.
//
// La app manda APP_WA_ENVIAR con { telefono, texto, imagen (data URL PNG) }.
// La persona revisa y toca Enviar: la extensión NUNCA envía el mensaje.
//
// v2.7 — una sola pestaña y sin recargar:
//  - Si ya hay una pestaña de WhatsApp Web abierta, se usa ESA, sin recargarla:
//    se abre el chat del número con las funciones internas de WhatsApp Web
//    (las mismas que usa la página al tocar un chat), se pega el texto y se
//    pega la imagen. Queda la vista previa con la imagen y el texto como pie.
//  - Si no hay ninguna, se abre una (una sola vez) y, cuando WhatsApp termina
//    de cargar, se hace lo mismo.
//  - Si WhatsApp cambiara esas funciones internas, se cae al método de la 2.3
//    (llevar ESA MISMA pestaña a /send?phone=… y pegar al cargar). Nunca se
//    abre una segunda pestaña.
//
// La función se inyecta sólo en la pestaña de este envío y en el mundo de la
// página (world: 'MAIN'), porque las funciones internas de WhatsApp no se ven
// desde el mundo aislado de la extensión. No hay content script permanente.
// El pedido pendiente vive en chrome.storage.session y vence a los 3 minutos.
const WA_HOST = 'web.whatsapp.com';
const WA_KEY = 'waPendiente';
const WA_TTL_MS = 3 * 60 * 1000;
const WA_MAX_IMAGEN = 12 * 1024 * 1024;

chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.action !== 'APP_WA_ENVIAR') return false;
  const origen = getVerifiedSenderOrigin(sender);
  if (!origen || !ALLOWED_APP_ORIGINS.has(origen)) {
    sendResponse({ ok: false, error: 'WA_ORIGEN' });
    return false;
  }
  const pedido = validarPedidoWa(msg);
  if (pedido.error) {
    sendResponse({ ok: false, error: pedido.error });
    return false;
  }
  enviarFichaWa(pedido).then(sendResponse, (e) => sendResponse({ ok: false, error: 'WA_ERROR', detalle: String(e && e.message || e) }));
  return true;
});

function validarPedidoWa(msg) {
  const telefono = String(msg.telefono || '').replace(/\D/g, '');
  const texto = String(msg.texto || '').slice(0, 1500);
  const imagen = String(msg.imagen || '');
  if (!/^\d{8,15}$/.test(telefono)) return { error: 'WA_TELEFONO' };
  if (!imagen.startsWith('data:image/png;base64,')) return { error: 'WA_IMAGEN' };
  if (imagen.length > WA_MAX_IMAGEN) return { error: 'WA_IMAGEN_GRANDE' };
  const nombre = String(msg.nombre || 'ficha.png').replace(/[^\w.\-áéíóúñÁÉÍÓÚÑ ]/g, '').slice(0, 120) || 'ficha.png';
  return { telefono, texto, imagen, nombre };
}

// La pestaña de WhatsApp Web que conviene usar: la de la última ventana usada
// si la hay; si no, cualquiera de este perfil.
async function buscarPestanaWa() {
  const abiertas = await chrome.tabs.query({ url: 'https://' + WA_HOST + '/*' });
  if (!abiertas.length) return null;
  let ventana = null;
  try { ventana = await chrome.windows.getLastFocused(); } catch { /* sin ventana */ }
  return abiertas.find((t) => ventana && t.windowId === ventana.id && t.active) ||
    abiertas.find((t) => ventana && t.windowId === ventana.id) ||
    abiertas.find((t) => t.active) ||
    abiertas[0];
}

async function enviarFichaWa(pedido) {
  const tab = await buscarPestanaWa();
  if (!tab) {
    // No hay WhatsApp Web abierto: se abre UNA pestaña y, cuando carga, se
    // abre el chat por las funciones internas (onUpdated, abajo).
    const nueva = await chrome.tabs.create({ url: 'https://' + WA_HOST + '/', active: true });
    await guardarPendiente(pedido, nueva.id, 'api');
    try { await chrome.windows.update(nueva.windowId, { focused: true }); } catch { /* sin ventana */ }
    return { ok: true, pestana: 'nueva' };
  }

  try { await chrome.tabs.update(tab.id, { active: true }); } catch { /* pestaña cerrada */ }
  try { await chrome.windows.update(tab.windowId, { focused: true }); } catch { /* sin ventana */ }

  // Se responde a la app enseguida; el trabajo sigue en segundo plano.
  operarEnPestana(tab.id, pedido, 'api').then((r) => {
    if (r && r.error === 'SIN_API') return irPorUrl(tab.id, pedido);
    return null;
  }).catch(() => irPorUrl(tab.id, pedido));
  return { ok: true, pestana: 'existente' };
}

async function operarEnPestana(tabId, pedido, modo) {
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: operarWhatsapp,
    args: [{ modo, telefono: pedido.telefono, texto: pedido.texto, imagen: pedido.imagen, nombre: pedido.nombre }],
  });
  return r && r.result;
}

// Respaldo (método de la 2.3) en la MISMA pestaña: si WhatsApp cambió sus
// funciones internas, se lleva la pestaña al chat por URL y se pega al cargar.
async function irPorUrl(tabId, pedido) {
  const url = 'https://' + WA_HOST + '/send?phone=' + pedido.telefono + '&text=' + encodeURIComponent(pedido.texto);
  await guardarPendiente(pedido, tabId, 'url');
  await chrome.tabs.update(tabId, { url, active: true });
}

function guardarPendiente(pedido, tabId, modo) {
  return chrome.storage.session.set({
    [WA_KEY]: { ...pedido, tabId, modo, inyectado: false, expiresAt: Date.now() + WA_TTL_MS },
  });
}

// Cuando la pestaña del envío termina de cargar (pestaña nueva o respaldo por
// URL), se completa el pedido una sola vez.
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete') return;
  let host = '';
  try { host = new URL(tab.url || '').hostname; } catch { return; }
  if (host !== WA_HOST) return;
  chrome.storage.session.get(WA_KEY, async (data) => {
    const p = data && data[WA_KEY];
    if (!p || p.tabId !== tabId || p.inyectado) return;
    if (p.expiresAt < Date.now()) { await chrome.storage.session.remove(WA_KEY); return; }
    await chrome.storage.session.set({ [WA_KEY]: { ...p, inyectado: true } });
    await chrome.storage.session.remove(WA_KEY);
    let r = null;
    try { r = await operarEnPestana(tabId, p, p.modo); } catch { /* la pestaña se cerró */ }
    if (p.modo === 'api' && r && r.error === 'SIN_API') {
      try { await irPorUrl(tabId, p); } catch { /* la pestaña se cerró */ }
    }
  });
});

// Inyectada en WhatsApp Web, en el mundo de la página (autocontenida).
// op.modo:
//  - 'api': espera a que WhatsApp esté listo (hasta 2 minutos, por si hay que
//    escanear el QR), abre el chat del número sin recargar, pega el texto y
//    pega la imagen. Devuelve SIN_API si las funciones internas no existen.
//  - 'url': el chat ya viene abierto por la URL (con el texto); sólo pega la
//    imagen.
// Nunca envía nada.
async function operarWhatsapp(op) {
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const aviso = (texto, ok) => {
    let box = document.getElementById('ekuatia-wa-aviso');
    if (!box) {
      box = document.createElement('div');
      box.id = 'ekuatia-wa-aviso';
      box.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483647;max-width:440px;' +
        'padding:10px 14px;border-radius:10px;font:14px/1.4 system-ui,Segoe UI,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25)';
      document.body.appendChild(box);
    }
    box.style.background = ok ? '#e7f6ee' : '#fff3cd';
    box.style.color = ok ? '#0e5a35' : '#5c4400';
    box.style.border = '2px solid ' + (ok ? '#1f8f4e' : '#e0a800');
    box.textContent = 'Ekuatia · ' + texto;
    clearTimeout(box._t);
    box._t = setTimeout(() => box.remove(), 12000);
  };
  const cuadroChat = () => document.querySelector(
    '#main footer [contenteditable="true"], [data-testid="conversation-compose-box-input"], footer div[contenteditable="true"][data-tab="10"]'
  );
  // El editor de adjuntos (vista previa) tiene su propio cuadro de texto para
  // el pie, fuera del pie de página del chat.
  const editorAdjuntos = () => [...document.querySelectorAll('[contenteditable="true"]')]
    .find((e) => !e.closest('#main footer') && !e.closest('#side'));
  const pegar = (cuadro, dt) => {
    cuadro.focus();
    cuadro.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  };
  const requerir = (nombre) => {
    try { return typeof window.require === 'function' ? window.require(nombre) : null; } catch { return null; }
  };

  // ---- 1. Abrir el chat ----
  if (op.modo === 'api') {
    // Esperar a WhatsApp listo (lista de chats visible y módulos cargados).
    let avisoQr = false;
    let listo = false;
    for (let i = 0; i < 240; i++) {
      if (document.querySelector('#pane-side') && requerir('WAWebCmd')) { listo = true; break; }
      if (!avisoQr && document.querySelector('canvas[aria-label], div[data-ref]')) {
        aviso('Vinculá WhatsApp Web escaneando el código QR; después la ficha se pega sola.', false);
        avisoQr = true;
      }
      await esperar(500);
    }
    if (!listo) {
      aviso('WhatsApp Web no terminó de cargar. La imagen está en el portapapeles: pegala con Ctrl+V.', false);
      return { ok: false, error: 'NO_LISTO' };
    }

    const Cmd = requerir('WAWebCmd') && requerir('WAWebCmd').Cmd;
    const WidFactory = requerir('WAWebWidFactory');
    const FindChat = requerir('WAWebFindChatAction');
    const Existe = requerir('WAWebQueryExistsJob');
    if (!Cmd || !Cmd.openChatBottom || !WidFactory || !WidFactory.createWid || !FindChat || !FindChat.findOrCreateLatestChat) {
      return { ok: false, error: 'SIN_API' };
    }

    try {
      let wid = WidFactory.createWid(op.telefono + '@c.us');
      if (Existe && Existe.queryWidExists) {
        const existe = await Existe.queryWidExists(wid);
        if (!existe) {
          aviso('Ese número no está en WhatsApp. Revisá el número del cliente.', false);
          return { ok: false, error: 'NUMERO_INVALIDO' };
        }
        if (existe.wid) wid = existe.wid;
      }
      const res = await FindChat.findOrCreateLatestChat(wid);
      const chat = res && res.chat ? res.chat : res;
      if (!chat) return { ok: false, error: 'SIN_API' };
      const cuadroAntes = cuadroChat();
      try {
        await Cmd.openChatBottom({ chat });
      } catch {
        await Cmd.openChatBottom(chat);
      }
      // Esperar el cuadro del chat recién abierto.
      let cuadro = null;
      for (let i = 0; i < 20; i++) {
        await esperar(250);
        cuadro = cuadroChat();
        if (cuadro && cuadro !== cuadroAntes) break;
      }
      await esperar(500);
      if (!cuadroChat()) return { ok: false, error: 'SIN_API' };
    } catch {
      return { ok: false, error: 'SIN_API' };
    }

    // Texto (en el modo 'url' ya lo escribe WhatsApp por el enlace). Si el
    // chat ya tiene ese mismo texto de un intento anterior, no se duplica.
    const texto = String(op.texto || '');
    const cuadro = cuadroChat();
    if (texto && cuadro && !(cuadro.innerText || '').includes(texto.slice(0, 30))) {
      const dtTexto = new DataTransfer();
      dtTexto.setData('text/plain', texto);
      pegar(cuadro, dtTexto);
      await esperar(500);
    }
  } else {
    // Modo 'url': esperar el cuadro del chat (hasta 2 minutos).
    let avisoQr = false;
    for (let i = 0; i < 240 && !cuadroChat(); i++) {
      if (!avisoQr && document.querySelector('canvas[aria-label], div[data-ref]')) {
        aviso('Vinculá WhatsApp Web escaneando el código QR; después la imagen se pega sola.', false);
        avisoQr = true;
      }
      const dialogo = document.querySelector('[role="dialog"]');
      if (dialogo && /no es v[aá]lido|invalid|isn.t on whatsapp|no est[aá] en whatsapp/i.test(dialogo.innerText || '')) {
        aviso('Ese número no está en WhatsApp. Revisá el número del cliente.', false);
        return { ok: false, error: 'NUMERO_INVALIDO' };
      }
      await esperar(500);
    }
    if (!cuadroChat()) {
      aviso('No se encontró el chat. La imagen está en el portapapeles: pegala con Ctrl+V.', false);
      return { ok: false, error: 'SIN_CHAT' };
    }
    // Que WhatsApp termine de escribir el texto del enlace.
    for (let i = 0; i < 12 && !(cuadroChat().innerText || '').trim(); i++) await esperar(250);
    await esperar(500);
  }

  // ---- 2. Pegar la imagen ----
  let archivo;
  try {
    const blob = await (await fetch(op.imagen)).blob();
    archivo = new File([blob], op.nombre, { type: 'image/png' });
  } catch {
    aviso('No se pudo preparar la imagen. Está en el portapapeles: pegala con Ctrl+V.', false);
    return { ok: false, error: 'PEGAR' };
  }
  for (let intento = 0; intento < 2; intento++) {
    const cuadro = cuadroChat();
    if (!cuadro) break;
    const dt = new DataTransfer();
    dt.items.add(archivo);
    pegar(cuadro, dt);
    for (let i = 0; i < 10; i++) {
      await esperar(400);
      if (editorAdjuntos()) {
        aviso('Ficha lista con el texto: revisá y tocá Enviar.', true);
        return { ok: true };
      }
    }
  }
  aviso('Si la imagen no aparece, pegala con Ctrl+V (está en el portapapeles).', false);
  return { ok: false, error: 'SIN_VISTA_PREVIA' };
}
