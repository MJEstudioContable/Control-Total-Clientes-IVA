/**
 * BACKEND - Control Remoto de Google Sheets
 *
 * IMPORTANTE:
 * - Reemplazá ADMIN_SPREADSHEET_ID por el ID que ya usa tu implementación.
 * - API_TOKEN, PIN_PEPPER, ALLOW_PINLESS_LOGIN y ALLOW_SELF_PIN_SETUP viven
 *   en Script Properties.
 * - Durante el alta inicial, ALLOW_SELF_PIN_SETUP=true permite que una cuenta
 *   con PIN_HASH vacío reclame su primer PIN. Es una excepción reversible con
 *   riesgo de usurpación aceptado: debe desactivarse al terminar el alta.
 * - ALLOW_PINLESS_LOGIN=true queda sólo para pruebas sin autoalta. Antes de
 *   producción ambas excepciones deben estar en false y todos deben tener PIN.
 */

// ── CONFIG ──────────────────────────────────────────────────────────────
const ADMIN_SPREADSHEET_ID = 'REEMPLAZAR_POR_TU_ID_ACTUAL';

const USERS_SHEET_NAME = 'Usuarios';
const HISTORIAL_SHEET_NAME = 'Historial';
const PLANILLAS_SHEET_NAME = 'Planillas';

const PIN_HASH_COLUMN = 3;
const PIN_HASH_HEADER = 'PIN_HASH';
const USER_STATUS_COLUMN = 4;
const USER_STATUS_HEADER = 'ESTADO';

const SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000;
const SESSION_IDLE_MS = 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 60 * 1000;
const MAX_PIN_ATTEMPTS = 5;
const PIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const PIN_LOCK_MS = 15 * 60 * 1000;

const SESSION_PROPERTY_PREFIX = 'AUTH_SESSION_';
const ATTEMPT_PROPERTY_PREFIX = 'AUTH_ATTEMPT_';

function getAdminSpreadsheet() {
  return SpreadsheetApp.openById(ADMIN_SPREADSHEET_ID);
}

// ── HOJA "PLANILLAS" (mapea año -> ID de planilla de ese año) ───────────
function ensurePlanillasSheet() {
  const ss = getAdminSpreadsheet();
  let sheet = ss.getSheetByName(PLANILLAS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(PLANILLAS_SHEET_NAME);
    sheet.getRange(1, 1, 1, 3).setValues([['Año', 'ID Planilla', 'Nombre']]);
    sheet.getRange(2, 1, 1, 3).setValues([
      ['2026', 'PEGA_ACA_EL_ID_DE_LA_PLANILLA_2026', 'Clientes 2026']
    ]);
  }
  return sheet;
}

function getYearMappings() {
  const sheet = ensurePlanillasSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  return values
    .filter(function (r) { return String(r[0]).trim().length > 0; })
    .map(function (r) {
      return {
        anio: String(r[0]).trim(),
        id: String(r[1]).trim()
      };
    });
}

function getAvailableYears() {
  return getYearMappings().map(function (m) { return m.anio; });
}

function getClientSpreadsheet(year) {
  const normalizedYear = String(year || '').trim();
  const mapping = getYearMappings().find(function (m) {
    return m.anio === normalizedYear;
  });

  if (!mapping || !mapping.id) return null;
  try {
    return SpreadsheetApp.openById(mapping.id);
  } catch (err) {
    return null;
  }
}

// ── MESES DENTRO DE UN AÑO ──────────────────────────────────────────────
function getAvailableSheets(year) {
  const ss = getClientSpreadsheet(year);
  if (!ss) return [];
  return ss.getSheets().map(function (s) { return s.getName(); });
}

function getMonthSheet(year, sheetName) {
  const ss = getClientSpreadsheet(year);
  if (!ss || !sheetName) return null;
  if (getAvailableSheets(year).indexOf(sheetName) === -1) return null;
  return ss.getSheetByName(sheetName);
}

// ── HOJA DE USUARIOS ────────────────────────────────────────────────────
function ensureUsersSheet() {
  const ss = getAdminSpreadsheet();
  let sheet = ss.getSheetByName(USERS_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(USERS_SHEET_NAME);
    sheet.getRange(1, 1, 1, 3).setValues([['Nombre', 'Rol', PIN_HASH_HEADER]]);
    sheet.getRange(2, 1, 2, 3).setValues([
      ['Ejemplo Persona 1', 'usuario', ''],
      ['Ejemplo Persona 2', 'admin', '']
    ]);
    return sheet;
  }

  const currentPinHeader = String(sheet.getRange(1, PIN_HASH_COLUMN).getValue() || '').trim();
  if (!currentPinHeader) {
    sheet.getRange(1, PIN_HASH_COLUMN).setValue(PIN_HASH_HEADER);
  } else if (normalizeKey(currentPinHeader) !== normalizeKey(PIN_HASH_HEADER)) {
    throw new Error(
      'La columna C de Usuarios debe llamarse "' + PIN_HASH_HEADER +
      '"; actualmente contiene "' + currentPinHeader + '"'
    );
  }

  return sheet;
}

function isActiveUserStatus(value) {
  const compact = normalizeKey(value);
  if (!compact) return true;
  return (
    compact !== 'inactivo' &&
    compact !== 'inactiva' &&
    compact !== 'baja' &&
    compact !== 'desactivado' &&
    compact !== 'desactivada' &&
    compact !== 'suspendido' &&
    compact !== 'suspendida' &&
    compact !== 'no' &&
    compact !== 'false' &&
    compact !== '0'
  );
}

function isTemporaryPinHash(pinHash) {
  return String(pinHash || '').trim().indexOf('v1-temp:') === 0;
}

function getAllUsers() {
  const sheet = ensureUsersSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, USER_STATUS_COLUMN).getValues();
  return values
    .map(function (r, idx) {
      const pinHash = String(r[2] || '').trim();
      return {
        row: idx + 2,
        nombre: String(r[0] || '').trim(),
        rol: normalizeRole(r[1]),
        pinHash: pinHash,
        activo: isActiveUserStatus(r[3]),
        mustChangePin: isTemporaryPinHash(pinHash)
      };
    })
    .filter(function (u) { return u.nombre.length > 0; });
}

