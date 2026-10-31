// Cálculo de saldos de horas a partir del reporte de marcaciones del reloj.
//
// Formato del Excel (sin encabezados, una fila por marcación):
//   A cédula | B nombre | C fecha y hora | D min. del sistema | E total min | F total horas
//
// Reglas (validadas contra los totales del propio reloj):
//  - Los segundos se descartan: 06:04:59 cuenta como 06:04.
//  - Entrada: antes de la hora suma, después resta. Salida: al revés.
//  - Almuerzo sin hora fija: se compara su DURACIÓN con el tiempo permitido.
//  - Sábado: horario único, sin almuerzo, sólo para quien lo tenga marcado.
//  - Un punto sin marcación aporta 0 y se avisa.

export const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const STORAGE_KEY_MARCACIONES = 'sheets-remote:marcaciones-config-v1';

const pad = (n) => String(n).padStart(2, '0');
const hm = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

export function fmtMin(min) {
  const a = Math.abs(Math.round(min));
  return a < 60 ? `${a} min` : `${Math.floor(a / 60)}h ${pad(a % 60)}m`;
}
export function signed(min) {
  if (!min) return '0 min';
  return `${min > 0 ? '+' : '−'}${fmtMin(min)}`;
}
export const tone = (min) => (min > 0 ? 'pos' : min < 0 ? 'neg' : '');

/* ─────────────── configuración ─────────────── */

export const CONFIG_INICIAL = {
  al: 40, // minutos de almuerzo permitidos, igual para todos
  tol: 0, // tolerancia en minutos para los negativos
  sab: { e: '08:00', s: '12:00' }, // horario único de sábado
  emp: {}, // { [cédula]: { e, s, lab: [1,2,3,4,5], al?, tol? } }
};

export function normalizeConfig(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    al: Number.isFinite(Number(r.al)) ? Number(r.al) : CONFIG_INICIAL.al,
    tol: Number(r.tol) || 0,
    sab: { ...CONFIG_INICIAL.sab, ...(r.sab || {}) },
    emp: r.emp && typeof r.emp === 'object' ? r.emp : {},
  };
}

export function loadConfig() {
  try {
    return normalizeConfig(JSON.parse(localStorage.getItem(STORAGE_KEY_MARCACIONES)));
  } catch {
    return normalizeConfig(null);
  }
}

export function clearLocalConfig() {
  try {
    localStorage.removeItem(STORAGE_KEY_MARCACIONES);
  } catch {
    /* nada que borrar */
  }
}

export function saveConfig(cfg) {
  try {
    localStorage.setItem(STORAGE_KEY_MARCACIONES, JSON.stringify(cfg));
  } catch {
    /* sin almacenamiento disponible: la configuración dura la sesión */
  }
}

/* ─────────────── lectura del Excel ─────────────── */

export function parseFechaHora(v) {
  if (typeof v === 'number' && v > 30000) {
    const t = Math.round(v * 86400);
    const d = Math.floor(t / 86400);
    const x = new Date(Date.UTC(1899, 11, 30) + d * 864e5);
    return { f: x.toISOString().slice(0, 10), s: t - d * 86400 };
  }
  if (typeof v === 'string') {
    const s = v.trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
    if (m) return { f: `${m[1]}-${m[2]}-${m[3]}`, s: +m[4] * 3600 + +m[5] * 60 + +(m[6] || 0) };
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
    if (m) return { f: `${m[3]}-${pad(m[2])}-${pad(m[1])}`, s: +m[4] * 3600 + +m[5] * 60 + +(m[6] || 0) };
  }
  return null;
}

/** Filas [A..F] → marcaciones. Ignora encabezados y celdas sueltas. */
export function filasAMarcaciones(filas) {
  const registros = [];
  let ignoradas = 0;
  for (const r of filas) {
    if (!r || r.every((c) => c == null || c === '')) continue;
    const a = r[0];
    const id = typeof a === 'number' ? String(Math.trunc(a)) : /^\d+$/.test(String(a ?? '').trim()) ? String(a).trim() : null;
    const nom = String(r[1] ?? '').trim();
    const t = parseFechaHora(r[2]);
    if (!id || !nom || !t) {
      ignoradas += 1;
      continue;
    }
    registros.push({ id, nom, f: t.f, m: Math.floor(t.s / 60) }); // segundos descartados
  }
  return { registros, ignoradas };
}

/** Lee el .xlsx (ArrayBuffer). La librería se carga recién al subir un archivo. */
export async function leerExcel(buffer) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // El reporte declara ~1 millón de filas vacías: se limita al contenido real (col. C = fecha).
  let max = 1;
  for (const k of Object.keys(ws)) {
    const x = /^C(\d+)$/.exec(k);
    if (x) max = Math.max(max, Number(x[1]));
  }
  ws['!ref'] = `A1:F${max}`;
  return filasAMarcaciones(XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }));
}

