// Núcleo del módulo Vencimientos IVA: cálculo del Formulario 120, fechas de
// vencimiento, ficha para el cliente, libros de compras/ventas y PDF.
// Portado sin cambios de criterio desde la app "vencimientos-iva"; acá no hay
// estado global: todo recibe el cliente, el período y la configuración.

export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const DIAS_C = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const DEFAULT_COLORS = { 0: '#ffff99', 1: '#cc99ff', 2: '#4285f4', 3: '#ffcc99', 4: '#ccecff', 5: '#ffff99', 6: '#b6d7a8', 7: '#ffccff', 8: '#cde9de', 9: '#8e7cc3' };
export const DEFAULT_FERIADOS = ['2026-01-01', '2026-03-01', '2026-04-02', '2026-04-03', '2026-05-01', '2026-05-14', '2026-05-15', '2026-06-12', '2026-08-15', '2026-09-29', '2026-12-08', '2026-12-25',
  '2027-01-01', '2027-03-01', '2027-03-25', '2027-03-26', '2027-05-01', '2027-05-14', '2027-05-15', '2027-06-12', '2027-08-15', '2027-09-29', '2027-12-08', '2027-12-25'];
export const DEFAULT_MORA = { interes: 0.0005, contrav: 50000 };
export const DEFAULT_FIRMA = 'MJ Estudio Contable';
// Cada monto guarda `iva`: true = el IVA se extrae del monto (base = m / 1,1);
// false = el IVA se suma encima (base = m). Los montos viejos guardados como
// número suelto se interpretan con IVA_DEFAULT (extraído), como siempre.
export const IVA_DEFAULT = true;
// En el editor la opción "IVA incluido" suma el IVA encima del monto y "Sin
// IVA" lo extrae (pedido de la oficina). Cada monto nuevo arranca en "IVA
// incluido", o sea iva: false.
export const IVA_DEFAULT_NUEVO = false;
export const ESTADOS = { pend: 'Pendiente', env: 'Enviado al cliente', pres: 'Presentado' };

// Categorías con montos múltiples. r = tasa de IVA (0 = exento). Según Formulario 120 v4 (DNIT).
export const LISTS = [
  { k: 'v10', cas: '10 / 22', t: 'Ventas gravadas al 10%', r: 0.10 },
  { k: 'v5a', cas: '150 / 156', t: 'Ventas de productos agrícolas naturales al 5%', r: 0.05 },
  { k: 'v5', cas: '151 / 157', t: 'Ventas de otros bienes y servicios al 5%', r: 0.05 },
  { k: 'vex', cas: '12', t: 'Ventas exoneradas o no alcanzadas', r: 0 },
  { k: 'ncvex', cas: '12 (neto)', t: '(-) NC emitidas por ventas exoneradas (se descuentan de la casilla 12)', r: 0 },
  { k: 'ncc10', cas: '15 / 23', t: 'NC recibidas de proveedores por compras gravadas al 10%', r: 0.10 },
  { k: 'ncc5a', cas: '154 / 158', t: 'NC recibidas por compras de productos agrícolas al 5%', r: 0.05 },
  { k: 'ncc5', cas: '155 / 159', t: 'NC recibidas por compras de otros bienes y servicios al 5%', r: 0.05 },
  { k: 'nccex', cas: '17', t: 'NC recibidas por compras exoneradas o no alcanzadas', r: 0 },
  { k: 'c10', cas: '35 / 38', t: 'Compras gravadas al 10% (atribuidas a operaciones gravadas)', r: 0.10 },
  { k: 'c5', cas: '32 / 38', t: 'Compras gravadas al 5% (atribuidas a operaciones gravadas)', r: 0.05 },
  { k: 'ncv10', cas: '34 / 42', t: 'NC emitidas a clientes por ventas gravadas al 10%', r: 0.10 },
  { k: 'ncv5', cas: '37 / 42', t: 'NC emitidas a clientes por ventas gravadas al 5%', r: 0.05 },
  { k: 'cex', cas: 'Rubro 6', t: 'Compras exoneradas o no alcanzadas del período', r: 0 },
];
export const LIST_BY = Object.fromEntries(LISTS.map((d) => [d.k, d]));

export const LIBRO_DEFS = {
  ventas: [['v10', 'b10', 1], ['v5a', 'b5', 1], ['v5', 'b5', 1], ['vex', 'ex', 1], ['ncv10', 'b10', -1], ['ncv5', 'b5', -1], ['ncvex', 'ex', -1]],
  compras: [['c10', 'b10', 1], ['c5', 'b5', 1], ['cex', 'ex', 1], ['ncc10', 'b10', -1], ['ncc5a', 'b5', -1], ['ncc5', 'b5', -1], ['nccex', 'ex', -1]],
};
export const VENTAS_KEYS = new Set(LIBRO_DEFS.ventas.map((x) => x[0]));

