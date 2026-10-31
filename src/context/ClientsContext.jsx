// Contexto compartido de la planilla del período (año + mes).
//
// Antes, ClientList y AssignClients cargaban CADA UNO su propia copia de
// la planilla (api.readClients) y guardaban cada cambio en su propio
// state local. El resultado era que las dos pantallas vivían
// desconectadas: lo que se asignaba en "Asignar clientes" no aparecía en
// la lista hasta recargar, y los filtros de una no tenían nada que ver
// con los de la otra.
//
// Este provider es la única fuente de verdad del período:
//   - datos (headers + rows) y equipo de usuarios, cargados UNA sola vez;
//   - filtros compartidos (búsqueda, vencimiento, encargado, estado);
//   - escritura de celdas (optimista + cola de guardado), de modo que un
//     cambio hecho en cualquier pantalla se ve al instante en todas las
//     demás, sin necesidad de recargar.
//
// Se monta en App.jsx alrededor de todas las pantallas del período, así
// el estado sobrevive al ir y volver entre Lista, Asignar y Detalle.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api } from '../api';
import {
  pickNameColumn,
  findVencimientoColumn,
  findRucColumn,
  buildRowSearchIndex,
  prepareSearchQuery,
  scoreSearchIndex,
  findUserStampColumn,
  findEncargadoColumn,
  findPresentadoColumn,
  findArchivadoColumn,
  isAffirmativeValue,
  assignClientsSequentially,
  getFieldType,
} from '../utils';

// Misma clave que usaba ClientList para cachear el equipo, así los
// usuarios ya guardados siguen disponibles sin esperar la red.
const STORAGE_KEY_TEAM = 'app-team-users';

// Orden manual del equipo para el reparto automático. El round-robin reparte
// en el orden de esta lista (users[index % users.length]), así que el orden
// define quién se queda con qué cliente. Se guarda aparte del roster para
// que una sincronización con Sheets no lo pise.
const STORAGE_KEY_TEAM_ORDER = 'app-team-order';

// Quiénes participan del reparto automático. No todo el equipo reparte: por
// ejemplo alguien que solo carga datos o está de licencia no debería recibir
// clientes. `null` significa "todavía no se definió" y equivale a todos.
const STORAGE_KEY_REPARTO = 'app-reparto-users';

const ClientsContext = createContext(null);
const ClientsMetaContext = createContext(null);
const ClientsDataContext = createContext(null);
const ClientsFiltersContext = createContext(null);
const ClientsSaveStateContext = createContext(null);

function readSavedTeam() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_TEAM);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // si el JSON está roto, simplemente se arranca sin equipo cacheado
  }
  return null;
}

function persistTeam(list) {
  try {
    localStorage.setItem(STORAGE_KEY_TEAM, JSON.stringify(list));
  } catch {
    // localStorage lleno o no disponible: no es grave, es solo un cache
  }
}

function readSavedOrder() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TEAM_ORDER);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((u) => typeof u === 'string');
    }
  } catch {
    // orden inválido: se arranca con el orden que venga de Sheets
  }
  return [];
}

function readSavedParticipants() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_REPARTO);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((u) => typeof u === 'string');
    }
  } catch {
    // si no se puede leer, se asume que participan todos
  }
  return null;
}

function persistParticipants(list) {
  try {
    localStorage.setItem(STORAGE_KEY_REPARTO, JSON.stringify(list));
  } catch {
    // es una preferencia local: si no se guarda, no rompe nada
  }
}

function persistOrder(list) {
  try {
    localStorage.setItem(STORAGE_KEY_TEAM_ORDER, JSON.stringify(list));
  } catch {
    // idem: es una preferencia local, no rompe nada si no se puede guardar
  }
}

// Aplica el orden guardado a la lista real de usuarios: primero los que ya
// tienen posición (en ese orden) y al final los nuevos que aparezcan en
// Sheets, que todavía no se ordenaron.
function orderUsers(list, order) {
  const ordered = order.filter((u) => list.includes(u));
  const newcomers = list.filter((u) => !ordered.includes(u));
  return [...ordered, ...newcomers];
}

