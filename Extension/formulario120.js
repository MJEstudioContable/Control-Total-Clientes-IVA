// Formulario 120 (IVA) de Marangatu y las funciones que la extensión inyecta
// en sus páginas.
//
// Relevado del formulario real: cada casilla es un <input id="C{número}">
// (C10, C22, C150…). Marangatu calcula el IVA de cada fila y los totales con
// su función Calcular() al cambiar un campo, así que se escriben sólo las
// casillas de ingreso (monto imponible) y se dispara su evento "change".
//
// MAPA_CASILLAS: excepciones casilla -> selector CSS, por si algún campo no
// sigue el patrón #C{número}. Vacío mientras el formulario no cambie.
// eslint-disable-next-line no-unused-vars -- lo usan popup.js y background.js
const MAPA_CASILLAS = {};

// Formato del importe al escribirlo: 'plano' = 1000000, 'miles' = 1.000.000.
// Marangatu pone los puntos solo (onBlurSoloNumeros).
// eslint-disable-next-line no-unused-vars -- lo usan popup.js y background.js
const FORMATO_IMPORTE = 'plano';

// --- Funciones inyectadas (serializadas por executeScript: autocontenidas) ---

// Escribe cada casilla en su campo y después compara los totales que calcula
// Marangatu con los de la app. Nunca envía ni presenta el formulario. Sólo
// actúa si la página es el Formulario 120 (tiene #C10 y #C44).
// soloVacios: no pisa campos que ya tienen un importe (modo automático).
// Devuelve { esFormulario, completadas, yaTenian, calculadas, faltantes, diferencias }.
// eslint-disable-next-line no-unused-vars -- lo usan popup.js y background.js
async function completarFormulario120(casillas, mapa, formato, control, soloVacios) {
  const res = { esFormulario: false, completadas: [], yaTenian: [], calculadas: [], faltantes: [], diferencias: [] };
  if (!document.getElementById('C10') || !document.getElementById('C44')) return res;
  res.esFormulario = true;

  const numero = (v) => { const t = String(v || '').replace(/[^\d-]/g, ''); return t === '' || t === '-' ? 0 : parseInt(t, 10); };
  const texto = (n) => (formato === 'miles'
    ? (n < 0 ? '-' : '') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    : String(n));
  // Setter nativo, por si el campo lo maneja un framework.
  const escribir = (el, v) => {
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    if (desc && desc.set) desc.set.call(el, v);
    else el.value = v;
  };
  const buscar = (cas) => (mapa[cas] ? document.querySelector(mapa[cas]) : document.getElementById('C' + cas));

  for (const { cas, valor } of casillas) {
    if (!valor) continue;
    const el = buscar(cas);
    if (!el || el.type === 'password' || el.type === 'hidden') { res.faltantes.push(cas); continue; }
    if (el.readOnly || el.disabled) { res.calculadas.push(cas); continue; }
    if (soloVacios && numero(el.value) !== 0) { res.yaTenian.push(cas); continue; }
    el.focus();
    escribir(el, texto(valor));
    // El onchange inline de Marangatu formatea y ejecuta Calcular(this.form).
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    el.style.outline = '2px solid #e0a800';
    el.style.backgroundColor = '#fff3b0';
    el.title = 'Completado por Ekuatia Login (casilla ' + cas + '): revisá antes de presentar';
    res.completadas.push(cas);
  }
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

  // Totales de control: lo que calculó Marangatu contra lo que calculó la
  // app. Hasta 3 Gs de diferencia se toma como redondeo.
  await new Promise((r) => setTimeout(r, 300));
  for (const { cas, valor } of control || []) {
    const el = buscar(cas);
    if (!el) continue;
    const formulario = numero(el.value);
    if (Math.abs(formulario - valor) > 3) res.diferencias.push({ cas, esperado: valor, formulario });
  }
  return res;
}

// Lista los campos del formulario SIN sus valores (ni contraseñas), para
// armar MAPA_CASILLAS. Devuelve un objeto por frame.
// eslint-disable-next-line no-unused-vars -- lo usa popup.js
function relevarFormulario() {
  const corto = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const campos = [...document.querySelectorAll('input, select, textarea')]
    .filter((el) => el.type !== 'password' && el.type !== 'hidden')
    .map((el) => {
      const label = (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) || el.closest('label');
      const fila = el.closest('tr') || el.parentElement;
      return {
        tag: el.tagName.toLowerCase(),
        type: el.type || '',
        id: el.id || '',
        name: el.name || '',
        clase: corto(el.className, 80),
        placeholder: corto(el.placeholder, 60),
        aria: corto(el.getAttribute('aria-label'), 80),
        label: corto(label && label.innerText, 120),
        contexto: corto(fila && fila.innerText, 160),
        soloLectura: Boolean(el.readOnly || el.disabled),
      };
    });
  return {
    pagina: location.origin + location.pathname,
    titulo: corto(document.title, 120),
    encabezados: [...document.querySelectorAll('h1, h2, h3, legend')].map((h) => corto(h.innerText, 100)).filter(Boolean).slice(0, 40),
    campos,
  };
}

