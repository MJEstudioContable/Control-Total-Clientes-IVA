import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useClients } from '../context/ClientsContext';
import { formatPeriodLabel } from '../utils';
import VencimientoPill from '../components/VencimientoPill';
import {
  ArrowLeft,
  ChevronDown,
  Search,
  Loader2,
  AlertCircle,
  UserCog,
  Check,
  CheckCircle2,
  Calendar,
  Shuffle,
  XCircle,
  Undo2,
  UserX,
  UserCheck,
} from 'lucide-react';

// Fila de la lista. Es un div memoizado sin animación: con 300 clientes,
// una motion.div por fila con stagger y un <select> completo con todo el
// equipo adentro eran la causa principal de lag en esta pantalla. El
// <select> se monta SÓLO en la fila que se está editando; el resto muestra
// el nombre del encargado como texto y un botón que abre el desplegable.
const AssignRow = memo(function AssignRow({
  row,
  name,
  currentEncargado,
  activeAssignee,
  justSaved,
  editing,
  disabled,
  teamUsers,
  roundRobinParticipants,
  nonParticipants,
  onRowClick,
  onStartEdit,
  onStopEdit,
  onAssign,
}) {
  const isAssignedToActive =
    activeAssignee && activeAssignee !== '__unassign__' && currentEncargado === activeAssignee;
  const isUnassigned = !currentEncargado;

  let rowTitle = undefined;
  if (activeAssignee === '__unassign__') {
    rowTitle = currentEncargado ? 'Tocá para desasignar' : 'Sin asignar';
  } else if (activeAssignee) {
    rowTitle = isAssignedToActive
      ? `Asignado a ${activeAssignee} (tocá para despintar / desasignar)`
      : `Tocá para asignar a ${activeAssignee}`;
  }

  const selectRef = useRef(null);
  // Abrir el desplegable EN EL MISMO TOQUE: el <select> se monta al tocar el
  // botón y showPicker() despliega la lista nativa dentro del mismo gesto
  // (por eso useLayoutEffect y no useEffect: corre en el mismo task del
  // click, cuando el navegador todavía considera el gesto válido). Si el
  // navegador no soporta showPicker, queda enfocado y el segundo toque abre
  // el desplegable, como antes -- sin romper nada.
  useLayoutEffect(() => {
    if (!editing || !selectRef.current) return;
    const select = selectRef.current;
    select.focus();
    try {
      select.showPicker?.();
    } catch {
      // Sin soporte o sin gesto válido: el desplegable no se abre solo.
    }
  }, [editing]);

  return (
    <div
      className={`assign-row ${activeAssignee ? 'assign-row-quick' : ''} ${
        isAssignedToActive ? 'assign-row-matched' : ''
      }`}
      onClick={() => onRowClick(row)}
      title={rowTitle}
    >
      <span className="assign-row-name">{name || 'Sin nombre'}</span>

      <div className="assign-row-control">
        {justSaved && <Check size={15} style={{ color: 'var(--success)' }} />}
        {isAssignedToActive && !justSaved && (
          <CheckCircle2 size={16} style={{ color: '#16a34a' }} />
        )}
        {editing ? (
          /* Encargado editable cliente por cliente. Acá SÍ se puede elegir a
             cualquiera del equipo, participe o no del reparto automático: la
             lista de participantes acota sólo la distribución automática,
             nunca la manual. */
          <select
            ref={selectRef}
            className={`sort-select assign-row-select ${isUnassigned ? 'is-empty' : ''}`}
            value={currentEncargado}
            disabled={disabled}
            // El click no debe llegar al onClick de la fila (que asigna al
            // encargado "activo"); si no, tocar el desplegable también
            // pintaría el cliente.
            onClick={(e) => e.stopPropagation()}
            onBlur={onStopEdit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onStopEdit();
            }}
            onChange={(e) => {
              e.stopPropagation();
              onAssign(row, e.target.value || '__unassign__');
              onStopEdit();
            }}
          >
            <option value="">Sin asignar</option>
            {/* Si la planilla tiene un nombre que ya no está en el equipo
                sincronizado, se muestra igual en vez de blanquearlo. */}
            {currentEncargado && !teamUsers.includes(currentEncargado) && (
              <option value={currentEncargado}>{currentEncargado} (fuera del equipo)</option>
            )}
            {roundRobinParticipants.length > 0 && (
              <optgroup label="Participan del reparto">
                {roundRobinParticipants.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </optgroup>
            )}
            {nonParticipants.length > 0 && (
              <optgroup label="No participan (asignación manual)">
                {nonParticipants.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        ) : (
          <button
            type="button"
            className={`sort-select assign-row-select assign-row-encargado ${
              isUnassigned ? 'is-empty' : ''
            }`}
            disabled={disabled}
            title={
              currentEncargado
                ? `Encargado: ${currentEncargado} (tocá para cambiarlo)`
                : 'Sin asignar: tocá para elegir un encargado'
            }
            onClick={(e) => {
              e.stopPropagation();
              onStartEdit(row._row);
            }}
          >
            <span className="assign-row-encargado-label">
              {currentEncargado || 'Sin asignar'}
            </span>
            <ChevronDown size={13} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
});

export default function AssignClients({ onBack }) {
  // Todo el estado de la planilla (datos, equipo, filtros y guardado) viene
  // del contexto compartido con ClientList: lo que se cambia acá se ve allá
  // al instante, y viceversa, porque es literalmente el mismo estado.
  const {
    user,
    year,
    month,
    rows,
    assignedRows,
    suggestRoundRobin,
    loading,
    error,
    teamUsers,
    repartoUsers,
    toggleParticipant,
    swapTeamMembers,
    nameKey,
    encargadoCol,
    vencimientoKey,
    availableVencimientos,
    getVencimientoDay,
    unassignedCount,
    primaryStatusHeader,
    // filtros compartidos
    query,
    setQuery,
    selectedVencimiento,
    setSelectedVencimiento,
    selectedStatus,
    setSelectedStatus,
    selectedAssignee,
    setSelectedAssignee,
    sortBy,
    applySharedFilters,
    clearFilters,
    hasActiveFilters,
    // escritura compartida
    savedRowSet,
    getSearchScore,
    setEncargado,
    queueCellUpdate,
    flushPendingSaves,
    applyBulkUpdates,
  } = useClients();

  const [undoing, setUndoing] = useState(false);
  // Historial de cambios para permitir revertir (local a esta pantalla: es
  // una comodidad de edición, no un dato de la planilla)
  const [history, setHistory] = useState([]); // Array<{ rowNum, prevUser, newUser, clientName }>

  // Modo asignación rápida / toque: elegís un usuario activo o "desasignar"
  // y vas tocando clientes para asignar o desasignar al instante sin selectores
  const [activeAssignee, setActiveAssignee] = useState(null); // string (user) | '__unassign__' | null
  // Fila cuyo <select> de encargado está abierto (una sola a la vez).
  const [editingRow, setEditingRow] = useState(null);
  const startEditRow = useCallback((rowNum) => setEditingRow(rowNum), []);
  const stopEditRow = useCallback(() => setEditingRow(null), []);

  // --- Orden del reparto: se cambia ARRASTRANDO los nombres ---
  //
  // Sin grip y sin drag-and-drop nativo del navegador (que en touch
  // directamente no funciona). Son pointer events con un umbral de
  // movimiento, así las dos cosas conviven en el mismo pill:
  //   - toque corto  -> activa el modo "asignar a esta persona" (como antes)
  //   - arrastre     -> mueve ese nombre a otra posición del reparto
  //
  // Para que NO se trabe nada: el pointer capture se toma recién cuando el
  // arrastre ya empezó (no en el pointerdown), los pills siguen dejando
  // pasar el scroll vertical de la página (touch-action: pan-y en el CSS) y
  // el reordenamiento es local e instantáneo, sin red de por medio.
  const pillRefs = useRef(new Map());
  const dragState = useRef(null); // { user, startX, startY, pointerId, active }
  const suppressClick = useRef(false);
  const ghostRef = useRef(null); // clon flotante que sigue al dedo/mouse
  const [draggingUser, setDraggingUser] = useState(null);
  // Nombre que está debajo del puntero mientras se arrastra. OJO: es solo una
  // marca visual, el intercambio NO se hace acá (ver endPillDrag).
  const [dropTarget, setDropTarget] = useState(null);
  // Modo "quiénes participan del reparto": se ve a TODO el equipo y se toca
  // para incluir o sacar. Fuera de este modo solo se muestran los que
  // participan, que son los que se ordenan y los que reciben clientes.
  const [participantsMode, setParticipantsMode] = useState(false);

  // El clon se mueve tocando el DOM directo (no con state): si se moviera por
  // state, cada pixel del gesto dispararía un re-render de React y ahí sí se
  // sentiría trabado.
  function positionGhost(x, y) {
    const el = ghostRef.current;
    if (!el) return;
    // translate3d para que lo anime la GPU; el segundo translate lo centra
    // sobre el puntero y lo corre un poco hacia arriba, así el dedo no lo tapa.
    el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -160%)`;
  }

  function hideGhost() {
    const el = ghostRef.current;
    if (el) el.style.opacity = '0';
  }

  function handlePillPointerDown(e, u) {
    if (e.pointerType === 'mouse' && e.button !== 0) return; // solo botón izquierdo
    // Un press nuevo siempre arranca limpio: si el arrastre anterior terminó
    // en pointercancel (nunca llegó su click), el flag no queda pegado.
    suppressClick.current = false;
    dragState.current = { user: u, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId, active: false };
  }

  function handlePillPointerMove(e) {
    const st = dragState.current;
    if (!st) return;

    if (!st.active) {
      // Umbral: menos de 6px de recorrido sigue siendo un toque, no un arrastre.
      if (Math.abs(e.clientX - st.startX) < 6 && Math.abs(e.clientY - st.startY) < 6) return;
      st.active = true;
      setDraggingUser(st.user);
      // Recién acá se captura el puntero: si se tomara en el pointerdown, un
      // simple intento de scrollear apoyando el dedo sobre un pill quedaría
      // atrapado -- eso es lo que "trababa" antes.
      try {
        e.currentTarget.setPointerCapture?.(st.pointerId);
      } catch {
        // si el navegador no lo soporta, el arrastre igual sigue funcionando
      }
      setDropTarget(null);
      const ghost = ghostRef.current;
      if (ghost) ghost.style.opacity = '1';
      positionGhost(e.clientX, e.clientY);
    }

    positionGhost(e.clientX, e.clientY);

    // ¿Sobre qué otro nombre está el puntero? Se MARCA, no se intercambia.
    // Si se intercambiara acá, arrastrar D hasta A iría swappeando con cada
    // nombre que se cruza en el camino (D-C, D-B, D-A) y terminaría en
    // "D A B C" en vez del "D B C A" que uno espera al soltarlo encima de A.
    let hovered = null;
    pillRefs.current.forEach((el, other) => {
      if (!el || other === st.user) return;
      const r = el.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        hovered = other;
      }
    });
    st.target = hovered;
    // setState solo cuando cambia de verdad: si no, re-renderiza en cada pixel.
    setDropTarget((curr) => (curr === hovered ? curr : hovered));
  }

  function endPillDrag(e) {
    const st = dragState.current;
    dragState.current = null;
    if (!st || !st.active) return;
    try {
      e.currentTarget.releasePointerCapture?.(st.pointerId);
    } catch {
      // el capture ya se había liberado solo
    }
    setDraggingUser(null);
    hideGhost();

    // Acá sí: UN intercambio directo entre el que se arrastró y el nombre que
    // quedó debajo. Los demás no se mueven.
    //   A B C D  --arrastro D hasta A-->  D B C A
    if (st.target && st.target !== st.user) {
      swapTeamMembers(st.user, st.target);
    }
    setDropTarget(null);
    // El click que el navegador dispara al soltar no debe activar el modo
    // asignar: veníamos arrastrando, no tocando. Lo consume el propio click
    // (sin timers: el orden entre un setTimeout y el click no está garantizado).
    suppressClick.current = true;
  }

  function handleTeamPillClick(u) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    setActiveAssignee((curr) => (curr === u ? null : u));
  }

  // Confirmación del reparto automático (round-robin)
  const [confirmingRoundRobin, setConfirmingRoundRobin] = useState(false);
  const [roundRobinScope, setRoundRobinScope] = useState('sin_asignar'); // 'sin_asignar' | 'todos'
  const [runningRoundRobin, setRunningRoundRobin] = useState(false);
  const [roundRobinProgress, setRoundRobinProgress] = useState(null); // { done, total }
  const [actionError, setActionError] = useState('');

  // El reparto automático usa SOLO a los participantes definidos, en el
  // orden que se les dio arrastrando. Si todavía no se definió nadie,
  // participan todos (repartoUsers ya resuelve eso).
  const roundRobinParticipants = repartoUsers;

  // Los que están en el equipo pero NO entran al reparto automático. No
  // pueden recibir clientes del round-robin, pero SÍ se les puede asignar
  // a mano cliente por cliente: la lista de participantes acota sólo la
  // distribución automática, nunca la asignación manual.
  const nonParticipants = useMemo(
    () => teamUsers.filter((u) => !repartoUsers.includes(u)),
    [teamUsers, repartoUsers]
  );

  // Un cliente está "protegido" del reparto automático cuando ya lo tiene
  // alguien que NO participa: se asignó a mano a propósito y no hay que
  // pisarlo. Se usa tanto para filtrar el reparto como para avisar en la
  // confirmación cuántos quedan afuera.
  const isProtectedRow = useCallback(
    (r) => {
      if (!encargadoCol) return false;
      const cur = String(r[encargadoCol] || '').trim();
      return !!cur && !roundRobinParticipants.includes(cur);
    },
    [encargadoCol, roundRobinParticipants]
  );

  const filteredRows = useMemo(() => {
    // Mismo criterio de filtrado que la lista principal (contexto
    // compartido): búsqueda + vencimiento + estado + encargado.
    const list = applySharedFilters(assignedRows);

    // La búsqueda prioriza Nombre/Razón social y luego RUC. Sin búsqueda,
    // respeta la opción de orden elegida en la lista de clientes.
    return list.sort((a, b) => {
      if (query.trim()) {
        // Sale del índice ya armado en el contexto: nada se normaliza acá.
        const relevance = getSearchScore(b) - getSearchScore(a);
        if (relevance !== 0) return relevance;
      }

      if (sortBy === 'vencimiento' && vencimientoKey) {
        const numA = parseInt(getVencimientoDay(a), 10);
        const numB = parseInt(getVencimientoDay(b), 10);
        const na = isNaN(numA) ? 999 : numA;
        const nb = isNaN(numB) ? 999 : numB;
        if (na !== nb) return na - nb;
      }
      return String(a[nameKey] || '').localeCompare(String(b[nameKey] || ''), 'es', {
        numeric: true,
        sensitivity: 'base',
      });
    });
  }, [applySharedFilters, assignedRows, sortBy, vencimientoKey, getVencimientoDay, nameKey, query, getSearchScore]);

  // Vista agrupada por vencimiento: se arma solo cuando tiene sentido
  // verla (viendo "Todos los vencimientos", sin buscar nada puntual) y
  // hay más de un grupo -- así se puede ver el ciclo del round-robin tal
  // cual lo aplica el algoritmo (ordenado por fila de la hoja, NO
  // alfabético, porque el reparto cíclico se basa en ese orden).
  const groupedByVencimiento = useMemo(() => {
    if (!vencimientoKey || selectedVencimiento !== 'todos' || query.trim()) return null;

    const groups = new Map();
    filteredRows.forEach((row) => {
      const day = getVencimientoDay(row);
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(row);
    });

    if (groups.size <= 1) return null;

    const dayOrder = [...availableVencimientos, 'Sin vencimiento'];
    return dayOrder
      .filter((day) => groups.has(day))
      .map((day) => ({
        day,
        // Orden por fila de la hoja (no alfabético): es el mismo criterio
        // que usa assignClientsSequentially para el ciclo, así lo que se
        // ve acá coincide con cómo se reparte de verdad.
        rows: [...groups.get(day)].sort((a, b) => (a._row || 0) - (b._row || 0)),
      }));
  }, [filteredRows, vencimientoKey, selectedVencimiento, query, availableVencimientos, getVencimientoDay]);

  // Mismo conteo pero solo dentro de lo que está filtrado ahora (ej: si
  // filtraste "Día 7", cuenta sin asignar de ese día nomás) -- así el
  // número que se ve en el botón de reparto coincide con lo que en
  // realidad se va a repartir.
  const filteredUnassignedCount = useMemo(
    () => filteredRows.filter((r) => !String(r[encargadoCol] || '').trim()).length,
    [filteredRows, encargadoCol]
  );

  // Cuántos clientes del alcance actual quedarían intactos por estar ya
  // asignados a alguien que no participa. Se muestra en la confirmación para
  // que "Reasignar todos" no sorprenda: no son todos los de la lista.
  const protectedCount = useMemo(
    () => filteredRows.filter(isProtectedRow).length,
    [filteredRows, isProtectedRow]
  );

  // Callbacks estables (useCallback) para que AssignRow, que está memoizado,
  // no se vuelva a dibujar en cada render del padre.
  const assignRow = useCallback(
    async (row, targetUser) => {
      if (!encargadoCol) return;
      const valueToSave = targetUser === '__unassign__' ? '' : targetUser;
      const prevValue = row[encargadoCol] || '';
      if (prevValue === valueToSave) return; // ya tiene ese valor

      setHistory((prev) => [
        {
          rowNum: row._row,
          prevUser: prevValue,
          newUser: valueToSave,
          clientName: row[nameKey] || 'Cliente',
        },
        ...prev.slice(0, 30), // guardar hasta 30 acciones en historial
      ]);

      try {
        // setEncargado pinta el cambio al instante en el estado compartido
        // (se ve también en la lista de clientes), escribe en segundo plano
        // y revierte si falla. La promesa se resuelve cuando el lote se
        // confirma: ahí aparece el ✓ verde de la fila.
        await setEncargado(row._row, valueToSave);
      } catch (err) {
        setHistory((prev) => prev.filter((h) => h.rowNum !== row._row || h.newUser !== valueToSave));
        setActionError(err.message || 'No se pudo guardar la asignación');
      }
    },
    [encargadoCol, nameKey, setEncargado]
  );

  const handleRowClick = useCallback(
    (row) => {
      if (!activeAssignee || !encargadoCol) return;
      const currentVal = row[encargadoCol] || '';
      if (activeAssignee === '__unassign__') {
        if (currentVal) {
          assignRow(row, '__unassign__');
        }
      } else {
        // Toggle: si ya estaba asignado a este usuario, al volver a tocarlo se despinta y desasigna
        if (currentVal === activeAssignee) {
          assignRow(row, '__unassign__');
        } else {
          assignRow(row, activeAssignee);
        }
      }
    },
    [activeAssignee, encargadoCol, assignRow]
  );

  async function undoLastAction() {
    if (!history.length || undoing || !encargadoCol) return;
    const lastAction = history[0];
    setUndoing(true);
    try {
      await setEncargado(lastAction.rowNum, lastAction.prevUser);
      setHistory((prev) => prev.slice(1));
    } catch (err) {
      setActionError(err.message || 'No se pudo revertir el cambio');
    } finally {
      setUndoing(false);
    }
  }

  async function runRoundRobin() {
    if (!encargadoCol || !roundRobinParticipants.length) return;
    setRunningRoundRobin(true);
    setActionError('');
    try {
      // El scope parte de lo que ya está filtrado en pantalla (respeta los
      // filtros compartidos: vencimiento, búsqueda, estado...) y encima se
      // aplica "solo sin asignar" o "todos" según lo elegido.
      const baseScope = filteredRows;
      // Con alcance "todos" NO se pisa lo que ya está asignado a alguien que
      // no participa del reparto: eso fue una decisión manual (ej. "este
      // cliente no lo puede hacer el que lo recibió, dáselo a otro de afuera")
      // y el automático la respeta. Los vacíos y los que ya tiene un
      // participante sí se reparten.
      const targets =
        roundRobinScope === 'todos'
          ? baseScope.filter((r) => !isProtectedRow(r))
          : baseScope.filter((r) => !String(r[encargadoCol] || '').trim());
      const suggestions = suggestRoundRobin(targets);
      const total = suggestions.length;
      setRoundRobinProgress({ done: 0, total });

      // Se manda en lotes chicos y SECUENCIALES (no todos de una) por dos
      // motivos: 1) un solo request gigante contra Apps Script puede
      // tardar muchísimo y se sentía "colgado" aunque en realidad seguía
      // trabajando; 2) así se puede mostrar progreso real ("120/395") en
      // vez de un spinner opaco sin información.
      const CHUNK_SIZE = 25;
      for (let i = 0; i < suggestions.length; i += CHUNK_SIZE) {
        const chunk = suggestions.slice(i, i + CHUNK_SIZE);

        await Promise.all(
          chunk.map((row) =>
            queueCellUpdate({
              row: row._row,
              column: encargadoCol,
              value: row._assignedUser,
            })
          )
        );
        // Fuerza a que ESTE lote salga ya (no espera a mezclarse con el
        // siguiente), así el progreso que se muestra es real, no
        // optimista solamente.
        await flushPendingSaves();

        const chunkUpdates = new Map(
          chunk.map((r) => [r._row, { [encargadoCol]: r._assignedUser }])
        );
        applyBulkUpdates(chunkUpdates);
        setRoundRobinProgress({ done: Math.min(i + CHUNK_SIZE, total), total });
      }

      setConfirmingRoundRobin(false);
    } catch (err) {
      setActionError(err.message || 'No se pudo repartir automáticamente');
    } finally {
      setRunningRoundRobin(false);
      setRoundRobinProgress(null);
    }
  }

  const assigneeLabel = (value) => {
    if (value === 'todos') return 'Todos';
    if (value === 'sin_asignar') return `Sin asignar (${unassignedCount})`;
    if (value === 'mis') return 'Mis clientes';
    return value;
  };

  return (
    <div className="screen wide real-exec-assign">
      <div className="screen-header">
        <motion.button
          className="back-btn"
          whileHover={{ scale: 1.04, x: -2 }}
          whileTap={{ scale: 0.95 }}
          onClick={onBack}
        >
          <ArrowLeft size={16} />
          <span>Volver</span>
        </motion.button>

        <div className="save-all-notice">
          <UserCog size={14} />
          <span>Asignar clientes · {formatPeriodLabel(month, year)}</span>
        </div>
      </div>

      {loading && (
        <div className="empty-state">
          <Loader2 size={28} className="animate-spin" />
          <p>Cargando clientes...</p>
        </div>
      )}

      {!loading && error && (
        <div className="empty-state">
          <AlertCircle size={28} style={{ color: 'var(--danger)' }} />
          <p>{error}</p>
        </div>
      )}

      {!loading && !error && !encargadoCol && (
        <div className="empty-state">
          <AlertCircle size={28} style={{ color: 'var(--danger)' }} />
          <p>
            Esta planilla todavía no tiene una columna <strong>"Encargado"</strong>.
            <br />
            Agregala en la hoja de {formatPeriodLabel(month, year)} para poder asignar clientes acá.
          </p>
        </div>
      )}

      {!loading && !error && encargadoCol && (
        <>
          <div className="assign-controls">
          {/* Toolbar: búsqueda + acciones masivas */}
          <div className="search-wrapper">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              className="search-input"
              placeholder="Buscar cliente..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="assign-toolbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <motion.button
                className="filter-pill"
                whileTap={{ scale: 0.96 }}
                onClick={() => setConfirmingRoundRobin(true)}
                disabled={!repartoUsers.length}
              >
                <Shuffle size={13} /> Repartir automático
              </motion.button>

              {history.length > 0 && (
                <motion.button
                  className="filter-pill"
                  whileTap={{ scale: 0.96 }}
                  onClick={undoLastAction}
                  disabled={undoing}
                  style={{ color: 'var(--primary)', borderColor: 'var(--primary-border)' }}
                  title="Revertir la última asignación"
                >
                  <Undo2 size={13} /> Revertir ({history.length})
                </motion.button>
              )}

              {hasActiveFilters && (
                <motion.button
                  className="filter-pill"
                  whileTap={{ scale: 0.96 }}
                  onClick={clearFilters}
                  title="Limpiar los filtros (compartidos con la lista de clientes)"
                >
                  <XCircle size={13} /> Limpiar filtros
                </motion.button>
              )}
            </div>
          </div>

          {actionError && (
            <div className="error-banner" style={{ marginTop: '8px' }}>
              <AlertCircle size={18} style={{ flexShrink: 0 }} />
              <div style={{ fontSize: 'calc(13px * var(--ui-font-scale, 1))' }}>{actionError}</div>
            </div>
          )}

          {/* Panel único: la misma lista de gente sirve para (a) elegir a
              quién le asignás clientes tocándolos y (b) ordenar el reparto
              automático arrastrando los nombres. El número de cada pill es
              su posición en ese reparto. */}
          <div className="assign-confirm-box">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '6px' }}>
              <div>
                <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-main)' }}>
                  {activeAssignee === '__unassign__' ? (
                    <>Tocá cualquier cliente para <span style={{ color: 'var(--danger)' }}>desasignarlo</span></>
                  ) : activeAssignee ? (
                    <>Asignando a: <strong style={{ color: 'var(--primary)' }}>{activeAssignee}</strong> (tocá para asignar; si ya está pintado, tocalo para despintar)</>
                  ) : participantsMode ? (
                    <>
                      Tocá los nombres que <strong>participan</strong> del reparto automático.
                      Los que quedan afuera no reciben clientes y no se muestran.
                    </>
                  ) : (
                    'Tocá un nombre para asignar clientes tocándolos. Arrastralo para cambiar el orden del reparto (el número es su posición).'
                  )}
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={`reorder-mode-btn ${participantsMode ? 'active' : ''}`}
                  onClick={() => {
                    setParticipantsMode((curr) => !curr);
                    setActiveAssignee(null);
                  }}
                  title="Elegir quiénes entran al reparto automático"
                >
                  {participantsMode ? (
                    'Listo'
                  ) : (
                    <>
                      Participantes
                      <span className="mode-count">{`(${repartoUsers.length} de ${teamUsers.length})`}</span>
                    </>
                  )}
                </button>
                {activeAssignee && (
                <button
                  type="button"
                  onClick={() => setActiveAssignee(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-subtle)',
                    fontSize: 'calc(12px * var(--ui-font-scale, 1))',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  Modo solo lectura
                </button>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {(participantsMode ? teamUsers : repartoUsers).map((u, idx) => (
                <button
                  key={u}
                  type="button"
                  ref={(el) => {
                    if (el) pillRefs.current.set(u, el);
                    else pillRefs.current.delete(u);
                  }}
                  className={`filter-pill team-pill ${!participantsMode && activeAssignee === u ? 'active' : ''} ${
                    draggingUser === u ? 'drag-origin' : ''
                  } ${draggingUser && dropTarget === u ? 'swap-target' : ''} ${
                    participantsMode && !repartoUsers.includes(u) ? 'not-participant' : ''
                  }`}
                  // draggable=false: si no, el navegador arranca su propio
                  // drag nativo (fantasma de texto) y se pelea con el nuestro.
                  draggable="false"
                  onPointerDown={(e) => {
                    if (!participantsMode) handlePillPointerDown(e, u);
                  }}
                  onPointerMove={handlePillPointerMove}
                  onPointerUp={endPillDrag}
                  onPointerCancel={endPillDrag}
                  onClick={() => {
                    if (participantsMode) toggleParticipant(u);
                    else handleTeamPillClick(u);
                  }}
                  title={
                    participantsMode
                      ? repartoUsers.includes(u)
                        ? `${u} participa (posición ${repartoUsers.indexOf(u) + 1}) · Tocá para sacarlo`
                        : `${u} no participa · Tocá para incluirlo`
                      : `Posición ${idx + 1} en el reparto · Tocá para asignarle clientes · Arrastralo para cambiar el orden`
                  }
                >
                  {/* El número es la posición en el reparto; el guion marca al
                      que no participa. Texto puro, sin íconos. */}
                  <span className="pill-order-num">
                    {participantsMode && !repartoUsers.includes(u) ? '—' : participantsMode ? repartoUsers.indexOf(u) + 1 : idx + 1}
                  </span>
                  {u}
                </button>
              ))}

              <button
                className={`filter-pill ${activeAssignee === '__unassign__' ? 'active' : ''}`}
                onClick={() => setActiveAssignee((curr) => (curr === '__unassign__' ? null : '__unassign__'))}
                style={activeAssignee === '__unassign__' ? { backgroundColor: 'var(--danger)', color: 'white', borderColor: 'var(--danger)' } : {}}
                title="Tocar clientes para desasignar directamente"
              >
                <UserX size={13} /> Desasignar
              </button>
            </div>

            {/* Confirmación del reparto automático: se expande DENTRO del
                mismo panel, sin repetir la lista de gente de arriba. */}
            <AnimatePresence>
              {confirmingRoundRobin && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  style={{ overflow: 'hidden' }}
                >
                  <div style={{ borderTop: '1px solid var(--border-light)', marginTop: '12px', paddingTop: '12px' }}>
                    <p>
                      Repartir <strong>{filteredRows.length} clientes</strong>
                      {selectedVencimiento !== 'todos' ? <> del Día {selectedVencimiento}</> : null}
                      {' '}entre los <strong>{roundRobinParticipants.length}</strong> participantes,
                      agrupando por vencimiento.
                    </p>

                    <div className="filter-pills" style={{ margin: '10px 0' }}>
                      <button
                        className={`filter-pill ${roundRobinScope === 'sin_asignar' ? 'active' : ''}`}
                        onClick={() => setRoundRobinScope('sin_asignar')}
                      >
                        Solo sin asignar ({filteredUnassignedCount})
                      </button>
                      <button
                        className={`filter-pill ${roundRobinScope === 'todos' ? 'active' : ''}`}
                        onClick={() => setRoundRobinScope('todos')}
                        title={
                          protectedCount > 0
                            ? `${filteredRows.length} clientes en pantalla, pero ${protectedCount} están asignados a alguien que no participa y se respetan`
                            : 'Reasigna todos los clientes del alcance actual'
                        }
                      >
                        Reasignar todos ({filteredRows.length - protectedCount})
                      </button>
                    </div>
                    {roundRobinScope === 'todos' && protectedCount > 0 && (
                      <p
                        style={{
                          margin: '0 0 10px',
                          fontSize: 'calc(12px * var(--ui-font-scale, 1))',
                          color: 'var(--text-muted)',
                          borderLeft: '3px solid var(--warning)',
                          paddingLeft: '8px',
                        }}
                      >
                        {protectedCount} de esos clientes{' '}
                        <strong>no se van a tocar</strong>: los tiene alguien que no participa
                        del reparto (asignación manual). Si querés repartirlos igual, cambiale
                        el encargado primero.
                      </p>
                    )}
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <motion.button
                        type="button"
                        className="btn-primary"
                        whileTap={{ scale: 0.97 }}
                        onClick={runRoundRobin}
                        disabled={runningRoundRobin || !roundRobinParticipants.length}
                        style={{ padding: '8px 16px' }}
                      >
                        {runningRoundRobin ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                        <span>
                          {runningRoundRobin
                            ? roundRobinProgress
                              ? `Asignando ${roundRobinProgress.done}/${roundRobinProgress.total}...`
                              : 'Preparando...'
                            : !roundRobinParticipants.length
                            ? 'Marcá al menos un usuario con ✓'
                            : 'Confirmar reparto'}
                        </span>
                      </motion.button>
                      <button
                        type="button"
                        className="pill-btn"
                        onClick={() => setConfirmingRoundRobin(false)}
                        disabled={runningRoundRobin}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Filtros: Vencimiento + Encargado + Estado. Son el MISMO estado
              que usa la lista de clientes (contexto compartido): si
              filtrás "Día 7" acá, la lista también queda en Día 7. */}
          {vencimientoKey && availableVencimientos.length > 0 && (
            <div className="filter-row">
              <span className="filter-label">
                <Calendar size={14} /> Vencimiento:
              </span>
              <div className="filter-pills">
                <button
                  className={`filter-pill ${selectedVencimiento === 'todos' ? 'active' : ''}`}
                  onClick={() => setSelectedVencimiento('todos')}
                >
                  Todos
                </button>
                {availableVencimientos.map((day, idx) => (
                  <VencimientoPill
                    key={day}
                    day={day}
                    digit={idx}
                    active={selectedVencimiento === day}
                    activeClassName="active"
                    className="filter-pill"
                    onClick={() => setSelectedVencimiento(day)}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="filter-row">
            <span className="filter-label">
              <UserCog size={14} /> Encargado:
            </span>
            <div className="filter-pills">
              <button
                className={`filter-pill ${selectedAssignee === 'todos' ? 'active' : ''}`}
                onClick={() => setSelectedAssignee('todos')}
              >
                {assigneeLabel('todos')}
              </button>
              <button
                className={`filter-pill ${selectedAssignee === 'sin_asignar' ? 'active' : ''}`}
                onClick={() => setSelectedAssignee('sin_asignar')}
              >
                {assigneeLabel('sin_asignar')}
              </button>
              <button
                className={`filter-pill ${selectedAssignee === 'mis' ? 'active' : ''}`}
                onClick={() => setSelectedAssignee('mis')}
                title="Solo los clientes que te tocan a vos"
              >
                <UserCheck size={12} /> {assigneeLabel('mis')}
              </button>
              {/* El usuario logueado NO se repite acá: ya tiene el pill "Mis
                  clientes", que filtra exactamente por lo mismo (la columna
                  Encargado === user). Tener los dos era redundante. */}
              {teamUsers
                .filter((u) => u !== user)
                .map((u) => (
                  <button
                    key={u}
                    className={`filter-pill ${selectedAssignee === u ? 'active' : ''}`}
                    onClick={() => setSelectedAssignee(u)}
                  >
                    {u}
                  </button>
                ))}
            </div>
          </div>

          {primaryStatusHeader && (
            <div className="filter-row">
              <span className="filter-label">
                <CheckCircle2 size={14} /> Estado:
              </span>
              <div className="filter-pills">
                <button
                  className={`filter-pill ${selectedStatus === 'todos' ? 'active' : ''}`}
                  onClick={() => setSelectedStatus('todos')}
                >
                  Todos
                </button>
                <button
                  className={`filter-pill ${selectedStatus === 'presentado' ? 'active' : ''}`}
                  onClick={() => setSelectedStatus('presentado')}
                >
                  Presentados
                </button>
                <button
                  className={`filter-pill ${selectedStatus === 'pendiente' ? 'active' : ''}`}
                  onClick={() => setSelectedStatus('pendiente')}
                >
                  Pendientes
                </button>
              </div>
            </div>
          )}

          {/* Integrated Footer: Results Count */}
          <div className="filter-footer-row">
            <div className="filter-footer-left">
              <div className="stats-bar-count">
                <UserCog size={14} />
                <span>Mostrando</span>
                <span className="count-badge">{filteredRows.length} de {rows.length}</span>
              </div>
            </div>

            {groupedByVencimiento && (
              <div className="stats-bar-tags">
                <span>Agrupado por vencimiento, en orden de reparto</span>
              </div>
            )}
          </div>
          </div>

          {(() => {
            const renderRow = (row) => (
              <AssignRow
                key={row._row}
                row={row}
                name={row[nameKey]}
                currentEncargado={String(row[encargadoCol] || '').trim()}
                activeAssignee={activeAssignee}
                justSaved={savedRowSet.has(row._row)}
                editing={editingRow === row._row}
                disabled={!encargadoCol}
                teamUsers={teamUsers}
                roundRobinParticipants={roundRobinParticipants}
                nonParticipants={nonParticipants}
                onRowClick={handleRowClick}
                onStartEdit={startEditRow}
                onStopEdit={stopEditRow}
                onAssign={assignRow}
              />
            );

            if (groupedByVencimiento) {
              return groupedByVencimiento.map((group) => (
                <div key={group.day} className="assign-group">
                  <div className="assign-group-header">
                    <Calendar size={13} />
                    <span>
                      {group.day === 'Sin vencimiento' ? 'Sin vencimiento' : `Día ${group.day}`}
                    </span>
                    <span className="assign-group-count">{group.rows.length}</span>
                  </div>
                  <div className="assign-list">{group.rows.map(renderRow)}</div>
                </div>
              ));
            }

            return <div className="assign-list">{filteredRows.map(renderRow)}</div>;
          })()}
        </>
      )}

      {/* Clon visible del nombre que se está arrastrando. Va por portal a
          document.body a propósito: esta pantalla vive adentro de un
          <motion.div> con transform, y un transform en un ancestro hace que
          position:fixed se posicione respecto de ese ancestro en vez de la
          pantalla (mismo motivo que el bottom-sheet de filtros de la lista).
          pointer-events:none para que no intercepte nada mientras se mueve. */}
      {createPortal(
        <div
          ref={ghostRef}
          className="team-pill-ghost"
          aria-hidden="true"
          style={{ opacity: 0 }}
        >
          {draggingUser && (
            <>
              <span className="pill-order-num">{repartoUsers.indexOf(draggingUser) + 1}</span>
              {draggingUser}
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
