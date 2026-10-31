# Backend simulado y pruebas de humo

Herramientas para probar la app **sin** el Apps Script real.

## Backend falso

```bash
node tools/smoke/server.mjs            # http://localhost:8787, 300 filas
VITE_BACKEND_URL=http://localhost:8787 npm run dev
```

Responde `login`, `session`, `users`, `years`, `months`, `read`, `updateBatch`
y `create` con datos inventados (cualquier nombre entra sin PIN como ADMINISTRADOR).

Variables: `PORT` (8787), `ROWS` (300), `LATENCY_MS` (250).

## Benchmark de búsqueda

```bash
node tools/smoke/bench.mjs
```

Compara el costo por tecla de filtrar/ordenar con el camino viejo
(`getClientSearchScore` normalizando cada fila) y con el índice en dos
etapas (`buildRowSearchIndex` + `prepareSearchQuery` + `scoreSearchIndex`).

## Prueba de humo en jsdom (sin navegador)

```bash
npm i -g --prefix /tmp jsdom   # o cualquier node_modules con jsdom
node tools/smoke/server.mjs &
NODE_PATH=/tmp/node_modules node tools/smoke/dom-smoke.mjs
```

Monta la app real contra el backend simulado, entra a 2026 → Agosto y
comprueba: filas del panel, que "Actualizar" **no** desmonta la lista
(aparece el aviso "Actualizando la planilla…"), cuántos nodos y `<select>`
monta "Asignar clientes" y que al tocar un encargado se monta **un** select.
