// Popup: sección "Página actual". Pregunta al catálogo (paginas.js) en qué
// pantalla de Marangatu está la pestaña activa y lo muestra.
// identificarPagina viene de paginas.js (cargado antes en popup.html).
/* global identificarPagina */
(() => {
  const MARANGATU_HOST = 'marangatu.set.gov.py';
  const el = (id) => document.getElementById(id);

  // Entre los marcos de la pestaña (el Formulario 120 puede estar en uno) gana el
  // reconocimiento firme; después el provisorio; el principal desempata.
  function elegir(resultados) {
    const lista = resultados.filter(Boolean);
    const puntos = (r) => (r.id !== 'DESCONOCIDA' ? (r.provisoria ? 1 : 2) : 0) * 2 + (r.marco === 'principal' ? 1 : 0);
    return lista.sort((a, b) => puntos(b) - puntos(a))[0] || null;
  }

  async function reconocer() {
    const estado = el('pagEstado');
    const detalle = el('pagDetalle');
    detalle.hidden = true;
    estado.className = 'muted';
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let host = '';
    try { host = new URL(tab.url).hostname; } catch { /* sin URL accesible */ }
    if (host !== MARANGATU_HOST) {
      estado.textContent = 'Abrí una pestaña de Marangatu para reconocer la página.';
      return;
    }
    try {
      const frames = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: identificarPagina });
      const r = elegir(frames.map((f) => f.result));
      if (!r) { estado.textContent = 'No se pudo leer la página.'; return; }
      estado.textContent = r.nombre + (r.provisoria ? ' (provisoria)' : '');
      estado.className = r.id === 'DESCONOCIDA' ? 'warn' : 'ok';
      detalle.textContent = r.id === 'DESCONOCIDA'
        ? 'Esta pantalla todavía no está en el catálogo: usá el relevamiento de navegación para registrarla.'
        : r.id + ' · ruta ' + r.ruta + ' · ' + r.evidencia + (r.provisoria ? ' · regla supuesta, a confirmar con el relevamiento' : '');
      detalle.hidden = false;
    } catch (err) {
      estado.textContent = 'No se pudo reconocer: ' + err.message;
      estado.className = 'bad';
    }
  }

  el('pagReconocer').addEventListener('click', reconocer);
  reconocer();
})();
