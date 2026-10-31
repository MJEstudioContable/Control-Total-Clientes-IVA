/**
 * MÓDULO VENCIMIENTOS IVA - archivo aparte del backend de Control Clientes.
 *
 * Instalación en el proyecto de Apps Script:
 *   1. Archivo nuevo (+ > Secuencia de comandos) llamado "Iva" y pegar este
 *      contenido completo.
 *   2. En doPost del Code.gs, justo antes de la línea
 *        return errorResponse('Acción desconocida: ' + action, 'UNKNOWN_ACTION');
 *      agregar:
 *        const ivaResponse = handleIvaAction(action, body, sessionUser, sessionRole);
 *        if (ivaResponse) return ivaResponse;
 *   3. Implementar > Administrar implementaciones > editar > Nueva versión.
 *
 * Usa funciones que ya existen en Code.gs: getAdminSpreadsheet, isPrivilegedRole,
 * jsonResponse y errorResponse. Todos los archivos .gs de un proyecto comparten
 * el mismo ámbito, así que no hace falta importarlas.
 */

// ── MÓDULO VENCIMIENTOS IVA ─────────────────────────────────────────────
// Reemplaza al backend de Netlify Blobs de la app "vencimientos-iva".
// La lista de clientes sale de las planillas mensuales; acá sólo se guarda
// lo propio del IVA:
//   "IVA AAAA-MM"   una hoja por período fiscal, una fila por cliente (RUC).
//                   Las primeras columnas son legibles (estado, resultado);
//                   la liquidación completa va como JSON, partida en varias
//                   celdas porque Sheets admite 50.000 caracteres por celda.
//   "IVA Clientes"  datos fijos del cliente para el IVA (WhatsApp, notas).
//   "IVA Config"    colores, feriados, mora y nombre del estudio.
// Por defecto viven en la planilla de administración; con la propiedad
// IVA_SPREADSHEET_ID se pueden mover a una planilla aparte.
const IVA_PERIOD_PREFIX = 'IVA ';
const IVA_CLIENTES_SHEET_NAME = 'IVA Clientes';
const IVA_CONFIG_SHEET_NAME = 'IVA Config';
const IVA_PERIOD_HEADERS = ['RUC', 'Cliente', 'Estado', 'Resultado', 'Monto', 'Actualizado', 'Usuario'];
const IVA_DATA_CHUNK = 45000;
const IVA_DATA_MAX_CHUNKS = 14;
const IVA_PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function getIvaSpreadsheet() {
  const customId = String(
    PropertiesService.getScriptProperties().getProperty('IVA_SPREADSHEET_ID') || ''
  ).trim();
  return customId ? SpreadsheetApp.openById(customId) : getAdminSpreadsheet();
}

function normalizeRuc(value) {
  // Sólo el número de RUC, sin el dígito verificador.
  const text = String(value === null || value === undefined ? '' : value).trim();
  const base = text.indexOf('-') !== -1 ? text.split('-')[0] : text;
  return base.replace(/\D/g, '');
}

function assertIvaPeriod(periodo) {
  if (!IVA_PERIOD_PATTERN.test(String(periodo || ''))) {
    throw new Error('Período inválido: se esperaba AAAA-MM');
  }
  return String(periodo);
}

function assertIvaRuc(ruc) {
  const clean = normalizeRuc(ruc);
  if (!clean || clean.length > 12) throw new Error('RUC inválido');
  return clean;
}

function getIvaPeriodSheet(periodo, create) {
  const ss = getIvaSpreadsheet();
  const name = IVA_PERIOD_PREFIX + periodo;
  let sheet = ss.getSheetByName(name);
  if (!sheet && create) {
    sheet = ss.insertSheet(name);
    const headers = IVA_PERIOD_HEADERS.slice();
    for (let i = 1; i <= IVA_DATA_MAX_CHUNKS; i++) headers.push('Datos ' + i);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    // RUC y datos como texto: si no, Sheets los reinterpreta.
    sheet.getRange('A:A').setNumberFormat('@');
    sheet.getRange(1, IVA_PERIOD_HEADERS.length + 1, sheet.getMaxRows(), IVA_DATA_MAX_CHUNKS)
      .setNumberFormat('@');
  }
  return sheet;
}