/* ---------- Períodos y fechas ---------- */
export function ym(y, m) { const d = new Date(y, m, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
export function parsePer(p) { const [y, m] = p.split('-').map(Number); return { y, m: m - 1 }; }
export function perLabel(p) { const { y, m } = parsePer(p); return MESES[m][0].toUpperCase() + MESES[m].slice(1) + ' ' + y; }
export function shiftPer(p, n) { const { y, m } = parsePer(p); return ym(y, m + n); }
export function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
export function fromIso(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function fechaLarga(d) { return DIAS[d.getDay()] + ' ' + d.getDate() + ' de ' + MESES[d.getMonth()] + ' de ' + d.getFullYear(); }
export function fechaCorta(d) { return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); }

// Mes de la hoja de la planilla ("Octubre", "Octubre 2026", "10-2026"...) → índice 0-11.
export function monthIndexFromSheet(sheetName) {
  const norm = String(sheetName || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const byName = MESES.findIndex((m) => norm.includes(m));
  if (byName >= 0) return byName;
  const byShort = MESES.findIndex((m) => new RegExp('\\b' + m.slice(0, 3) + '\\b').test(norm));
  if (byShort >= 0) return byShort;
  const num = norm.match(/\b(0?[1-9]|1[0-2])\b/);
  return num ? Number(num[1]) - 1 : null;
}

/* ---------- Formato ---------- */
export function gs(n) { n = Math.round(Number(n) || 0); return (n < 0 ? '-' : '') + Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
export function toNum(s) { const t = String(s ?? '').replace(/[^\d-]/g, ''); return t === '' || t === '-' ? 0 : parseInt(t, 10); }
export function rucTexto(c) { return c ? c.ruc + (c.dv ? '-' + c.dv : '') : ''; }
export function lastDigit(ruc) { const d = String(ruc || '').replace(/\D/g, ''); return d ? Number(d.slice(-1)) : null; }

// "80012345-6" → { ruc: "80012345", dv: "6" }. Si el DV viene en otra
// columna se pasa aparte; sin guion ni DV, todo el valor es el RUC.
export function splitRuc(raw, dvRaw = '') {
  const text = String(raw ?? '').trim();
  if (text.includes('-')) {
    const [a, b] = text.split('-');
    return { ruc: a.replace(/\D/g, ''), dv: (b || '').replace(/\D/g, '') };
  }
  return { ruc: text.replace(/\D/g, ''), dv: String(dvRaw ?? '').replace(/\D/g, '') };
}

export function textOn(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return L > 0.6 ? '#14213A' : '#FFFFFF';
}

/* ---------- Configuración ---------- */
export function normalizeConfig(raw) {
  const c = raw || {};
  return {
    colores: { ...DEFAULT_COLORS, ...(c.colores || {}) },
    feriados: Array.isArray(c.feriados) ? c.feriados : [...DEFAULT_FERIADOS],
    mora: { ...DEFAULT_MORA, ...(c.mora || {}) },
    firma: c.firma || '',
  };
}
export function firma(config) { return (config && config.firma) || DEFAULT_FIRMA; }
export function colorFor(config, t) { return (config.colores && config.colores[t]) || DEFAULT_COLORS[t] || '#888'; }

/* ---------- Vencimientos ---------- */
// Vencimientos fijos: VENC. 0→día 7, VENC. 1→día 9 … VENC. 9→día 25 del mes siguiente al período. No se trasladan.
export function vencAuto(config, t, periodo) {
  const { y, m } = parsePer(periodo);
  const fecha = new Date(y, m + 1, 7 + 2 * t);
  const fer = new Set(config.feriados || []);
  const inhabil = fecha.getDay() === 0 || fecha.getDay() === 6 || fer.has(iso(fecha));
  return { fecha, base: fecha, movido: false, inhabil };
}
export function vencDe(config, cl, l, periodo) {
  const t = lastDigit(cl.ruc);
  if (t === null) return null;
  if (l && l.vencManual) return { fecha: fromIso(l.vencManual), base: vencAuto(config, t, periodo).base, movido: false, inhabil: false, manual: true };
  return vencAuto(config, t, periodo);
}

/* ---------- Liquidación ---------- */
export function getItems(l, k) {
  const v = l && l[k];
  if (Array.isArray(v)) return v.map((x) => ({ m: Number(x.m) || 0, iva: !!x.iva, f: x.f || '', n: x.n || '', t: x.t || '' }));
  const n = Number(v) || 0;
  return n ? [{ m: n, iva: IVA_DEFAULT, f: '', n: '', t: '' }] : [];
}
export function rowCalc(r, x) {
  const m = x.m;
  if (!r) return { base: m, iva: 0, total: m };
  if (x.iva) return { base: Math.round(m / (1 + r)), iva: Math.round(m * r / (1 + r)), total: m };
  const iva = Math.round(m * r);
  return { base: m, iva, total: m + iva };
}
function catCalc(l, k) {
  const d = LIST_BY[k];
  let sum = 0, base = 0, iva = 0, n = 0;
  getItems(l, k).forEach((x) => { if (!x.m) return; n++; sum += x.m; const c = rowCalc(d.r, x); base += c.base; iva += c.iva; });
  return { sum, base, iva, n };
}
function moraPct(m) { return m <= 0 ? 0 : m <= 1 ? 0.04 : m <= 2 ? 0.06 : m <= 3 ? 0.08 : m <= 4 ? 0.10 : m <= 5 ? 0.12 : 0.14; }

// ctx = { config, cliente, periodo }. El cliente hace falta para la fecha de
// vencimiento, de la que dependen los días de mora.
export function calc(l, ctx) {
  l = l || {};
  const { config, cliente, periodo } = ctx;
  const C = {};
  LISTS.forEach((d) => { C[d.k] = catCalc(l, d.k); });
  const n = (x) => Number(l[x]) || 0, M = Math.max, R = Math.round;
  // Rubro 1 y 3: las NC recibidas suman al IVA débito; las NC emitidas suman al IVA crédito
  const deb = C.v10.iva + C.v5a.iva + C.v5.iva + C.ncc10.iva + C.ncc5a.iva + C.ncc5.iva;
  const cred = C.c10.iva + C.c5.iva + C.ncv10.iva + C.ncv5.iva;
  const ventasBase = C.v10.base + C.v5a.base + C.v5.base + C.vex.base - C.ncvex.base + C.ncc10.base + C.ncc5a.base + C.ncc5.base + C.nccex.base;
  const comprasBase = C.c10.base + C.c5.base + C.ncv10.base + C.ncv5.base;
  // Rubro 4
  const c46 = n('sant'), c166 = M(0, cred + c46 - deb), c167 = n('remit'), c47 = M(0, c166 - c167), c48 = M(0, deb - cred - c46), c49 = n('expo'), c168 = n('disc'), c50 = M(0, c48 - c49 - c168);
  // Rubro 5
  const c51 = n('sret'), c52 = n('ret'), c169 = n('perc'), c53 = c51 + c52 + c169;
  const v = cliente ? vencDe(config, cliente, l, periodo) : null;
  let dias = 0;
  if (v && l.pago) dias = M(0, R((fromIso(l.pago) - v.fecha) / 864e5));
  const meses = dias ? Math.ceil(dias / 30) : 0, pct = moraPct(meses), mo = config.mora || DEFAULT_MORA;
  const c56 = dias > 0 ? mo.contrav : 0, c55 = c50, c57 = c55 + c56, c58 = M(0, c57 - c53), c54 = M(0, c53 - c57);
  const baseMora = M(0, c55 - c53), multa = R(baseMora * pct), interes = R(baseMora * mo.interes * dias);
  const totalMora = c58 + multa + interes;
  const man = !!l.manual;
  const pagar = man ? n('ivaManual') : totalMora;
  const favor = man ? 0 : (c47 > 0 ? c47 : c54);
  const ventasNetas = C.v10.base + C.v5a.base + C.v5.base, comprasNetas = C.c10.base + C.c5.base;
  return {
    C, deb, cred, ventasBase, comprasBase, dias, meses, pct, baseMora, multa, interes, totalMora, pagar, favor,
    cas: {
      44: deb, 45: cred, 46: c46, 166: c166, 167: c167, 47: c47, 48: c48, 49: c49, 168: c168, 50: c50, 55: c55, 51: c51, 52: c52, 169: c169, 56: c56, 53: c53, 57: c57, 58: c58, 54: c54,
      dias, meses, pct, baseMora, multa, interes, totalMora, ventasBase, comprasBase, ventasNetas, comprasNetas,
      margen: ventasNetas - comprasNetas, ratio: deb ? cred / deb : 0, nr: C.cex.base - C.nccex.base, nccex: C.nccex.base, sire: n('sire'),
    },
  };
}

// Deja cada lista con al menos una fila vacía para editar.
export function normDraft(d) {
  LISTS.forEach((L) => { let rows = getItems(d, L.k); if (!rows.length) rows = [{ m: 0, iva: IVA_DEFAULT_NUEVO, f: '', n: '', t: '' }]; d[L.k] = rows; });
  return d;
}
// Quita filas vacías y campos sin uso antes de guardar.
export function cleanDraft(d) {
  const o = { ...d };
  LISTS.forEach((L) => {
    const a = (o[L.k] || []).filter((x) => Number(x.m)).map((x) => {
      const r = { m: Number(x.m), iva: !!x.iva };
      if (x.f) r.f = x.f;
      if (x.n) r.n = String(x.n).slice(0, 40);
      if (x.t) r.t = String(x.t).slice(0, 80);
      return r;
    });
    if (a.length) o[L.k] = a; else delete o[L.k];
  });
  return o;
}

/* ---------- Ficha para el cliente ---------- */
export function fichaModel(ctx, l) {
  const { config, cliente: c, periodo } = ctx;
  l = l || {};
  const k = calc(l, ctx), C = k.C, v = vencDe(config, c, l, periodo), t = lastDigit(c.ruc);
  const secs = [];
  const add = (t2, arr) => { const lines = arr.filter(([, val, al]) => al || val).map(([a, val]) => [a, val]); if (lines.length) secs.push({ t: t2, lines }); };
  add('Ventas', [['Ventas 10%', C.v10.base, 1], ['Ventas 5%', C.v5a.base + C.v5.base], ['Ventas exentas', C.vex.base - C.ncvex.base]]);
  add('Compras', [['Compras 10%', C.c10.base, 1], ['Compras 5%', C.c5.base], ['Compras exentas', C.cex.base - C.nccex.base]]);
  add('Notas de crédito', [['NC compra 10%', C.ncc10.base], ['NC compra 5%', C.ncc5a.base + C.ncc5.base], ['NC venta 10%', C.ncv10.base], ['NC venta 5%', C.ncv5.base]]);
  if (!l.manual) {
    add('Saldos y retenciones', [['Retenciones del mes', k.cas[52]], ['Percepciones', k.cas[169]], ['Saldo de retenciones anterior', k.cas[51]], ['Saldo anterior de IVA', k.cas[46]]]);
    add('Liquidación', [['IVA débito (ventas)', k.deb, 1], ['IVA crédito (compras)', k.cred, 1], ['IVA a pagar', k.cas[58], 1],
      ['Saldo a favor próximo mes (IVA)', k.cas[47]], ['Saldo de retenciones próximo mes', k.cas[54]],
      ['Multa e intereses por mora (' + k.dias + ' días)', k.multa + k.interes]]);
  }
  let aPagar = true, resLabel = 'IVA a pagar', resVal = k.pagar;
  if (k.pagar > 0 || l.manual) { resLabel = k.multa + k.interes > 0 ? 'Total a pagar (con mora)' : 'IVA a pagar'; }
  else if (k.cas[47] > 0) { aPagar = false; resLabel = 'Saldo a favor próximo mes'; resVal = k.cas[47]; }
  else if (k.cas[54] > 0) { aPagar = false; resLabel = 'Saldo de retenciones próximo mes'; resVal = k.cas[54]; }
  else { aPagar = false; resVal = 0; }
  return {
    per: 'IVA - ' + perLabel(periodo), nombre: c.nombre, ruc: 'RUC ' + rucTexto(c), color: t === null ? '#1B3358' : colorFor(config, t),
    secs, aPagar, resLabel, resVal, venc: v ? fechaLarga(v.fecha) : '-',
    pie: (k.dias > 0 && l.pago ? 'Pago previsto el ' + fechaCorta(fromIso(l.pago)) + ' (' + k.dias + ' días de atraso). ' : '') + 'Pagando después del vencimiento se aplican multa por mora e intereses.',
  };
}

export function waText(ctx, l) {
  const m = fichaModel(ctx, l);
  const out = ['*' + m.per + '*', m.nombre, ''];
  m.secs.forEach((s) => { out.push('_' + s.t + '_'); s.lines.forEach(([a, b]) => out.push(a + ': Gs. ' + gs(b))); out.push(''); });
  out.push('*' + m.resLabel + ': Gs. ' + gs(m.resVal) + '*');
  out.push('Vence: ' + m.venc);
  out.push('');
  out.push(firma(ctx.config));
  return out.join('\n');
}

// Número en formato internacional para WhatsApp (Paraguay: 0981… -> 595981…).
export function waTelefono(cliente) {
  let p = String((cliente && cliente.wa) || '').replace(/\D/g, '');
  if (p.startsWith('0')) p = '595' + p.slice(1);
  else if (p.length === 9 && p.startsWith('9')) p = '595' + p;
  return p;
}

// Mensaje corto que acompaña la imagen de la ficha (el detalle va en la imagen).
export function waMensaje(ctx, l) {
  const m = fichaModel(ctx, l);
  return 'Hola, te paso la liquidación de ' + m.per.replace('IVA - ', 'IVA de ') + '. ' +
    m.resLabel + ': Gs. ' + gs(m.resVal) + '. Vence el ' + m.venc + '.\n' + firma(ctx.config);
}

// Chat del cliente con el mensaje escrito. WhatsApp no permite adjuntar
// archivos por enlace: la imagen se pega en el chat (o se comparte en el
// teléfono). destino: 'web' (WhatsApp Web), 'app' (WhatsApp de escritorio)
// o 'wa' (wa.me, decide el sistema).
export function waChatUrl(ctx, l, destino = 'web', texto = waMensaje(ctx, l)) {
  const tel = waTelefono(ctx.cliente);
  const q = 'phone=' + tel + '&text=' + encodeURIComponent(texto);
  if (destino === 'app') return 'whatsapp://send?' + q;
  if (destino === 'wa') return 'https://wa.me/' + tel + '?text=' + encodeURIComponent(texto);
  return 'https://web.whatsapp.com/send?' + q;
}

export function waLink(ctx, l) {
  return waChatUrl(ctx, l, 'wa', waText(ctx, l));
}

// Casillas del Formulario 120 (v4) tal como lo arma Marangatu (relevado del
// formulario real). Marangatu calcula solo el IVA de cada fila (base x tasa)
// y todos los totales, así que se cargan únicamente las casillas de ingreso,
// con el MONTO IMPONIBLE. Devuelve:
//  - cargar:  casillas que la extensión escribe.
//  - control: totales que calcula Marangatu; la extensión los compara con lo
//             calculado acá y avisa si no coinciden (tolerancia por redondeo).
//  - avisos:  importes que la app tiene pero el formulario no deja cargar.
export function casillasFormulario120(ctx, l) {
  l = l || {};
  const k = calc(l, ctx), C = k.C;
  const n = (x) => Math.round(Number(x) || 0);
  const cargar = [
    ['10', C.v10.base, 'Rubro 1 a) Ventas gravadas al 10% (monto imponible)'],
    ['150', C.v5a.base, 'Rubro 1 b) Ventas de productos agrícolas al 5%'],
    ['151', C.v5.base, 'Rubro 1 c) Ventas de otros bienes y servicios al 5%'],
    ['12', C.vex.base - C.ncvex.base, 'Rubro 1 d) Ventas exoneradas o no alcanzadas (neto de NC emitidas)'],
    ['15', C.ncc10.base, 'Rubro 1 h) Ajustes / NC recibidas al 10%'],
    ['154', C.ncc5a.base, 'Rubro 1 i) Ajustes / NC recibidas al 5% (agrícolas)'],
    ['155', C.ncc5.base, 'Rubro 1 j) Ajustes / NC recibidas al 5%'],
    ['17', C.nccex.base, 'Rubro 1 k) Ajustes / NC recibidas exoneradas'],
    ['32', C.c5.base, 'Rubro 3 a) Compras al 5% (monto imponible)'],
    ['35', C.c10.base, 'Rubro 3 a) Compras al 10% (monto imponible)'],
    ['34', C.ncv5.base, 'Rubro 3 e) NC emitidas por ventas al 5%'],
    ['37', C.ncv10.base, 'Rubro 3 e) NC emitidas por ventas al 10%'],
    ['46', n(l.sant), 'Rubro 4 c) Saldo a favor del período anterior'],
    ['167', n(l.remit), 'Rubro 4 e) Saldo a favor remitido al Fisco'],
    ['51', n(l.sret), 'Rubro 5 b) Saldo a favor del período anterior (retenciones)'],
    ['52', n(l.ret), 'Rubro 5 c) Retenciones computables'],
    ['62', C.cex.base, 'Rubro 6 d) Compras exentas por operaciones exoneradas'],
  ].map(([cas, valor, label]) => ({ cas, valor: n(valor), label }));

  const control = [
    ['18', k.cas.ventasBase, 'Total ventas (monto imponible)'],
    ['44', k.cas[44], 'IVA débito'],
    ['45', k.cas[45], 'IVA crédito'],
    ['47', k.cas[47], 'Saldo a favor a trasladar'],
    ['48', k.cas[48], 'Saldo a favor del Fisco'],
    ['50', k.cas[50], 'Impuesto determinado'],
    ['53', k.cas[53], 'Total pagos a cuenta'],
  ].map(([cas, valor, label]) => ({ cas, valor: n(valor), label }));

  const avisos = [];
  if (n(l.perc)) avisos.push('Percepciones (casilla 169): el formulario la fija en 0; Gs. ' + gs(l.perc) + ' no se pueden cargar acá.');
  if (n(l.disc)) avisos.push('Deducción por discapacidad (casilla 168): el formulario la fija en 0.');
  if (n(l.expo)) avisos.push('IVA crédito por exportación (casilla 49): sale del Anexo Exportador, no se carga directo.');
  if (l.manual) avisos.push('El IVA a pagar está cargado a mano en la app: el formulario va a calcular su propio resultado.');
  avisos.push('La multa por presentación tardía (casilla 56) y por lo tanto el saldo a pagar (58) los calcula Marangatu con su fecha.');
  return { cargar, control, avisos };
}

export function casillasTexto(ctx, l) {
  const { cargar } = casillasFormulario120(ctx, l);
  const lines = ['Formulario 120 - IVA de ' + perLabel(ctx.periodo), ctx.cliente.nombre + ' - RUC ' + rucTexto(ctx.cliente), ''];
  cargar.filter((c) => c.valor).forEach((c) => lines.push('Casilla ' + c.cas + ': ' + gs(c.valor) + '  (' + c.label + ')'));
  return lines.join('\n');
}

// Resumen legible que se guarda en las primeras columnas de la hoja del período.
export function resumenHoja(ctx, l) {
  const k = calc(l, ctx);
  const resultado = k.pagar > 0 ? 'A pagar' : k.favor > 0 ? 'A favor' : 'Sin saldo';
  return {
    cliente: ctx.cliente.nombre,
    estado: ESTADOS[l.estado || 'pend'] || '',
    resultado,
    monto: k.pagar > 0 ? k.pagar : k.favor,
  };
}

export function fileBase(ctx, prefix = 'IVA') {
  return (prefix + ' ' + perLabel(ctx.periodo) + ' ' + ctx.cliente.nombre).replace(/[^\w\sáéíóúñÁÉÍÓÚÑ-]/g, '').replace(/\s+/g, '_');
}

/* ---------- Libro de ventas y compras ---------- */
export function libroData(l) {
  const out = {};
  for (const bk of ['ventas', 'compras']) {
    const rows = [];
    let seq = 0;
    LIBRO_DEFS[bk].forEach(([k, col, sg]) => {
      const r = LIST_BY[k].r;
      getItems(l, k).forEach((x) => {
        if (!x.m) return;
        const rc = rowCalc(r, x);
        rows.push({
          f: x.f, n: x.n, t: x.t, seq: seq++, nc: sg < 0,
          b10: col === 'b10' ? sg * rc.base : 0, i10: col === 'b10' ? sg * rc.iva : 0, b5: col === 'b5' ? sg * rc.base : 0, i5: col === 'b5' ? sg * rc.iva : 0, ex: col === 'ex' ? sg * rc.base : 0, total: sg * rc.total,
        });
      });
    });
    rows.sort((a, b) => (a.f || '9999-99-99').localeCompare(b.f || '9999-99-99') || a.seq - b.seq);
    const tot = { b10: 0, i10: 0, b5: 0, i5: 0, ex: 0, total: 0 };
    rows.forEach((r) => { for (const q in tot) tot[q] += r[q]; });
    out[bk] = { rows, tot };
  }
  return out;
}

/* ---------- PDF (jsPDF se carga recién cuando hace falta) ---------- */
export async function loadJsPDF() {
  const mod = await import('jspdf');
  return mod.jsPDF || mod.default;
}
function rgb(hex) { const x = hex.replace('#', ''); return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)); }
function pdfSafe(s) {
  // oxlint-disable-next-line no-control-regex -- se quitan caracteres fuera de Latin-1, que jsPDF no dibuja
  return String(s ?? '').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[^\x00-\xFF]/g, '');
}

export function fichaHeight(doc, w, m) {
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  const nl = doc.splitTextToSize(pdfSafe(m.nombre), w - 10).length;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
  const pl = doc.splitTextToSize(pdfSafe(m.pie), w - 10).length;
  let h = 6 + 5 + nl * 5.5 + 5 + 4;
  m.secs.forEach((s) => { h += 7 + s.lines.length * 6; });
  return h + 4 + 16 + 11.5 + pl * 3 + 8;
}

export function drawFicha(doc, x, y, w, m, firmaTxt) {
  const H = fichaHeight(doc, w, m);
  const col = rgb(m.color);
  const tx = textOn(m.color) === '#FFFFFF' ? [255, 255, 255] : [20, 33, 58];
  doc.setDrawColor(214, 222, 228); doc.setLineWidth(0.3); doc.roundedRect(x, y, w, H, 3, 3, 'S');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  const nl = doc.splitTextToSize(pdfSafe(m.nombre), w - 10);
  const hh = 6 + 5 + nl.length * 5.5 + 5;
  doc.setFillColor(...col); doc.roundedRect(x, y, w, hh, 3, 3, 'F'); doc.rect(x, y + hh - 3, w, 3, 'F');
  doc.setTextColor(...tx); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.text(pdfSafe(m.per), x + 5, y + 7);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(nl, x + 5, y + 13);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.text(pdfSafe(m.ruc), x + 5, y + 13 + nl.length * 5.5);
  let cy = y + hh + 4;
  doc.setTextColor(20, 33, 58);
  m.secs.forEach((s) => {
    cy += 5; doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(90, 104, 120); doc.text(pdfSafe(s.t), x + 5, cy); cy += 2;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(20, 33, 58);
    s.lines.forEach(([a, b]) => { cy += 4.5; doc.text(pdfSafe(a), x + 5, cy); doc.text(gs(b), x + w - 5, cy, { align: 'right' }); cy += 1.5; doc.setDrawColor(237, 241, 244); doc.line(x + 5, cy, x + w - 5, cy); });
  });
  cy += 4;
  const rc = m.aPagar ? [180, 35, 24] : [14, 107, 79], rb = m.aPagar ? [253, 236, 234] : [230, 244, 238];
  doc.setFillColor(...rb); doc.rect(x + 0.2, cy, w - 0.4, 16, 'F'); doc.setTextColor(...rc); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.text(pdfSafe(m.resLabel), x + 5, cy + 5.5);
  doc.setFontSize(14); doc.text('Gs. ' + gs(m.resVal), x + w - 5, cy + 12.5, { align: 'right' }); cy += 16;
  doc.setTextColor(20, 33, 58); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text('Vencimiento', x + 5, cy + 6.5);
  doc.setFont('helvetica', 'bold'); doc.text(pdfSafe(m.venc), x + w - 5, cy + 6.5, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(90, 104, 120);
  const pz = doc.splitTextToSize(pdfSafe(m.pie), w - 10); doc.text(pz, x + 5, cy + 11.5);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(20, 33, 58); doc.text(pdfSafe(firmaTxt), x + w / 2, cy + 11.5 + pz.length * 3 + 4, { align: 'center' });
  return H;
}

export async function exportFichaPDF(ctx, l) {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  drawFicha(doc, 15, 15, 110, fichaModel(ctx, l), firma(ctx.config));
  doc.save(fileBase(ctx) + '.pdf');
}

export async function exportLibroPDF(ctx, l) {
  const L = libroData(l);
  if (!L.ventas.rows.length && !L.compras.rows.length) {
    throw new Error('Cargá montos de ventas o compras para armar el libro');
  }
  const JsPDF = await loadJsPDF();
  const c = ctx.cliente, firmaTxt = firma(ctx.config);
  const doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const PW = 297, PH = 210, M = 12, RH = 5.4;
  const W = [7, 19, 36, 60, 26, 22, 26, 20, 24, 26], AL = ['c', 'l', 'l', 'l', 'r', 'r', 'r', 'r', 'r', 'r'];
  const X = [];
  W.reduce((a, w, i) => { X[i] = a; return a + w; }, M);
  const fmt = (v) => (v ? gs(v) : '');
  const alignOf = (a) => (a === 'r' ? 'right' : a === 'c' ? 'center' : 'left');
  const xOf = (i) => (AL[i] === 'r' ? X[i] + W[i] - 1.6 : AL[i] === 'c' ? X[i] + W[i] / 2 : X[i] + 1.6);
  let y = 0;
  const pageHead = () => {
    doc.setTextColor(20, 33, 58); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(pdfSafe(firmaTxt), M, M + 3);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90, 104, 120); doc.text('Libros de IVA - Ventas y Compras', PW - M, M + 3, { align: 'right' });
    doc.setTextColor(20, 33, 58); doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(pdfSafe(doc.splitTextToSize(c.nombre, 190)[0]), M, M + 11);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90, 104, 120);
    doc.text('RUC ' + pdfSafe(rucTexto(c)) + '   |   Período fiscal: ' + perLabel(ctx.periodo), M, M + 16.5);
    doc.setDrawColor(214, 222, 228); doc.setLineWidth(0.3); doc.line(M, M + 19, PW - M, M + 19); y = M + 24;
  };
  const tHead = (bk) => {
    doc.setFillColor(27, 51, 88); doc.rect(M, y, PW - 2 * M, 6.4, 'F'); doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
    const labs = ['#', 'Fecha', 'Comprobante', bk === 'ventas' ? 'Cliente' : 'Proveedor', 'Base 10%', 'IVA 10%', 'Base 5%', 'IVA 5%', 'Exento', 'Total'];
    labs.forEach((t, i) => doc.text(t, xOf(i), y + 4.4, { align: alignOf(AL[i]) }));
    y += 6.4;
  };
  const need = (hh, bk) => { if (y + hh > PH - 13) { doc.addPage(); pageHead(); if (bk) tHead(bk); } };
  const book = (bk, title) => {
    const B = L[bk];
    need(24); doc.setTextColor(20, 33, 58); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(title, M, y + 3); y += 6;
    if (!B.rows.length) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90, 104, 120); doc.text('Sin movimientos en el período.', M, y + 4); y += 10; return; }
    tHead(bk);
    B.rows.forEach((r, i) => {
      need(RH, bk);
      if (i % 2 === 1) { doc.setFillColor(245, 248, 250); doc.rect(M, y, PW - 2 * M, RH, 'F'); }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(20, 33, 58);
      const fecha = r.f ? fechaCorta(fromIso(r.f)) : '-';
      const comp = (r.nc ? 'NC ' : '') + (r.n || (r.f || r.t ? '' : '(total cargado)'));
      const vals = [String(i + 1), fecha, comp, r.t, fmt(r.b10), fmt(r.i10), fmt(r.b5), fmt(r.i5), fmt(r.ex), fmt(r.total)];
      vals.forEach((t, j) => {
        const s = pdfSafe(doc.splitTextToSize(String(t), W[j] - 3.2)[0] || '');
        if (r.nc && AL[j] === 'r') doc.setTextColor(180, 35, 24); else doc.setTextColor(20, 33, 58);
        doc.text(s, xOf(j), y + 3.8, { align: alignOf(AL[j]) });
      });
      y += RH;
    });
    need(RH + 1, bk);
    doc.setFillColor(230, 236, 242); doc.rect(M, y, PW - 2 * M, RH + 1, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(20, 33, 58);
    doc.text('TOTAL (' + B.rows.length + ' comprobantes)', X[1] + 1.6, y + 4.2);
    [['b10', 4], ['i10', 5], ['b5', 6], ['i5', 7], ['ex', 8], ['total', 9]].forEach(([q, j]) => doc.text(gs(B.tot[q]), X[j] + W[j] - 1.6, y + 4.2, { align: 'right' }));
    y += RH + 9;
  };
  pageHead();
  book('ventas', 'LIBRO DE VENTAS');
  book('compras', 'LIBRO DE COMPRAS');
  const ivaV = L.ventas.tot.i10 + L.ventas.tot.i5, ivaC = L.compras.tot.i10 + L.compras.tot.i5;
  need(30);
  doc.setTextColor(20, 33, 58); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('RESUMEN DEL PERÍODO', M, y + 3); y += 6;
  const box = [['IVA de ventas (neto de notas de crédito)', ivaV], ['IVA de compras (neto de notas de crédito)', ivaC], ['Diferencia de IVA del período (antes de saldos anteriores y retenciones)', ivaV - ivaC]];
  box.forEach(([a, b], i) => {
    doc.setFont('helvetica', i === 2 ? 'bold' : 'normal'); doc.setFontSize(9); doc.setTextColor(20, 33, 58); doc.text(pdfSafe(a), M + 2, y + 4.4); doc.text('Gs. ' + gs(b), M + 150, y + 4.4, { align: 'right' });
    doc.setDrawColor(214, 222, 228); doc.line(M, y + 6, M + 152, y + 6); y += 6.6;
  });
  const np = doc.getNumberOfPages();
  for (let i = 1; i <= np; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(120, 132, 146);
    doc.text(pdfSafe(firmaTxt) + ' - Generado el ' + fechaCorta(new Date()), M, PH - 7); doc.text('Página ' + i + ' de ' + np, PW - M, PH - 7, { align: 'right' });
  }
  doc.save(fileBase(ctx, 'Libro_IVA') + '.pdf');
}