function getAllowedUsers() {
  return getAllUsers().filter(function (u) { return u.activo; });
}

function findAnyUser(userName) {
  const wanted = canonicalUserName(userName);
  if (!wanted) return null;
  return getAllUsers().find(function (u) {
    return canonicalUserName(u.nombre) === wanted;
  }) || null;
}

function findAllowedUser(userName) {
  const wanted = canonicalUserName(userName);
  if (!wanted) return null;
  return getAllowedUsers().find(function (u) {
    return canonicalUserName(u.nombre) === wanted;
  }) || null;
}

function normalizeRole(value) {
  const compact = normalizeKey(value);

  if (
    compact === 'superusuario' ||
    compact === 'superusuaria' ||
    compact === 'superadmin' ||
    compact === 'superadministrador' ||
    compact === 'superadministradora'
  ) {
    return 'SUPERUSUARIO';
  }

  if (
    compact === 'admin' ||
    compact === 'administrador' ||
    compact === 'administradora'
  ) {
    return 'ADMINISTRADOR';
  }

  return 'USUARIO';
}

function isPrivilegedRole(role) {
  const normalized = normalizeRole(role);
  return normalized === 'ADMINISTRADOR' || normalized === 'SUPERUSUARIO';
}

function isAdmin(userName) {
  const user = findAllowedUser(userName);
  return !!user && isPrivilegedRole(user.rol);
}

function canonicalUserName(value) {
  return normalizeText(value).replace(/\s+/g, ' ').trim();
}

function normalizeText(value) {
  let result = String(value || '').trim().toLowerCase();
  if (typeof result.normalize === 'function') {
    result = result.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  return result;
}

function normalizeKey(value) {
  return normalizeText(value).replace(/[^a-z0-9]/g, '');
}

// ── HOJA DE HISTORIAL ───────────────────────────────────────────────────
function ensureHistorialSheet() {
  const ss = getAdminSpreadsheet();
  let sheet = ss.getSheetByName(HISTORIAL_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(HISTORIAL_SHEET_NAME);
    sheet.getRange(1, 1, 1, 8).setValues([[
      'Fecha', 'Usuario', 'Año', 'Mes', 'Fila', 'Columna',
      'Valor anterior', 'Valor nuevo'
    ]]);
  }
  return sheet;
}

function logChange(user, year, monthSheetName, row, column, oldValue, newValue) {
  const sheet = ensureHistorialSheet();
  sheet.appendRow([
    new Date(), user, year, monthSheetName, row, column, oldValue, newValue
  ]);
}

// ── CELDAS COMBINADAS ───────────────────────────────────────────────────
function fillMergedValues(range) {
  const values = range.getValues();
  const merges = range.getMergedRanges();
  const rangeStartRow = range.getRow();
  const rangeStartCol = range.getColumn();

  merges.forEach(function (merge) {
    const topRow = merge.getRow();
    const topCol = merge.getColumn();
    const numRows = merge.getNumRows();
    const numCols = merge.getNumColumns();

    const topRowIdx = topRow - rangeStartRow;
    const topColIdx = topCol - rangeStartCol;
    if (topRowIdx < 0 || topColIdx < 0 || !values[topRowIdx]) return;

    const topValue = values[topRowIdx][topColIdx];

    for (let r = 0; r < numRows; r++) {
      const rowIdx = topRowIdx + r;
      if (rowIdx < 0 || rowIdx >= values.length || !values[rowIdx]) continue;
      for (let c = 0; c < numCols; c++) {
        const colIdx = topColIdx + c;
        if (colIdx < 0 || colIdx >= values[rowIdx].length) continue;
        values[rowIdx][colIdx] = topValue;
      }
    }
  });

  return values;
}

// ── TOKEN GENERAL DE LA API ─────────────────────────────────────────────
function isAuthorized(token) {
  const validToken = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!validToken) return false;
  return constantTimeEquals(String(token || ''), validToken);
}

function unauthorizedResponse() {
  return errorResponse('No autorizado', 'API_TOKEN_INVALID');
}

// ── CONFIGURACIÓN DE AUTENTICACIÓN ──────────────────────────────────────
// Ejecutar UNA vez durante testing. Crea PIN_PEPPER sin mostrarlo y habilita
// temporalmente el acceso de usuarios cuya columna PIN_HASH esté vacía.
function configurarAutenticacionParaPruebas() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PIN_PEPPER')) {
    props.setProperty('PIN_PEPPER', createRandomToken());
  }
  props.setProperty('ALLOW_PINLESS_LOGIN', 'true');
  ensureUsersSheet();
  Logger.log('Autenticación de pruebas configurada. ALLOW_PINLESS_LOGIN=true');
}

// Abre temporalmente el alta directa del primer PIN y desactiva el bypass
// pinless. También revoca sus sesiones anteriores: una cuenta vacía debe
// configurar su PIN antes de poder leer datos. La primera persona que reclame
// el nombre quedará como dueña.
function habilitarConfiguracionInicialPin() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PIN_PEPPER')) {
    props.setProperty('PIN_PEPPER', createRandomToken());
  }
  props.setProperty('ALLOW_SELF_PIN_SETUP', 'true');
  props.setProperty('ALLOW_PINLESS_LOGIN', 'false');
  ensureUsersSheet();
  revokePinlessSessions();
  Logger.log('Configuración inicial de PIN habilitada y acceso pinless desactivado.');
}

// Cierra únicamente el alta directa. Los usuarios que ya tienen PIN conservan
// su acceso; las cuentas vacías deberán ser configuradas por el administrador.
function desactivarConfiguracionInicialPin() {
  PropertiesService
    .getScriptProperties()
    .setProperty('ALLOW_SELF_PIN_SETUP', 'false');
  Logger.log('Configuración inicial de PIN desactivada.');
}

// Ejecutar antes de producción, después de configurar PIN para todos. Cierra
// ambas excepciones temporales y revoca las sesiones creadas sin PIN.
function desactivarAccesoSinPin() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('ALLOW_PINLESS_LOGIN', 'false');
  props.setProperty('ALLOW_SELF_PIN_SETUP', 'false');
  revokePinlessSessions();
  Logger.log('Acceso sin PIN y configuración inicial directa desactivados.');
}