export function ClientsProvider({ user, userRole, year, month, children }) {
  const canAssignClients = userRole === 'ADMINISTRADOR' || userRole === 'SUPERUSUARIO';

  // --- Datos de la planilla (fuente única) -------------------------------
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  // `loading` es SÓLO la primera carga de un período (no hay nada para
  // mostrar); `refreshing` es una recarga con datos ya en pantalla.
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  // --- Equipo de usuarios ------------------------------------------------
  // `rosterUsers` es QUIÉNES están en el equipo (viene de Sheets); `teamOrder`
  // es el ORDEN manual del reparto. `teamUsers` (lo que consumen las
  // pantallas) sale de combinar los dos.
  const [rosterUsers, setRosterUsers] = useState(() => readSavedTeam() || [user].filter(Boolean));
  const [teamOrder, setTeamOrder] = useState(readSavedOrder);
  const [syncingUsers, setSyncingUsers] = useState(false);

  // Si `user` no está en el equipo (recién logueado con un equipo viejo en
  // caché, o un equipo local que no lo incluye), se suma al roster para que
  // siempre aparezca en el reparto. Se deriva con useMemo (antes se mutaba
  // el estado durante el render y el memo de teamUsers no se enteraba).
  const rosterWithUser = useMemo(
    () => (user && !rosterUsers.includes(user) ? [...rosterUsers, user] : rosterUsers),
    [rosterUsers, user]
  );

  const teamUsers = useMemo(() => orderUsers(rosterWithUser, teamOrder), [rosterWithUser, teamOrder]);

  // Participantes del reparto. `null` = no se definió todavía = participan
  // todos (así nadie se queda sin reparto por no haber tocado nada).
  const [participants, setParticipants] = useState(readSavedParticipants);

  // Los que SÍ entran al round-robin, ya en el orden del reparto. Es lo que
  // se muestra en el panel de asignar y lo que usa el reparto automático.
  const repartoUsers = useMemo(
    () => (participants ? teamUsers.filter((u) => participants.includes(u)) : teamUsers),
    [teamUsers, participants]
  );

  // Incluye o saca a alguien del reparto. La primera vez que se usa, parte de
  // "todos" y saca al que se tocó -- así definir participantes es restar.
  const toggleParticipant = useCallback(
    (name) => {
      const current = participants || teamUsers;
      const next = current.includes(name)
        ? current.filter((u) => u !== name)
        : [...current, name];
      // se guarda respetando el orden del equipo, no el orden en que se tocó
      const ordered = teamUsers.filter((u) => next.includes(u));
      setParticipants(ordered);
      persistParticipants(ordered);
    },
    [participants, teamUsers]
  );

  // Intercambio DIRECTO de posiciones entre dos usuarios: A pasa al lugar de
  // B y B al de A, y los demás NO se corren. Es lo que usa el arrastre de los
  // pills: arrastrás un nombre encima de otro y se intercambian solo esos dos.
  // (Antes se hacía "sacar y volver a insertar", que le movía el lugar a todos
  // los que quedaban en el medio.)
  //
  // Es 100% local y sincrónica (state + localStorage): no va al backend, no
  // espera red y no bloquea nada.
  const swapTeamMembers = useCallback(
    (a, b) => {
      if (!a || !b || a === b) return;
      const ia = teamUsers.indexOf(a);
      const ib = teamUsers.indexOf(b);
      if (ia < 0 || ib < 0) return;
      const next = [...teamUsers];
      next[ia] = teamUsers[ib];
      next[ib] = teamUsers[ia];
      setTeamOrder(next);
      persistOrder(next);
    },
    [teamUsers]
  );

  // --- Filtros compartidos entre pantallas -------------------------------
  const [query, setQuery] = useState('');
  const [selectedVencimiento, setSelectedVencimiento] = useState('todos');
  // 'todos' | 'presentado' | 'pendiente' (columna de presentación)
  const [selectedStatus, setSelectedStatus] = useState('todos');
  // 'todos' | 'sin_asignar' | 'mis' | <nombre de usuario>
  const [selectedAssignee, setSelectedAssignee] = useState('todos');
  // 'alpha' | 'vencimiento'
  const [sortBy, setSortBy] = useState('alpha');

  // --- Indicadores de guardado por fila (visibles en cualquier pantalla) --
  const [savingRows, setSavingRows] = useState([]);
  const [savedRows, setSavedRows] = useState([]);
  // Sets para consultar en O(1) por fila (antes era includes() por fila).
  const savingRowSet = useMemo(() => new Set(savingRows), [savingRows]);
  const savedRowSet = useMemo(() => new Set(savedRows), [savedRows]);
  const savedTimers = useRef(new Map());

  useEffect(
    () => () => {
      savedTimers.current.forEach((timer) => clearTimeout(timer));
      savedTimers.current.clear();
    },
    []
  );

  // Referencia siempre actualizada de `rows`, para poder leer el valor
  // anterior de una celda (necesario para revertir si falla el guardado)
  // sin meter `rows` en las dependencias de los callbacks.
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  // --- Carga de datos ----------------------------------------------------
  // Período que está en pantalla, para descartar respuestas de otro período.
  const periodRef = useRef({ year, month });
  periodRef.current = { year, month };
  const hasDataRef = useRef(false);

  const applySheetData = useCallback((data) => {
    const nextHeaders = data.headers || [];
    setHeaders((prev) =>
      prev.length === nextHeaders.length && prev.every((h, i) => h === nextHeaders[i])
        ? prev
        : nextHeaders
    );
    // Copia defensiva: el cache de api.js muta sus filas in-place con
    // las actualizaciones optimistas; trabajar con copias evita que el
    // state de React cambie "por atrás" sin disparar un re-render.
    setRows((data.rows || []).map((r) => ({ ...r })));
    hasDataRef.current = true;
  }, []);

  const reload = useCallback(
    async (force = false) => {
      // Con datos en pantalla la recarga NO desmonta la lista: se marca
      // `refreshing` y la lista sigue visible hasta que llegan los nuevos.
      const firstLoad = !hasDataRef.current;
      if (firstLoad) setLoading(true);
      else setRefreshing(true);
      setError('');
      try {
        const data = await api.readClients(year, month, force);
        if (periodRef.current.year !== year || periodRef.current.month !== month) return;
        applySheetData(data);
      } catch (err) {
        if (periodRef.current.year !== year || periodRef.current.month !== month) return;
        setError(err.message || 'No se pudo cargar la planilla');
      } finally {
        if (periodRef.current.year === year && periodRef.current.month === month) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [year, month, applySheetData]
  );

  // Cuando la recarga en segundo plano de api.js trae datos nuevos, se
  // repintan solos (antes quedaban viejos hasta apretar "Actualizar").
  useEffect(
    () =>
      api.onSheetData(({ year: y, sheet, data }) => {
        if (y === periodRef.current.year && sheet === periodRef.current.month && data) {
          applySheetData(data);
        }
      }),
    [applySheetData]
  );

  const syncTeamUsers = useCallback(
    async (force = false) => {
      setSyncingUsers(true);
      try {
        const allUsers = await api.listUsers(force);
        if (Array.isArray(allUsers) && allUsers.length > 0) {
          // Reemplazo estricto con lo que viene de Sheets (así los
          // usuarios borrados también desaparecen), sumando al usuario
          // logueado para que siempre esté en la lista.
          const updated = Array.from(new Set(user ? [user, ...allUsers] : allUsers)).filter(Boolean);
          setRosterUsers(updated);
          persistTeam(updated);

          // Si el filtro de encargado apuntaba a alguien que ya no está,
          // vuelve a "todos" para no dejar la lista vacía sin explicación.
          setSelectedAssignee((curr) => {
            if (curr === 'todos' || curr === 'sin_asignar' || curr === 'mis') return curr;
            return updated.includes(curr) ? curr : 'todos';
          });
        }
      } catch (e) {
        console.warn('Error al sincronizar usuarios totales:', e);
      } finally {
        setSyncingUsers(false);
      }
    },
    [user]
  );

  // --- Columnas detectadas (una sola vez, compartidas) --------------------
  const nameKey = useMemo(() => (headers.length ? pickNameColumn(headers) : null), [headers]);
  const vencimientoKey = useMemo(() => findVencimientoColumn(headers), [headers]);
  const rucKey = useMemo(() => findRucColumn(headers), [headers]);
  const encargadoCol = useMemo(() => findEncargadoColumn(headers), [headers]);
  const presentadoPorCol = useMemo(() => findUserStampColumn(headers, 'presentado'), [headers]);
  const archivadoPorCol = useMemo(() => findUserStampColumn(headers, 'archivado'), [headers]);
  const presentadoCol = useMemo(() => findPresentadoColumn(headers), [headers]);
  const archivadoCol = useMemo(() => findArchivadoColumn(headers), [headers]);

  // Columnas de estado SI/NO que se muestran como toggles rápidos.
  const statusHeaders = useMemo(() => {
    if (!headers.length) return [];
    return headers
      .filter((h) => {
        if (h === nameKey || h === vencimientoKey || h === presentadoPorCol || h === archivadoPorCol) {
          return false;
        }
        const type = getFieldType(h, '');
        return type === 'pure_yesno' || type === 'hybrid';
      })
      .slice(0, 5);
  }, [headers, nameKey, vencimientoKey, presentadoPorCol, archivadoPorCol]);

  // Columna principal de estado (Presentado / DDJJ / Declarado...).
  const primaryStatusHeader = useMemo(
    () =>
      presentadoCol ||
      statusHeaders.find((h) => findPresentadoColumn([h])) ||
      statusHeaders[0] ||
      null,
    [presentadoCol, statusHeaders]
  );

  // Días de vencimiento disponibles para los pills de filtro.
  const availableVencimientos = useMemo(() => {
    if (!vencimientoKey || !rows.length) return [];
    const set = new Set();
    rows.forEach((r) => {
      const raw = String(r[vencimientoKey] || '').trim();
      if (!raw) return;
      const digits = raw.match(/\d+/);
      set.add(digits ? String(parseInt(digits[0], 10)) : raw);
    });
    return Array.from(set).sort((a, b) => {
      const na = parseInt(a, 10);
      const nb = parseInt(b, 10);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });
  }, [vencimientoKey, rows]);

  // Día de vencimiento normalizado de una fila (ej. "Día 7" -> "7").
  const getVencimientoDay = useCallback(
    (row) => {
      if (!vencimientoKey) return 'Sin vencimiento';
      const raw = String(row[vencimientoKey] || '').trim();
      if (!raw) return 'Sin vencimiento';
      const digits = raw.match(/\d+/);
      return digits ? String(parseInt(digits[0], 10)) : raw;
    },
    [vencimientoKey]
  );

  // Encargado de cada fila. La ÚNICA fuente de verdad es la columna real
  // "Encargado" de la hoja: si está vacía, el cliente está SIN ASIGNAR y
  // así se muestra en todas las pantallas (lista, asignar, resumen).
  //
  // Acá antes se completaba el hueco con el round-robin de
  // assignClientsSequentially(), y el resultado era confuso: la lista
  // pintaba "Encargado: Juan" sobre un cliente que en la planilla no
  // tenía encargado, y ese nombre cambiaba solo al agregar clientes o
  // usuarios. El reparto automático sigue existiendo, pero como lo que
  // es: una acción explícita ("Repartir automático") que ESCRIBE valores
  // reales en la hoja, no una asignación fantasma que se muestra sola.
  const assignedRows = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        _assignedUser: encargadoCol ? String(row[encargadoCol] || '').trim() : '',
      })),
    [rows, encargadoCol]
  );

  // Reparto automático sugerido (round-robin). No toca el estado: devuelve
  // la propuesta para que "Repartir automático" la muestre/la escriba.
  const suggestRoundRobin = useCallback(
    (list) => assignClientsSequentially(list, vencimientoKey, repartoUsers),
    [vencimientoKey, repartoUsers]
  );

  // Índice de búsqueda por fila (una vez por cambio de datos, no por tecla).
  const searchIndex = useMemo(() => {
    const map = new Map();
    rows.forEach((row) => map.set(row._row, buildRowSearchIndex(row, nameKey, rucKey)));
    return map;
  }, [rows, nameKey, rucKey]);

  const preparedQuery = useMemo(() => prepareSearchQuery(query), [query]);

  // Puntaje de una fila para la búsqueda actual (0 si no hay búsqueda).
  const getSearchScore = useCallback(
    (row) => {
      if (!preparedQuery) return 0;
      const index = searchIndex.get(row._row) || buildRowSearchIndex(row, nameKey, rucKey);
      return scoreSearchIndex(index, preparedQuery);
    },
    [searchIndex, preparedQuery, nameKey, rucKey]
  );

  const unassignedCount = useMemo(() => {
    if (!encargadoCol) return rows.length;
    return rows.filter((r) => !String(r[encargadoCol] || '').trim()).length;
  }, [rows, encargadoCol]);

  // --- Filtros compartidos: lógica única para todas las pantallas ---------
  const matchesAssignee = useCallback(
    (row) => {
      if (selectedAssignee === 'todos') return true;
      // Siempre contra la columna real: sin columna o vacía = sin asignar.
      const real = encargadoCol ? String(row[encargadoCol] || '').trim() : '';
      if (selectedAssignee === 'sin_asignar') return !real;
      if (selectedAssignee === 'mis') return real === user;
      return real === selectedAssignee;
    },
    [selectedAssignee, encargadoCol, user]
  );

  // Estado "presentado" de una fila. La columna SI/NO MANDA; el sello
  // ("Presentado por: X") es sólo un fallback para planillas viejas.
  //
  // Antes se hacía `isAffirmativeValue(val) || hasStamp`, y el resultado era
  // que al desmarcar Presentado el ícono seguía en verde: la columna quedaba
  // en "NO" pero el sello seguía cargado y ganaba la disyunción. Ahora, si
  // existe una columna de estado propia, el sello no se consulta.
  const isRowPresentado = useCallback(
    (row) => {
      // Sin columna de estado real: lo único que indica que la fila ya se
      // presentó es el sello de usuario.
      if (!primaryStatusHeader) {
        return Boolean(
          presentadoPorCol && String(row[presentadoPorCol] || '').trim()
        );
      }

      const val = row[primaryStatusHeader];

      // Planilla vieja "solo sello": la columna que se detecta como estado ES
      // el sello ("Presentado por:"). Acá cualquier valor no vacío cuenta
      // como presentado, salvo el "NO"/"N" literal que se escribe al
      // desmarcar.
      if (primaryStatusHeader === presentadoPorCol) {
        const text = String(val || '').trim();
        if (!text) return false;
        return !/^no?$/i.test(text);
      }

      // Hay columna SI/NO propia: depende SOLO de ella.
      return isAffirmativeValue(val);
    },
    [primaryStatusHeader, presentadoPorCol]
  );

  // Aplica los filtros compartidos a cualquier lista de filas. Cada
  // pantalla le pasa sus filas (con o sin sugerencia de encargado) y
  // después ordena/agrupa como le convenga, pero el CRITERIO de filtrado
  // es uno solo: lo que se filtra en la lista es exactamente lo que se
  // filtra en "Asignar clientes".
  const applySharedFilters = useCallback(
    (list) => {
      let out = [...list];

      if (preparedQuery) {
        out = out.filter((row) => getSearchScore(row) >= 0);
      }

      if (vencimientoKey && selectedVencimiento !== 'todos') {
        out = out.filter((row) => getVencimientoDay(row) === selectedVencimiento);
      }

      if (selectedStatus !== 'todos' && primaryStatusHeader) {
        out = out.filter((row) => {
          const presentado = isRowPresentado(row);
          return selectedStatus === 'presentado' ? presentado : !presentado;
        });
      }

      if (selectedAssignee !== 'todos') {
        out = out.filter(matchesAssignee);
      }

      return out;
    },
    [
      preparedQuery,
      getSearchScore,
      vencimientoKey,
      selectedVencimiento,
      getVencimientoDay,
      selectedStatus,
      primaryStatusHeader,
      isRowPresentado,
      selectedAssignee,
      matchesAssignee,
    ]
  );

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedAssignee !== 'todos') count++;
    if (selectedVencimiento !== 'todos') count++;
    if (selectedStatus !== 'todos') count++;
    return count;
  }, [selectedAssignee, selectedVencimiento, selectedStatus]);

  const hasActiveFilters = activeFilterCount > 0 || Boolean(query.trim());

  const clearFilters = useCallback(() => {
    setQuery('');
    setSelectedVencimiento('todos');
    setSelectedStatus('todos');
    setSelectedAssignee('todos');
  }, []);

  // Carga de la planilla: se dispara al montar y cada vez que cambia el
  // período (año/mes). Mientras no haya año y mes elegidos (estamos en los
  // pickers) no se pide nada al backend. El contenido del período anterior se
  // descarta cuando el año o el mes cambian a null (volver al picker): el
  // estado deriva del período, así que se reinicia junto con la pantalla.
  useEffect(() => {
    if (!year || !month) return;
    // Es otra planilla: los datos y filtros anteriores ya no aplican.
    hasDataRef.current = false;
    setRows([]);
    clearFilters();
    reload(false);
  }, [year, month, reload, clearFilters]);

  // --- Equipo de usuarios no depende de la planilla, sólo del usuario -----
  // La sincronización con Sheets arranca en el montaje con el usuario
  // logueado. No depende del período: se hace una vez por sesión de usuario.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- primera corrida al montar
  useEffect(() => {
    if (!user) return;
    syncTeamUsers(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- corre sólo al montar / al cambiar user
  }, [user]);


  // --- Escritura de celdas (compartida) ----------------------------------
  function markRowSaving(rowNum) {
    setSavingRows((prev) => (prev.includes(rowNum) ? prev : [...prev, rowNum]));
  }

  function markRowSaved(rowNum) {
    setSavingRows((prev) => prev.filter((r) => r !== rowNum));
    setSavedRows((prev) => (prev.includes(rowNum) ? prev : [...prev, rowNum]));
    clearTimeout(savedTimers.current.get(rowNum));
    savedTimers.current.set(
      rowNum,
      setTimeout(() => {
        setSavedRows((prev) => prev.filter((r) => r !== rowNum));
        savedTimers.current.delete(rowNum);
      }, 1000)
    );
  }

  // Actualización optimista del state compartido (sin tocar el backend).
  const applyLocalUpdates = useCallback((rowNum, updates) => {
    setRows((prev) =>
      prev.map((r) => (r._row === rowNum ? { ...r, ...updates } : r))
    );
  }, []);

  // Actualización optimista masiva: Map<rowNum, updates>.
  const applyBulkUpdates = useCallback((updatesByRow) => {
    setRows((prev) =>
      prev.map((r) =>
        updatesByRow.has(r._row) ? { ...r, ...updatesByRow.get(r._row) } : r
      )
    );
  }, []);

  // Encola una sola celda en la cola de guardado (sin actualizar el state).
  const queueCellUpdate = useCallback(
    ({ row, column, value }) =>
      api.updateCell({ year, sheet: month, row, column, value }),
    [year, month]
  );

  const flushPendingSaves = useCallback(() => api.flushPendingSaves(), []);

  // Guarda varias columnas de una fila. Siempre pinta el cambio al instante
  // en el estado compartido (se ve en todas las pantallas); la diferencia
  // está en cómo se comporta mientras el backend responde:
  //
  //  - normal: marca la fila "guardando" (spinner) y revierte si falla. Lo
  //    usan los formularios, donde esperar el guardado es parte del flujo.
  //  - background: no marca la fila como "guardando" ni bloquea la UI; sigue
  //    plenamente usable (toggles rápidos del panel, detalle del cliente,
  //    asignar clientes). Cuando el lote se confirma SÍ la marca como
  //    guardada: sin spinner de por medio, el ✓ es la única señal de que el
  //    cambio llegó a la planilla. Si el guardado falla, revierte la celda
  //    SÓLO si todavía conserva el valor que falló (así no pisa una
  //    corrección hecha entre medio) y avisa lanzando el error para que la
  //    pantalla lo muestre.
  const runRowSave = useCallback(
    async (rowNum, updates, { background = false } = {}) => {
      const target = rowsRef.current.find((r) => r._row === rowNum);
      const prevValues = {};
      if (target) {
        Object.keys(updates).forEach((col) => {
          prevValues[col] = target[col];
        });
      }

      applyLocalUpdates(rowNum, updates);
      if (!background) markRowSaving(rowNum);

      try {
        await Promise.all(
          Object.entries(updates).map(([column, value]) =>
            api.updateCell({ year, sheet: month, row: rowNum, column, value })
          )
        );
        // Confirmación visible en los DOS modos: en background no hay
        // spinner, así que el ✓ es lo único que le dice al usuario que el
        // lote llegó a la planilla.
        markRowSaved(rowNum);
      } catch (err) {
        setRows((prev) =>
          prev.map((r) => {
            if (r._row !== rowNum) return r;
            let next = null;
            Object.entries(prevValues).forEach(([col, prevVal]) => {
              if (r[col] === updates[col]) {
                if (!next) next = { ...r };
                next[col] = prevVal;
              }
            });
            return next || r;
          })
        );
        setSavingRows((prev) => prev.filter((r) => r !== rowNum));
        throw err;
      }
    },
    [applyLocalUpdates, year, month]
  );

  const saveRowUpdates = useCallback(
    (rowNum, updates) => runRowSave(rowNum, updates),
    [runRowSave]
  );

  // Variante sin bloqueo para acciones rápidas: pinta al toque, escribe en
  // segundo plano y revierte sólo si falla.
  const saveRowUpdatesInBackground = useCallback(
    (rowNum, updates) => runRowSave(rowNum, updates, { background: true }),
    [runRowSave]
  );

  // Atajo para la columna "Encargado" (lo que usa Asignar clientes y el
  // desplegable del detalle). Va en modo fondo: la fila se pinta al toque,
  // sin spinner, y el ✓ aparece cuando el lote se confirma. Se conserva el
  // chequeo de permisos por rol.
  const setEncargado = useCallback(
    (rowNum, value) => {
      if (!canAssignClients) {
        return Promise.reject(new Error('Tu rol no permite cambiar el Encargado'));
      }
      if (!encargadoCol) return Promise.resolve();
      return saveRowUpdatesInBackground(rowNum, { [encargadoCol]: value });
    },
    [canAssignClients, encargadoCol, saveRowUpdatesInBackground]
  );

  // Sub-contexto 1: Metadatos, equipo, columnas detectadas y acciones estables.
  // No depende de `rows`, de los filtros ni de `savingRows`/`savedRows`:
  // componentes como `PeriodScreens` o `ClientDetail` consumen este sub-contexto
  // y NO se re-renderizan cuando se edita una fila, se escribe en el buscador
  // o se confirma un lote de guardado.
  const metaValue = useMemo(
    () => ({
      user,
      userRole,
      canAssignClients,
      year,
      month,
      headers,
      reload,
      teamUsers,
      participants,
      repartoUsers,
      toggleParticipant,
      swapTeamMembers,
      syncingUsers,
      syncTeamUsers,
      suggestRoundRobin,
      nameKey,
      vencimientoKey,
      rucKey,
      encargadoCol,
      presentadoCol,
      archivadoCol,
      presentadoPorCol,
      archivadoPorCol,
      statusHeaders,
      primaryStatusHeader,
      getVencimientoDay,
      isRowPresentado,
      setQuery,
      setSelectedVencimiento,
      setSelectedStatus,
      setSelectedAssignee,
      setSortBy,
      clearFilters,
      applyLocalUpdates,
      applyBulkUpdates,
      saveRowUpdates,
      saveRowUpdatesInBackground,
      setEncargado,
      queueCellUpdate,
      flushPendingSaves,
    }),
    [
      user,
      userRole,
      canAssignClients,
      year,
      month,
      headers,
      reload,
      teamUsers,
      participants,
      repartoUsers,
      toggleParticipant,
      swapTeamMembers,
      syncingUsers,
      syncTeamUsers,
      suggestRoundRobin,
      nameKey,
      vencimientoKey,
      rucKey,
      encargadoCol,
      presentadoCol,
      archivadoCol,
      presentadoPorCol,
      archivadoPorCol,
      statusHeaders,
      primaryStatusHeader,
      getVencimientoDay,
      isRowPresentado,
      clearFilters,
      applyLocalUpdates,
      applyBulkUpdates,
      saveRowUpdates,
      saveRowUpdatesInBackground,
      setEncargado,
      queueCellUpdate,
      flushPendingSaves,
    ]
  );

  // Sub-contexto 2: Filas y estado de carga del período.
  const dataValue = useMemo(
    () => ({
      rows,
      assignedRows,
      loading,
      refreshing,
      error,
      availableVencimientos,
      unassignedCount,
    }),
    [
      rows,
      assignedRows,
      loading,
      refreshing,
      error,
      availableVencimientos,
      unassignedCount,
    ]
  );

  // Sub-contexto 3: Filtros compartidos y funciones de filtrado.
  const filtersValue = useMemo(
    () => ({
      query,
      setQuery,
      selectedVencimiento,
      setSelectedVencimiento,
      selectedStatus,
      setSelectedStatus,
      selectedAssignee,
      setSelectedAssignee,
      sortBy,
      setSortBy,
      applySharedFilters,
      getSearchScore,
      matchesAssignee,
      activeFilterCount,
      hasActiveFilters,
      clearFilters,
    }),
    [
      query,
      selectedVencimiento,
      selectedStatus,
      selectedAssignee,
      sortBy,
      applySharedFilters,
      getSearchScore,
      matchesAssignee,
      activeFilterCount,
      hasActiveFilters,
      clearFilters,
    ]
  );

  // Sub-contexto 4: Estado transitorio de guardado por fila (spinner / ✓).
  const saveStateValue = useMemo(
    () => ({
      savingRows,
      savedRows,
      savingRowSet,
      savedRowSet,
    }),
    [savingRows, savedRows, savingRowSet, savedRowSet]
  );

  const value = useMemo(
    () => ({
      ...metaValue,
      ...dataValue,
      ...filtersValue,
      ...saveStateValue,
    }),
    [metaValue, dataValue, filtersValue, saveStateValue]
  );

  return (
    <ClientsMetaContext.Provider value={metaValue}>
      <ClientsDataContext.Provider value={dataValue}>
        <ClientsFiltersContext.Provider value={filtersValue}>
          <ClientsSaveStateContext.Provider value={saveStateValue}>
            <ClientsContext.Provider value={value}>{children}</ClientsContext.Provider>
          </ClientsSaveStateContext.Provider>
        </ClientsFiltersContext.Provider>
      </ClientsDataContext.Provider>
    </ClientsMetaContext.Provider>
  );
}

