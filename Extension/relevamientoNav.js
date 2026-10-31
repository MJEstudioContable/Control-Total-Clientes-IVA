// Relevamiento de navegación de Marangatu (content script).
//
// Sirve para dibujar el mapa real de páginas del portal: qué pantallas hay, cómo
// se reconoce cada una, y cómo se pasa de una a otra (mismo documento, página
// nueva o pestaña nueva). Sólo actúa mientras la persona activó "Iniciar
// registro" en el popup; sin eso no hace nada.
//
// Qué registra: la ESTRUCTURA de cada pantalla (ruta sin valores de consulta,
// títulos, menús, botones, encabezados de tablas, nombres de campos, si la abrió
// otra ventana) y los clicks (a qué elemento). Nunca valores de campos, ni el
// texto del cuerpo de la página, ni datos de clientes; los números largos
// (RUC, cédulas, montos) se reemplazan por "#".
// Cada registro se guarda en su propia clave de chrome.storage.local, para que
// varias pestañas escribiendo a la vez no se pisen.
(() => {
  if (window.__ekuRelevamiento) return;
  window.__ekuRelevamiento = true;

  const FLAG = 'eku_relev_activo';
  const PREFIX = 'eku_rel_';
  const MAX_POR_PAGINA = 150;

  let activo = false;
  let escritos = 0;
  let ultimaFirma = '';
  let observador = null;
  let temporizador = null;

  // Texto corto y sin datos personales: espacios colapsados, sin números largos
  // ni correos.
  const limpiar = (t, max = 60) => String(t == null ? '' : t)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '@')
    .replace(/\d{6,}/g, '#')
    .slice(0, max);

  const visible = (el) => el.offsetParent !== null || el.getClientRects().length > 0;
  // El texto de lo que está dentro de una tabla suele ser un dato (nombre de un
  // cliente, un monto): de ahí sólo se registra la ruta o el nombre técnico.
  const enTabla = (el) => !!(el.closest && el.closest('table'));
  const unicos = (lista, max) => [...new Set(lista.filter(Boolean))].slice(0, max);

  const rutaDe = (u) => {
    try { const x = new URL(u, location.href); return x.origin === location.origin ? x.pathname : x.hostname + x.pathname; } catch { return ''; }
  };

  function tomarFoto() {
    const textoDe = (el) => limpiar(el.innerText || el.getAttribute('title') || el.getAttribute('aria-label') || el.getAttribute('value') || '');

    const menus = unicos(
      [...document.querySelectorAll('nav a, nav li, .menu a, .menu li, #menu a, [role="menu"] *, [role="menuitem"], .dropdown-menu a, .navbar a')]
        .filter(visible).map(textoDe),
      40
    );
    const botones = [...document.querySelectorAll('button, input[type="submit"], input[type="button"]')]
      .filter(visible).slice(0, 30)
      .map((b) => ({ id: limpiar(b.id, 40), name: limpiar(b.getAttribute('name'), 40), texto: enTabla(b) ? '' : textoDe(b) }));
    const enlaces = unicos(
      [...document.querySelectorAll('a[href]')].filter(visible).map((a) => {
        const h = a.getAttribute('href') || '';
        if (/^(#|javascript:)/i.test(h)) return '';
        return limpiar(rutaDe(h), 80) + ' | ' + (enTabla(a) ? '' : textoDe(a).slice(0, 30));
      }),
      40
    );
    const tablas = [...document.querySelectorAll('table')].filter(visible).slice(0, 3)
      .map((t) => unicos([...t.querySelectorAll('th')].map(textoDe), 12));
    const formularios = [...document.querySelectorAll('form')].slice(0, 5).map((f) => ({
      accion: limpiar(rutaDe(f.getAttribute('action') || ''), 80),
      metodo: (f.getAttribute('method') || 'get').toLowerCase(),
      campos: unicos([...f.querySelectorAll('input, select, textarea')].map((c) => limpiar(c.name || c.id, 40)), 30),
    }));
    const marcos = unicos([...document.querySelectorAll('iframe, frame')].map((f) => limpiar(rutaDe(f.getAttribute('src') || ''), 80)), 10);

    const ids = unicos([...document.querySelectorAll('[id]')].slice(0, 400).map((e) => limpiar(e.id, 40)), 60);
    // Página reconocida por el catálogo (paginas.js, cargado antes en el manifest).
    const identificada = typeof identificarPagina === 'function' ? identificarPagina() : null;
    const firma = [location.pathname, botones.map((b) => b.name || b.id || b.texto).join(','), tablas.map((t) => t.join('/')).join(';'), menus.length, marcos.join(',')].join('|');

    return {
      path: location.pathname,
      clavesConsulta: unicos([...new URLSearchParams(location.search).keys()].map((k) => limpiar(k, 30)), 15),
      hash: limpiar(location.hash.replace(/=.*/, ''), 40),
      titulo: limpiar(document.title, 80),
      abiertaPorOtraVentana: !!window.opener,
      vieneDe: limpiar(rutaDe(document.referrer || ''), 80),
      angular: !!document.querySelector('[data-ng-app], [ng-app], .ng-scope, [data-ng-controller], [ng-controller]'),
      identificada, marcos, menus, botones, enlaces, tablas, formularios, ids, firma,
    };
  }

  async function registrar(rec) {
    if (escritos >= MAX_POR_PAGINA) return;
    escritos += 1;
    const clave = PREFIX + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    try { await chrome.storage.local.set({ [clave]: { ts: Date.now(), ...rec } }); } catch { /* extensión recargada */ }
  }

  function fotoDePagina(tipo, extra = {}) {
    const f = tomarFoto();
    ultimaFirma = f.firma;
    return registrar({ tipo, ...f, ...extra });
  }

  function alClick(e) {
    const el = e.target && e.target.closest ? e.target.closest('a, button, input, li, [role="menuitem"], [data-ng-click], [ng-click]') : null;
    if (!el) return;
    const href = el.getAttribute && el.getAttribute('href');
    registrar({
      tipo: 'click',
      path: location.pathname,
      elemento: el.tagName.toLowerCase(),
      id: limpiar(el.id, 40),
      name: limpiar(el.getAttribute('name'), 40),
      texto: enTabla(el) ? '' : limpiar(el.innerText || el.getAttribute('value') || el.getAttribute('title') || '', 50),
      destino: href && !/^(#|javascript:)/i.test(href) ? limpiar(rutaDe(href), 80) : '',
      target: limpiar(el.getAttribute('target'), 20),
    });
  }

  // Cambios dentro de la misma ventana (menús, pestañas internas, AngularJS):
  // se compara una firma de la pantalla y se registra cuando cambia.
  function alCambiarDom() {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      const f = tomarFoto();
      if (f.firma !== ultimaFirma) {
        ultimaFirma = f.firma;
        registrar({ tipo: 'cambio_misma_ventana', ...f });
      }
    }, 800);
  }

  function iniciar() {
    if (activo) return;
    activo = true;
    escritos = 0;
    setTimeout(() => { if (activo) fotoDePagina('pagina'); }, 1200); // AngularJS dibuja tarde
    document.addEventListener('click', alClick, true);
    window.addEventListener('hashchange', alCambiarDom);
    window.addEventListener('popstate', alCambiarDom);
    observador = new MutationObserver(alCambiarDom);
    observador.observe(document.documentElement, { childList: true, subtree: true });
  }

  function detener() {
    activo = false;
    document.removeEventListener('click', alClick, true);
    window.removeEventListener('hashchange', alCambiarDom);
    window.removeEventListener('popstate', alCambiarDom);
    if (observador) observador.disconnect();
    observador = null;
    clearTimeout(temporizador);
  }

  chrome.storage.local.get(FLAG).then((d) => { if (d && d[FLAG]) iniciar(); }).catch(() => {});
  chrome.storage.onChanged.addListener((cambios, area) => {
    if (area !== 'local' || !cambios[FLAG]) return;
    if (cambios[FLAG].newValue) iniciar(); else detener();
  });

  // El popup pide una foto con una etiqueta ("madre", "vision-integral"...).
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.action !== 'RELEV_FOTO') return false;
    fotoDePagina('marca', { etiqueta: limpiar(msg.etiqueta, 40) }).then(() => sendResponse({ ok: true }));
    return true;
  });
})();