// rows: [{ c, l, t, v, k, estado }] ya filtradas como en el tablero.
export async function exportPeriodoPDF({ config, periodo, rows, dayFilter }) {
  const JsPDF = await loadJsPDF();
  const firmaTxt = firma(config);
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 14;
  let y = M;
  const title = 'Vencimientos IVA - ' + perLabel(periodo) + (dayFilter !== null ? ' - día ' + vencAuto(config, dayFilter, periodo).fecha.getDate() : '');
  const head = () => {
    doc.setTextColor(20, 33, 58); doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(pdfSafe(title), M, y + 5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90, 104, 120); doc.text('Generado el ' + fechaCorta(new Date()) + ' - ' + rows.length + ' clientes - ' + pdfSafe(firmaTxt), M, y + 10.5); y += 17;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    const hx = [M + 6, M + 80, M + 104, W - M - 26, W - M];
    doc.text('Cliente', hx[0], y); doc.text('RUC', hx[1], y); doc.text('Vence', hx[2], y); doc.text('Resultado', hx[3], y, { align: 'right' }); doc.text('Estado', hx[4], y, { align: 'right' });
    y += 2; doc.setDrawColor(214, 222, 228); doc.line(M, y, W - M, y); y += 1;
  };
  head();
  let totPagar = 0, totFavor = 0;
  const est = { none: 'Sin cargar', pend: 'Pendiente', env: 'Enviado', pres: 'Presentado' };
  rows.forEach((r) => {
    if (y > 280) { doc.addPage(); y = M; head(); }
    doc.setFillColor(...rgb(r.t === null ? '#999999' : colorFor(config, r.t))); doc.rect(M, y + 1, 3.5, 5, 'F');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(20, 33, 58);
    doc.text(doc.splitTextToSize(pdfSafe(r.c.nombre + (r.c.notas ? ' *' : '')), 70)[0], M + 6, y + 5);
    doc.text(pdfSafe(rucTexto(r.c)), M + 80, y + 5);
    doc.text(r.v ? DIAS_C[r.v.fecha.getDay()] + ' ' + fechaCorta(r.v.fecha) : '-', M + 104, y + 5);
    if (r.k) {
      if (r.k.pagar > 0) { doc.setTextColor(180, 35, 24); doc.text('A pagar ' + gs(r.k.pagar), W - M - 26, y + 5, { align: 'right' }); totPagar += r.k.pagar; }
      else if (r.k.favor > 0) { doc.setTextColor(14, 107, 79); doc.text('A favor ' + gs(r.k.favor), W - M - 26, y + 5, { align: 'right' }); totFavor += r.k.favor; }
      else doc.text('Gs. 0', W - M - 26, y + 5, { align: 'right' });
    } else doc.text('-', W - M - 26, y + 5, { align: 'right' });
    doc.setTextColor(20, 33, 58); doc.text(est[r.estado], W - M, y + 5, { align: 'right' });
    y += 7; doc.setDrawColor(237, 241, 244); doc.line(M, y, W - M, y);
  });
  y += 6;
  if (y > 275) { doc.addPage(); y = M; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(20, 33, 58);
  doc.text('Total IVA a pagar: Gs. ' + gs(totPagar) + '     Total saldos a favor: Gs. ' + gs(totFavor), M, y);
  if (rows.some((r) => r.c.notas)) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(90, 104, 120); doc.text('* Cliente con notas o excepciones', M, y + 5); }
  const conFicha = rows.filter((r) => r.l);
  if (conFicha.length) {
    doc.addPage(); y = M;
    const cw = (W - 2 * M - 8) / 2;
    let i = 0, rowH = 0;
    conFicha.forEach((r) => {
      const m = fichaModel({ config, cliente: r.c, periodo }, r.l);
      const hgt = fichaHeight(doc, cw, m);
      if (i % 2 === 0) { if (i > 0) { y += rowH + 8; rowH = 0; } if (y + hgt > 297 - M) { doc.addPage(); y = M; } }
      else if (y + hgt > 297 - M) { doc.addPage(); y = M; rowH = 0; i = 0; }
      drawFicha(doc, M + (i % 2) * (cw + 8), y, cw, m, firmaTxt);
      rowH = Math.max(rowH, hgt); i++;
    });
  }
  doc.save(pdfSafe(title).replace(/\s+-\s+/g, '_').replace(/\s+/g, '_') + '.pdf');
}

// Imagen PNG de la ficha que ve el cliente (html2canvas se carga a demanda).
export async function fichaBlob(element) {
  const { default: html2canvas } = await import('html2canvas');
  const canvas = await html2canvas(element, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
