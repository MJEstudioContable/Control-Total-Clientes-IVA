// Normaliza encabezados removiendo tildes, signos de puntuación finales y espacios redundantes
export function normalizeHeader(header) {
  if (!header) return '';
  return String(header)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Quita tildes (ej: Presentó -> Presento, Razón -> Razon)
    .replace(/[\u00A0\s]+/g, ' ') // Espacios no rompibles y múltiples espacios a uno solo
    .replace(/[:._\-#]+$/, '') // Quita dos puntos, puntos, guiones finales
    .trim()
    .toLowerCase();
}

// Versión compacta sin ningún espacio ni puntuación para comparaciones 100% inmunes a espacios accidentales (ej: "Pres entado por:" -> "presentadopor")
export function compactHeader(header) {
  if (!header) return '';
  return normalizeHeader(header).replace(/[^a-z0-9]/g, '');
}

// Patrones ampliados para detectar la columna del nombre/razón social
const NAME_PATTERNS = [
  /^(cliente|razon\s*social|razon|nombre|titular|contribuyente|empresa|denominacion|sociedad|apellido)/i,
  /cliente|razon|nombre|titular|contribuyente|empresa/i,
];

export function pickNameColumn(headers) {
  if (!headers || !headers.length) return null;
  for (const pattern of NAME_PATTERNS) {
    const found = headers.find((h) => pattern.test(normalizeHeader(h)) || pattern.test(compactHeader(h)));
    if (found) return found;
  }
  return headers[0];
}

// Texto comparable para el buscador: no distingue mayúsculas, tildes,
// puntuación ni espacios repetidos ("PÉREZ S.A." y "perez sa" coinciden).
export function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Búsqueda en dos etapas, para no normalizar la fila entera en cada tecla:
 *   1. buildRowSearchIndex(row) -> una vez por fila (cuando cambian los datos);
 *   2. prepareSearchQuery(query) -> una vez por tecla;
 *   3. scoreSearchIndex(index, prepared) -> sólo compara strings ya listos.
 * getClientSearchScore() sigue existiendo como atajo (sin caché).
 */
export function buildRowSearchIndex(row, nameKey, rucKey) {
  const name = normalizeSearchText(nameKey ? row[nameKey] : '');
  const ruc = normalizeSearchText(rucKey ? row[rucKey] : '');
  const others = [];
  for (const key in row) {
    if (key.startsWith('_') || key === nameKey || key === rucKey) continue;
    const value = normalizeSearchText(row[key]);
    if (value) others.push(value);
  }
  return {
    name,
    nameWords: name ? name.split(' ') : [],
    compactRuc: ruc.replace(/\s+/g, ''),
    others,
    othersWords: others.map((v) => v.split(' ')),
    all: [name, ruc, ...others].join(' '),
  };
}

export function prepareSearchQuery(query) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return null;
  return {
    normalized,
    terms: normalized.split(' ').filter(Boolean),
    compact: normalized.replace(/\s+/g, ''),
  };
}

function termsMatchWords(words, terms) {
  return terms.every((term) => words.some((word) => word.startsWith(term)));
}

/**
 * Puntaje de relevancia (mayor = mejor). -1 cuando la fila no coincide.
 * - Nombre/Razón social siempre tiene la prioridad más alta.
 * - RUC queda segundo.
 * - El resto de las columnas permite seguir encontrando por cualquier dato.
 */
export function scoreSearchIndex(index, prepared) {
  if (!prepared) return 0;
  const { normalized, terms, compact } = prepared;
  const { name, nameWords, compactRuc, others, othersWords, all } = index;

  if (name) {
    if (name === normalized) return 1000;
    if (name.startsWith(normalized)) return 950;
    if (name.includes(normalized)) return 900;
    if (termsMatchWords(nameWords, terms)) return 850;
    if (terms.every((term) => name.includes(term))) return 800;
  }

  if (compactRuc && compact) {
    if (compactRuc === compact) return 700;
    if (compactRuc.startsWith(compact)) return 650;
    if (compactRuc.includes(compact)) return 600;
  }

  for (let i = 0; i < others.length; i++) if (others[i] === normalized) return 500;
  for (let i = 0; i < others.length; i++) if (others[i].startsWith(normalized)) return 450;
  for (let i = 0; i < others.length; i++) if (others[i].includes(normalized)) return 400;
  for (let i = 0; i < othersWords.length; i++) if (termsMatchWords(othersWords[i], terms)) return 350;

  // Consultas combinadas (parte del nombre + parte del RUC) repartidas entre columnas.
  if (terms.every((term) => all.includes(term))) return 300;

  return -1;
}

export function getClientSearchScore(row, query, nameKey, rucKey) {
  return scoreSearchIndex(buildRowSearchIndex(row, nameKey, rucKey), prepareSearchQuery(query));
}

// Los permisos usan una forma canónica aunque la planilla tenga variantes
// habituales como "Admin", espacios accidentales o diferencias de mayúsculas.
export function normalizeUserRole(value) {
  const compact = normalizeSearchText(value).replace(/\s+/g, '');

  if (
    compact === 'superusuario' ||
    compact === 'superusuaria' ||
    compact === 'superadmin' ||
    compact === 'superadministrador' ||
    compact === 'superadministradora'
  ) {
    return 'SUPERUSUARIO';
  }

  if (compact === 'admin' || compact === 'administrador' || compact === 'administradora') {
    return 'ADMINISTRADOR';
  }

  return 'USUARIO';
}

export function getDisplayHeader(header) {
  if (!header) return 'Vencimiento';
  const clean = String(header).trim().replace(/[:._-]+$/, '').trim();
  if (!clean || /^(_col_|columna\s*\d+|unnamed)/i.test(clean)) {
    return 'Vencimiento';
  }
  const norm = normalizeHeader(clean);
  const comp = compactHeader(clean);
  if (/^(vto|venc|f\s*venc|fecha\s*venc|vencimiento|vencimientos|dia\s*venc|vto\s*dia)$/i.test(norm) || comp.startsWith('venc') || comp.startsWith('vto')) {
    return 'Vencimiento';
  }
  return clean;
}

// Columnas estrictas de SI/NO (marcas de verificación directas)
const STRICT_YES_NO_PATTERN = /^(papel(es)?|recibid[oa]s?|entregad[oa]s?|confirmad[oa]s?|completad[oa]s?|check|presentad[oa]s?|presento|presentacion|ddjj|dj|declarad[oa]s?|declaracion|liquidacion|liquidad[oa]s?|enviad[oa]s?|list[oa]|hech[oa])$/i;

// Columnas híbridas que aceptan SI/NO o texto libre (ej. "Archivado por:", "Procesado por", etc.)
const HYBRID_PATTERN = /archiv|procesad|revisad|por:?$|quien|responsable/i;

export function findVencimientoColumn(headers) {
  if (!headers || !headers.length) return null;
  const vtoPattern = /^(vto|venc|f\s*venc|fecha\s*venc|vencimiento|vencimientos|dia\s*venc|vto\s*dia|dia)$/i;
  let found = headers.find((h) => vtoPattern.test(normalizeHeader(h)));
  if (found) return found;
  found = headers.find((h) => {
    const comp = compactHeader(h);
    return comp.startsWith('venc') || comp.startsWith('vto') || comp === 'fechavencimiento' || comp === 'diavencimiento';
  });
  if (found) return found;
  found = headers.find((h) => getDisplayHeader(h) === 'Vencimiento');
  if (found) return found;
  found = headers.find((h) => /venc|vto/i.test(normalizeHeader(h)) || compactHeader(h).includes('venc') || compactHeader(h).includes('vto'));
  return found || null;
}

// Columna real donde se guarda el encargado/asignado de cada cliente
export function findEncargadoColumn(headers) {
  if (!headers || !headers.length) return null;
  // Prioridad: "Encargado", "Encargada", "Responsable", "Asignado a", "Operador"
  let found = headers.find((h) => {
    const comp = compactHeader(h);
    return (
      comp === 'encargado' ||
      comp === 'encargada' ||
      comp === 'responsable' ||
      comp === 'asignado' ||
      comp === 'asignada' ||
      comp === 'asignadoa' ||
      comp === 'operador' ||
      comp === 'asignacion' ||
      comp === 'usuarioresponsable'
    );
  });
  if (found) return found;

  const pattern = /^(encargad[oa]s?|responsable|asignad[oa]s?|operador|asignacion|usuario\s*responsable)$/i;
  found = headers.find((h) => pattern.test(normalizeHeader(h)));
  if (found) return found;

  // Búsqueda flexible excluyendo sellos de acción (como "Presentado por" o "Archivado por")
  found = headers.find((h) => {
    const comp = compactHeader(h);
    if (comp.includes('present') || comp.includes('archiv') || comp.includes('liquid') || comp.includes('enviad')) return false;
    return comp.includes('encargad') || comp.includes('responsable') || comp.includes('asignad');
  });
  return found || null;
}

// Columna de Presentación (soporta Presentado, Presentó, Presentación, DDJJ, DJ, Declarado, etc.)
export function findPresentadoColumn(headers) {
  if (!headers || !headers.length) return null;

  // 1. Coincidencia exacta o prioritaria para columna booleana/estado
  let found = headers.find((h) => {
    const comp = compactHeader(h);
    return (
      comp === 'presentado' ||
      comp === 'presentada' ||
      comp === 'presento' ||
      comp === 'presentacion' ||
      comp === 'ddjj' ||
      comp === 'dj' ||
      comp === 'declaracion' ||
      comp === 'declaracionjurada' ||
      comp === 'declarado' ||
      comp === 'liquidado' ||
      comp === 'enviado' ||
      comp === 'presentados' ||
      comp === 'presentadas'
    );
  });
  if (found) return found;

  const directPattern = /^(presentad[oa]s?|presento|presentacion|ddjj|dj|declaracion(\s*jurada)?|declarad[oa]s?|liquidad[oa]s?|enviad[oa]s?)$/i;
  found = headers.find((h) => directPattern.test(normalizeHeader(h)));
  if (found) return found;

  // 2. Coincidencia de "Presentado por:" u otras variantes con "por" (incluso con espacios accidentales como "Pres entado por:")
  found = headers.find((h) => {
    const comp = compactHeader(h);
    return (comp.includes('present') || comp.includes('ddjj') || comp.includes('declarad') || comp.includes('liquid')) && comp.includes('por');
  });
  if (found) return found;

  const stampPattern = /(presentad|presento|presentacion|ddjj|dj|declarad|liquid|enviad).*por/i;
  found = headers.find((h) => stampPattern.test(normalizeHeader(h)));
  if (found) return found;

  // 3. Cualquier columna que contenga "present", "ddjj" o "declarad"
  found = headers.find((h) => {
    const comp = compactHeader(h);
    return comp.includes('present') || comp.includes('ddjj') || comp.includes('declarad') || comp === 'dj';
  });
  return found || null;
}

// Columna de Archivado (soporta Archivado, Archivado por:, Archivo, Guardado, etc.)
export function findArchivadoColumn(headers) {
  if (!headers || !headers.length) return null;

  // 1. Coincidencia directa
  let found = headers.find((h) => {
    const comp = compactHeader(h);
    return comp === 'archivado' || comp === 'archivada' || comp === 'archivo' || comp === 'guardado' || comp === 'guardada';
  });
  if (found) return found;

  const directPattern = /^(archivad[oa]s?|archivo|guardad[oa]s?)$/i;
  found = headers.find((h) => directPattern.test(normalizeHeader(h)));
  if (found) return found;

  // 2. Coincidencia con "por"
  found = headers.find((h) => {
    const comp = compactHeader(h);
    return (comp.includes('archiv') || comp.includes('guard')) && comp.includes('por');
  });
  if (found) return found;

  const stampPattern = /(archivad|archivo|guardad).*por/i;
  found = headers.find((h) => stampPattern.test(normalizeHeader(h)));
  if (found) return found;

  // 3. Cualquier columna que contenga "archiv" o "guardad"
  found = headers.find((h) => {
    const comp = compactHeader(h);
    return comp.includes('archiv') || comp.includes('guard');
  });
  return found || null;
}

export function findUserStampColumn(headers, type) {
  if (!headers || !headers.length) return null;
  const cleanType = String(type).toLowerCase();

  if (cleanType.includes('present') || cleanType.includes('ddjj') || cleanType.includes('dj')) {
    // Busca columnas tipo "Presentado por:", "Pres entado por:", "DDJJ por", etc.
    let found = headers.find((h) => {
      const comp = compactHeader(h);
      return (
        (comp.includes('present') || comp.includes('ddjj') || comp.includes('declarad') || comp.includes('liquid') || comp.includes('enviad')) &&
        (comp.includes('por') || comp.includes('usuario') || comp.includes('quien') || comp.includes('operador'))
      );
    });
    if (found) return found;

    found = headers.find((h) => {
      const norm = normalizeHeader(h);
      return /(presentad|presento|presentacion|ddjj|dj|declarad|liquid|enviad).*(por|usuario|quien|operador)/i.test(norm) ||
             /^(presentad|presento|ddjj|declarad)\s*por/i.test(norm);
    });
    if (found) return found;

    found = headers.find((h) => {
      const comp = compactHeader(h);
      return comp.includes('present') && comp.includes('por');
    });
    return found || null;
  }

  if (cleanType.includes('archiv') || cleanType.includes('guard')) {
    let found = headers.find((h) => {
      const comp = compactHeader(h);
      return (
        (comp.includes('archiv') || comp.includes('guard')) &&
        (comp.includes('por') || comp.includes('usuario') || comp.includes('quien') || comp.includes('operador'))
      );
    });
    if (found) return found;

    let foundNorm = headers.find((h) => {
      const norm = normalizeHeader(h);
      return /(archivad|archivo|guardad).*(por|usuario|quien|operador)/i.test(norm) ||
             /^(archivad|archivo|guardad)\s*por/i.test(norm);
    });
    if (foundNorm) return foundNorm;

    found = headers.find((h) => {
      const comp = compactHeader(h);
      return comp.includes('archiv') && comp.includes('por');
    });
    return found || null;
  }

  return headers.find((h) => {
    const comp = compactHeader(h);
    return comp.includes('por') || comp.includes('usuario');
  }) || null;
}

// Evalúa si un valor de celda representa un estado afirmativo / positivo (SI, SÍ, OK, X, 1, etc.)
export function isAffirmativeValue(val) {
  if (val === null || val === undefined) return false;
  const clean = String(val).trim().toUpperCase();
  if (!clean) return false;
  return ['SI', 'SÍ', 'S', 'OK', 'X', 'TRUE', '1', 'V', 'LISTO', 'HECHO', 'PRES', 'PRESENTADO', 'ARCHIVADO'].includes(clean);
}

// Distribution of clients sequentially (round-robin) per Vencimiento group
export function assignClientsSequentially(rows, vencimientoKey, teamUsers) {
  if (!rows || !rows.length) return [];
  const users = teamUsers && teamUsers.length > 0 ? teamUsers : ['Sin Asignar'];

  // Group rows by Vencimiento
  const groups = {};
  rows.forEach((row) => {
    const raw = vencimientoKey ? String(row[vencimientoKey] || '').trim() : 'Sin Vencimiento';
    const digits = raw.match(/\d+/);
    const dayKey = digits ? `Día ${parseInt(digits[0], 10)}` : raw || 'Sin Vencimiento';

    if (!groups[dayKey]) groups[dayKey] = [];
    groups[dayKey].push(row);
  });

  // Sort within each group by original row order (_row) and assign cyclically
  const assignedMap = new Map();
  Object.keys(groups).forEach((dayKey) => {
    const groupRows = groups[dayKey];
    groupRows.sort((a, b) => (a._row || 0) - (b._row || 0));

    groupRows.forEach((row, index) => {
      const assignedUser = users[index % users.length];
      assignedMap.set(row._row, assignedUser);
    });
  });

  return rows.map((r) => ({
    ...r,
    _assignedUser: assignedMap.get(r._row) || users[0],
  }));
}

export function getFieldType(header, currentValue) {
  const norm = normalizeHeader(header);
  const v = String(currentValue ?? '').trim().toUpperCase();

  // Si la cabecera es un campo híbrido (ej. "Archivado por:", "Procesado por", etc.)
  if (HYBRID_PATTERN.test(norm)) {
    return 'hybrid';
  }

  // Si la cabecera es estrictamente de verificación (ej. "Papeles", "Recibido", "Presentado")
  if (STRICT_YES_NO_PATTERN.test(norm)) {
    return 'pure_yesno';
  }

  // Si el valor actual en la planilla es afirmativo o negativo, y la columna parece un checklist
  if (
    (isAffirmativeValue(v) || v === 'NO' || v === 'N') &&
    /papel|recib|entreg|confirm|complet|check|present|archiv|ddjj|dj|declar|liquid|enviad/i.test(norm)
  ) {
    return 'pure_yesno';
  }

  // Para el resto de casillas: texto libre
  return 'text';
}

export function isYesNoColumn(header, currentValue) {
  const type = getFieldType(header, currentValue);
  return type === 'pure_yesno';
}

// Formatea etiquetas de período evitando redundancia si el nombre de la hoja (mes)
// ya contiene el año (ej. "Enero 2026" + "2026" -> "Enero 2026")
export function formatPeriodLabel(month, year) {
  if (!month) return year ? String(year) : '';
  if (!year) return String(month);

  const monthStr = String(month).trim();
  const yearStr = String(year).trim();

  if (monthStr.toLowerCase().includes(yearStr.toLowerCase())) {
    return monthStr;
  }

  return `${monthStr} ${yearStr}`;
}



// --- Columnas de credenciales de Marangatu (login SET) -----------------
// El botón de la tarjeta que abre el login de Marangatu lee estas dos
// columnas de la fila. La detección tolera los nombres reales de la hoja:
// "R.U.C." (usuario) y "Clave MH" (contraseña).
export function findRucColumn(headers) {
  if (!headers || !headers.length) return null;
  const found = headers.find((h) => {
    const comp = compactHeader(h);
    return comp === 'ruc' || comp === 'nroruc' || comp === 'ruccliente' || comp.startsWith('ruc');
  });
  return found || null;
}

export function findClaveMarangatuColumn(headers) {
  if (!headers || !headers.length) return null;
  const found = headers.find((h) => {
    const comp = compactHeader(h);
    return (
      comp === 'clavemh' ||
      comp === 'clavemarangatu' ||
      comp === 'passwordmh' ||
      (comp.includes('clave') && comp.includes('mh'))
    );
  });
  return found || null;
}
