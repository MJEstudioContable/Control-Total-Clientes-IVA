// Preferencias de interfaz que viven en el dispositivo (no en la sesión ni
// en el backend): no se pierden al cambiar de usuario y cada equipo puede
// tener la suya. Hoy: el tamaño de texto.
//
// Están en su propio módulo (y no dentro de App.jsx) para que el archivo de
// componentes exporte solamente componentes: así Fast Refresh sigue
// funcionando y el lint se mantiene sin warnings.

export const STORAGE_KEY_FONT_SCALE = 'app-font-scale';

// El id de cada opción es el valor de data-font-scale en <html>. El factor
// real de cada uno se define en styles.css (--ui-font-scale).
export const FONT_SCALE_OPTIONS = [
  { id: 'compacto', label: 'Compacto' },
  { id: 'normal', label: 'Normal' },
  { id: 'grande', label: 'Grande' },
  { id: 'extra', label: 'Extra' },
];

export const DEFAULT_FONT_SCALE = 'normal';

export function isValidFontScale(value) {
  return FONT_SCALE_OPTIONS.some((option) => option.id === value);
}

// Lee la preferencia guardada tolerando localStorage bloqueado (modo
// privado, WebView restringida) y valores viejos que ya no existan.
export function readStoredFontScale() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_FONT_SCALE);
    return isValidFontScale(saved) ? saved : DEFAULT_FONT_SCALE;
  } catch {
    return DEFAULT_FONT_SCALE;
  }
}

export function persistFontScale(value) {
  try {
    localStorage.setItem(STORAGE_KEY_FONT_SCALE, value);
  } catch {
    // Es solo una preferencia visual: si no se puede guardar, se sigue
    // usando la elegida en esta sesión.
  }
}