function isPinlessLoginAllowed() {
  const value = PropertiesService
    .getScriptProperties()
    .getProperty('ALLOW_PINLESS_LOGIN');
  return String(value || '').toLowerCase() === 'true';
}

function isSelfPinSetupAllowed() {
  const value = PropertiesService
    .getScriptProperties()
    .getProperty('ALLOW_SELF_PIN_SETUP');
  return String(value || '').toLowerCase() === 'true';
}

function requirePinPepper() {
  const pepper = PropertiesService.getScriptProperties().getProperty('PIN_PEPPER');
  if (!pepper) {
    throw new Error(
      'Falta PIN_PEPPER en Script Properties. Ejecutá configurarAutenticacionParaPruebas().'
    );
  }
  return pepper;
}

// Para asignar/restablecer un PIN sin escribirlo en el código:
// 1. En Script Properties crear PIN_SETUP_USER y PIN_SETUP_VALUE.
// 2. Ejecutar esta función.
// 3. Ambas propiedades temporales se eliminan incluso si ocurre un error.
function aplicarPinPendienteDesdeProperties() {
  const props = PropertiesService.getScriptProperties();
  const userName = String(props.getProperty('PIN_SETUP_USER') || '').trim();
  const pin = String(props.getProperty('PIN_SETUP_VALUE') || '').trim();

  try {
    if (!userName) throw new Error('Falta PIN_SETUP_USER en Script Properties');
    if (!/^\d{4}$/.test(pin)) {
      throw new Error('PIN_SETUP_VALUE debe contener exactamente 4 dígitos');
    }
    setUserPinHash(userName, pin);
    Logger.log('PIN configurado para el usuario indicado y sesiones anteriores revocadas.');
  } finally {
    props.deleteProperty('PIN_SETUP_USER');
    props.deleteProperty('PIN_SETUP_VALUE');
  }
}

function setUserPinHash(userName, pin, isTemp) {
  const user = findAnyUser(userName);
  if (!user) throw new Error('Usuario no encontrado: ' + userName);
  if (!/^\d{4}$/.test(String(pin || ''))) {
    throw new Error('El PIN debe contener exactamente 4 dígitos');
  }

  const sheet = ensureUsersSheet();
  const targetRow = user.row;
  if (targetRow < 2) throw new Error('No se encontró la fila del usuario');
  sheet
    .getRange(targetRow, PIN_HASH_COLUMN)
    .setValue(computePinHash(user.nombre, pin, Boolean(isTemp)));
  revokeSessionsForUser(user.nombre);
}

function setUserActiveStatus(userName, active) {
  const user = findAnyUser(userName);
  if (!user) throw new Error('Usuario no encontrado: ' + userName);

  const sheet = ensureUsersSheet();
  const currentStatusHeader = String(sheet.getRange(1, USER_STATUS_COLUMN).getValue() || '').trim();
  if (!currentStatusHeader) {
    sheet.getRange(1, USER_STATUS_COLUMN).setValue(USER_STATUS_HEADER);
  }
  sheet
    .getRange(user.row, USER_STATUS_COLUMN)
    .setValue(active ? 'ACTIVO' : 'INACTIVO');
  revokeSessionsForUser(user.nombre);
}

// ── PIN Y LÍMITE DE INTENTOS ────────────────────────────────────────────
function computePinHash(userName, pin, isTemp) {
  const signature = Utilities.computeHmacSha256Signature(
    canonicalUserName(userName) + '\n' + String(pin),
    requirePinPepper(),
    Utilities.Charset.UTF_8
  );
  return (isTemp ? 'v1-temp:' : 'v1:') + base64Url(signature);
}

function verifyUserPin(user, pin) {
  if (!user || !user.pinHash || !/^\d{4}$/.test(String(pin || ''))) return false;
  const expected = computePinHash(user.nombre, pin, Boolean(user.mustChangePin));
  return constantTimeEquals(expected, user.pinHash);
}

function constantTimeEquals(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);

  for (let i = 0; i < length; i++) {
    difference |= (a.charCodeAt(i % Math.max(a.length, 1)) || 0) ^
      (b.charCodeAt(i % Math.max(b.length, 1)) || 0);
  }
  return difference === 0;
}

function getAttemptPropertyKey(userName) {
  return ATTEMPT_PROPERTY_PREFIX + sha256(canonicalUserName(userName));
}

function readAttemptState(userName, now) {
  const props = PropertiesService.getScriptProperties();
  const key = getAttemptPropertyKey(userName);
  const raw = props.getProperty(key);
  if (!raw) return { count: 0, firstFailedAt: 0, lockedUntil: 0 };

  try {
    const state = JSON.parse(raw);
    if (Number(state.lockedUntil || 0) > now) return state;

    if (
      Number(state.lockedUntil || 0) > 0 ||
      !Number(state.firstFailedAt || 0) ||
      now - Number(state.firstFailedAt) > PIN_ATTEMPT_WINDOW_MS
    ) {
      props.deleteProperty(key);
      return { count: 0, firstFailedAt: 0, lockedUntil: 0 };
    }

    return state;
  } catch (err) {
    props.deleteProperty(key);
    return { count: 0, firstFailedAt: 0, lockedUntil: 0 };
  }
}

function registerFailedPin(userName) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw new Error('No se pudo validar el intento. Probá nuevamente.');
  }

  try {
    const now = Date.now();
    const props = PropertiesService.getScriptProperties();
    const key = getAttemptPropertyKey(userName);
    const state = readAttemptState(userName, now);

    if (Number(state.lockedUntil || 0) > now) {
      return {
        locked: true,
        lockedUntil: Number(state.lockedUntil),
        attemptsRemaining: 0
      };
    }

    const count = Number(state.count || 0) + 1;
    const firstFailedAt = Number(state.firstFailedAt || 0) || now;

    if (count >= MAX_PIN_ATTEMPTS) {
      const lockedUntil = now + PIN_LOCK_MS;
      props.setProperty(key, JSON.stringify({
        count: count,
        firstFailedAt: firstFailedAt,
        lockedUntil: lockedUntil
      }));
      return { locked: true, lockedUntil: lockedUntil, attemptsRemaining: 0 };
    }

    props.setProperty(key, JSON.stringify({
      count: count,
      firstFailedAt: firstFailedAt,
      lockedUntil: 0
    }));

    return {
      locked: false,
      lockedUntil: 0,
      attemptsRemaining: MAX_PIN_ATTEMPTS - count
    };
  } finally {
    lock.releaseLock();
  }
}

