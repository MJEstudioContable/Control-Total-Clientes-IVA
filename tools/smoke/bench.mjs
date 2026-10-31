// Micro-benchmark de la búsqueda (filtrar + ordenar por relevancia) con las
// filas del backend simulado. Compara el camino viejo (normalizar todo por
// tecla) con el índice en dos etapas.  node tools/smoke/bench.mjs
import {
  getClientSearchScore,
  buildRowSearchIndex,
  prepareSearchQuery,
  scoreSearchIndex,
} from '../../src/utils.js';
import { handle } from './server.mjs';

process.env.LATENCY_MS = '0';
const { rows } = await handle({ action: 'login', user: 'Jorge' }).then((s) =>
  handle({ action: 'read', year: '2026', sheet: 'Agosto', sessionToken: s.sessionToken })
);
const nameKey = 'Razón Social';
const rucKey = 'R.U.C.';
const queries = ['fer', 'sur 12', '8000', 'estudio guarani', 'clave'];

function time(label, fn, iterations = 50) {
  fn();
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  console.log(`${label.padEnd(44)} ${((performance.now() - start) / iterations).toFixed(2)} ms`);
}

const index = new Map(rows.map((r) => [r._row, buildRowSearchIndex(r, nameKey, rucKey)]));

for (const q of queries) {
  console.log(`\nConsulta "${q}" sobre ${rows.length} filas`);
  time('  filtrar (antes: por fila y por tecla)', () =>
    rows.filter((r) => getClientSearchScore(r, q, nameKey, rucKey) >= 0));
  time('  filtrar (ahora: índice + query preparada)', () => {
    const p = prepareSearchQuery(q);
    return rows.filter((r) => scoreSearchIndex(index.get(r._row), p) >= 0);
  });
  time('  ordenar (antes: score en el comparador)', () =>
    [...rows].sort((a, b) => getClientSearchScore(b, q, nameKey, rucKey) - getClientSearchScore(a, q, nameKey, rucKey)));
  time('  ordenar (ahora: índice)', () => {
    const p = prepareSearchQuery(q);
    return [...rows].sort((a, b) => scoreSearchIndex(index.get(b._row), p) - scoreSearchIndex(index.get(a._row), p));
  });
}
