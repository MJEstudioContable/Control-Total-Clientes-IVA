// Cola de guardado en segundo plano.
//
// Objetivo: el usuario ve el cambio reflejado al instante en la UI (eso ya
// lo hacen ClientDetail/ClientList con su actualización optimista), pero las
// peticiones reales al backend (Apps Script) NO se disparan una por una en
// paralelo. En cambio:
//
//  1. Cada edición se encola (enqueueUpdate).
//  2. Si llegan varias ediciones en una ventana corta (FLUSH_DELAY_MS), se
//     agrupan en un solo "lote" en vez de N requests sueltos disparados a
//     la vez.
//  3. Si el usuario edita la MISMA celda varias veces antes de que se
//     procese la cola (ej: SI -> NO -> SI), sólo se manda el último valor:
//     no tiene sentido gastar varias llamadas al backend por eso.
//  4. Los lotes se procesan de a uno por vez y se mandan como UNA sola
//     petición al backend (acción 'updateBatch'), no como varias
//     peticiones sueltas. Esto es lo que realmente soluciona la lentitud:
//     Apps Script compite por el lock de la hoja cuando le llegan varias
//     escrituras simultáneas, y eso es más lento que agruparlas.
//
// Requiere que el Apps Script tenga la acción 'updateBatch' (ver Code.gs).
//
// Nada de esto bloquea el hilo principal ni el render: todo pasa en
// background con promesas y timers.

const FLUSH_DELAY_MS = 300; // ventana para agrupar ediciones rápidas
const MAX_RETRIES = 3;
const NON_RETRYABLE_CODES = new Set([
  'SESSION_REQUIRED',
  'SESSION_EXPIRED',
  'SESSION_REVOKED',
]);

let pending = new Map(); // key -> { year, sheet, row, column, value, resolvers[], rejecters[] }
let flushTimer = null;
let flushing = false;
let inFlightCount = 0;
let postFn = null; // se inyecta desde api.js para evitar import circular

const listeners = new Set();

function notify() {
  const totalPending = pending.size + inFlightCount;
  const status = flushing || pending.size > 0 ? 'syncing' : 'idle';
  listeners.forEach((cb) => {
    try {
      cb({ status, pendingCount: totalPending });
    } catch (e) {
      console.warn('Error en listener de saveQueue:', e);
    }
  });
}

// Permite a la UI (ej. un indicador "Sincronizando...") suscribirse al
// estado de la cola sin acoplarse a la implementación interna.
export function onQueueStatusChange(cb) {
  listeners.add(cb);
  cb({
    status: flushing || pending.size > 0 ? 'syncing' : 'idle',
    pendingCount: pending.size + inFlightCount,
  });
  return () => listeners.delete(cb);
}

// Consulta sincrónica para saber si quedan cambios en cola o viajando al
// servidor (se usa en beforeunload / pagehide para forzar el flush o avisar
// antes de cerrar la pestaña).
export function hasPendingSaves() {
  return flushing || pending.size > 0;
}

// api.js inyecta acá su función `post` (la que ya maneja retries de red,
// token, etc.) para que esta cola no dependa directamente de config/fetch.
export function configureSaveQueue({ post }) {
  postFn = post;
}

function keyFor({ year, sheet, row, column }) {
  return `${year}__${sheet}__${row}__${column}`;
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_DELAY_MS);
}

export function enqueueUpdate({ year, sheet, row, column, value }) {
  if (!postFn) {
    return Promise.reject(new Error('saveQueue no fue configurada (falta configureSaveQueue).'));
  }

  const key = keyFor({ year, sheet, row, column });

  return new Promise((resolve, reject) => {
    const existing = pending.get(key);
    if (existing) {
      // Coalescing: pisa el valor anterior, no se manda dos veces.
      existing.value = value;
      existing.resolvers.push(resolve);
      existing.rejecters.push(reject);
    } else {
      pending.set(key, {
        year,
        sheet,
        row,
        column,
        value,
        resolvers: [resolve],
        rejecters: [reject],
      });
    }
    notify();
    scheduleFlush();
  });
}

// Copia de las escrituras que están en la cola esperando salir al backend.
// Sirve para no "rebobinar" cambios optimistas con datos viejos del
// servidor: cuando el cache se revalida en segundo plano puede volver una
// foto de la hoja anterior a una edición que todavía no se mandó.
export function getPendingUpdates() {
  return Array.from(pending.values()).map(({ year, sheet, row, column, value }) => ({
    year,
    sheet,
    row,
    column,
    value,
  }));
}

// Manda TODO el lote en una sola petición al backend (acción
// 'updateBatch'), y reparte el resultado por celda usando el array
// `results` que devuelve Apps Script. El request en sí se reintenta si
// falla por completo (ej: caída de red); si el request llegó bien pero
// algún item puntual falló del lado del servidor, sólo se reintenta/marca
// ESE item, no el lote entero.
async function sendBatch(batch) {
  const updates = batch.map(({ year, sheet, row, column, value }) => ({
    year,
    sheet,
    row,
    column,
    value,
  }));

  let attempt = 0;
  let lastErr = null;
  let response = null;

  while (attempt < MAX_RETRIES) {
    attempt++;
    try {
      response = await postFn({ action: 'updateBatch', updates });
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (NON_RETRYABLE_CODES.has(err.code)) break;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
  }

  if (lastErr) {
    // El request en sí nunca llegó a buen puerto (ni siquiera con
    // reintentos): todo el lote se marca como fallido.
    batch.forEach((item) => item.rejecters.forEach((rejectOne) => rejectOne(lastErr)));
    return;
  }

  // El request sí llegó: repartimos éxito/error por celda según `results`.
  const resultsByKey = new Map();
  (response && Array.isArray(response.results) ? response.results : []).forEach((r) => {
    resultsByKey.set(`${r.row}__${r.column}`, r);
  });

  batch.forEach((item) => {
    const result = resultsByKey.get(`${item.row}__${item.column}`);
    if (!result || result.ok) {
      item.resolvers.forEach((resolveOne) => resolveOne());
    } else {
      const err = new Error(result.error || 'No se pudo guardar el cambio');
      item.rejecters.forEach((rejectOne) => rejectOne(err));
    }
  });
}

async function flush() {
  if (flushing || pending.size === 0) return;
  const batch = Array.from(pending.values());
  pending = new Map();
  flushing = true;
  inFlightCount = batch.length;
  notify();

  // Lo que llegue MIENTRAS se procesa este lote se acumula en un `pending`
  // nuevo y se manda en el próximo flush, no se pierde ni se mezcla.
  await sendBatch(batch);

  flushing = false;
  inFlightCount = 0;
  notify();

  if (pending.size > 0) {
    scheduleFlush();
  }
}

// Por si se necesita forzar el guardado inmediato (ej: antes de salir de la
// pantalla o cerrar la app) en vez de esperar los 300ms de debounce.
export function flushNow() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  return flush();
}

