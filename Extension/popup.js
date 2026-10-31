// Popup de Ekuatia Login: completa el Formulario 120 con las casillas que
// mandó Control Clientes y genera el relevamiento de campos.
// MAPA_CASILLAS, FORMATO_IMPORTE, completarFormulario120 y relevarFormulario
// vienen de formulario120.js (cargado antes en popup.html).
/* global MAPA_CASILLAS, FORMATO_IMPORTE, completarFormulario120, relevarFormulario, seleccionarObligacionIva */
const IVA_STORAGE_KEY = 'ivaPendiente';
const MARANGATU_HOST = 'marangatu.set.gov.py';

const $ = (id) => document.getElementById(id);
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const perLabel = (p) => { const [y, m] = p.split('-'); return MESES[Number(m) - 1] + ' ' + y; };
// El IVA de un mes se presenta en el mes siguiente.
const presentaLabel = (p) => { const [y, m] = p.split('-').map(Number); return m === 12 ? perLabel((y + 1) + '-01') : perLabel(y + '-' + String(m + 1).padStart(2, '0')); };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let pendiente = null;
let tabMarangatu = null;

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    if (tab && new URL(tab.url).hostname === MARANGATU_HOST) tabMarangatu = tab;
  } catch { /* pestaña sin URL accesible */ }

  const data = await chrome.storage.session.get(IVA_STORAGE_KEY);
  pendiente = data[IVA_STORAGE_KEY] || null;
  if (pendiente && pendiente.expiresAt < Date.now()) {
    await chrome.storage.session.remove(IVA_STORAGE_KEY);
    pendiente = null;
  }
  render();
}

function render() {
  const box = $('pendiente');
  if (!pendiente) {
    box.innerHTML = 'No hay datos para cargar. Usá <b>Copiar a Marangatu</b> en la ficha IVA del cliente.';
  } else {
    const min = Math.max(1, Math.round((pendiente.expiresAt - Date.now()) / 60000));
    const conImporte = pendiente.casillas.filter((c) => c.valor).length;
    box.innerHTML =
      '<p><b>' + esc(pendiente.nombre || 'Cliente') + '</b> · RUC ' + esc(pendiente.ruc) + '</p>' +
      '<p>IVA de <b>' + esc(perLabel(pendiente.periodo)) + '</b> (se presenta en ' + esc(presentaLabel(pendiente.periodo)) + ') · ' + conImporte + ' casillas con importe</p>' +
      '<p class="muted">Se borran en ' + min + ' min o al cerrar el navegador.</p>' +
      (tabMarangatu ? '' : '<p class="warn">Abrí esta ventana estando en el Formulario 120 de Marangatu.</p>');
  }
  $('completar').disabled = !pendiente || !tabMarangatu;
  $('seleccionar').disabled = !pendiente || !tabMarangatu;
  $('descartar').disabled = !pendiente;
  $('relevar').disabled = !tabMarangatu;
}

$('completar').addEventListener('click', async () => {
  $('completar').disabled = true;
  const resultado = $('resultado');
  try {
    const frames = await chrome.scripting.executeScript({
      target: { tabId: tabMarangatu.id, allFrames: true },
      func: completarFormulario120,
      // Botón manual: escribe todas las casillas, aunque ya tengan importe.
      args: [pendiente.casillas, MAPA_CASILLAS, FORMATO_IMPORTE, pendiente.control || [], false],
    });
    const r = frames.map((f) => f.result).find((x) => x && x.esFormulario);
    const fmt = (n) => (n < 0 ? '-' : '') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    if (!r) {
      resultado.innerHTML = '<h2>Resultado</h2><p class="bad">Esta página no es el Formulario 120. Elegí IVA y período y pulsá Continuar.</p>';
      return;
    }
    resultado.innerHTML =
      '<h2>Resultado</h2>' +
      '<p class="ok">Cargadas: ' + (r.completadas.join(', ') || 'ninguna') + '</p>' +
      (r.faltantes.length ? '<p class="bad">No encontradas (cargalas a mano): ' + r.faltantes.join(', ') + '</p>' : '') +
      (r.diferencias.length
        ? '<p class="bad">Diferencias con la app:</p>' + r.diferencias.map((d) => '<p class="bad">Casilla ' + esc(d.cas) + ': app ' + fmt(d.esperado) + ' · Marangatu ' + fmt(d.formulario) + '</p>').join('')
        : '<p class="ok">Totales de control: coinciden con la app.</p>') +
      '<p class="warn">Revisá los campos marcados en amarillo y presentá vos la declaración.</p>';
  } catch (err) {
    resultado.innerHTML = '<h2>Resultado</h2><p class="bad">No se pudo completar: ' + esc(err.message) + '</p>';
  } finally {
    render();
  }
});

$('seleccionar').addEventListener('click', async () => {
  $('seleccionar').disabled = true;
  const resultado = $('resultado');
  const [anio, mes] = pendiente.periodo.split('-').map(Number);
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tabMarangatu.id },
      func: seleccionarObligacionIva,
      args: [anio, mes],
    });
    resultado.innerHTML = '<h2>Selección</h2>' +
      (result.pasos || []).map((p) => '<p class="ok">' + esc(p) + '</p>').join('') +
      (result.ok ? '<p class="warn">Revisá y pulsá el botón para continuar.</p>' : '<p class="bad">' + esc(result.error) + '</p>');
  } catch (err) {
    resultado.innerHTML = '<h2>Selección</h2><p class="bad">No se pudo: ' + esc(err.message) + '</p>';
  } finally {
    render();
  }
});

$('descartar').addEventListener('click', async () => {
  await chrome.storage.session.remove(IVA_STORAGE_KEY);
  pendiente = null;
  $('resultado').innerHTML = '';
  render();
});

$('relevar').addEventListener('click', async () => {
  try {
    const frames = await chrome.scripting.executeScript({
      target: { tabId: tabMarangatu.id, allFrames: true },
      func: relevarFormulario,
    });
    const listado = {
      generado: new Date().toISOString(),
      frames: frames.map(({ result }) => result).filter((r) => r && r.campos.length),
    };
    $('relevamientoTexto').value = JSON.stringify(listado, null, 2);
    $('relevamiento').hidden = false;
  } catch (err) {
    $('relevamientoTexto').value = 'No se pudo relevar: ' + err.message;
    $('relevamiento').hidden = false;
  }
});

$('copiarRelevamiento').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('relevamientoTexto').value);
  $('copiarRelevamiento').textContent = 'Copiado';
});

init();