function ensureIvaKeyValueSheet(name, headers) {
  const ss = getIvaSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange('A:A').setNumberFormat('@');
  }
  return sheet;
}

function findRowByKey(sheet, key) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const keys = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  for (let i = 0; i < keys.length; i++) {
    if (String(keys[i][0]).trim() === key) return i + 2;
  }
  return -1;
}

function nextFreeRow(sheet) {
  const row = Math.max(2, sheet.getLastRow() + 1);
  // Las filas nuevas heredan el formato de texto de la anterior.
  if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 200);
  return row;
}

// Cada fragmento lleva "~" adelante: un pedazo de JSON que empezara con
// "=", "+" o "-" Sheets lo tomaría como fórmula o número.
function splitIvaData(json) {
  const parts = [];
  for (let i = 0; i < json.length; i += IVA_DATA_CHUNK) {
    parts.push('~' + json.slice(i, i + IVA_DATA_CHUNK));
  }
  if (parts.length > IVA_DATA_MAX_CHUNKS) {
    throw new Error('La liquidación es demasiado grande para guardarse');
  }
  while (parts.length < IVA_DATA_MAX_CHUNKS) parts.push('');
  return parts;
}

function joinIvaData(rowValues) {
  const json = rowValues
    .slice(IVA_PERIOD_HEADERS.length)
    .map(function (part) { return String(part || '').replace(/^~/, ''); })
    .join('');
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch (err) {
    return null;
  }
}

// Versión liviana para el tablero: quita el detalle de comprobantes
// (fecha, número, tercero), igual que el backend anterior.
function summarizeIvaDoc(doc) {
  const out = {};
  Object.keys(doc || {}).forEach(function (key) {
    const value = doc[key];
    out[key] = Array.isArray(value)
      ? value.map(function (x) { return { m: x.m, iva: x.iva }; })
      : value;
  });
  return out;
}

function readIvaPeriod(periodo, summary) {
  const sheet = getIvaPeriodSheet(periodo, false);
  const out = {};
  if (!sheet || sheet.getLastRow() < 2) return out;
  const values = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
    .getDisplayValues();
  values.forEach(function (row) {
    const ruc = String(row[0]).trim();
    if (!ruc) return;
    const doc = joinIvaData(row);
    if (doc) out[ruc] = summary ? summarizeIvaDoc(doc) : doc;
  });
  return out;
}

function readIvaClientes() {
  const sheet = ensureIvaKeyValueSheet(
    IVA_CLIENTES_SHEET_NAME,
    ['RUC', 'Cliente', 'WhatsApp', 'Notas', 'Actualizado', 'Usuario']
  );
  const out = {};
  if (sheet.getLastRow() < 2) return out;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getDisplayValues().forEach(function (row) {
    const ruc = String(row[0]).trim();
    if (ruc) out[ruc] = { wa: String(row[2] || ''), notas: String(row[3] || '') };
  });
  return out;
}

function readIvaConfig() {
  const sheet = ensureIvaKeyValueSheet(IVA_CONFIG_SHEET_NAME, ['Clave', 'Valor']);
  const row = findRowByKey(sheet, 'ajustes');
  if (row === -1) return null;
  try {
    return JSON.parse(String(sheet.getRange(row, 2).getValue() || 'null'));
  } catch (err) {
    return null;
  }
}

