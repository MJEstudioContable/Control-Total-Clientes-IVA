/**
 * MÓDULO MARCACIONES - archivo aparte del backend de Control Clientes.
 *
 * Guarda en la planilla de administración los horarios y las planillas mensuales
 * procesadas de Marcaciones (sólo ADMINISTRADOR y SUPERUSUARIO). El .dat original
 * no se guarda; se almacenan las marcas procesadas y las correcciones por día.
 *
 * Instalación en el proyecto de Apps Script:
 *   1. Archivo nuevo (+ > Secuencia de comandos) llamado "Marcaciones" y pegar
 *      este contenido completo.
 *   2. En doPost del Code.gs, justo antes de la línea
 *        return errorResponse('Acción desconocida: ' + action, 'UNKNOWN_ACTION');
 *      agregar:
 *        const marcacionesResponse = handleMarcacionesAction(action, body, sessionUser, sessionRole);
 *        if (marcacionesResponse) return marcacionesResponse;
 *   3. Implementar > Administrar implementaciones > editar > Nueva versión.
 *
 * Las acciones marcacionesGetMonths, marcacionesGetMonth y marcacionesSaveMonth
 * guardan/leen los datos mensuales en "Marcaciones Datos". La hoja se crea sola.
 *
 * Usa funciones que ya existen en Code.gs: getAdminSpreadsheet, isPrivilegedRole,
 * jsonResponse y errorResponse.
 */

// Hoja "Marcaciones Config": una fila por clave ("ajustes"), con el JSON de
// horarios, quién y cuándo lo guardó. Se crea sola la primera vez.
const MARCACIONES_CONFIG_SHEET_NAME = 'Marcaciones Config';
const MARCACIONES_CONFIG_KEY = 'ajustes';
const MARCACIONES_DATA_SHEET_NAME = 'Marcaciones Datos';
const MARCACIONES_DATA_CHUNK = 40000;
const MARCACIONES_DATA_MAX = 4000000;
const MARCACIONES_CONFIG_MAX = 45000; // Sheets admite 50.000 caracteres por celda
const MARCACIONES_HORA = /^([01]?\d|2[0-3]):[0-5]\d$/;

function ensureMarcacionesConfigSheet() {
  const ss = getAdminSpreadsheet();
  let sheet = ss.getSheetByName(MARCACIONES_CONFIG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(MARCACIONES_CONFIG_SHEET_NAME);
    sheet.getRange(1, 1, 1, 4).setValues([['Clave', 'Valor', 'Actualizado', 'Usuario']]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange('A:A').setNumberFormat('@');
  }
  return sheet;
}

function findMarcacionesConfigRow(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const keys = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  for (let i = 0; i < keys.length; i++) {
    if (String(keys[i][0]).trim() === MARCACIONES_CONFIG_KEY) return i + 2;
  }
  return -1;
}

function assertMarcacionesAdmin(sessionRole) {
  if (!isPrivilegedRole(sessionRole)) {
    throw new Error('Sólo un administrador puede ver o cambiar los horarios de marcaciones');
  }
}

function marcacionesHora(value) {
  const text = String(value || '').trim();
  return MARCACIONES_HORA.test(text) ? text : '';
}

function marcacionesNumero(value, fallback) {
  if (value === '' || value == null) return fallback;
  const n = Number(value);
  return isFinite(n) && n >= 0 && n <= 1440 ? n : fallback;
}

// Se guarda sólo lo que la pantalla usa, con el formato validado.
function sanitizeMarcacionesConfig(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Configuración inválida');
  }
  const sab = data.sab && typeof data.sab === 'object' ? data.sab : {};
  const clean = {
    al: marcacionesNumero(data.al, 40),
    tol: marcacionesNumero(data.tol, 0),
    dup: marcacionesNumero(data.dup, 3),
    sab: { e: marcacionesHora(sab.e), s: marcacionesHora(sab.s) },
    emp: {}
  };
  const emp = data.emp && typeof data.emp === 'object' && !Array.isArray(data.emp) ? data.emp : {};
  Object.keys(emp).forEach(function (cedula) {
    if (!/^\d{3,15}$/.test(cedula)) return;
    const c = emp[cedula] || {};
    const lab = Array.isArray(c.lab)
      ? c.lab.map(Number).filter(function (d, i, all) {
          return d === Math.floor(d) && d >= 0 && d <= 6 && all.indexOf(d) === i;
        })
      : [];
    const item = { e: marcacionesHora(c.e), s: marcacionesHora(c.s), lab: lab, tipo: c.tipo === 'flexible' ? 'flexible' : 'fijo' };
    const nom = String(c.nom || '').trim().slice(0, 60);
    if (nom) item.nom = nom;
    const al = marcacionesNumero(c.al, null);
    const tol = marcacionesNumero(c.tol, null);
    if (al !== null) item.al = al;
    if (tol !== null) item.tol = tol;
    clean.emp[cedula] = item;
  });
  return clean;
}

