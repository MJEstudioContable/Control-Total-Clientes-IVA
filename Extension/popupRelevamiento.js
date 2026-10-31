// Popup: sección "Relevamiento de navegación". Activa el registro de
// relevamientoNav.js (content script) y arma el listado para copiar.
(() => {
  const FLAG = 'eku_relev_activo';
  const PREFIX = 'eku_rel_';
  const MARANGATU_HOST = 'marangatu.set.gov.py';
  const el = (id) => document.getElementById(id);

  let tab = null;
  let activo = false;

  const limpiar = (t, max = 40) => String(t || '').replace(/\s+/g, ' ').trim().replace(/\d{6,}/g, '#').slice(0, max);

  async function registros() {
    const todo = await chrome.storage.local.get(null);
    return Object.keys(todo).filter((k) => k.startsWith(PREFIX)).map((k) => todo[k]).sort((a, b) => a.ts - b.ts);
  }

  async function render() {
    const n = (await registros()).length;
    el('relEstado').textContent = (activo ? 'Registrando… ' : 'Registro detenido. ') + n + ' registro(s).';
    el('relEstado').className = activo ? 'ok' : 'muted';
    el('relIniciar').disabled = activo;
    el('relDetener').disabled = !activo;
    el('relMarcar').disabled = !tab;
  }

  async function init() {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    try { if (t && new URL(t.url).hostname === MARANGATU_HOST) tab = t; } catch { /* sin URL accesible */ }
    activo = !!(await chrome.storage.local.get(FLAG))[FLAG];
    await render();
  }

  el('relIniciar').addEventListener('click', async () => {
    await chrome.storage.local.set({ [FLAG]: true });
    activo = true;
    await render();
  });

  el('relDetener').addEventListener('click', async () => {
    await chrome.storage.local.remove(FLAG);
    activo = false;
    await render();
  });

  el('relMarcar').addEventListener('click', async () => {
    const etiqueta = limpiar(el('relMarca').value);
    if (!etiqueta || !tab) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'RELEV_FOTO', etiqueta });
      el('relMarca').value = '';
    } catch {
      el('relEstado').textContent = 'No se pudo marcar: recargá la pestaña de Marangatu y reintentá.';
      el('relEstado').className = 'bad';
      return;
    }
    await render();
  });

  el('relCopiar').addEventListener('click', async () => {
    const lista = await registros();
    const salida = JSON.stringify({ version: 'rel-1', generado: new Date().toISOString(), cantidad: lista.length, registros: lista }, null, 1);
    el('relTexto').value = salida;
    el('relTexto').hidden = false;
    try {
      await navigator.clipboard.writeText(salida);
      el('relCopiar').textContent = 'Copiado (' + lista.length + ')';
    } catch {
      el('relTexto').select(); // si el portapapeles no está disponible, se copia a mano
    }
  });

  el('relBorrar').addEventListener('click', async () => {
    const todo = await chrome.storage.local.get(null);
    await chrome.storage.local.remove(Object.keys(todo).filter((k) => k.startsWith(PREFIX)));
    el('relTexto').value = '';
    el('relTexto').hidden = true;
    el('relCopiar').textContent = 'Copiar listado';
    await render();
  });

  chrome.storage.onChanged.addListener((c, area) => { if (area === 'local') render(); });

  init();
})();