function withIvaLock(fn) {
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

function handleIvaLoad(body) {
  const periodos = (Array.isArray(body.periodos) ? body.periodos : [])
    .map(String)
    .filter(function (p) { return IVA_PERIOD_PATTERN.test(p); })
    .slice(0, 6);
  const liq = {};
  periodos.forEach(function (p) { liq[p] = readIvaPeriod(p, true); });
  return jsonResponse({
    ok: true,
    clientes: readIvaClientes(),
    config: readIvaConfig(),
    liq: liq
  });
}

function handleIvaGetDoc(body) {
  const periodo = assertIvaPeriod(body.periodo);
  const ruc = assertIvaRuc(body.ruc);
  const sheet = getIvaPeriodSheet(periodo, false);
  if (!sheet) return jsonResponse({ ok: true, doc: null });
  const row = findRowByKey(sheet, ruc);
  if (row === -1) return jsonResponse({ ok: true, doc: null });
  const values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  return jsonResponse({ ok: true, doc: joinIvaData(values) });
}

function handleIvaSaveDoc(body, sessionUser) {
  const periodo = assertIvaPeriod(body.periodo);
  const ruc = assertIvaRuc(body.ruc);
  const data = body.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Datos de liquidación inválidos');
  }
  const resumen = body.resumen && typeof body.resumen === 'object' ? body.resumen : {};
  const parts = splitIvaData(JSON.stringify(data));
  const rowValues = [
    ruc,
    String(resumen.cliente || '').slice(0, 200),
    String(resumen.estado || '').slice(0, 40),
    String(resumen.resultado || '').slice(0, 60),
    Number(resumen.monto) || 0,
    new Date(),
    sessionUser
  ].concat(parts);

  withIvaLock(function () {
    const sheet = getIvaPeriodSheet(periodo, true);
    let row = findRowByKey(sheet, ruc);
    if (row === -1) row = nextFreeRow(sheet);
    sheet.getRange(row, 1, 1, rowValues.length).setValues([rowValues]);
  });
  return jsonResponse({ ok: true });
}

function handleIvaSaveCliente(body, sessionUser) {
  const ruc = assertIvaRuc(body.ruc);
  const data = body.data && typeof body.data === 'object' ? body.data : {};
  const rowValues = [
    ruc,
    String(data.nombre || '').slice(0, 200),
    String(data.wa || '').slice(0, 40),
    String(data.notas || '').slice(0, 5000),
    new Date(),
    sessionUser
  ];
  withIvaLock(function () {
    const sheet = ensureIvaKeyValueSheet(
      IVA_CLIENTES_SHEET_NAME,
      ['RUC', 'Cliente', 'WhatsApp', 'Notas', 'Actualizado', 'Usuario']
    );
    let row = findRowByKey(sheet, ruc);
    if (row === -1) row = nextFreeRow(sheet);
    sheet.getRange(row, 1, 1, rowValues.length).setValues([rowValues]);
  });
  return jsonResponse({ ok: true });
}

function handleIvaSaveConfig(body, sessionRole) {
  if (!isPrivilegedRole(sessionRole)) {
    throw new Error('Sólo un administrador puede cambiar la configuración de IVA');
  }
  const data = body.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Configuración inválida');
  }
  const json = JSON.stringify(data);
  if (json.length > IVA_DATA_CHUNK) throw new Error('Configuración demasiado grande');
  withIvaLock(function () {
    const sheet = ensureIvaKeyValueSheet(IVA_CONFIG_SHEET_NAME, ['Clave', 'Valor']);
    let row = findRowByKey(sheet, 'ajustes');
    if (row === -1) row = nextFreeRow(sheet);
    sheet.getRange(row, 1, 1, 2).setValues([['ajustes', json]]);
  });
  return jsonResponse({ ok: true });
}