function clearFailedPins(userName) {
  PropertiesService
    .getScriptProperties()
    .deleteProperty(getAttemptPropertyKey(userName));
}

// ── SESIONES ────────────────────────────────────────────────────────────
function createRandomToken() {
  return [
    Utilities.getUuid(),
    Utilities.getUuid(),
    Utilities.getUuid()
  ].join('').replace(/-/g, '');
}

function sha256(value) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ''),
    Utilities.Charset.UTF_8
  );
  return base64Url(digest);
}

function base64Url(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

function getSessionPropertyKey(sessionToken) {
  return SESSION_PROPERTY_PREFIX + sha256(sessionToken);
}

function getPinVersion(pinHash) {
  return sha256(String(pinHash || ''));
}

function cleanupExpiredSessions() {
  const now = Date.now();
  const pinlessAllowed = isPinlessLoginAllowed();
  const selfPinSetupAllowed = isSelfPinSetupAllowed();
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();

  Object.keys(all).forEach(function (key) {
    if (key.indexOf(SESSION_PROPERTY_PREFIX) !== 0) return;
    try {
      const session = JSON.parse(all[key]);
      const expired =
        now >= Number(session.expiresAt || 0) ||
        now - Number(session.lastActivityAt || 0) >= SESSION_IDLE_MS;
      if (
        expired ||
        (session.pinless && (!pinlessAllowed || selfPinSetupAllowed))
      ) {
        props.deleteProperty(key);
      }
    } catch (err) {
      props.deleteProperty(key);
    }
  });
}

function issueSession(user, pinless) {
  cleanupExpiredSessions();

  const now = Date.now();
  const token = createRandomToken();
  const session = {
    user: user.nombre,
    role: normalizeRole(user.rol),
    pinless: !!pinless,
    mustChangePin: !!user.mustChangePin,
    pinVersion: getPinVersion(user.pinHash),
    createdAt: now,
    lastActivityAt: now,
    expiresAt: now + SESSION_MAX_AGE_MS
  };

  PropertiesService
    .getScriptProperties()
    .setProperty(getSessionPropertyKey(token), JSON.stringify(session));

  return {
    token: token,
    session: session
  };
}

function validateSession(sessionToken, touch) {
  const token = String(sessionToken || '');
  if (!token || token.length > 512) {
    return { ok: false, code: 'SESSION_REQUIRED', error: 'Sesión requerida' };
  }

  const props = PropertiesService.getScriptProperties();
  const key = getSessionPropertyKey(token);
  const raw = props.getProperty(key);
  if (!raw) {
    return { ok: false, code: 'SESSION_EXPIRED', error: 'La sesión expiró' };
  }

  let session;
  try {
    session = JSON.parse(raw);
  } catch (err) {
    props.deleteProperty(key);
    return { ok: false, code: 'SESSION_EXPIRED', error: 'La sesión expiró' };
  }

  const now = Date.now();
  if (
    now >= Number(session.expiresAt || 0) ||
    now - Number(session.lastActivityAt || 0) >= SESSION_IDLE_MS
  ) {
    props.deleteProperty(key);
    return { ok: false, code: 'SESSION_EXPIRED', error: 'La sesión expiró' };
  }

  if (session.pinless && isSelfPinSetupAllowed()) {
    props.deleteProperty(key);
    return {
      ok: false,
      code: 'PIN_SETUP_REQUIRED',
      error: 'Configurá tu PIN para volver a ingresar'
    };
  }

  if (session.pinless && !isPinlessLoginAllowed()) {
    props.deleteProperty(key);
    return {
      ok: false,
      code: 'PIN_REQUIRED',
      error: 'El acceso sin PIN fue desactivado'
    };
  }

  const currentUser = findAllowedUser(session.user);
  if (!currentUser) {
    props.deleteProperty(key);
    return {
      ok: false,
      code: 'SESSION_REVOKED',
      error: 'El usuario ya no está autorizado'
    };
  }

  if (getPinVersion(currentUser.pinHash) !== String(session.pinVersion || '')) {
    props.deleteProperty(key);
    return {
      ok: false,
      code: 'SESSION_REVOKED',
      error: 'El PIN cambió; ingresá nuevamente'
    };
  }

  const currentRole = normalizeRole(currentUser.rol);
  let changed = currentRole !== session.role;
  session.role = currentRole;

  if (touch && now - Number(session.lastActivityAt || 0) >= SESSION_TOUCH_INTERVAL_MS) {
    session.lastActivityAt = now;
    changed = true;
  }

  if (changed) props.setProperty(key, JSON.stringify(session));

  return {
    ok: true,
    token: token,
    propertyKey: key,
    session: session,
    user: currentUser
  };
}

function revokeSession(sessionToken) {
  const token = String(sessionToken || '');
  if (!token || token.length > 512) return;
  PropertiesService
    .getScriptProperties()
    .deleteProperty(getSessionPropertyKey(token));
}

function revokeSessionsForUser(userName) {
  const wanted = canonicalUserName(userName);
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();

  Object.keys(all).forEach(function (key) {
    if (key.indexOf(SESSION_PROPERTY_PREFIX) !== 0) return;
    try {
      const session = JSON.parse(all[key]);
      if (canonicalUserName(session.user) === wanted) props.deleteProperty(key);
    } catch (err) {
      props.deleteProperty(key);
    }
  });
}

function revokePinlessSessions() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();

  Object.keys(all).forEach(function (key) {
    if (key.indexOf(SESSION_PROPERTY_PREFIX) !== 0) return;
    try {
      const session = JSON.parse(all[key]);
      if (session.pinless) props.deleteProperty(key);
    } catch (err) {
      props.deleteProperty(key);
    }
  });
}

function sessionResponse(issued) {
  return jsonResponse({
    ok: true,
    sessionToken: issued.token,
    user: {
      name: issued.session.user,
      role: issued.session.role
    },
    pinless: issued.session.pinless,
    mustChangePin: !!issued.session.mustChangePin,
    expiresAt: issued.session.expiresAt,
    idleTimeoutMs: SESSION_IDLE_MS
  });
}

