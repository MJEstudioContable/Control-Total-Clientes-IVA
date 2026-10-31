// Prueba de humo en jsdom (sin navegador): monta la app real contra el
// backend simulado, entra a un período y mide la lista de "Asignar
// clientes" y el comportamiento de "Actualizar".
//   node tools/smoke/server.mjs &   (o LATENCY_MS=0)
//   NODE_PATH=/tmp/node_modules node tools/smoke/dom-smoke.mjs
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(process.env.NODE_PATH ? `${process.env.NODE_PATH}/` : import.meta.url);
const { JSDOM } = require('jsdom');

const BACKEND = process.env.SMOKE_BACKEND || 'http://127.0.0.1:8787';
process.env.VITE_BACKEND_URL = BACKEND;
process.env.VITE_API_TOKEN ||= 'smoke-token';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const { window } = dom;
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'localStorage',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'MutationObserver', 'CustomEvent', 'Event',
  'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLButtonElement',
  'SVGElement', 'DOMRect', 'matchMedia', 'IntersectionObserver', 'ResizeObserver', 'DocumentFragment', 'Text', 'Image']) {
  if (window[key] === undefined) continue;
  try { globalThis[key] = window[key]; } catch { Object.defineProperty(globalThis, key, { value: window[key], configurable: true }); }
}
globalThis.matchMedia ||= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
window.matchMedia ||= globalThis.matchMedia;
globalThis.ResizeObserver ||= class { observe() {} disconnect() {} unobserve() {} };
globalThis.IntersectionObserver ||= class { observe() {} disconnect() {} unobserve() {} };
window.scrollTo = () => {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const vite = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'error',
  ssr: { external: true, target: 'node' },
});
try {
  const appRequire = createRequire(new URL('../../package.json', import.meta.url));
  const React = appRequire('react');
  const { act } = React;
  const { createRoot } = appRequire('react-dom/client');
  const App = (await vite.ssrLoadModule('/src/App.jsx')).default;
  const ExecutiveDashboard = (await vite.ssrLoadModule('/src/ui-executive/ExecutiveDashboard.jsx')).default;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const flush = async (ms = 50) => { await act(async () => { await sleep(ms); }); };
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const click = (el) => act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  const clickText = async (text, sel = 'button') => {
    const el = $$(sel).find((b) => b.textContent.includes(text));
    if (!el) throw new Error(`No se encontró "${text}" — botones: ${$$('button').map((b) => b.textContent.trim()).slice(0, 20).join(' | ')}`);
    await click(el);
  };
  const waitFor = async (fn, label, timeout = 8000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) { if (fn()) return; await flush(50); }
    throw new Error(`timeout esperando ${label}\n--- DOM ---\n${document.body.textContent.slice(0, 600)}`);
  };

  window.localStorage.setItem('sheets-remote:user', 'Jorge');
  const root = createRoot(document.getElementById('root'));
  await act(async () => {
    root.render(React.createElement(App, { uiMode: 'executive', periodOverviewComponent: ExecutiveDashboard }));
  });

  await waitFor(() => $$('button').some((b) => /2026/.test(b.textContent)), 'selector de año');
  await clickText('2026');
  await waitFor(() => $$('button').some((b) => /Agosto/.test(b.textContent)), 'selector de mes');
  await clickText('Agosto');
  await waitFor(() => $('.real-exec-client-row'), 'panel ejecutivo con filas');
  console.log('Panel ejecutivo: filas montadas (virtualizadas):', $$('.real-exec-client-row').length);

  // "Actualizar" no debe desmontar la lista.
  const firstRow = $('.real-exec-client-row');
  const refreshBtn = $$('button').find((b) => /Actualizar/i.test(b.getAttribute('title') || b.getAttribute('aria-label') || b.textContent));
  if (refreshBtn) {
    await click(refreshBtn);
    await flush(20);
    const notice = $('.real-exec-refresh-notice');
    const stillMounted = document.contains(firstRow);
    console.log('Actualizar → aviso "Actualizando" visible:', Boolean(notice), '| lista sigue montada:', stillMounted);
    await waitFor(() => !$('.real-exec-refresh-notice'), 'fin de la recarga');
  } else {
    console.log('(no se encontró el botón Actualizar en el navbar)');
  }

  // Asignar clientes.
  await clickText('Asignar');
  await waitFor(() => $('.assign-row'), 'pantalla Asignar clientes');
  const nodes = document.querySelectorAll('*').length;
  console.log(`Asignar clientes: ${$$('.assign-row').length} filas, ${$$('select').length} <select>, ${nodes} nodos en el DOM`);
  const encBtn = $('.assign-row-encargado');
  await click(encBtn);
  console.log('Tras tocar un encargado: <select> montados =', $$('select').length);

  // Panel exclusivo de SUPERUSUARIO en Configuración.
  const settingsBtn = $$('button').find((b) => /Configuración/i.test(b.getAttribute('title') || b.getAttribute('aria-label') || b.textContent));
  if (settingsBtn) {
    await click(settingsBtn);
    await waitFor(() => $$('button').some((b) => /Gestionar usuarios y accesos/.test(b.textContent)), 'modal Configuración con opción Superusuario');
    await clickText('Gestionar usuarios y accesos');
    await waitFor(() => $$('.settings-admin-card').length === 5, 'lista de usuarios de Superusuario');
    console.log('Gestión de usuarios (Superusuario): tarjetas =', $$('.settings-admin-card').length);
  }

  console.log('\nOK');
} catch (error) {
  console.error('FALLÓ:', error);
  process.exitCode = 1;
} finally {
  await vite.close();
  setTimeout(() => process.exit(process.exitCode || 0), 100);
}