// Hook de acceso al sub-contexto de metadatos, columnas, equipo y acciones
// estables (no se invalida cuando cambian `rows`, filtros o `savedRows`).
// oxlint-disable-next-line react/only-export-components -- archivo de contexto: conviven Provider y hooks
export function useClientsMeta() {
  const ctx = useContext(ClientsMetaContext);
  if (!ctx) {
    throw new Error('useClientsMeta() debe usarse dentro de <ClientsProvider>');
  }
  return ctx;
}

// Alias semántico para pantallas que sólo disparan acciones (ej. `reload`).
// oxlint-disable-next-line react/only-export-components -- archivo de contexto: conviven Provider y hooks
export function useClientsActions() {
  return useClientsMeta();
}

// Hook de acceso sólo a las filas y estado de carga del período.
// oxlint-disable-next-line react/only-export-components -- archivo de contexto: conviven Provider y hooks
export function useClientsData() {
  const ctx = useContext(ClientsDataContext);
  if (!ctx) {
    throw new Error('useClientsData() debe usarse dentro de <ClientsProvider>');
  }
  return ctx;
}

// Hook de acceso sólo a los filtros compartidos.
// oxlint-disable-next-line react/only-export-components -- archivo de contexto: conviven Provider y hooks
export function useClientsFilters() {
  const ctx = useContext(ClientsFiltersContext);
  if (!ctx) {
    throw new Error('useClientsFilters() debe usarse dentro de <ClientsProvider>');
  }
  return ctx;
}

// Hook de acceso sólo a los indicadores de guardado por fila.
// oxlint-disable-next-line react/only-export-components -- archivo de contexto: conviven Provider y hooks
export function useClientsSaveState() {
  const ctx = useContext(ClientsSaveStateContext);
  if (!ctx) {
    throw new Error('useClientsSaveState() debe usarse dentro de <ClientsProvider>');
  }
  return ctx;
}

// Hook de acceso al contexto compartido completo de la planilla.
// oxlint-disable-next-line react/only-export-components -- archivo de contexto: convive el Provider (componente) con useClients (hook)
export function useClients() {
  const ctx = useContext(ClientsContext);
  if (!ctx) {
    throw new Error('useClients() debe usarse dentro de <ClientsProvider>');
  }
  return ctx;
}