/* ─────────────── cálculo ─────────────── */

/**
 * m: minutos de las marcaciones del día, ordenados.
 * c: { e, s, al, tol, sinAlmuerzo }.
 * Devuelve { pos, neg, al: avisos, o: { e, a, s } origen del saldo }.
 */
export function calcularDia(m, c) {
  const tol = c.tol || 0;
  const E = hm(c.e);
  const S = hm(c.s);
  const n = m.length;
  const avisos = [];
  const o = { e: 0, a: 0, s: 0 };
  let pos = 0;
  let neg = 0;
  const add = (d, k) => {
    if (d > 0) { pos += d; o[k] += d; }
    else if (d < -tol) { neg -= d; o[k] += d; }
  };

  if (n === 1) {
    const esSalida = Math.abs(m[0] - S) < Math.abs(m[0] - E);
    add(esSalida ? m[0] - S : E - m[0], esSalida ? 's' : 'e');
    avisos.push(`Una sola marca: falta ${esSalida ? 'la entrada' : 'la salida'}`);
    return { pos, neg, al: avisos, o };
  }

  add(E - m[0], 'e');
  add(m[n - 1] - S, 's');
  const mid = m.slice(1, n - 1);
  if (!mid.length) {
    if (!c.sinAlmuerzo) avisos.push('Sin marcas de almuerzo: no se calcula');
  } else if (mid.length === 1) {
    avisos.push('Almuerzo incompleto (una sola marca): no se calcula');
  } else {
    // El par más largo es el almuerzo; los demás son salidas extra (se informan, no se descuentan).
    const du = mid.length % 2
      ? mid.slice(0, -1).map((x, i) => mid[i + 1] - x)
      : mid.filter((_, i) => i % 2 === 0).map((x, k) => mid[2 * k + 1] - x);
    const L = Math.max(...du);
    add((c.al || 0) - L, 'a');
    if (mid.length % 2) avisos.push('Marcaciones impares: revisar');
    else if (du.length > 1) {
      avisos.push(`${du.length - 1} salida(s) extra, ${du.reduce((a, b) => a + b, 0) - L} min fuera (no se descuentan)`);
    }
  }
  return { pos, neg, al: avisos, o };
}

const horaTxt = (x) => `${pad(Math.floor(x / 60))}:${pad(x % 60)}`;

/** Saldos del mes por empleado, con saldo del día y saldo total acumulado. */
export function calcularEmpleados(regs, mes, cfg) {
  const porId = {};
  for (const r of regs) {
    if (!r.f.startsWith(mes)) continue;
    const e = (porId[r.id] ??= { id: r.id, nom: r.nom, D: {} });
    (e.D[r.f] ??= []).push(r.m);
  }
  const sabOk = Boolean(cfg.sab?.e && cfg.sab?.s);

  return Object.values(porId).map((e) => {
    const c = cfg.emp[e.id];
    const cf = Boolean(c && c.e && c.s);
    let sal = 0;
    let P = 0;
    let N = 0;
    const dias = Object.keys(e.D).sort().map((f) => {
      const ps = e.D[f].sort((a, b) => a - b);
      const dw = new Date(`${f}T00:00:00Z`).getUTCDay();
      const base = { f, dw, mk: ps.map(horaTxt).join('  ') };
      if (!cf) return { ...base, al: ['Sin horario configurado'] };
      if (!(c.lab || []).includes(dw)) return { ...base, al: ['Día libre: no se calcula'] };
      if (dw === 6 && !sabOk) return { ...base, al: ['Sin horario de sábado configurado'] };
      const horario = dw === 6
        ? { e: cfg.sab.e, s: cfg.sab.s, al: 0, tol: c.tol ?? cfg.tol, sinAlmuerzo: true }
        : { e: c.e, s: c.s, al: c.al === '' || c.al == null ? cfg.al : Number(c.al), tol: c.tol ?? cfg.tol };
      const d = calcularDia(ps, horario);
      P += d.pos;
      N += d.neg;
      sal += d.pos - d.neg;
      return { ...base, ...d, net: d.pos - d.neg, sal };
    });
    const T = dias.reduce(
      (t, d) => (d.o ? { e: t.e + d.o.e, a: t.a + d.o.a, s: t.s + d.o.s } : t),
      { e: 0, a: 0, s: 0 },
    );
    return { id: e.id, nom: e.nom, cf, dias, P, N, S: P - N, T, avisos: dias.filter((d) => d.al.length).length };
  });
}
