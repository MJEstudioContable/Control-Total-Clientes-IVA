// Backend SIMULADO del Apps Script, para probar la app sin planilla real.
// Responde las acciones que usa src/api.js (login, session, changePin,
// adminListUsers, adminResetPin, adminSetUserActive, adminRevokeUserSessions,
// users, years, months, read, update/updateBatch, create y las acciones iva*
// del módulo Vencimientos IVA) con datos inventados.
//
//   node tools/smoke/server.mjs            # escucha en :8787
//   VITE_BACKEND_URL=http://localhost:8787 npm run dev
//
// Variables: PORT (8787), ROWS (300), LATENCY_MS (250), SOLO_SELLO (0/1).
import http from 'node:http';

const PORT = Number(process.env.PORT || 8787);
const ROWS = Number(process.env.ROWS || 300);
const LATENCY_MS = Number(process.env.LATENCY_MS || 250);

const USERS = ['Jorge', 'María', 'Lucía', 'Carlos', 'Ana'];
const userRecords = new Map(
  USERS.map((name, index) => [
    name,
    {
      name,
      role: index === 0 ? 'SUPERUSUARIO' : index === 1 ? 'ADMINISTRADOR' : 'USUARIO',
      active: true,
      hasPin: true,
      mustChangePin: false,
      pin: '1234',
    },
  ])
);

// SOLO_SELLO=1 simula una planilla sin columnas SI/NO: el estado vive sólo
// en "Presentado por:" / "Archivado por:" (nombre de quien lo hizo).
const SOLO_SELLO = process.env.SOLO_SELLO === '1';
const HEADERS = [
  'Razón Social', 'R.U.C.', 'Clave MH', 'Vencimiento', 'Encargado',
  'Presentado', 'Presentado por:', 'Archivado', 'Archivado por:', 'Observaciones',
].filter((h) => !SOLO_SELLO || (h !== 'Presentado' && h !== 'Archivado'));
const NAMES = ['Comercial', 'Ferretería', 'Distribuidora', 'Estudio', 'Panadería', 'Transportes', 'Farmacia', 'Consultora'];
const SURNAMES = ['Sur', 'del Este', 'Ñandutí', 'Guaraní', 'Central', 'Paraná', 'Chaco', 'Ypacaraí'];

function makeRows(count) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const presentado = i % 3 === 0;
    rows.push({
      _row: i + 2,
      'Razón Social': `${NAMES[i % NAMES.length]} ${SURNAMES[(i * 7) % SURNAMES.length]} ${i + 1} S.A.`,
      'R.U.C.': `${80000000 + i * 37}-${i % 10}`,
      'Clave MH': i % 4 === 0 ? '' : `clave${i}`,
      'Vencimiento': `Día ${((i * 3) % 25) + 1}`,
      'Encargado': i % 5 === 4 ? '' : USERS[i % USERS.length],
      'Presentado': presentado ? 'SI' : 'NO',
      'Presentado por:': presentado ? USERS[i % USERS.length] : '',
      'Archivado': i % 11 === 0 ? 'SI' : 'NO',
      'Archivado por:': i % 11 === 0 ? 'Jorge' : '',
      'Observaciones': i % 6 === 0 ? 'Cliente con IVA mensual' : '',
    });
    if (SOLO_SELLO) {
      delete rows[i]['Presentado'];
      delete rows[i]['Archivado'];
    }
  }
  return rows;
}

export const sheets = new Map(); // `${year}_${month}` -> rows
function getRows(year, month) {
  const key = `${year}_${month}`;
  if (!sheets.has(key)) sheets.set(key, makeRows(ROWS));
  return sheets.get(key);
}

// Módulo Vencimientos IVA: liquidaciones por período y RUC, en memoria.
const iva = { liq: {}, clientes: {}, config: null };
function summarizeIvaDoc(doc) {
  return Object.fromEntries(
    Object.entries(doc || {}).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => ({ m: x.m, iva: x.iva })) : v])
  );
}