function handleInitialPinSetup(body) {
  if (!isSelfPinSetupAllowed()) {
    return errorResponse(
      'La configuración inicial de PIN está desactivada',
      'PIN_SETUP_DISABLED'
    );
  }

  const userName = String(body.user || '').trim();
  const pin = String(body.pin || '').trim();
  if (!userName) {
    return errorResponse('Falta indicar el usuario', 'USER_REQUIRED');
  }
  if (!/^\d{4}$/.test(pin)) {
    return errorResponse(
      'El PIN debe contener exactamente 4 dígitos',
      'PIN_INVALID_FORMAT'
    );
  }

  // El lock hace atómica la regla "el primero que reclama la cuenta gana".
  // Dentro del lock se vuelve a leer PIN_HASH para impedir dos altas paralelas.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return errorResponse(
      'No se pudo reservar la configuración del PIN. Probá nuevamente.',
      'PIN_SETUP_LOCK_TIMEOUT'
    );
  }

  try {
    if (!isSelfPinSetupAllowed()) {
      return errorResponse(
        'La configuración inicial de PIN fue desactivada',
        'PIN_SETUP_DISABLED'
      );
    }

    const user = findAllowedUser(userName);
    if (!user) {
      return errorResponse('Usuario no autorizado', 'USER_NOT_FOUND');
    }
    if (user.pinHash) {
      return errorResponse(
        'Este usuario ya tiene un PIN configurado',
        'PIN_ALREADY_CONFIGURED'
      );
    }

    setUserPinHash(user.nombre, pin);
    clearFailedPins(user.nombre);

    const configuredUser = findAllowedUser(user.nombre);
    if (!configuredUser || !configuredUser.pinHash) {
      throw new Error('No se pudo confirmar el PIN recién configurado');
    }

    Logger.log('PIN inicial configurado para el usuario: ' + configuredUser.nombre);
    return sessionResponse(issueSession(configuredUser, false));
  } finally {
    lock.releaseLock();
  }
}

function handleLogin(body) {
  const user = findAllowedUser(body.user);
  if (!user) {
    return errorResponse('Usuario no autorizado', 'USER_NOT_FOUND');
  }

  if (!user.pinHash) {
    // El alta directa tiene prioridad sobre el bypass de testing: si está
    // habilitada, ninguna cuenta vacía puede ver datos antes de elegir su PIN.
    if (isSelfPinSetupAllowed()) {
      return errorResponse(
        'Configurá tu PIN de 4 dígitos para habilitar la cuenta',
        'PIN_SETUP_REQUIRED'
      );
    }

    if (!isPinlessLoginAllowed()) {
      return errorResponse(
        'Este usuario todavía no tiene un PIN configurado',
        'PIN_NOT_CONFIGURED'
      );
    }

    clearFailedPins(user.nombre);
    return sessionResponse(issueSession(user, true));
  }

  const pin = String(body.pin || '').trim();
  if (!pin) {
    return errorResponse('Ingresá tu PIN', 'PIN_REQUIRED');
  }

  const now = Date.now();
  const attemptState = readAttemptState(user.nombre, now);
  if (Number(attemptState.lockedUntil || 0) > now) {
    return errorResponse('Demasiados intentos. Esperá antes de volver a probar.', 'PIN_LOCKED', {
      lockedUntil: Number(attemptState.lockedUntil)
    });
  }

  if (!/^\d{4}$/.test(pin) || !verifyUserPin(user, pin)) {
    const failed = registerFailedPin(user.nombre);
    if (failed.locked) {
      return errorResponse('Demasiados intentos. Acceso bloqueado temporalmente.', 'PIN_LOCKED', {
        lockedUntil: failed.lockedUntil,
        attemptsRemaining: 0
      });
    }

    return errorResponse('PIN incorrecto', 'PIN_INVALID', {
      attemptsRemaining: failed.attemptsRemaining
    });
  }

  clearFailedPins(user.nombre);
  return sessionResponse(issueSession(user, false));
}

function handleSessionCheck(body) {
  const result = validateSession(body.sessionToken, true);
  if (!result.ok) return errorResponse(result.error, result.code);

  return jsonResponse({
    ok: true,
    user: {
      name: result.session.user,
      role: result.session.role
    },
    pinless: !!result.session.pinless,
    mustChangePin: !!result.user.mustChangePin,
    expiresAt: result.session.expiresAt,
    idleTimeoutMs: SESSION_IDLE_MS
  });
}

// Cambiar el PIN propio ya autenticado. Exige el PIN actual salvo que la
// cuenta todavía no tenga PIN (pinless de prueba) y el autoalta siga
// habilitado: en ese caso se comporta como el alta inicial, con la
// diferencia de que ya hay una sesión válida.
function handleChangePin(body, sessionUser) {
  const currentPin = String(body.currentPin || '').trim();
  const newPin = String(body.newPin || '').trim();

  if (!/^\d{4}$/.test(currentPin) && !/^\d{4}$/.test(newPin)) {
    return errorResponse(
      'El PIN debe contener exactamente 4 dígitos',
      'PIN_INVALID_FORMAT'
    );
  }
  if (!/^\d{4}$/.test(newPin)) {
    return errorResponse(
      'El PIN nuevo debe contener exactamente 4 dígitos',
      'PIN_INVALID_FORMAT'
    );
  }

  const user = findAllowedUser(sessionUser);
  if (!user) {
    return errorResponse('Usuario no autorizado', 'USER_NOT_FOUND');
  }

  if (user.pinHash) {
    if (!/^\d{4}$/.test(currentPin)) {
      return errorResponse(
        'Ingresá tu PIN actual de 4 dígitos',
        'PIN_INVALID_FORMAT'
      );
    }

    if (!verifyUserPin(user, currentPin)) {
      const failed = registerFailedPin(user.nombre);
      if (failed.locked) {
        return errorResponse(
          'Demasiados intentos. Cambio de PIN bloqueado temporalmente.',
          'PIN_LOCKED',
          { lockedUntil: failed.lockedUntil, attemptsRemaining: 0 }
        );
      }
      return errorResponse(
        'El PIN actual es incorrecto',
        'PIN_INVALID',
        { attemptsRemaining: failed.attemptsRemaining }
      );
    }
  } else if (!isSelfPinSetupAllowed()) {
    return errorResponse(
      'Este usuario todavía no tiene un PIN configurado',
      'PIN_NOT_CONFIGURED'
    );
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return errorResponse(
      'No se pudo reservar el cambio de PIN. Probá nuevamente.',
      'PIN_CHANGE_LOCK_TIMEOUT'
    );
  }

  try {
    const freshUser = findAllowedUser(sessionUser);
    if (!freshUser) {
      return errorResponse('Usuario no autorizado', 'USER_NOT_FOUND');
    }

    // Evita que dos cambios paralelos sobre la misma cuenta se pisen.
    if (
      freshUser.pinHash &&
      !constantTimeEquals(String(freshUser.pinHash || ''), String(user.pinHash || ''))
    ) {
      return errorResponse(
        'El PIN cambió mientras tanto. Volvé a intentarlo.',
        'PIN_CHANGE_RACE'
      );
    }

    setUserPinHash(freshUser.nombre, newPin, false);
    clearFailedPins(freshUser.nombre);

    const configuredUser = findAllowedUser(freshUser.nombre);
    if (!configuredUser || !configuredUser.pinHash) {
      throw new Error('No se pudo confirmar el PIN recién configurado');
    }

    Logger.log('PIN actualizado por el usuario: ' + configuredUser.nombre);
    return sessionResponse(issueSession(configuredUser, false));
  } finally {
    lock.releaseLock();
  }
}

