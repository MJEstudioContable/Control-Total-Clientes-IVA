// Panel flotante de Ekuatia dentro de Marangatu.
//
// Muestra, en una esquina de cada pestaña de Marangatu, el mismo estado que ve la
// app: en qué cliente trabaja la app, qué sesión hay abierta, en qué pantalla
// estás y cómo va la tarea en curso. Desde acá se puede cancelar la tarea y cerrar
// la sesión. También es los "ojos" del service worker: le informa la sesión
// (PANEL_SESION) y ejecuta su pedido de leerla o cerrarla.
//
// - Sólo en la ventana principal (no en marcos) y no en la página del formulario
//   presentado (consultarDDJJCompleta.do), que es la que se imprime a PDF.
// - Todo se dibuja en un Shadow DOM: no toca ni se mezcla con la página (ni con
//   lo que recorre descargaContent.js) y se oculta al imprimir.
// - Sólo lee estructura: nunca valores de campos ni datos de formularios. Del
//   encabezado toma números que parecen un RUC para saber de quién es la sesión.
// - Cerrar sesión busca el control de salida por heurística (enlace/botón
//   "Salir"/"Cerrar sesión"), pendiente de confirmar con el relevamiento.
(() => {
  if (window !== window.top) return;
  if (/consultarddjjcompleta\.do/i.test(location.pathname)) return;
  if (document.getElementById('eku-panel-host')) return;

  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const visible = (e) => !!(e && (e.offsetParent !== null || (e.getClientRects && e.getClientRects().length)));

  // --- Lectura de la sesión ----------------------------------------------------------

  const TEXTO_SALIR = /^(salir|cerrar sesi[oó]n|finalizar sesi[oó]n|logout|log out|desconectar|terminar sesi[oó]n)$/i;
  const HREF_SALIR = /logout|logoff|cerrarsesion|cerrar_sesion|finalizarsesion/i;

  function buscarSalir() {
    const cand = [...document.querySelectorAll('a, button, [role="button"], [role="menuitem"], li > span, input[type="button"]')].filter(visible);
    return cand.find((e) => {
      const href = e.getAttribute('href') || '';
      const texto = norm(e.textContent || e.value);
      const rotulo = norm(e.getAttribute('title') || e.getAttribute('aria-label') || e.getAttribute('data-tooltip'));
      return HREF_SALIR.test(href) || TEXTO_SALIR.test(texto) || TEXTO_SALIR.test(rotulo);
    }) || null;
  }

  // Marangatu muestra en el encabezado el NOMBRE del usuario de la sesión, en el
  // menú desplegable #navbarDropdownMenuLink (confirmado con el relevamiento).
  function menuUsuario() {
    const e = document.getElementById('navbarDropdownMenuLink');
    return e && visible(e) ? e : null;
  }

  function enLogin() {
    return /\/login/i.test(location.pathname) || [...document.querySelectorAll('input[type="password"]')].some(visible);
  }

  // Números con aspecto de RUC en la zona del encabezado (arriba de la página).
  function leerRucs() {
    const zona = document.querySelectorAll('header, nav, .navbar, [class*="header" i], [class*="user" i], [class*="usuario" i], [class*="contribuyente" i], [id*="header" i], [id*="user" i], [id*="usuario" i]');
    const vistos = new Set();
    for (const e of zona) {
      if (!visible(e)) continue;
      const r = e.getBoundingClientRect();
      const t = norm(e.textContent);
      if (r.top > 170 || !t || t.length > 220) continue;
      for (const m of t.matchAll(/\b(\d{5,9})(?:\s*-\s*\d)?\b/g)) vistos.add(m[1]);
      if (vistos.size >= 5) break;
    }
    return [...vistos].slice(0, 5);
  }

  function leerSesion() {
    const login = enLogin();
    const salir = buscarSalir();
    const menu = menuUsuario();
    let pagina = null;
    try { pagina = typeof identificarPagina === 'function' ? identificarPagina() : null; } catch { pagina = null; }
    return {
      logueado: !login && (!!menu || !!salir),
      enLogin: login,
      usuario: !login && menu ? norm(menu.textContent).slice(0, 80) : '',
      rucs: !login && (menu || salir) ? leerRucs() : [],
      pagina: pagina ? { id: pagina.id, nombre: pagina.nombre } : null,
    };
  }

  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

  // Hace clic en "Salir" y, si aparece una confirmación, la acepta.
  async function cerrarSesionLocal() {
    let el = buscarSalir();
    // El "Salir" suele estar dentro del menú del usuario, cerrado hasta abrirlo.
    const menu = menuUsuario();
    let abrioMenu = false;
    if (!el && menu) {
      menu.click();
      abrioMenu = true;
      await dormir(450);
      el = buscarSalir();
    }
    if (!el) {
      if (abrioMenu) menu.click(); // lo deja como estaba
      return { ok: false, error: 'No encontré el control para cerrar la sesión.' };
    }
    const texto = norm(el.textContent || el.value || el.getAttribute('title')).slice(0, 40);
    el.click();
    await dormir(700);
    const confirmar = [...document.querySelectorAll('.modal button, .modal a.btn, [role="dialog"] button')]
      .filter(visible)
      .find((b) => /^(s[ií]|aceptar|confirmar|ok|salir)$/i.test(norm(b.textContent)));
    if (confirmar) confirmar.click();
    return { ok: true, texto };
  }

  // --- Mensajes del service worker ----------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || sender.id !== chrome.runtime.id) return false;
    if (msg.action === 'PANEL_LEER_SESION') {
      sendResponse({ ok: true, ...leerSesion() });
      return false;
    }
    if (msg.action === 'PANEL_CERRAR_SESION') {
      cerrarSesionLocal().then(sendResponse);
      return true;
    }
    return false;
  });

  let ultimaSesion = '';
  function informarSesion() {
    const s = leerSesion();
    const clave = JSON.stringify(s);
    if (clave === ultimaSesion) return;
    ultimaSesion = clave;
    try { chrome.runtime.sendMessage({ action: 'PANEL_SESION', sesion: s }).catch(() => {}); } catch { /* extensión recargada */ }
  }

  // --- Estado en vivo (puerto) ---------------------------------------------------------

  let estado = null;
  let sesionLocal = leerSesion();
  let desistido = 0; // ts del estado final cuyo ofrecimiento se descartó
  let oculto = false;
  let abierto = null; // null = automático
  try { oculto = sessionStorage.getItem('ekuPanelOculto') === '1'; } catch { /* sin storage */ }

  function conectar() {
    let puerto;
    try { puerto = chrome.runtime.connect({ name: 'eku-panel' }); } catch { return; }
    puerto.onMessage.addListener((m) => {
      if (m && m.tipo === 'estado') { estado = m.estado || null; dibujar(); }
    });
    puerto.onDisconnect.addListener(() => { void chrome.runtime.lastError; setTimeout(conectar, 2000); });
  }

  // --- Panel ----------------------------------------------------------------------------

  const host = document.createElement('div');
  host.id = 'eku-panel-host';
  const raiz = host.attachShadow({ mode: 'closed' });
  const estilo = document.createElement('style');
  estilo.textContent = `
    :host { all: initial; position: fixed; right: 14px; bottom: 14px; z-index: 2147483000; }
    @media print { :host { display: none !important; } }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
    .chip { display: flex; align-items: center; gap: 8px; border: 0; border-radius: 999px; padding: 8px 14px; font-size: 13px;
      color: #fff; background: #1f2937; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.3); }
    .chip.alerta { background: #b45309; } .chip.error { background: #b91c1c; } .chip.ok { background: #15803d; }
    .punto { width: 9px; height: 9px; border-radius: 50%; background: #9ca3af; }
    .punto.on { background: #34d399; }
    .card { width: 300px; max-height: 70vh; overflow: auto; background: #fff; color: #111827; border-radius: 12px;
      box-shadow: 0 8px 28px rgba(0,0,0,.35); font-size: 13px; }
    .cab { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: #1f2937; color: #fff;
      border-radius: 12px 12px 0 0; font-weight: 600; }
    .cab button { background: none; border: 0; color: #fff; font-size: 16px; cursor: pointer; }
    .cuerpo { padding: 10px 12px; display: grid; gap: 8px; }
    .fila { display: grid; gap: 1px; } .fila b { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
    .barra { height: 6px; background: #e5e7eb; border-radius: 3px; overflow: hidden; } .barra i { display: block; height: 100%; background: #2563eb; }
    .msg { padding: 8px 10px; border-radius: 8px; background: #f3f4f6; }
    .msg.alerta { background: #fef3c7; color: #78350f; } .msg.error { background: #fee2e2; color: #7f1d1d; } .msg.ok { background: #dcfce7; color: #14532d; }
    .botones { display: flex; flex-wrap: wrap; gap: 6px; }
    .botones button { border: 1px solid #d1d5db; background: #f9fafb; color: #111827; border-radius: 8px; padding: 6px 10px; font-size: 12px; cursor: pointer; }
    .botones button.fuerte { background: #b91c1c; border-color: #b91c1c; color: #fff; }
    .botones button:disabled { opacity: .5; cursor: default; }
  `;
  raiz.appendChild(estilo);
  const caja = document.createElement('div');
  raiz.appendChild(caja);

  function h(tag, props, ...hijos) {
    const e = document.createElement(tag);
    if (props) Object.assign(e, props);
    for (const c of hijos) if (c != null) e.append(c);
    return e;
  }

  function rucCoincide(a, b) {
    const x = String(a || '').replace(/\D/g, '');
    const y = String(b || '').replace(/\D/g, '');
    if (!x || !y) return false;
    return x === y || x.slice(0, -1) === y || x === y.slice(0, -1);
  }

  function dibujar() {
    caja.textContent = '';
    if (oculto) { host.style.display = 'none'; return; }
    host.style.display = '';

    const e = estado || { activo: false };
    const contexto = e.contexto || null;
    const sesion = sesionLocal;
    const rucsSesion = sesion.rucs || [];
    const desajuste = !!(contexto && contexto.ruc && sesion.logueado && rucsSesion.length && !rucsSesion.some((r) => rucCoincide(contexto.ruc, r)));
    const termino = !e.activo && ['terminado', 'error', 'cancelado'].includes(e.fase) && e.ts && e.ts !== desistido && Date.now() - e.ts < 10 * 60 * 1000;
    const hayAlgo = e.activo || !!e.aviso || desajuste || termino;
    const expandido = abierto === null ? hayAlgo : abierto;

    const clase = e.fase === 'error' || desajuste ? 'error' : (e.aviso ? 'alerta' : (e.fase === 'terminado' ? 'ok' : ''));
    const rotulo = e.activo ? `Ekuatia · ${e.hechos || 0}/${e.total || '…'}` : (sesion.logueado ? 'Ekuatia · sesión abierta' : 'Ekuatia');

    if (!expandido) {
      caja.append(h('button', { className: `chip ${clase}`, title: 'Abrir el panel de Ekuatia', onclick: () => { abierto = true; dibujar(); } },
        h('span', { className: `punto${sesion.logueado ? ' on' : ''}` }), rotulo));
      return;
    }

    const cuerpo = h('div', { className: 'cuerpo' });
    cuerpo.append(h('div', { className: 'fila' }, h('b', null, 'App'),
      contexto ? `${contexto.nombre || 'Cliente'} · RUC ${contexto.ruc}` : 'Sin cliente seleccionado'));
    cuerpo.append(h('div', { className: 'fila' }, h('b', null, 'Sesión de Marangatu'),
      sesion.enLogin ? 'En la pantalla de acceso' : (sesion.logueado ? `Abierta${rucsSesion.length ? ' · RUC ' + rucsSesion.join(', ') : ''}` : 'Sin sesión detectada')));
    if (sesion.usuario) cuerpo.append(h('div', { className: 'fila' }, h('b', null, 'Usuario'), sesion.usuario));
    if (sesion.pagina) cuerpo.append(h('div', { className: 'fila' }, h('b', null, 'Pantalla'), sesion.pagina.nombre));

    if (desajuste) cuerpo.append(h('div', { className: 'msg error' }, `La sesión abierta no parece ser la del cliente de la app (${contexto.ruc}). Cerrala antes de seguir.`));

    if (e.activo) {
      cuerpo.append(h('div', { className: 'fila' }, h('b', null, `Tarea: ${e.nombre || e.ruc || ''}`), e.mensaje || 'En curso…'));
      if (e.total) cuerpo.append(h('div', { className: 'barra' }, h('i', { style: `width:${Math.min(100, Math.round(((e.hechos || 0) / e.total) * 100))}%` })));
    } else if (termino) {
      cuerpo.append(h('div', { className: `msg ${e.fase === 'error' ? 'error' : (e.fase === 'terminado' ? 'ok' : '')}` }, e.mensaje || e.error || ''));
      if (e.fase === 'terminado') cuerpo.append(h('div', { className: 'fila' }, '¿Querés cerrar la sesión de este cliente?'));
    }
    if (e.aviso) cuerpo.append(h('div', { className: 'msg alerta' }, e.aviso));

    const botones = h('div', { className: 'botones' });
    const accion = (texto, fn, fuerte) => botones.append(h('button', { textContent: texto, className: fuerte ? 'fuerte' : '', onclick: async (ev) => {
      ev.currentTarget.disabled = true;
      try { await fn(); } finally { setTimeout(() => { sesionLocal = leerSesion(); informarSesion(); dibujar(); }, 1500); }
    } }));
    if (e.activo) {
      accion('Cancelar tarea', () => chrome.runtime.sendMessage({ action: 'PANEL_CANCELAR' }));
      accion('Cancelar y cerrar sesión', async () => { await chrome.runtime.sendMessage({ action: 'PANEL_CANCELAR' }); await dormir(400); await cerrarSesionLocal(); }, true);
    } else {
      if (sesion.logueado) accion('Cerrar sesión', cerrarSesionLocal, true);
      if (termino && e.fase === 'terminado') accion('Dejar abierta', async () => { desistido = e.ts; });
    }
    botones.append(h('button', { textContent: 'Ocultar', onclick: () => { oculto = true; try { sessionStorage.setItem('ekuPanelOculto', '1'); } catch { /* sin storage */ } dibujar(); } }));
    cuerpo.append(botones);

    caja.append(h('div', { className: 'card' },
      h('div', { className: 'cab' }, 'Ekuatia', h('button', { textContent: '–', title: 'Minimizar', onclick: () => { abierto = false; dibujar(); } })),
      cuerpo));
  }

  // --- Arranque --------------------------------------------------------------------------

  document.documentElement.appendChild(host);
  dibujar();
  conectar();
  informarSesion();

  // La página (AngularJS) cambia sin recargar: se vuelve a leer, con pausa.
  let pendiente = null;
  new MutationObserver(() => {
    if (pendiente) return;
    pendiente = setTimeout(() => {
      pendiente = null;
      sesionLocal = leerSesion();
      informarSesion();
      dibujar();
    }, 1500);
  }).observe(document.body || document.documentElement, { childList: true, subtree: true });
  setInterval(() => { sesionLocal = leerSesion(); informarSesion(); dibujar(); }, 15000);
})();
