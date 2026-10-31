// Popup: sección "Descargar formularios IVA". Manda el pedido a descargaBg.js
// (service worker) y muestra el avance que éste deja en chrome.storage.session.
// Va envuelto en una función porque popup.js ya declara $ y esc en el ámbito global.
(() => {
  const ESTADO_KEY = 'ivaDescargaEstado';
  const CONFIG_KEY = 'descargaConfig'; // sólo prefijo y demora: no es información sensible
  const MARANGATU_HOST = 'marangatu.set.gov.py';
  const el = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let tabMarangatu = null;
  let estado = { activo: false };

  async function init() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try {
      if (tab && new URL(tab.url).hostname === MARANGATU_HOST) tabMarangatu = tab;
    } catch { /* pestaña sin URL accesible */ }

    const cfg = (await chrome.storage.local.get(CONFIG_KEY))[CONFIG_KEY] || {};
    if (cfg.prefijo) el('descPrefijo').value = cfg.prefijo;
    if (cfg.demora) el('descDemora').value = cfg.demora;

    const hoy = new Date();
    const mes = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    el('descHasta').value = mes(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1));
    el('descDesde').value = mes(new Date(hoy.getFullYear(), hoy.getMonth() - 6, 1));

    estado = (await chrome.storage.session.get(ESTADO_KEY))[ESTADO_KEY] || { activo: false };
    render();
  }

  function render() {
    const box = el('descEstado');
    const prog = el('descProgreso');
    if (estado.activo) {
      box.className = 'muted';
      box.innerHTML = esc(estado.mensaje || 'En curso…');
      prog.hidden = !estado.total;
      prog.max = estado.total || 1;
      prog.value = estado.hechos || 0;
    } else {
      prog.hidden = true;
      if (estado.fase === 'terminado') { box.className = 'ok'; box.textContent = estado.mensaje; }
      else if (estado.fase === 'error') { box.className = 'bad'; box.textContent = estado.error || estado.mensaje; }
      else if (estado.fase === 'cancelado') { box.className = 'warn'; box.textContent = estado.mensaje; }
      else { box.className = 'muted'; box.textContent = tabMarangatu ? 'Sin descarga en curso.' : 'Abrí Marangatu e iniciá sesión para descargar.'; }
    }
    el('descIniciar').disabled = estado.activo || !tabMarangatu;
    el('descCancelar').disabled = !estado.activo;
    el('descForm').querySelectorAll('input, select').forEach((i) => { i.disabled = !!estado.activo; });
  }

  // Lista AAAA-MM entre dos meses (inclusive), de a uno.
  function rango(desde, hasta) {
    const out = [];
    let [y, m] = desde.split('-').map(Number);
    const [yf, mf] = hasta.split('-').map(Number);
    while ((y < yf || (y === yf && m <= mf)) && out.length <= 24) {
      out.push(y + '-' + String(m).padStart(2, '0'));
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
    return out;
  }

  el('descModo').addEventListener('change', () => {
    el('descRango').hidden = el('descModo').value !== 'rango';
  });

  el('descIniciar').addEventListener('click', async () => {
    const datos = {
      ruc: el('descRuc').value,
      prefijo: el('descPrefijo').value.trim() || 'IVA',
      demora: Number(el('descDemora').value) || 4,
    };
    if (el('descModo').value === 'rango') {
      const desde = el('descDesde').value;
      const hasta = el('descHasta').value;
      const lista = desde && hasta ? rango(desde, hasta) : [];
      if (!lista.length || lista.length > 24) {
        estado = { activo: false, fase: 'error', error: 'Elegí un rango válido de hasta 24 meses.' };
        render();
        return;
      }
      datos.periodos = lista;
    } else {
      datos.ultimos = Number(el('descModo').value);
    }
    await chrome.storage.local.set({ [CONFIG_KEY]: { prefijo: datos.prefijo, demora: datos.demora } });
    el('descIniciar').disabled = true;
    const resp = await chrome.runtime.sendMessage({ action: 'POPUP_DESCARGA_INICIAR', tabId: tabMarangatu.id, datos });
    if (!resp || !resp.ok) {
      const msg = resp && resp.error === 'DESCARGA_EN_CURSO' ? 'Ya hay una descarga en curso.' : (resp && resp.error) || 'No se pudo iniciar.';
      estado = { activo: false, fase: 'error', error: msg };
      render();
    }
  });

  el('descCancelar').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ action: 'POPUP_DESCARGA_CANCELAR' });
  });

  chrome.storage.onChanged.addListener((cambios, area) => {
    if (area === 'session' && cambios[ESTADO_KEY]) {
      estado = cambios[ESTADO_KEY].newValue || { activo: false };
      render();
    }
  });

  init();
})();
