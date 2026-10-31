// Catálogo de páginas de Marangatu: "¿en qué pantalla estoy?".
//
// identificarPagina() mira la página actual (ruta + marcadores del contenido) y
// devuelve { id, nombre, provisoria, evidencia, ruta, marco }. Es la base del
// futuro navegador: cada pantalla tiene un id estable que las tareas usan para
// saber dónde están y hacia dónde ir.
//
// Va autocontenida (sin variables externas) porque también se inyecta con
// chrome.scripting.executeScript({ func: identificarPagina }) desde el popup.
// Sólo lee la estructura: nunca valores de campos ni datos de clientes.
//
// Las reglas se evalúan en orden y gana la primera que coincide. Las ya
// confirmadas salen del recorrido real de la extensión (rutas .do y campos del
// Formulario 120). "Provisoria" = regla supuesta, a confirmar con el relevamiento
// de navegación; se ajusta cuando haya páginas relevadas.
// eslint-disable-next-line no-unused-vars -- lo usan popupPagina.js y relevamientoNav.js
function identificarPagina() {
  const ruta = location.pathname;
  const rutaMin = ruta.toLowerCase();
  const q = (selector) => document.querySelector(selector) !== null;
  const visibleConTexto = (texto) => [...document.querySelectorAll('a, li, span, button')]
    .some((e) => e.offsetParent !== null && (e.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase() === texto);
  // Fila de la tabla de obligaciones "211 IVA General / 1 DECLARACIONES".
  const fila211 = () => [...document.querySelectorAll('table tr')].some((tr) => {
    const x = (tr.textContent || '').replace(/\s+/g, ' ').toUpperCase();
    return x.includes('211') && x.includes('IVA') && x.includes('DECLARACIONES');
  });

  const reglas = [
    { id: 'FORMULARIO_120', nombre: 'Formulario 120 (IVA)', evidencia: 'campos #C10 y #C44', ok: () => q('#C10') && q('#C44') },
    { id: 'FORMULARIO_DDJJ', nombre: 'Formulario presentado (DDJJ completa)', evidencia: 'ruta consultarDDJJCompleta.do', ok: () => rutaMin.includes('consultarddjjcompleta.do') },
    { id: 'PRESENTAR_DECLARACION', nombre: 'Presentar declaración', evidencia: 'ruta recibirDDJJContribuyente.do', ok: () => rutaMin.includes('recibirddjjcontribuyente.do') },
    { id: 'DETALLE_CUENTA', nombre: 'Detalle de cuenta', evidencia: 'ruta consultarDetalleCuenta.do', ok: () => rutaMin.includes('consultardetallecuenta.do') },
    { id: 'LISTA_DDJJ', nombre: 'Lista de declaraciones (211 IVA)', evidencia: 'ruta consultarTransacciones.do o enlaces a consultarDDJJCompleta.do', ok: () => rutaMin.includes('consultartransacciones.do') || q('a[href*="consultarDDJJCompleta.do"]') },
    { id: 'LOGIN', nombre: 'Inicio de sesión', evidencia: 'ruta /login o campo de clave', ok: () => rutaMin.includes('/login') || q('input[type="password"]') },
    { id: 'VISION_RESULTADO', nombre: 'Visión Integral: resultado de la búsqueda', evidencia: 'fila 211 IVA General / DECLARACIONES', ok: fila211 },
    { id: 'VISION_INTEGRAL', nombre: 'Visión Integral del Contribuyente', evidencia: 'botón Búsqueda (botonConsultar)', ok: () => q('button[name="botonConsultar"]') },
    // Confirmado con el relevamiento real: al iniciar sesión se llega a /eset/
    // ("Bienvenido | MARANGATU"), donde "CONSULTAS" es un div, no un enlace.
    { id: 'INICIO', nombre: 'Inicio (página madre)', evidencia: 'ruta /eset/ (página de bienvenida)', ok: () => /^\/eset\/?$/.test(rutaMin) || visibleConTexto('consultas') },
  ];

  const base = { ruta, marco: window === window.top ? 'principal' : 'marco' };
  for (const r of reglas) {
    let coincide = false;
    try { coincide = !!r.ok(); } catch { coincide = false; }
    if (coincide) return { ...base, id: r.id, nombre: r.nombre, provisoria: !!r.provisoria, evidencia: r.evidencia };
  }
  return { ...base, id: 'DESCONOCIDA', nombre: 'Página no reconocida', provisoria: false, evidencia: '' };
}
