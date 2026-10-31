// Configuración de conexión al backend (Apps Script).
// Los valores se inyectan al compilar mediante variables de entorno y nunca
// deben escribirse en el repositorio. Al ser una app cliente, VITE_API_TOKEN
// evita la exposición en Git pero NO es un secreto frente a quien inspeccione
// el bundle; la autenticación real debe validarse en el backend.
export const BACKEND_URL = String(import.meta.env.VITE_BACKEND_URL || '').trim();
export const API_TOKEN = String(import.meta.env.VITE_API_TOKEN || '').trim();

// El nombre elegido se conserva para no pedirlo en cada apertura. La sesión
// individual tiene su propia clave y expira según lo que valide Apps Script.
export const STORAGE_KEY_USER = 'sheets-remote:user';
export const STORAGE_KEY_SESSION = 'sheets-remote:session-v1';

// --- Marangatu (login de la SET) ---------------------------------------
// Página que abre el botón de la tarjeta de cliente. Si la extensión
// "Ekuatia Login" está instalada y configurada, autocompleta el formulario;
// si no, igual abre el login para cargarlo a mano.
export const MARANGATU_LOGIN_URL =
  import.meta.env.VITE_MARANGATU_LOGIN_URL || 'https://marangatu.set.gov.py/eset/login';

// ID de la extensión (se ve en chrome://extensions con "Modo de
// desarrollador" activado). Si queda vacío, el botón sólo abre la página y
// avisa que instales la extensión. El ID de una extensión "descomprimida"
// cambia según la máquina: pegalo acá (o en VITE_MARANGATU_EXT_ID) tras
// cargarla en tu Chrome.
export const MARANGATU_EXT_ID = import.meta.env.VITE_MARANGATU_EXT_ID || '';