// ── MIGRACIÓN ÚNICA DESDE LA APP DE NETLIFY ─────────────────────────────
// Ejecutar a mano desde el editor de Apps Script, una sola vez:
//   1. Script Properties:
//        IVA_MIGRAR_URL    https://TU-SITIO.netlify.app   (sin barra final)
//        IVA_MIGRAR_CLAVE  la CLAVE_ACCESO de Netlify
//        IVA_MIGRAR_DESDE  primer período a traer, ej. 2025-01
//   2. Ejecutar migrarDesdeVencimientosIvaNetlify y revisar el registro.
//   3. Borrar las tres propiedades.
// Las liquidaciones pasan a identificarse por RUC (antes, por un id interno).
// Es repetible: vuelve a escribir las mismas filas.
function migrarDesdeVencimientosIvaNetlify() {
  const props = PropertiesService.getScriptProperties();
  const baseUrl = String(props.getProperty('IVA_MIGRAR_URL') || '').replace(/\/+$/, '');
  const clave = String(props.getProperty('IVA_MIGRAR_CLAVE') || '');
  const desde = String(props.getProperty('IVA_MIGRAR_DESDE') || '');
  if (!baseUrl || !clave || !IVA_PERIOD_PATTERN.test(desde)) {
    throw new Error('Configurá IVA_MIGRAR_URL, IVA_MIGRAR_CLAVE e IVA_MIGRAR_DESDE (AAAA-MM)');
  }

  const periodos = [];
  const hoy = new Date();
  const limite = hoy.getFullYear() + '-' + ('0' + (hoy.getMonth() + 1)).slice(-2);
  let p = desde;
  while (p <= limite) {
    periodos.push(p);
    const y = Number(p.slice(0, 4));
    const m = Number(p.slice(5, 7));
    p = (m === 12 ? y + 1 : y) + '-' + ('0' + (m === 12 ? 1 : m + 1)).slice(-2);
  }

  function fetchLote(lote) {
    const response = UrlFetchApp.fetch(
      baseUrl + '/api/data?periodos=' + lote.join(','),
      { headers: { 'x-clave': clave }, muteHttpExceptions: true }
    );
    if (response.getResponseCode() !== 200) {
      throw new Error('Netlify respondió ' + response.getResponseCode() + ': ' + response.getContentText());
    }
    return JSON.parse(response.getContentText());
  }

  let clientes = {};
  let config = null;
  let liquidaciones = 0;
  const sinRuc = [];

  for (let i = 0; i < periodos.length; i += 6) {
    const lote = periodos.slice(i, i + 6);
    const data = fetchLote(lote);
    clientes = data.clientes || clientes;
    config = (data.config && data.config.ajustes) || config;

    lote.forEach(function (periodo) {
      const docs = (data.liq && data.liq[periodo]) || {};
      Object.keys(docs).forEach(function (idCliente) {
        const cliente = clientes[idCliente];
        const ruc = cliente ? normalizeRuc(cliente.ruc) : '';
        if (!ruc) {
          sinRuc.push(periodo + ' / ' + idCliente);
          return;
        }
        const doc = docs[idCliente];
        doc.clienteId = ruc;
        doc.periodo = periodo;
        handleIvaSaveDoc(
          { periodo: periodo, ruc: ruc, data: doc, resumen: { cliente: cliente.nombre, estado: doc.estado || '' } },
          'Migración'
        );
        liquidaciones++;
      });
    });
  }

  let fichas = 0;
  Object.keys(clientes).forEach(function (idCliente) {
    const c = clientes[idCliente];
    const ruc = normalizeRuc(c.ruc);
    if (ruc && (c.wa || c.notas)) {
      handleIvaSaveCliente({ ruc: ruc, data: { nombre: c.nombre, wa: c.wa, notas: c.notas } }, 'Migración');
      fichas++;
    }
  });

  if (config) handleIvaSaveConfig({ data: config }, 'SUPERUSUARIO');

  Logger.log('Liquidaciones migradas: ' + liquidaciones);
  Logger.log('Clientes con WhatsApp o notas: ' + fichas);
  Logger.log('Configuración: ' + (config ? 'migrada' : 'no había'));
  if (sinRuc.length) Logger.log('Sin RUC (no migradas): ' + sinRuc.join(', '));
}

// ── RUTEO ───────────────────────────────────────────────────────────────
// Se llama desde doPost después de validar la sesión. Devuelve la respuesta
// si la acción es del módulo de IVA, o null para que doPost siga con lo suyo.
// Cualquier sesión válida puede leer y cargar liquidaciones; la configuración
// sólo la cambian los roles privilegiados.
function handleIvaAction(action, body, sessionUser, sessionRole) {
  const routes = {
    ivaLoad: [function () { return handleIvaLoad(body); }, 'IVA_LOAD_ERROR'],
    ivaGetDoc: [function () { return handleIvaGetDoc(body); }, 'IVA_GET_ERROR'],
    ivaSaveDoc: [function () { return handleIvaSaveDoc(body, sessionUser); }, 'IVA_SAVE_ERROR'],
    ivaSaveCliente: [function () { return handleIvaSaveCliente(body, sessionUser); }, 'IVA_CLIENT_ERROR'],
    ivaSaveConfig: [function () { return handleIvaSaveConfig(body, sessionRole); }, 'IVA_CONFIG_ERROR']
  };
  const route = Object.prototype.hasOwnProperty.call(routes, action) ? routes[action] : null;
  if (!route) return null;
  try {
    return route[0]();
  } catch (err) {
    return errorResponse(err.message, route[1]);
  }
}