// ── GESTIÓN EXCLUSIVA DE SUPERUSUARIO ───────────────────────────────────
function serializeAdminUser(user) {
  return {
    name: user.nombre,
    role: user.rol,
    active: Boolean(user.activo),
    hasPin: Boolean(user.pinHash),
    mustChangePin: Boolean(user.mustChangePin)
  };
}

function assertSuperuserRole(sessionRole) {
  if (normalizeRole(sessionRole) !== 'SUPERUSUARIO') {
    throw new Error('Esta operación requiere permisos de SUPERUSUARIO');
  }
}

function handleAdminListUsers(sessionRole) {
  assertSuperuserRole(sessionRole);
  return jsonResponse({
    ok: true,
    users: getAllUsers().map(serializeAdminUser)
  });
}

function handleAdminResetPin(body, sessionUser, sessionRole) {
  assertSuperuserRole(sessionRole);
  const targetName = String(body.targetUser || '').trim();
  const tempPin = String(body.tempPin || '').trim();

  if (!targetName) {
    return errorResponse('Falta indicar el usuario', 'USER_REQUIRED');
  }
  if (!/^\d{4}$/.test(tempPin)) {
    return errorResponse(
      'El PIN temporal debe contener exactamente 4 dígitos',
      'PIN_INVALID_FORMAT'
    );
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return errorResponse(
      'No se pudo reservar el cambio de PIN. Probá nuevamente.',
      'PIN_CHANGE_LOCK_TIMEOUT'
    );
  }

  try {
    const target = findAnyUser(targetName);
    if (!target) {
      return errorResponse('Usuario no encontrado', 'USER_NOT_FOUND');
    }

    setUserPinHash(target.nombre, tempPin, true);
    clearFailedPins(target.nombre);
    logChange(
      sessionUser,
      'ADMIN',
      USERS_SHEET_NAME,
      target.row,
      PIN_HASH_HEADER,
      target.pinHash ? '[HASH]' : '',
      '[HASH_TEMP]'
    );

    const updated = findAnyUser(target.nombre);
    return jsonResponse({
      ok: true,
      user: serializeAdminUser(updated)
    });
  } finally {
    lock.releaseLock();
  }
}

function handleAdminSetUserActive(body, sessionUser, sessionRole) {
  assertSuperuserRole(sessionRole);
  const targetName = String(body.targetUser || '').trim();
  const nextActive = Boolean(body.active);

  if (!targetName) {
    return errorResponse('Falta indicar el usuario', 'USER_REQUIRED');
  }

  if (!nextActive && canonicalUserName(targetName) === canonicalUserName(sessionUser)) {
    return errorResponse(
      'No podés dar de baja tu propio usuario activo',
      'SELF_DEACTIVATION_FORBIDDEN'
    );
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return errorResponse(
      'No se pudo reservar la actualización del usuario. Probá nuevamente.',
      'USER_UPDATE_LOCK_TIMEOUT'
    );
  }

  try {
    const target = findAnyUser(targetName);
    if (!target) {
      return errorResponse('Usuario no encontrado', 'USER_NOT_FOUND');
    }

    setUserActiveStatus(target.nombre, nextActive);
    logChange(
      sessionUser,
      'ADMIN',
      USERS_SHEET_NAME,
      target.row,
      USER_STATUS_HEADER,
      target.activo ? 'ACTIVO' : 'INACTIVO',
      nextActive ? 'ACTIVO' : 'INACTIVO'
    );

    const updated = findAnyUser(target.nombre);
    return jsonResponse({
      ok: true,
      user: serializeAdminUser(updated)
    });
  } finally {
    lock.releaseLock();
  }
}

function handleAdminRevokeUserSessions(body, sessionUser, sessionRole) {
  assertSuperuserRole(sessionRole);
  const targetName = String(body.targetUser || '').trim();
  if (!targetName) {
    return errorResponse('Falta indicar el usuario', 'USER_REQUIRED');
  }

  const target = findAnyUser(targetName);
  if (!target) {
    return errorResponse('Usuario no encontrado', 'USER_NOT_FOUND');
  }

  revokeSessionsForUser(target.nombre);
  clearFailedPins(target.nombre);
  logChange(
    sessionUser,
    'ADMIN',
    USERS_SHEET_NAME,
    target.row,
    'SESIONES',
    'ACTIVAS',
    'REVOCADAS'
  );

  return jsonResponse({
    ok: true,
    user: serializeAdminUser(target)
  });
}