const sessions = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serializeAdminUser(record) {
  return {
    name: record.name,
    role: record.role,
    active: Boolean(record.active),
    hasPin: Boolean(record.hasPin),
    mustChangePin: Boolean(record.mustChangePin),
  };
}

function revokeUserSessions(userName) {
  for (const [tok, sess] of sessions.entries()) {
    if (sess.user === userName) sessions.delete(tok);
  }
}

function sessionResponse(user) {
  const record = userRecords.get(user) || {
    name: user,
    role: 'SUPERUSUARIO',
    active: true,
    hasPin: true,
    mustChangePin: false,
  };
  const token = `tok-${Math.random().toString(36).slice(2)}`;
  sessions.set(token, { user: record.name, role: record.role });
  return {
    ok: true,
    sessionToken: token,
    user: { name: record.name, role: record.role },
    pinless: true,
    mustChangePin: Boolean(record.mustChangePin),
    expiresAt: Date.now() + 8 * 3600_000,
    idleTimeoutMs: 30 * 60_000,
  };
}

export async function handle(body) {
  await sleep(LATENCY_MS);
  const { action } = body || {};
  if (action === 'ping') return { ok: true };
  if (action === 'login') {
    const userName = String(body.user || 'Jorge');
    const record = userRecords.get(userName);
    if (record && !record.active) {
      return { ok: false, code: 'USER_NOT_FOUND', error: 'Usuario no autorizado' };
    }
    return sessionResponse(userName);
  }
  const session = sessions.get(body.sessionToken);
  if (!session) return { ok: false, code: 'SESSION_REQUIRED', error: 'Sesión requerida' };
  const activeRecord = userRecords.get(session.user);
  if (activeRecord && !activeRecord.active) {
    sessions.delete(body.sessionToken);
    return { ok: false, code: 'SESSION_REVOKED', error: 'El usuario ya no está autorizado' };
  }

  switch (action) {
    case 'session':
      return {
        ...sessionResponse(session.user),
        sessionToken: body.sessionToken,
      };
    case 'logout':
      sessions.delete(body.sessionToken);
      return { ok: true };
    case 'changePin': {
      const rec = userRecords.get(session.user);
      if (rec) {
        rec.pin = String(body.newPin || '1234');
        rec.hasPin = true;
        rec.mustChangePin = false;
      }
      revokeUserSessions(session.user);
      return sessionResponse(session.user);
    }
    case 'adminListUsers': {
      if (session.role !== 'SUPERUSUARIO') {
        return { ok: false, code: 'FORBIDDEN', error: 'Requiere permisos de SUPERUSUARIO' };
      }
      return {
        ok: true,
        users: Array.from(userRecords.values()).map(serializeAdminUser),
      };
    }
    case 'adminResetPin': {
      if (session.role !== 'SUPERUSUARIO') {
        return { ok: false, code: 'FORBIDDEN', error: 'Requiere permisos de SUPERUSUARIO' };
      }
      const target = userRecords.get(String(body.targetUser || ''));
      if (!target) return { ok: false, code: 'USER_NOT_FOUND', error: 'Usuario no encontrado' };
      if (!/^\d{4}$/.test(String(body.tempPin || ''))) {
        return { ok: false, code: 'PIN_INVALID_FORMAT', error: 'El PIN temporal debe tener 4 dígitos' };
      }
      target.pin = String(body.tempPin);
      target.hasPin = true;
      target.mustChangePin = true;
      revokeUserSessions(target.name);
      return { ok: true, user: serializeAdminUser(target) };
    }
    case 'adminSetUserActive': {
      if (session.role !== 'SUPERUSUARIO') {
        return { ok: false, code: 'FORBIDDEN', error: 'Requiere permisos de SUPERUSUARIO' };
      }
      const target = userRecords.get(String(body.targetUser || ''));
      if (!target) return { ok: false, code: 'USER_NOT_FOUND', error: 'Usuario no encontrado' };
      if (!body.active && target.name === session.user) {
        return { ok: false, code: 'SELF_DEACTIVATION_FORBIDDEN', error: 'No podés dar de baja tu propio usuario' };
      }
      target.active = Boolean(body.active);
      revokeUserSessions(target.name);
      return { ok: true, user: serializeAdminUser(target) };
    }
    case 'adminRevokeUserSessions': {
      if (session.role !== 'SUPERUSUARIO') {
        return { ok: false, code: 'FORBIDDEN', error: 'Requiere permisos de SUPERUSUARIO' };
      }
      const target = userRecords.get(String(body.targetUser || ''));
      if (!target) return { ok: false, code: 'USER_NOT_FOUND', error: 'Usuario no encontrado' };
      revokeUserSessions(target.name);
      return { ok: true, user: serializeAdminUser(target) };
    }
    case 'users':
      return {
        ok: true,
        users: Array.from(userRecords.values())
          .filter((u) => u.active)
          .map((u) => ({ name: u.name })),
      };
    case 'years':
      return { ok: true, years: ['2025', '2026'] };
    case 'months':
      return { ok: true, months: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre'] };
    case 'read':
      return { ok: true, headers: HEADERS, rows: getRows(body.year, body.sheet) };
    case 'update': {
      const row = getRows(body.year, body.sheet).find((r) => r._row === Number(body.row));
      if (!row) return { ok: false, code: 'ROW_NOT_FOUND', error: 'Fila inexistente' };
      row[body.column] = body.value;
      return { ok: true };
    }
    case 'updateBatch': {
      const results = (body.updates || []).map((update) => {
        const row = getRows(update.year, update.sheet).find((item) => item._row === Number(update.row));
        if (!row) return { row: update.row, column: update.column, ok: false, error: 'Fila inexistente' };
        row[update.column] = update.value;
        return { row: update.row, column: update.column, ok: true };
      });
      return { ok: true, results };
    }
    case 'create': {
      const rows = getRows(body.year, body.sheet);
      const nextRow = rows.reduce((maximum, row) => Math.max(maximum, row._row), 1) + 1;
      rows.push({ ...Object.fromEntries(HEADERS.map((header) => [header, ''])), ...body.values, _row: nextRow });
      return { ok: true, row: nextRow };
    }
    case 'ivaLoad': {
      const liq = {};
      (body.periodos || []).forEach((p) => {
        liq[p] = Object.fromEntries(
          Object.entries(iva.liq[p] || {}).map(([ruc, doc]) => [ruc, summarizeIvaDoc(doc)])
        );
      });
      return { ok: true, clientes: iva.clientes, config: iva.config, liq };
    }
    case 'ivaGetDoc':
      return { ok: true, doc: (iva.liq[body.periodo] || {})[body.ruc] || null };
    case 'ivaSaveDoc':
      iva.liq[body.periodo] = { ...(iva.liq[body.periodo] || {}), [body.ruc]: body.data };
      return { ok: true };
    case 'ivaSaveCliente':
      iva.clientes[body.ruc] = { wa: body.data?.wa || '', notas: body.data?.notas || '' };
      return { ok: true };
    case 'ivaSaveConfig':
      if (session.role === 'USUARIO') {
        return { ok: false, code: 'IVA_CONFIG_ERROR', error: 'Sólo un administrador puede cambiar la configuración de IVA' };
      }
      iva.config = body.data;
      return { ok: true };
    default:
      return { ok: false, code: 'UNKNOWN_ACTION', error: `Acción desconocida: ${action}` };
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  http
    .createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') return res.end();
      let raw = '';
      for await (const chunk of req) raw += chunk;
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* vacío */ }
      const out = await handle(body);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(out));
    })
    .listen(PORT, '0.0.0.0', () => console.log(`Backend simulado en http://0.0.0.0:${PORT} (${ROWS} filas)`));
}
