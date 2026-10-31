// ============================================================
// Descarga de formularios IVA - content script.
//
// Es el content script de "Marangatu Pro" (M-dulo-EXTIVA) tal cual funcionaba:
// una máquina de etapas guardada en chrome.storage.local que cada página de
// Marangatu retoma al cargar. Sólo actúa si hay una etapa pendiente (la crea
// descargaBg.js al recibir el pedido de la app o del popup); sin etapa no hace
// nada. Cambios respecto del original: se quitó el login (lo hace background.js)
// y el archivo se llama con el RUC. No guarda ni lee credenciales.
// ============================================================
(function () {
  'use strict';

  const STORAGE_KEY = 'eku_descarga_etapa';
  const DEBUG = false;

  function log(...args) {
    if (DEBUG) console.log('[Marangatu Pro]', ...args);
  }

  function normalizeText(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  function getContribuyenteNombreFromInputs() {
    const nombre = normalizeText(document.getElementById('nombre')?.value || '');
    const apellido = normalizeText(document.getElementById('primerApellido')?.value || '');
    const full = normalizeText(`${nombre} ${apellido}`);
    return full || null;
  }

  // ── Al cargar, leer tarea pendiente ───────────────────────
  // Chrome puede inyectar este script cuando "load" ya ocurrió: en ese caso se
  // arranca de inmediato en lugar de esperar un evento que no va a llegar.
  async function alCargarPagina() {
    log('📄 Nueva pagina cargada:', window.location.href);
    
    await delay(150);

    const data = await chrome.storage.local.get(STORAGE_KEY);
    const automation = data[STORAGE_KEY];
    
    if (!automation || !automation.etapa) {
      log('ℹ️ No hay automatizacion pendiente en esta tab');
      return;
    }

    const { etapa, state } = automation;

    // Evitar ejecutar automatizaciones viejas que quedan colgadas
    const ageMs = Date.now() - (automation.updatedAt || Date.now());
    if (ageMs > 30 * 60 * 1000) {
      log('⏱️ Automatizacion expirada, limpiando estado');
      clearEtapa();
      return;
    }
    
    // Sólo la pestaña dueña de la descarga puede actuar: otra pestaña de
    // Marangatu abierta a mano comparte esta etapa (storage.local) pero no debe
    // ejecutarla. Sin respuesta del service worker no se hace nada.
    if (!(await pedirPermiso(etapa))) {
      log('ℹ️ Esta pestaña no es la dueña de la descarga, se ignora la etapa');
      return;
    }

    log('🎯 Etapa pendiente:', etapa);

    switch (etapa) {
      case 'BUSCAR_CONTRIBUYENTE':
        log('▶️ Ejecutando: BUSCAR_CONTRIBUYENTE');
        runBuscarContribuyente(state);
        break;
      case 'CLICK_IVA_DECLARACIONES':
        log('▶️ Ejecutando: CLICK_IVA_DECLARACIONES');
        runClickIvaDeclaraciones(state);
        break;
      case 'LEER_TABLA_IVA':
        log('▶️ Ejecutando: LEER_TABLA_IVA');
        runLeerTablaIva(state);
        break;
      case 'GUARDAR_FORMULARIO':
        log('▶️ Ejecutando: GUARDAR_FORMULARIO');
        // Solo imprimir si esta tab es exactamente el formulario esperado.
        if (!isExpectedFormularioTab(state, window.location.href)) {
          log('ℹ️ Tab no coincide con formulario esperado, no se imprime');
          // Limpiar estado para evitar que cualquier formulario manual dispare print.
          clearEtapa();
          return;
        }
        runGuardarFormulario(state);
        break;
      default:
        log('⚠️ Etapa desconocida:', etapa);
    }
  }

  async function pedirPermiso(etapa) {
    try {
      const r = await chrome.runtime.sendMessage({ action: 'ETAPA_PERMISO', etapa });
      return !!(r && r.ok);
    } catch {
      return false;
    }
  }

  if (document.readyState === 'complete') alCargarPagina();
  else window.addEventListener('load', alCargarPagina, { once: true });

  // ── Escuchar mensajes ─────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || sender.id !== chrome.runtime.id) return false;
    switch (message.action) {
      case 'INICIAR_DESCARGA_IVA':
        iniciarDescarga(message.state);
        break;

      case 'ABRIR_SIGUIENTE_FORMULARIO':
        abrirSiguienteFormularioEnListaTab(message.state);
        break;

    }
    sendResponse({ ok: true });
    return true;
  });

  // ═══════════════════════════════════════════════════════════
  // INICIAR DESCARGA
  // ═══════════════════════════════════════════════════════════
  function iniciarDescarga(state) {
    log('Iniciando descarga de formularios IVA');

    const ctx = detectContext();
    log('Contexto detectado:', ctx);

    // Lógica situacional: arrancar desde donde ya está el usuario.
    if (ctx === 'lista_ddjj') {
      setEtapa('LEER_TABLA_IVA', state);
      runLeerTablaIva(state);
      return;
    }

    if (ctx === 'resultado_vision') {
      setEtapa('CLICK_IVA_DECLARACIONES', state);
      runClickIvaDeclaraciones(state);
      return;
    }

    if (ctx === 'vision_integral') {
      setEtapa('BUSCAR_CONTRIBUYENTE', state);
      runBuscarContribuyente(state);
      return;
    }

    if (ctx === 'login_page') {
      reportarError('La tab activa esta en login. Inicia sesion en Marangatu y reintenta.');
      return;
    }

    setEtapa('CLICK_CONSULTAS', state);
    ejecutarClickConsultas(state);
  }

  function detectContext() {
    const url = window.location.href;
    if (document.querySelector('input[type="password"]')) return 'login_page';

    const hasDdjjRows = !!document.querySelector('a[href*="consultarDDJJCompleta.do"]');
    if (hasDdjjRows) return 'lista_ddjj';

    const has211 = Array.from(document.querySelectorAll('table tr')).some(tr => {
      const txt = normalizeText(tr.textContent).toUpperCase();
      return txt.includes('211') && txt.includes('IVA') && txt.includes('DECLARACIONES');
    });
    if (has211) return 'resultado_vision';

    const hasBusquedaButton = !!document.querySelector('button[name="botonConsultar"], button[type="submit"]');
    const isMarangatu = url.includes('marangatu.set.gov.py');
    if (isMarangatu && hasBusquedaButton) return 'vision_integral';

    return 'dashboard';
  }

  // ═══════════════════════════════════════════════════════════
  // PASO 1: Click en "Consultas"
  // ═══════════════════════════════════════════════════════════
  async function ejecutarClickConsultas(state) {
    console.log('[Marangatu Pro] 🔍 PASO 1: Buscando menú Consultas...');
    
    // Buscar el elemento "Consultas" con múltiples intentos
    const menuItem = await waitForText('Consultas', 12000);
    if (!menuItem) {
      reportarError('No se encontró el menú "Consultas". Verifica que estés en el dashboard de Marangatu.');
      return;
    }

    console.log('[Marangatu Pro] ✅ Encontrado menú Consultas');
    console.log('[Marangatu Pro] 👆 Haciendo click en Consultas...');
    menuItem.click();
    
    // Espera breve para expandir submenú
    await delay(250);

    // Buscar "Visión Integral Del Contribuyente" (con "Del" en mayúscula)
    console.log('[Marangatu Pro] 🔍 Buscando "Visión Integral Del Contribuyente"...');
    
    let visionLink = await waitForText('Visión Integral Del Contribuyente', 10000);
    
    // Si no encuentra, intentar con "del" en minúscula
    if (!visionLink) {
      console.log('[Marangatu Pro] 🔍 Intentando con "del" en minúscula...');
      visionLink = await waitForText('Visión Integral del Contribuyente', 5000);
    }
    
    // Intentar solo "Visión Integral"
    if (!visionLink) {
      console.log('[Marangatu Pro] 🔍 Intentando solo "Visión Integral"...');
      visionLink = await waitForText('Visión Integral', 5000);
    }
    
    if (!visionLink) {
      console.error('[Marangatu Pro] ❌ No se encontró ninguna opción relacionada con "Visión Integral"');
      console.error('[Marangatu Pro] 💡 Busca manualmente en la lista de arriba cuál opción te lleva a ver formularios IVA');
      reportarError('No apareció "Visión Integral del Contribuyente". Revisa la consola (F12) para ver las opciones disponibles.');
      return;
    }

    console.log('[Marangatu Pro] ✅ Encontrado elemento:', visionLink.textContent.trim());
    console.log('[Marangatu Pro] 👆 Haciendo click...');
    setEtapa('BUSCAR_CONTRIBUYENTE', state);
    visionLink.click();
  }

  // ═══════════════════════════════════════════════════════════
  // PASO 2: Llenar RUC y buscar
  // ═══════════════════════════════════════════════════════════
  async function runBuscarContribuyente(state) {
    console.log('[Marangatu Pro] 🔍 PASO 2: En Visión Integral - Click en Búsqueda');
    
    // El botón lo dibuja AngularJS (data-ng-if) después de que la página
    // carga: se espera a que aparezca (hasta 15 s).
    let btnBusqueda = await waitForCondition(
      () => document.querySelector('button[name="botonConsultar"]')
        || Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.includes('Búsqueda')),
      15000, 200
    );

    if (!btnBusqueda) {
      btnBusqueda = document.querySelector('button[type="submit"]');
    }

    if (!btnBusqueda) {
      console.error('[Marangatu Pro] ❌ No se encontró botón Búsqueda');
      reportarError('No se encontró el botón Búsqueda');
      return;
    }

    console.log('[Marangatu Pro] ✅ Botón encontrado');
    console.log('[Marangatu Pro] 👆 Click en Búsqueda...');
    
    btnBusqueda.click();
    
    console.log('[Marangatu Pro] ✅ Click realizado');

    // Esperar reactivamente a que aparezca 211 (sin delay fijo)
    const ready = await waitForCondition(() => {
      const rows = Array.from(document.querySelectorAll('table tr'));
      return rows.some(tr => normalizeText(tr.textContent).includes('211'));
    }, 12000, 150);

    if (!ready) {
      reportarError('No cargo la tabla luego de Búsqueda');
      return;
    }

    // Tomar nombre + primer apellido desde los campos readonly de la pantalla.
    const nombreContribuyente = getContribuyenteNombreFromInputs();
    if (nombreContribuyente) {
      state.cliente = state.cliente || {};
      state.cliente.nombre = nombreContribuyente;
      log('✅ Nombre contribuyente detectado:', nombreContribuyente);
    }

    runClickIvaDeclaraciones(state);
  }

  // ═══════════════════════════════════════════════════════════
  // PASO 3: Click en "211 - IVA General"
  // ═══════════════════════════════════════════════════════════
  async function runClickIvaDeclaraciones(state) {
    log('🔍 PASO 3: buscando fila 211 IVA General + 1 DECLARACIONES...');

    const linkIva = await waitForCondition(() => {
      const filas = Array.from(document.querySelectorAll('table tr'));
      const fila = filas.find(tr => {
        const txt = normalizeText(tr.textContent).toUpperCase();
        return txt.includes('211') && txt.includes('IVA') && txt.includes('DECLARACIONES');
      });
      if (!fila) return null;
      return fila.querySelector('a[href*="consultarTransacciones.do"]');
    }, 8000, 300);

    if (!linkIva) {
      reportarError('No se encontro la fila 211 IVA General / 1 DECLARACIONES');
      return;
    }

    log('✅ Link 211 encontrado:', normalizeText(linkIva.textContent));
    setEtapa('LEER_TABLA_IVA', state);
    linkIva.click();
  }

  // ═══════════════════════════════════════════════════════════
  // PASO 4: Leer tabla y armar cola
  // ═══════════════════════════════════════════════════════════
  async function runLeerTablaIva(state) {
    log('🔍 PASO 4: leyendo tabla de formularios IVA...');

    await waitForSelector('table tbody tr', 10000);
    const filas = Array.from(document.querySelectorAll('table tbody tr'));

    const formularios = [];
    filas.forEach((tr) => {
      const periodAnchor = tr.querySelector('td:first-child a[href*="consultarDetalleCuenta.do"]');
      const ddjjAnchor = tr.querySelector('a[href*="consultarDDJJCompleta.do"]');
      if (!periodAnchor || !ddjjAnchor) return;

      const periodo = normalizarPeriodo(normalizeText(periodAnchor.textContent));
      if (!/^\d{2}\/\d{4}$/.test(periodo)) return;
      formularios.push({ periodo, href: ddjjAnchor.href });
    });

    if (!formularios.length) {
      reportarError('No se encontraron filas DDJJ en tabla IVA');
      return;
    }

    // Ordenar disponibles del mas reciente al mas antiguo
    formularios.sort((a, b) => {
      const [ma, ya] = a.periodo.split('/').map(Number);
      const [mb, yb] = b.periodo.split('/').map(Number);
      return (yb * 12 + mb) - (ya * 12 + ma);
    });

    let cola = [];
    if (state.selectionMode === 'custom') {
      const periodosRequeridos = (state.meses || []).map(m => `${String(m.mes).padStart(2, '0')}/${m.anio}`);
      log('🎯 Periodos custom solicitados:', periodosRequeridos);
      cola = periodosRequeridos
        .map(p => formularios.find(f => f.periodo === p))
        .filter(Boolean);
    } else {
      const count = state.selectionCount || state.cantidadMeses || 1;
      log('🎯 Ultimos disponibles solicitados:', count);
      cola = formularios.slice(0, count);
    }

    if (!cola.length) {
      reportarError('No se encontraron DDJJ para los periodos solicitados');
      return;
    }

    log('✅ Formularios a descargar:', cola.map(c => c.periodo));

    state.cola = cola;
    state.colaIndex = 0;

    chrome.runtime.sendMessage({
      action: 'FORMULARIOS_ENCONTRADOS',
      periodos: cola.map(f => f.periodo)
    });

    await delay(300);
    log('👆 Abriendo primer formulario...');
    abrirFormularioDeCola(state);
  }

  // ═══════════════════════════════════════════════════════════
  // PASO 5: Abrir formulario
  // ═══════════════════════════════════════════════════════════
  function abrirFormularioDeCola(state) {
    const item = state.cola[state.colaIndex];
    if (!item) return;

    console.log(`[Marangatu Pro] Abriendo formulario ${item.periodo}`);
    setEtapa('GUARDAR_FORMULARIO', state);
    chrome.runtime.sendMessage({ action: 'OPEN_FORMULARIO_TAB', href: item.href }, () => {
      if (chrome.runtime.lastError) {
        window.open(item.href, '_blank');
      }
    });
  }

  function abrirSiguienteFormularioEnListaTab(state) {
    abrirFormularioDeCola(state);
  }

  // ═══════════════════════════════════════════════════════════
  // PASO 6: Guardar formulario
  // ═══════════════════════════════════════════════════════════
  async function runGuardarFormulario(state) {
    console.log('[Marangatu Pro] Preparando descarga...');
    
    await waitForContent(6000);

    const item = state.cola[state.colaIndex];
    const [mm, aaaa] = item.periodo.split('/');
    const clienteNombre = sanitize(state.cliente.ruc || state.cliente.nombre);
    const prefix = state.config?.prefix || 'IVA';
    const nombreSugerido = `${prefix}_${aaaa}_${mm}_${clienteNombre}`;

    chrome.runtime.sendMessage({
      action: 'DESCARGANDO_FORMULARIO',
      periodo: item.periodo,
      index: state.colaIndex,
      total: state.cola.length
    });

    inyectarEstiloPrint();
    await delay(1000);
    
    document.title = nombreSugerido;
    window.print();

    await delay(state.config?.delay * 1000 || 4000);
    avanzarCola(state);
  }

  // ═══════════════════════════════════════════════════════════
  // Avanzar cola
  // ═══════════════════════════════════════════════════════════
  function avanzarCola(state) {
    chrome.runtime.sendMessage({
      action: 'FORMULARIO_GUARDADO',
      index: state.colaIndex,
      total: state.cola.length
    });

    state.colaIndex++;

    if (state.colaIndex >= state.cola.length) {
      chrome.runtime.sendMessage({ action: 'DESCARGA_COMPLETA' });
      clearEtapa();
      window.close();
      return;
    }

    chrome.runtime.sendMessage({
      action: 'ABRIR_SIGUIENTE_FORMULARIO',
      state
    });
    
    window.close();
  }

  // ═══════════════════════════════════════════════════════════
  // Gestión de etapas
  // ═══════════════════════════════════════════════════════════
  function setEtapa(etapa, state) {
    chrome.storage.local.set({ [STORAGE_KEY]: { etapa, state, updatedAt: Date.now() } });
  }

  function clearEtapa() {
    chrome.storage.local.remove(STORAGE_KEY);
  }

  function isExpectedFormularioTab(state, currentUrl) {
    try {
      const item = state?.cola?.[state?.colaIndex];
      if (!item?.href) return false;

      const expected = new URL(item.href, window.location.origin);
      const current = new URL(currentUrl, window.location.origin);

      // Comparamos host + ruta + query para evitar disparos en formularios manuales.
      return (
        expected.origin === current.origin &&
        expected.pathname === current.pathname &&
        expected.search === current.search &&
        current.pathname.includes('consultarDDJJCompleta.do')
      );
    } catch {
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Normalización de período
  // ═══════════════════════════════════════════════════════════
  function normalizarPeriodo(texto) {
    let m = texto.match(/^(\d{2})\/(\d{4})$/);
    if (m) return texto;

    m = texto.match(/^(\d{4})[-\/](\d{2})$/);
    if (m) return `${m[2]}/${m[1]}`;

    m = texto.match(/(\d{1,2})[\/\-](\d{4})/);
    if (m) return `${String(m[1]).padStart(2, '0')}/${m[2]}`;

    return texto;
  }

  // ═══════════════════════════════════════════════════════════
  // UTILIDADES
  // ═══════════════════════════════════════════════════════════
  function waitForSelector(selector, timeout = 6000) {
    return new Promise(resolve => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) {
          observer.disconnect();
          resolve(found);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  function waitForText(text, timeout = 6000) {
    const textLower = text.toLowerCase();
    return new Promise(resolve => {
      const find = () => {
        const all = document.querySelectorAll('a, button, li, span, div, p');
        for (const el of all) {
          const elementText = el.textContent.trim();
          const elementTextLower = elementText.toLowerCase();
          
          // Buscar coincidencia exacta (ignorando mayúsculas)
          if (elementTextLower === textLower && el.offsetParent !== null) {
            console.log(`[Marangatu Pro] ✅ Match exacto: "${elementText}"`);
            return el;
          }
          
          // Buscar que contenga el texto (ignorando mayúsculas)
          if (
            elementTextLower.includes(textLower) &&
            el.offsetParent !== null &&
            elementText.length < 200 // Evitar elementos muy largos
          ) {
            // Priorizar elementos clickables
            if (el.tagName === 'A' || el.tagName === 'BUTTON' || el.tagName === 'LI') {
              console.log(`[Marangatu Pro] ✅ Match clickable: "${elementText}"`);
              return el;
            }
          }
        }
        return null;
      };

      const existing = find();
      if (existing) {
        console.log(`[Marangatu Pro] Encontrado inmediatamente: "${text}"`);
        return resolve(existing);
      }

      console.log(`[Marangatu Pro] Esperando elemento: "${text}"`);
      
      const observer = new MutationObserver(() => {
        const found = find();
        if (found) {
          console.log(`[Marangatu Pro] Elemento apareció: "${text}"`);
          observer.disconnect();
          resolve(found);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
      
      setTimeout(() => {
        console.log(`[Marangatu Pro] ⏱️ Timeout esperando: "${text}"`);
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  function waitForContent(timeout = 5000) {
    return new Promise(resolve => {
      if (document.readyState === 'complete') return resolve();
      window.addEventListener('load', resolve, { once: true });
      setTimeout(resolve, timeout);
    });
  }

  function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function waitForCondition(fn, timeout = 6000, poll = 250) {
    return new Promise(resolve => {
      const start = Date.now();
      const tick = () => {
        let value = null;
        try {
          value = fn();
        } catch {
          value = null;
        }
        if (value) return resolve(value);
        if (Date.now() - start >= timeout) return resolve(null);
        setTimeout(tick, poll);
      };
      tick();
    });
  }

  // Buscar elemento por XPath
  function getElementByXPath(xpath) {
    return document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    ).singleNodeValue;
  }

  function inyectarEstiloPrint() {
    if (document.getElementById('mp-print-style')) return;
    const s = document.createElement('style');
    s.id = 'mp-print-style';
    s.textContent = `
      @media print {
        nav, header, footer, .menu, .sidebar,
        .no-print, [class*="header"], [class*="nav"],
        [class*="menu"], [class*="footer"] { display: none !important; }
        body { margin: 0 !important; }
        @page { margin: 10mm; }
      }
    `;
    document.head.appendChild(s);
  }

  function sanitize(name) {
    return (name || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_ ]/g, '')
      .replace(/\s+/g, '_')
      .toUpperCase()
      .substring(0, 35);
  }

  function reportarError(msg) {
    console.error('[Marangatu Pro]', msg);
    chrome.runtime.sendMessage({ action: 'ERROR_AUTOMATIZACION', error: msg });
    clearEtapa();
  }

})();
