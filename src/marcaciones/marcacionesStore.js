// Planilla de marcaciones cargada: sobrevive al cambio de pestaña (memoria) y,
// si el administrador lo pide, también al cierre del navegador (este dispositivo).
// Se descarta al cerrar sesión o cambiar de usuario (ver App.jsx).
const KEY_DATOS = 'sheets-remote:marcaciones-datos-v1';
const KEY_RECORDAR = 'sheets-remote:marcaciones-recordar-v1';

let memoria = null; // { regs, info, mes }

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin espacio o sin acceso */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* nada que borrar */ } },
};

export const recordarActivo = () => ls.get(KEY_RECORDAR) === '1';

export function leerPlanilla() {
  if (memoria) return memoria;
  if (!recordarActivo()) return null;
  try {
    const p = JSON.parse(ls.get(KEY_DATOS));
    if (Array.isArray(p?.regs) && p.regs.length) {
      memoria = p;
      return p;
    }
  } catch { /* dato dañado: se ignora */ }
  return null;
}

export function guardarPlanilla(p) {
  memoria = p;
  if (recordarActivo()) ls.set(KEY_DATOS, JSON.stringify(p));
}

export function setRecordar(on) {
  if (on) {
    ls.set(KEY_RECORDAR, '1');
    if (memoria) ls.set(KEY_DATOS, JSON.stringify(memoria));
  } else {
    ls.del(KEY_RECORDAR);
    ls.del(KEY_DATOS);
  }
}

/** Botón "Quitar planilla": borra los datos y conserva la preferencia. */
export function quitarPlanilla() {
  memoria = null;
  ls.del(KEY_DATOS);
}

/** Cierre de sesión / cambio de usuario: borra datos y preferencia. */
export function olvidarPlanilla() {
  memoria = null;
  ls.del(KEY_DATOS);
  ls.del(KEY_RECORDAR);
}
