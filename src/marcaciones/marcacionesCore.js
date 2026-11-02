// Cálculo de saldos de horas a partir del archivo de marcaciones del reloj (.dat).
//
// Formato del .dat (attlog, sin encabezados, una línea por marcación, separado por tabulaciones):
//   cédula (con espacios a la izquierda) | fecha y hora | y cuatro columnas que no se usan
//
// Reglas:
//  - Los segundos se descartan: 06:04:59 cuenta como 06:04.
//  - Se espera 4 marcaciones por día (entrada, salida a almuerzo, vuelta, salida).
//  - Una marcación repetida a pocos minutos de la anterior se ignora (vale la primera).
//  - Entrada: antes de la hora suma, después resta. Salida: al revés.
//  - Almuerzo sin hora fija: se compara su DURACIÓN con el tiempo permitido.
//  - Sin marcas de almuerzo: se suma el tiempo de almuerzo permitido.
//  - Sábado: horario único, sin almuerzo, sólo para quien lo tenga marcado.

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
  dup: 3, // marcaciones repetidas dentro de estos minutos se ignoran (vale la primera)
  sab: { e: '08:00', s: '12:00' }, // horario único de sábado
  emp: {}, // { [cédula]: { nom, e, s, lab: [1,2,3,4,5], al?, tol? } }
};

export function normalizeConfig(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    al: Number.isFinite(Number(r.al)) ? Number(r.al) : CONFIG_INICIAL.al,
    tol: Number(r.tol) || 0,
    dup: r.dup === '' ? 0 : Number.isFinite(Number(r.dup)) && r.dup != null ? Number(r.dup) : CONFIG_INICIAL.dup,
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

/* ─────────────── lectura del .dat ─────────────── */

const LINEA_DAT = /^\s*(\d+)\s+(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2}):(\d{2})/;

/** Texto del .dat → marcaciones { id, f: 'AAAA-MM-DD', seg: segundos del día }. */
export function leerAttlog(texto) {
  const registros = [];
  let ignoradas = 0;
  for (const linea of String(texto).split(/\r?\n/)) {
    if (!linea.trim()) continue;
    const m = LINEA_DAT.exec(linea);
    if (!m) {
      ignoradas += 1;
      continue;
    }
    registros.push({ id: m[1], f: `${m[2]}-${m[3]}-${m[4]}`, seg: +m[5] * 3600 + +m[6] * 60 + +m[7] });
  }
  return { registros, ignoradas };
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
    // Sin marcas de almuerzo se suma el almuerzo permitido (evita confusiones).
    if (!c.sinAlmuerzo && c.al > 0) {
      add(c.al, 'a');
      avisos.push(`Sin marcas de almuerzo: se suman ${c.al} min`);
    }
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
    const e = (porId[r.id] ??= { id: r.id, D: {} });
    (e.D[r.f] ??= []).push(r.seg ?? r.m * 60);
  }
  const sabOk = Boolean(cfg.sab?.e && cfg.sab?.s);
  const ventana = Math.max(0, Number(cfg.dup) || 0) * 60;

  return Object.values(porId).map((e) => {
    const c = cfg.emp[e.id];
    const cf = Boolean(c && c.e && c.s);
    let sal = 0;
    let P = 0;
    let N = 0;
    const dias = Object.keys(e.D).sort().map((f) => {
      // Marcaciones repetidas a pocos minutos de la anterior: vale la primera.
      const rep = [];
      const ps = [];
      let ultima = null;
      for (const sg of e.D[f].sort((a, b) => a - b)) {
        if (ultima !== null && ventana > 0 && sg - ultima <= ventana) rep.push(sg);
        else { ps.push(Math.floor(sg / 60)); ultima = sg; }
      }
      const dw = new Date(`${f}T00:00:00Z`).getUTCDay();
      const base = { f, dw, mk: ps.map(horaTxt).join('  '), rep: rep.map((sg) => horaTxt(Math.floor(sg / 60))) };
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
    return { id: e.id, nom: (c?.nom || '').trim() || e.id, cf, dias, P, N, S: P - N, T, avisos: dias.filter((d) => d.al.length).length };
  });
}