// Pantalla "Presentar Declaración" (recibirDDJJContribuyente.do, AngularJS):
// elige 211 - IVA General, periodicidad MENSUAL, año y mes del período
// fiscal. Cada select se llena recién cuando se eligió el anterior, por eso
// se espera a que aparezcan sus opciones. No pulsa el botón de continuar.
// Devuelve { ok, pasos, error }.
// eslint-disable-next-line no-unused-vars -- lo usan popup.js y background.js
async function seleccionarObligacionIva(anio, mes) {
  const pasos = [];
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const buscar = (modelo) => document.querySelector('select[data-ng-model="' + modelo + '"], select[ng-model="' + modelo + '"]');
  const elegir = async (modelo, valor, nombre) => {
    for (let i = 0; i < 40; i++) {
      const sel = buscar(modelo);
      const opt = sel && [...sel.options].find((o) => o.value === String(valor));
      if (opt) {
        if (sel.value !== opt.value) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        sel.style.outline = '2px solid #e0a800';
        pasos.push(nombre + ': ' + opt.textContent.replace(/\s+/g, ' ').trim());
        return true;
      }
      await esperar(250);
    }
    return false;
  };
  if (!buscar('vm.datos.obligacion')) return { ok: false, pasos, error: 'No es la pantalla de selección de obligación' };
  if (!(await elegir('vm.datos.obligacion', '211', 'Obligación'))) return { ok: false, pasos, error: 'No aparece 211 - IVA General para este contribuyente' };
  if (!(await elegir('vm.datos.periodicidad', '1', 'Periodicidad'))) return { ok: false, pasos, error: 'No aparece la periodicidad MENSUAL' };
  if (!(await elegir('vm.datos.anio', String(anio), 'Año'))) return { ok: false, pasos, error: 'No aparece el año ' + anio };
  if (!(await elegir('vm.datos.mes', String(mes), 'Mes'))) return { ok: false, pasos, error: 'No aparece el mes ' + mes };
  return { ok: true, pasos };
}

// Recuadro fijo en Marangatu con el cliente y el período a declarar, para
// tener la referencia a la vista. Se puede cerrar; no tapa el formulario.
// eslint-disable-next-line no-unused-vars -- lo usa background.js
function mostrarReferenciaIva(info) {
  let box = document.getElementById('ekuatia-referencia');
  if (!box) {
    box = document.createElement('div');
    box.id = 'ekuatia-referencia';
    box.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;max-width:320px;' +
      'background:#fffbe6;color:#14213a;border:2px solid #e0a800;border-radius:10px;padding:10px 12px;' +
      'font:13px/1.4 system-ui,Segoe UI,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.2)';
    document.body.appendChild(box);
  }
  box.textContent = '';
  const linea = (texto, negrita) => {
    const d = document.createElement('div');
    d.textContent = texto;
    if (negrita) d.style.fontWeight = '700';
    box.appendChild(d);
  };
  linea('Ekuatia · Control Clientes', true);
  linea(info.nombre + ' · RUC ' + info.ruc);
  linea('IVA de ' + info.periodoTexto + ' (se presenta en ' + info.presentaTexto + ')', true);
  const r = info.resultado;
  if (!r) {
    linea('Elegí: 211 - IVA General · Mensual · ' + info.anio + ' · ' + info.mesTexto);
  } else {
    const fmt = (n) => (n < 0 ? '-' : '') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    linea('Casillas cargadas: ' + (r.completadas.length ? r.completadas.join(', ') : 'ninguna'));
    if (r.yaTenian.length) linea('Ya tenían importe (no se tocaron): ' + r.yaTenian.join(', '));
    if (r.faltantes.length) linea('No encontradas (cargalas a mano): ' + r.faltantes.join(', '));
    if (r.diferencias.length) {
      linea('Diferencias con la app:', true);
      r.diferencias.forEach((d) => linea('Casilla ' + d.cas + ': app ' + fmt(d.esperado) + ' · Marangatu ' + fmt(d.formulario)));
    } else if (r.completadas.length || r.yaTenian.length) {
      linea('Totales de control: coinciden con la app.');
    }
    linea('Revisá los campos en amarillo y presentá vos la declaración.', true);
  }
  const cerrar = document.createElement('button');
  cerrar.textContent = 'Ocultar';
  cerrar.style.cssText = 'margin-top:6px;font:inherit;border:1px solid #e0a800;background:#fff;border-radius:6px;padding:2px 8px;cursor:pointer';
  cerrar.onclick = () => box.remove();
  box.appendChild(cerrar);
}