// ── AUTORIZACIÓN DE COLUMNAS ────────────────────────────────────────────
function isAssignmentColumn(column) {
  const key = normalizeKey(column);
  const exactNames = [
    'encargado',
    'encargada',
    'responsable',
    'asignado',
    'asignada',
    'asignadoa',
    'operador',
    'asignacion',
    'usuarioresponsable'
  ];

  if (exactNames.indexOf(key) !== -1) return true;

  // Misma búsqueda flexible que utiliza el frontend. Se excluyen sellos como
  // "Presentado por" y "Archivado por", que USUARIO sí puede modificar.
  if (
    key.indexOf('present') !== -1 ||
    key.indexOf('archiv') !== -1 ||
    key.indexOf('liquid') !== -1 ||
    key.indexOf('enviad') !== -1
  ) {
    return false;
  }

  return key.indexOf('encargad') !== -1 ||
    key.indexOf('responsable') !== -1 ||
    key.indexOf('asignad') !== -1;
}

function assertCanEditColumn(role, column) {
  if (!isPrivilegedRole(role) && isAssignmentColumn(column)) {
    throw new Error('Tu rol no permite cambiar el Encargado de un cliente');
  }
}

// ── RESPUESTAS ──────────────────────────────────────────────────────────
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function errorResponse(message, code, extra) {
  const payload = {
    ok: false,
    error: String(message || 'Error desconocido'),
    code: code || 'UNKNOWN_ERROR'
  };

  if (extra) {
    Object.keys(extra).forEach(function (key) {
      payload[key] = extra[key];
    });
  }

  return jsonResponse(payload);
}

// ── GET DESACTIVADO ─────────────────────────────────────────────────────
// El token nunca debe enviarse por URL. Todas las operaciones usan POST.
function doGet() {
  return errorResponse(
    'Método no permitido. Usá POST con JSON.',
    'POST_REQUIRED'
  );
}

// ── ESCRITURA DE UNA CELDA YA VALIDADA ──────────────────────────────────
function writeSingleCell(sheet, headers, user, year, sheetName, row, column, value) {
  const colIndex = headers.indexOf(column);
  if (colIndex === -1) throw new Error('Columna "' + column + '" no existe');
  if (!row || Number(row) < 2) throw new Error('Fila inválida');

  const rowNumber = Number(row);
  const cell = sheet.getRange(rowNumber, colIndex + 1);
  const oldValue = cell.getValue();
  cell.setValue(value);
  logChange(user, year, sheetName, rowNumber, column, oldValue, value);
}