function withMarcacionesLock(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('No se pudo obtener el lock de la hoja (30s), intentá de nuevo');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function handleMarcacionesGetConfig(sessionRole) {
  assertMarcacionesAdmin(sessionRole);
  const sheet = ensureMarcacionesConfigSheet();
  const row = findMarcacionesConfigRow(sheet);
  if (row === -1) return jsonResponse({ ok: true, config: null });
  let config = null;
  try {
    config = JSON.parse(String(sheet.getRange(row, 2).getValue() || 'null'));
  } catch (err) {
    config = null;
  }
  return jsonResponse({
    ok: true,
    config: config,
    actualizado: String(sheet.getRange(row, 3).getDisplayValue() || ''),
    usuario: String(sheet.getRange(row, 4).getDisplayValue() || '')
  });
}

function handleMarcacionesSaveConfig(body, sessionUser, sessionRole) {
  assertMarcacionesAdmin(sessionRole);
  const clean = sanitizeMarcacionesConfig(body.data);
  const json = JSON.stringify(clean);
  if (json.length > MARCACIONES_CONFIG_MAX) throw new Error('Configuración demasiado grande');
  withMarcacionesLock(function () {
    const sheet = ensureMarcacionesConfigSheet();
    let row = findMarcacionesConfigRow(sheet);
    if (row === -1) row = Math.max(2, sheet.getLastRow() + 1);
    sheet.getRange(row, 1, 1, 4).setValues([[MARCACIONES_CONFIG_KEY, json, new Date(), sessionUser]]);
  });
  return jsonResponse({ ok: true });
}

function ensureMarcacionesDataSheet() {
  const ss = getAdminSpreadsheet();
  let sheet = ss.getSheetByName(MARCACIONES_DATA_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(MARCACIONES_DATA_SHEET_NAME);
    sheet.getRange(1, 1, 1, 5).setValues([['Mes', 'Parte', 'Datos JSON', 'Actualizado', 'Usuario']]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange('A:A').setNumberFormat('@');
  }
  return sheet;
}

function validateMarcacionesMonth(month) {
  const value = String(month || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error('Mes inválido');
  return value;
}

function handleMarcacionesGetMonths(sessionRole) {
  assertMarcacionesAdmin(sessionRole);
  const sheet = ensureMarcacionesDataSheet();
  const last = sheet.getLastRow();
  const months = last < 2 ? [] : sheet.getRange(2, 1, last - 1, 1).getDisplayValues()
    .map(function (r) { return String(r[0] || '').trim(); })
    .filter(function (m, i, all) { return /^\d{4}-\d{2}$/.test(m) && all.indexOf(m) === i; })
    .sort();
  return jsonResponse({ ok: true, months: months });
}

function handleMarcacionesGetMonth(body, sessionRole) {
  assertMarcacionesAdmin(sessionRole);
  const month = validateMarcacionesMonth(body.month);
  const sheet = ensureMarcacionesDataSheet();
  const last = sheet.getLastRow();
  if (last < 2) return jsonResponse({ ok: true, month: month, data: null });
  const rows = sheet.getRange(2, 1, last - 1, 5).getValues()
    .filter(function (r) { return String(r[0]) === month; })
    .sort(function (a, b) { return Number(a[1]) - Number(b[1]); });
  if (!rows.length) return jsonResponse({ ok: true, month: month, data: null });
  const text = rows.map(function (r) { return String(r[2] || ''); }).join('');
  return jsonResponse({ ok: true, month: month, data: JSON.parse(text) });
}

function sanitizeMarcacionesMonthData(month, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Datos del mes inválidos');
  const regs = Array.isArray(data.regs) ? data.regs : [];
  if (regs.length > 60000) throw new Error('Demasiadas marcaciones para un mes');
  const cleanRegs = regs.map(function (r) {
    const id = String(r && r.id || '').trim();
    const f = String(r && r.f || '').trim();
    const seg = Number(r && r.seg);
    if (!/^\d{3,15}$/.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(f) || f.slice(0, 7) !== month || !isFinite(seg) || seg < 0 || seg >= 86400) {
      throw new Error('Hay una marcación inválida o fuera del mes');
    }
    return { id: id, f: f, seg: Math.floor(seg) };
  });
  const editsIn = data.edits && typeof data.edits === 'object' && !Array.isArray(data.edits) ? data.edits : {};
  const edits = {};
  Object.keys(editsIn).forEach(function (key) {
    const m = /^(\d{3,15})\|(\d{4}-\d{2}-\d{2})$/.exec(key);
    if (!m || m[2].slice(0, 7) !== month) return;
    const e = editsIn[key] || {};
    const slots = Array.isArray(e.slots) ? e.slots.slice(0, 4).map(marcacionesHora) : null;
    edits[key] = { slots: slots, attendance: Boolean(e.attendance) };
  });
  const clean = {
    version: 1,
    info: String(data.info || '').slice(0, 500),
    regs: cleanRegs,
    edits: edits
  };
  const json = JSON.stringify(clean);
  if (json.length > MARCACIONES_DATA_MAX) throw new Error('El mes supera el tamaño máximo permitido');
  return { clean: clean, json: json };
}

function handleMarcacionesSaveMonth(body, sessionUser, sessionRole) {
  assertMarcacionesAdmin(sessionRole);
  const month = validateMarcacionesMonth(body.month);
  const prepared = sanitizeMarcacionesMonthData(month, body.data);
  withMarcacionesLock(function () {
    const sheet = ensureMarcacionesDataSheet();
    const last = sheet.getLastRow();
    if (last >= 2) {
      const existing = sheet.getRange(2, 1, last - 1, 1).getDisplayValues();
      for (let i = existing.length - 1; i >= 0; i--) {
        if (String(existing[i][0]) === month) sheet.deleteRow(i + 2);
      }
    }
    const chunks = [];
    for (let i = 0; i < prepared.json.length; i += MARCACIONES_DATA_CHUNK) {
      chunks.push([month, chunks.length + 1, prepared.json.slice(i, i + MARCACIONES_DATA_CHUNK), new Date(), sessionUser]);
    }
    if (!chunks.length) chunks.push([month, 1, '{}', new Date(), sessionUser]);
    sheet.getRange(sheet.getLastRow() + 1, 1, chunks.length, 5).setValues(chunks);
  });
  return jsonResponse({ ok: true, month: month, marks: prepared.clean.regs.length });
}

// Leer y guardar los horarios queda restringido a roles privilegiados
// (ADMINISTRADOR y SUPERUSUARIO), validado acá y no sólo en la interfaz.
function handleMarcacionesAction(action, body, sessionUser, sessionRole) {
  const routes = {
    marcacionesGetConfig: [function () { return handleMarcacionesGetConfig(sessionRole); }, 'MARCACIONES_GET_ERROR'],
    marcacionesSaveConfig: [function () { return handleMarcacionesSaveConfig(body, sessionUser, sessionRole); }, 'MARCACIONES_SAVE_ERROR'],
    marcacionesGetMonths: [function () { return handleMarcacionesGetMonths(sessionRole); }, 'MARCACIONES_MONTHS_ERROR'],
    marcacionesGetMonth: [function () { return handleMarcacionesGetMonth(body, sessionRole); }, 'MARCACIONES_MONTH_ERROR'],
    marcacionesSaveMonth: [function () { return handleMarcacionesSaveMonth(body, sessionUser, sessionRole); }, 'MARCACIONES_MONTH_SAVE_ERROR']
  };
  const route = Object.prototype.hasOwnProperty.call(routes, action) ? routes[action] : null;
  if (!route) return null;
  try {
    return route[0]();
  } catch (err) {
    return errorResponse(err.message, route[1]);
  }
}