// ── POST: LECTURA Y ESCRITURA ───────────────────────────────────────────
function doPost(e) {
  let body;

  try {
    if (!e || !e.postData || typeof e.postData.contents !== 'string') {
      throw new Error('Sin body');
    }
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return errorResponse('Body inválido, se esperaba JSON', 'INVALID_BODY');
  }

  if (!isAuthorized(body.token)) return unauthorizedResponse();

  const action = String(body.action || 'ping');

  // Acciones permitidas antes de iniciar sesión.
  if (action === 'ping') {
    return jsonResponse({
      ok: true,
      message: 'Conexión establecida correctamente',
      authMode: isSelfPinSetupAllowed()
        ? 'self-pin-setup'
        : (isPinlessLoginAllowed() ? 'testing' : 'enforced'),
      timestamp: new Date().toISOString()
    });
  }

  if (action === 'users') {
    try {
      return jsonResponse({
        ok: true,
        users: getAllowedUsers().map(function (u) {
          return { name: u.nombre };
        })
      });
    } catch (err) {
      return errorResponse(err.message, 'USERS_ERROR');
    }
  }

  if (action === 'setupPin') {
    try {
      return handleInitialPinSetup(body);
    } catch (err) {
      return errorResponse(err.message, 'PIN_SETUP_ERROR');
    }
  }

  if (action === 'login') {
    try {
      return handleLogin(body);
    } catch (err) {
      return errorResponse(err.message, 'LOGIN_ERROR');
    }
  }

  if (action === 'session') {
    try {
      return handleSessionCheck(body);
    } catch (err) {
      return errorResponse(err.message, 'SESSION_ERROR');
    }
  }

  if (action === 'logout') {
    revokeSession(body.sessionToken);
    return jsonResponse({ ok: true });
  }

  // Desde acá toda operación debe tener una sesión individual válida.
  const auth = validateSession(body.sessionToken, true);
  if (!auth.ok) return errorResponse(auth.error, auth.code);

  const sessionUser = auth.session.user;
  const sessionRole = auth.session.role;

  if (action === 'changePin') {
    try {
      return handleChangePin(body, sessionUser);
    } catch (err) {
      return errorResponse(err.message, 'PIN_CHANGE_ERROR');
    }
  }

  if (action === 'adminListUsers') {
    try {
      return handleAdminListUsers(sessionRole);
    } catch (err) {
      return errorResponse(err.message, 'FORBIDDEN');
    }
  }

  if (action === 'adminResetPin') {
    try {
      return handleAdminResetPin(body, sessionUser, sessionRole);
    } catch (err) {
      return errorResponse(err.message, 'ADMIN_RESET_PIN_ERROR');
    }
  }

  if (action === 'adminSetUserActive') {
    try {
      return handleAdminSetUserActive(body, sessionUser, sessionRole);
    } catch (err) {
      return errorResponse(err.message, 'ADMIN_USER_STATUS_ERROR');
    }
  }

  if (action === 'adminRevokeUserSessions') {
    try {
      return handleAdminRevokeUserSessions(body, sessionUser, sessionRole);
    } catch (err) {
      return errorResponse(err.message, 'ADMIN_REVOKE_SESSIONS_ERROR');
    }
  }

  if (action === 'years') {
    try {
      return jsonResponse({ ok: true, years: getAvailableYears() });
    } catch (err) {
      return errorResponse(err.message, 'YEARS_ERROR');
    }
  }

  if (action === 'months') {
    try {
      if (!body.year) {
        return errorResponse('Falta indicar el año', 'YEAR_REQUIRED');
      }
      return jsonResponse({
        ok: true,
        months: getAvailableSheets(body.year)
      });
    } catch (err) {
      return errorResponse(err.message, 'MONTHS_ERROR');
    }
  }

  if (action === 'read') {
    try {
      const sheet = getMonthSheet(body.year, body.sheet);
      if (!sheet) {
        return errorResponse(
          'Año/mes "' + body.year + ' / ' + body.sheet + '" no válido',
          'SHEET_NOT_FOUND'
        );
      }

      const data = fillMergedValues(sheet.getDataRange());
      if (data.length === 0) {
        return jsonResponse({ ok: true, headers: [], rows: [] });
      }

      const headers = data[0];
      const rows = data.slice(1).map(function (row, idx) {
        const obj = {};
        headers.forEach(function (h, i) { obj[h] = row[i]; });
        obj._row = idx + 2;
        return obj;
      });

      return jsonResponse({ ok: true, headers: headers, rows: rows });
    } catch (err) {
      return errorResponse(err.message, 'READ_ERROR');
    }
  }

  if (action === 'create') {
    try {
      const sheet = getMonthSheet(body.year, body.sheet);
      if (!sheet) {
        return errorResponse(
          'Año/mes "' + body.year + ' / ' + body.sheet + '" no válido',
          'SHEET_NOT_FOUND'
        );
      }
      if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)) {
        return errorResponse('Faltan los datos del cliente', 'VALUES_REQUIRED');
      }

      const headers = sheet
        .getRange(1, 1, 1, sheet.getLastColumn())
        .getValues()[0];
      const rowValues = headers.map(function (header) {
        const value = Object.prototype.hasOwnProperty.call(body.values, header)
          ? body.values[header]
          : '';
        if (value !== '' && value !== null && value !== undefined) {
          assertCanEditColumn(sessionRole, header);
        }
        return value === null || value === undefined ? '' : value;
      });

      const lock = LockService.getScriptLock();
      if (!lock.tryLock(30000)) {
        return errorResponse(
          'No se pudo obtener el lock de la hoja (30s), intentá de nuevo',
          'SHEET_LOCK_TIMEOUT'
        );
      }

      let newRow;
      try {
        newRow = Math.max(2, sheet.getLastRow() + 1);
        const target = sheet.getRange(newRow, 1, 1, headers.length);
        let inheritedFormulas = [];
        // Conserva formato, validaciones y fórmulas de la fila anterior, sin
        // copiar sus datos. R1C1 hace que las referencias relativas se ajusten
        // a la fila nueva.
        if (newRow > 2) {
          const previous = sheet.getRange(newRow - 1, 1, 1, headers.length);
          previous.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
          target.setDataValidations(previous.getDataValidations());
          inheritedFormulas = previous.getFormulasR1C1()[0];
        }
        target.setValues([rowValues]);
        inheritedFormulas.forEach(function (formula, index) {
          if (formula && rowValues[index] === '') {
            target.getCell(1, index + 1).setFormulaR1C1(formula);
          }
        });
        headers.forEach(function (header, index) {
          if (rowValues[index] !== '') {
            logChange(sessionUser, body.year, body.sheet, newRow, header, '', rowValues[index]);
          }
        });
      } finally {
        lock.releaseLock();
      }

      return jsonResponse({ ok: true, row: newRow, message: 'Cliente creado' });
    } catch (err) {
      return errorResponse(err.message, 'CREATE_ERROR');
    }
  }

  if (action === 'update') {
    try {
      const sheet = getMonthSheet(body.year, body.sheet);
      if (!sheet) {
        return errorResponse(
          'Año/mes "' + body.year + ' / ' + body.sheet + '" no válido',
          'SHEET_NOT_FOUND'
        );
      }

      const headers = sheet
        .getRange(1, 1, 1, sheet.getLastColumn())
        .getValues()[0];

      assertCanEditColumn(sessionRole, body.column);
      writeSingleCell(
        sheet,
        headers,
        sessionUser,
        body.year,
        body.sheet,
        body.row,
        body.column,
        body.value
      );

      return jsonResponse({
        ok: true,
        message: 'Celda actualizada',
        row: body.row,
        column: body.column
      });
    } catch (err) {
      return errorResponse(err.message, 'UPDATE_ERROR');
    }
  }

  if (action === 'updateBatch') {
    try {
      const updates = body.updates;
      if (!Array.isArray(updates) || updates.length === 0) {
        return errorResponse(
          'No se recibió ningún cambio para guardar (updates vacío)',
          'UPDATES_REQUIRED'
        );
      }

      const groups = {};
      const groupOrder = [];

      updates.forEach(function (u) {
        const key = String(u.year) + '||' + String(u.sheet);
        if (!groups[key]) {
          groups[key] = [];
          groupOrder.push(key);
        }
        groups[key].push(u);
      });

      const results = [];
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(30000)) {
        return errorResponse(
          'No se pudo obtener el lock de la hoja (30s), intentá de nuevo',
          'SHEET_LOCK_TIMEOUT'
        );
      }

      try {
        groupOrder.forEach(function (key) {
          const groupUpdates = groups[key];
          const first = groupUpdates[0];
          const sheet = getMonthSheet(first.year, first.sheet);

          if (!sheet) {
            groupUpdates.forEach(function (u) {
              results.push({
                row: u.row,
                column: u.column,
                ok: false,
                error: 'Año/mes "' + first.year + ' / ' + first.sheet + '" no válido'
              });
            });
            return;
          }

          const headers = sheet
            .getRange(1, 1, 1, sheet.getLastColumn())
            .getValues()[0];

          groupUpdates.forEach(function (u) {
            try {
              assertCanEditColumn(sessionRole, u.column);
              writeSingleCell(
                sheet,
                headers,
                sessionUser,
                u.year,
                u.sheet,
                u.row,
                u.column,
                u.value
              );
              results.push({ row: u.row, column: u.column, ok: true });
            } catch (itemErr) {
              results.push({
                row: u.row,
                column: u.column,
                ok: false,
                error: itemErr.message
              });
            }
          });
        });
      } finally {
        lock.releaseLock();
      }

      return jsonResponse({ ok: true, results: results });
    } catch (err) {
      return errorResponse(err.message, 'UPDATE_BATCH_ERROR');
    }
  }

  // Módulo Vencimientos IVA (archivo AppsScript-Iva.gs).
  const ivaResponse = handleIvaAction(action, body, sessionUser, sessionRole);
  if (ivaResponse) return ivaResponse;

  // Módulo Marcaciones (archivo AppsScript-Marcaciones.gs).
  const marcacionesResponse = handleMarcacionesAction(action, body, sessionUser, sessionRole);
  if (marcacionesResponse) return marcacionesResponse;

  return errorResponse('Acción desconocida: ' + action, 'UNKNOWN_ACTION');
}
