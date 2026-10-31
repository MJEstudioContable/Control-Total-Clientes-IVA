import {
  forwardRef,
  memo,
  useCallback,
  useDeferredValue,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import {
  AlertCircle,
  Archive,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Filter,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { useClients } from '../context/ClientsContext';
import VencimientoPill from '../components/VencimientoPill';
import { findClaveMarangatuColumn, formatPeriodLabel, isAffirmativeValue } from '../utils';
import { openMarangatuLogin } from '../marangatu';

const QUICK_FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'mine', label: 'Mis clientes' },
  { id: 'pending', label: 'Pendientes' },
  { id: 'early', label: 'Días 1–15' },
  { id: 'unassigned', label: 'Sin asignar' },
];

// Mismo criterio que isRowPresentado (ClientsContext):
//  - planilla "sólo sello" (la columna de estado ES "Archivado por:"): un
//    nombre cuenta como archivado; vacío o el "NO" literal, no.
//  - hay columna SI/NO propia: manda sólo ella. Antes era "SI o sello
//    cargado", y al desarchivar el sello viejo dejaba la fila archivada.
//  - sin columna de estado: sólo el sello.
function isArchived(row, archivedColumn, archivedByColumn) {
  if (archivedColumn && archivedColumn === archivedByColumn) {
    const text = String(row[archivedColumn] || '').trim();
    return Boolean(text) && !/^no?$/i.test(text);
  }
  if (archivedColumn) return isAffirmativeValue(row[archivedColumn]);
  return Boolean(archivedByColumn && String(row[archivedByColumn] || '').trim());
}

function getDueNumber(row, dueColumn) {
  if (!dueColumn) return Number.POSITIVE_INFINITY;
  const match = String(row[dueColumn] || '').match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : Number.POSITIVE_INFINITY;
}

// Estado de la fila. Cuando se puede editar es un botón que alterna el
// valor en el acto (migrado de la lista anterior, donde se marcaba
// Presentado/Archivado con un gesto sin entrar al detalle); cuando no,
// queda como indicador de sólo lectura.
function StatusIcon({ type, active, onToggle, disabled, busy }) {
  const archived = type === 'archived';
  const stateLabel = archived
    ? (active ? 'Archivado' : 'Sin archivar')
    : (active ? 'Presentado' : 'Pendiente');
  const icon = archived ? <Archive size={15} /> : <ClipboardCheck size={15} />;
  const className = `real-exec-status-icon ${active ? 'is-active' : 'is-inactive'}`;

  if (!onToggle) {
    return (
      <span className={className} role="img" aria-label={stateLabel} title={stateLabel}>
        {icon}
      </span>
    );
  }

  const actionLabel = archived
    ? (active ? 'Quitar de archivados' : 'Marcar como archivado')
    : (active ? 'Marcar como pendiente' : 'Marcar como presentado');

  return (
    <button
      type="button"
      className={`${className} is-actionable ${busy ? 'is-busy' : ''}`}
      aria-label={`${stateLabel}. ${actionLabel}`}
      aria-pressed={active}
      title={actionLabel}
      disabled={disabled || busy}
      onClick={(event) => {
        // La fila entera es un botón que abre el detalle: sin esto, tocar
        // el estado abriría el cliente además de cambiar el valor.
        event.stopPropagation();
        onToggle();
      }}
    >
      {busy ? <Loader2 size={15} className="real-exec-spin" /> : icon}
    </button>
  );
}

// Fila de la tabla. Va en su propio componente memoizado porque la lista
// puede tener cientos de clientes: si la fila se recalculara con cada
// tecleo del buscador o cada cambio de filtro, el navegador se quedaba
// masticando cientos de re-renders en vez de mostrar la letra escrita.
// Con memo() sólo se vuelven a dibujar las filas cuyos datos cambiaron.
const ClientRow = memo(function ClientRow({
  row,
  index,
  nameKey,
  rucKey,
  presented,
  archived,
  due,
  onSelect,
  onTogglePresented,
  onToggleArchived,
  otherStatuses,
  onToggleOtherStatus,
  saving,
  marangatu,
}) {
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const clientName = row[nameKey] || 'Sin nombre';
  const assignee = String(row._assignedUser || '').trim();

  // La fila es un div con rol de botón (no un <button>): adentro viven los
  // botones de estado y de Marangatu, y un <button> no puede contener otro.
  return (
    <div
      role="button"
      tabIndex={0}
      className="real-exec-client-row"
      onClick={() => onSelect(row)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(row);
        }
      }}
    >
      {/* Sin checkbox de selección: la asignación de clientes vive en su
          propio apartado ("Asignar clientes"), acá la fila es consulta y
          acceso directo. El número sigue marcando la posición. */}
      <span className="real-exec-row-num">{String(index + 1).padStart(2, '0')}</span>
      <span className="real-exec-client-identity">
        <span>{String(clientName).charAt(0).toUpperCase()}</span>
        <span>
          <strong>{clientName}</strong>
          <small>{rucKey && row[rucKey] ? `RUC ${row[rucKey]}` : `Fila ${row._row}`}</small>
        </span>
      </span>
      <span className={`real-exec-assignee ${assignee ? '' : 'is-empty'}`}>
        <UserRound size={13} /> {assignee || 'Sin asignar'}
      </span>
      <span className="real-exec-due">
        <CalendarDays size={13} />
        {Number.isFinite(due) ? `Día ${due}` : '—'}
      </span>
      <span className="real-exec-statuses">
        {/* Acceso directo a Marangatu (recuperado de la tarjeta anterior):
            inyecta el RUC y la Clave MH en el login de la SET. El CSS lo
            muestra sólo en equipos con mouse, donde vive la extensión. */}
        {marangatu && (
          <button
            type="button"
            className="real-exec-marangatu-btn"
            title={`Abrir Marangatu con el RUC ${marangatu.user}`}
            aria-label="Abrir Marangatu con las credenciales de este cliente"
            onClick={(event) => {
              event.stopPropagation();
              openMarangatuLogin(marangatu, (m) => window.alert(m));
            }}
          >
            <img src="/marangatu.svg" alt="" aria-hidden="true" />
          </button>
        )}
        <StatusIcon
          type="presented"
          active={presented}
          busy={saving}
          onToggle={onTogglePresented ? () => onTogglePresented(row, presented) : undefined}
        />
        <StatusIcon
          type="archived"
          active={archived}
          busy={saving}
          onToggle={onToggleArchived ? () => onToggleArchived(row, archived) : undefined}
        />
        {otherStatuses.length > 0 && (
          <span className="real-exec-status-menu-wrap">
            <button
              type="button"
              className="real-exec-status-more"
              aria-label="Más estados"
              aria-expanded={statusMenuOpen}
              title="Más estados"
              onClick={(event) => {
                event.stopPropagation();
                setStatusMenuOpen((open) => !open);
              }}
            >
              <MoreHorizontal size={16} />
            </button>
            {statusMenuOpen && (
              <span className="real-exec-status-menu" onClick={(event) => event.stopPropagation()}>
                {otherStatuses.map(({ column, active }) => (
                  <button
                    key={column}
                    type="button"
                    disabled={saving || !onToggleOtherStatus}
                    aria-pressed={active}
                    onClick={() => onToggleOtherStatus(row, column, active)}
                  >
                    <span>{column}</span><strong>{active ? 'SÍ' : 'NO'}</strong>
                  </button>
                ))}
              </span>
            )}
          </span>
        )}
      </span>
      <ChevronRight className="real-exec-chevron" size={16} />
    </div>
  );
});

// Tabla virtualizada: sólo se montan en el DOM las filas visibles (más un
// pequeño colchón), no las cientos que tenga el período. Antes, 300
// clientes significaban ~3.600 nodos creados de una sola vez en cada
// filtrado; ahora son ~20 filas montadas y el resto es alto reservado.
//
// Usa el scroll de la ventana (useWindowVirtualizer) en vez de un
// contenedor con scroll propio: así la página sigue comportándose como
// una sola columna que baja, igual que antes, y no aparece el "scroll
// dentro del scroll" que molesta en el teléfono.
function VirtualClientRows({
  rows,
  nameKey,
  rucKey,
  rowMeta,
  onSelect,
  onTogglePresented,
  onToggleArchived,
  otherStatusHeaders,
  onToggleOtherStatus,
  savingRowSet,
}) {
  const listRef = useRef(null);
  const [offset, setOffset] = useState(0);

  // Distancia entre el inicio del documento y el inicio de la lista: el
  // virtualizador de ventana la necesita para saber qué filas caen dentro
  // de la pantalla. Se recalcula si cambia el layout (filtros, resize).
  useLayoutEffect(() => {
    const element = listRef.current;
    if (!element) return undefined;

    const measure = () => {
      const top = element.getBoundingClientRect().top + window.scrollY;
      setOffset((previous) => (Math.abs(previous - top) > 1 ? top : previous));
    };

    measure();
    window.addEventListener('resize', measure);

    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (observer) observer.observe(document.body);

    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [rows.length]);

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => 62,
    overscan: 8,
    scrollMargin: offset,
  });

  const items = virtualizer.getVirtualItems();

  return (
    <div ref={listRef} className="real-exec-virtual-body" style={{ height: virtualizer.getTotalSize() }}>
      {items.map((item) => {
        const row = rows[item.index];
        const meta = rowMeta.get(row._row);
        return (
          <div
            key={row._row}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className="real-exec-virtual-row"
            style={{ transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)` }}
          >
            <ClientRow
              row={row}
              index={item.index}
              nameKey={nameKey}
              rucKey={rucKey}
              presented={meta?.presented ?? false}
              archived={meta?.archived ?? false}
              due={meta?.due ?? Number.POSITIVE_INFINITY}
              onSelect={onSelect}
              onTogglePresented={onTogglePresented}
              onToggleArchived={onToggleArchived}
              otherStatuses={otherStatusHeaders.map((column) => ({
                column,
                active: isAffirmativeValue(row[column]),
              }))}
              onToggleOtherStatus={onToggleOtherStatus}
              saving={savingRowSet.has(row._row)}
              marangatu={meta?.marangatu ?? null}
            />
          </div>
        );
      })}
    </div>
  );
}

function Metric({ icon: Icon, value, label, tone }) {
  return (
    <article className={`real-exec-metric tone-${tone}`}>
      <span className="real-exec-metric-icon"><Icon size={18} /></span>
      <span><strong>{value}</strong><small>{label}</small></span>
    </article>
  );
}

// Las secciones de arriba (hero, métricas, prioridad, equipo, calendario)
// no dependen del texto del buscador. Van en componentes memo con props
// memoizadas: escribir sólo re-renderiza el input y la tabla.
const HeroSection = memo(function HeroSection({ metrics, completion, month, year, onShowPending }) {
  return (
    <section className="real-exec-hero">
      <div className="real-exec-hero-copy">
        <span className="real-exec-eyebrow"><BarChart3 size={13} /> Panel del período</span>
        <h1>Tu operación,<br />bajo control.</h1>
        <p>
          {metrics.presented} de {metrics.total} clientes ya fueron presentados en{' '}
          {formatPeriodLabel(month, year)}.
        </p>
        <button type="button" onClick={onShowPending}>
          <Clock3 size={16} /> Revisar {metrics.pending} pendientes
        </button>
      </div>

      <div className="real-exec-progress-card">
        <span>AVANCE REAL</span>
        <div className="real-exec-progress-ring" style={{ '--real-progress': `${completion * 3.6}deg` }}>
          <strong>{completion}<small>%</small></strong>
        </div>
        <small>{metrics.presented} presentados · {metrics.pending} pendientes</small>
      </div>
    </section>
  );
});

const MetricsSection = memo(function MetricsSection({ metrics }) {
  return (
    <section className="real-exec-metrics" aria-label="Resumen del período">
      <Metric icon={Users} value={metrics.total} label="Clientes" tone="blue" />
      <Metric icon={Clock3} value={metrics.pending} label="Pendientes" tone="amber" />
      <Metric icon={CheckCircle2} value={metrics.presented} label="Presentados" tone="green" />
      <Metric icon={Archive} value={metrics.archived} label="Archivados" tone="navy" />
    </section>
  );
});

const InsightsSection = memo(function InsightsSection({
  priorityRows,
  rowMeta,
  workload,
  total,
  nameKey,
  rucKey,
  onSelect,
}) {
  return (
    <section className="real-exec-insights">
      <article className="real-exec-priority-card">
        <div className="real-exec-section-heading">
          <div><span>PRIORIDAD</span><h2>Requieren atención</h2></div>
          <small>{priorityRows.length}</small>
        </div>
        {priorityRows.length ? priorityRows.map((row) => {
          const due = rowMeta.get(row._row)?.due ?? Number.POSITIVE_INFINITY;
          return (
            <button type="button" key={row._row} onClick={() => onSelect(row)}>
              <i className={due <= 10 ? 'is-urgent' : ''} />
              <span><strong>{row[nameKey] || 'Sin nombre'}</strong><small>{rucKey ? row[rucKey] : `Fila ${row._row}`}</small></span>
              <em>{Number.isFinite(due) ? `Día ${due}` : 'Sin fecha'}</em>
              <ChevronRight size={15} />
            </button>
          );
        }) : (
          <div className="real-exec-positive-empty"><CheckCircle2 size={18} /> No hay presentaciones pendientes.</div>
        )}
      </article>

      <article className="real-exec-workload-card">
        <div className="real-exec-section-heading">
          <div><span>EQUIPO</span><h2>Carga asignada</h2></div>
        </div>
        {workload.length ? workload.map(([name, count]) => (
          <div className="real-exec-workload-row" key={name}>
            <span>{name}</span>
            <div><i style={{ width: `${total ? (count / total) * 100 : 0}%` }} /></div>
            <strong>{count}</strong>
          </div>
        )) : <span className="real-exec-no-data">Sin asignaciones para mostrar.</span>}
      </article>
    </section>
  );
});

// Resumen por día de vencimiento. Cada celda filtra la cartera por ese
// día, para pasar del panorama al detalle en un toque.
const SummarySection = memo(function SummarySection({ dailySummary, selectedVencimiento, onPickDay, digitByDay }) {
  if (!dailySummary.length) return null;
  return (
    <section className="real-exec-summary">
      <div className="real-exec-section-heading">
        <div>
          <span>CALENDARIO</span>
          <h2>Resumen por vencimiento</h2>
        </div>
        <small>{dailySummary.length}</small>
      </div>

      <div className="real-exec-summary-grid">
        {dailySummary.map((entry) => {
          const key = entry.due === null ? 'sin-fecha' : String(entry.due);
          const pending = entry.total - entry.presented;
          const ratio = entry.total ? (entry.presented / entry.total) * 100 : 0;
          const isSelected = selectedVencimiento === key;

          return (
            <button
              type="button"
              key={key}
              className={`real-exec-summary-cell ${isSelected ? 'is-active' : ''} ${
                pending === 0 ? 'is-done' : ''
              }`}
              aria-pressed={isSelected}
              title={
                entry.due === null
                  ? 'Clientes sin fecha de vencimiento'
                  : `Día ${entry.due}: ${entry.presented} de ${entry.total} presentados`
              }
              onClick={() => onPickDay(isSelected ? 'todos' : key)}
            >
              <span className={`real-exec-summary-day ${entry.due === null ? '' : 'filter-pill-vencimiento'}`}>
                {entry.due === null ? (
                  'Sin fecha'
                ) : (
                  <>
                    <span className="pill-day-label">Día {entry.due}</span>
                    <span className="pill-digit-label" aria-hidden="true">{digitByDay.get(String(entry.due)) ?? '—'}</span>
                  </>
                )}
              </span>
              <span className="real-exec-summary-count">
                <strong>{entry.presented}</strong>/{entry.total}
              </span>
              <span className="real-exec-summary-bar">
                <i style={{ width: `${ratio}%` }} />
              </span>
              <span className="real-exec-summary-pending">
                {pending === 0 ? 'Completo' : `${pending} pend.`}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
});

// Esqueleto de la primera carga: misma estructura que el panel real, así el
// contenido aparece "en su lugar" en vez de reemplazar un spinner centrado.
function DashboardSkeleton() {
  return (
    <main className="real-exec-screen real-exec-skeleton" aria-busy="true" aria-label="Cargando el panel">
      <section className="real-exec-hero">
        <div className="real-exec-hero-copy">
          <span className="real-exec-skeleton-line" style={{ width: '38%' }} />
          <span className="real-exec-skeleton-line is-title" style={{ width: '70%' }} />
          <span className="real-exec-skeleton-line is-title" style={{ width: '55%' }} />
          <span className="real-exec-skeleton-line" style={{ width: '80%' }} />
          <span className="real-exec-skeleton-pill" />
        </div>
        <div className="real-exec-progress-card">
          <span className="real-exec-skeleton-line" style={{ width: '50%' }} />
          <span className="real-exec-skeleton-ring" />
          <span className="real-exec-skeleton-line" style={{ width: '70%' }} />
        </div>
      </section>
      <section className="real-exec-metrics">
        {[0, 1, 2, 3].map((i) => (
          <article key={i} className="real-exec-metric">
            <span className="real-exec-skeleton-block" style={{ width: 40, height: 40 }} />
            <span>
              <span className="real-exec-skeleton-line is-title" style={{ width: 48 }} />
              <span className="real-exec-skeleton-line" style={{ width: 72 }} />
            </span>
          </article>
        ))}
      </section>
      <section className="real-exec-clients">
        <div className="real-exec-section-heading real-exec-clients-heading">
          <div>
            <span className="real-exec-skeleton-line" style={{ width: 110 }} />
            <span className="real-exec-skeleton-line is-title" style={{ width: 200 }} />
          </div>
        </div>
        <div className="real-exec-skeleton-search" />
        <div className="real-exec-table">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="real-exec-skeleton-row">
              <span className="real-exec-skeleton-block" style={{ width: 34, height: 34, borderRadius: '50%' }} />
              <span>
                <span className="real-exec-skeleton-line is-title" style={{ width: `${45 + ((i * 17) % 40)}%` }} />
                <span className="real-exec-skeleton-line" style={{ width: '30%' }} />
              </span>
              <span className="real-exec-skeleton-line" style={{ width: 90 }} />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

const ExecutiveDashboard = forwardRef(function ExecutiveDashboard(
  { onSelect, onNewClient, readOnly = false, section = 'all', onGoToClients, withDesktopSidebar = false },
  ref
) {
  const {
    user,
    year,
    month,
    headers,
    assignedRows,
    loading,
    refreshing,
    error,
    reload,
    syncTeamUsers,
    teamUsers,
    nameKey,
    rucKey,
    vencimientoKey,
    presentadoCol,
    presentadoPorCol,
    archivadoCol,
    archivadoPorCol,
    statusHeaders,
    availableVencimientos,
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
    activeFilterCount,
    hasActiveFilters,
    clearFilters,
    applySharedFilters,
    isRowPresentado,
    savingRowSet,
    saveRowUpdatesInBackground,
  } = useClients();

  const [actionError, setActionError] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [quickFilter, setQuickFilter] = useState('all');
  const clientSectionRef = useRef(null);

  // El input de búsqueda escribe en su propio estado y recién después
  // actualiza el filtro compartido. Antes cada tecla disparaba, de forma
  // síncrona, el filtrado + ordenamiento de toda la planilla y el
  // re-render de la lista entera: se escribía y las letras aparecían con
  // retraso. Ahora el texto se pinta al instante y el trabajo pesado va
  // por detrás, en una actualización de baja prioridad.
  const [typedSearch, setTypedSearch] = useState(query);
  const [lastSyncedQuery, setLastSyncedQuery] = useState(query);

  // Si el filtro se limpia o cambia desde afuera (cambio de período,
  // "limpiar filtros"), el input acompaña ese cambio. Se ajusta durante el
  // render -- el patrón recomendado por React para estado derivado -- en
  // vez de con un efecto, que provocaría un render extra en cascada.
  let searchText = typedSearch;
  if (query !== lastSyncedQuery) {
    searchText = query;
    setLastSyncedQuery(query);
    setTypedSearch(query);
  }

  const handleSearchChange = useCallback(
    (value) => {
      setTypedSearch(value);
      setLastSyncedQuery(value);
      setQuery(value);
    },
    [setQuery]
  );

  const clearSearch = useCallback(() => {
    setTypedSearch('');
    setLastSyncedQuery('');
    setQuery('');
  }, [setQuery]);

  const refresh = useCallback(
    () => Promise.allSettled([reload(true), syncTeamUsers(true)]),
    [reload, syncTeamUsers]
  );

  // Acción rápida sobre la fila: marcar Presentado / Archivado sin abrir
  // el cliente. Escribe también la columna del sello ("Presentado por:",
  // "Archivado por:") con el mismo criterio que el detalle, para que la
  // planilla quede igual sin importar desde dónde se marcó.
  //
  // Respuesta visual directa + guardado en segundo plano: el icono cambia
  // EN EL TOQUE (el estado se pinta optimista) y la escritura real en la
  // planilla viaja por la cola de fondo sin bloquear el botón. Si el
  // guardado falla, el contexto revierte la celda y acá se avisa, sin
  // llegar a trabar la navegación.
  const toggleStatus = useCallback(
    (row, column, stampColumn, isActive) => {
      if (readOnly || !column) return;

      let updates;
      if (stampColumn && stampColumn === column) {
        // Planilla "sólo sello" ("Presentado por:" / "Archivado por:"): la
        // marca es el nombre de quien lo hizo; desmarcar la deja vacía.
        updates = { [column]: isActive ? '' : user };
      } else {
        updates = { [column]: isActive ? 'NO' : 'SI' };
        if (stampColumn) updates[stampColumn] = isActive ? '' : user;
      }

      setActionError('');
      saveRowUpdatesInBackground(row._row, updates).catch((saveError) => {
        setActionError(
          saveError?.message || 'No se pudo guardar el cambio. Probá de nuevo.'
        );
      });
    },
    [readOnly, saveRowUpdatesInBackground, user]
  );

  const handleTogglePresented = useCallback(
    (row, isActive) => toggleStatus(row, presentadoCol, presentadoPorCol, isActive),
    [toggleStatus, presentadoCol, presentadoPorCol]
  );

  const handleToggleArchived = useCallback(
    (row, isActive) => toggleStatus(row, archivadoCol, archivadoPorCol, isActive),
    [toggleStatus, archivadoCol, archivadoPorCol]
  );

  // Sólo se ofrece la acción rápida si la planilla realmente tiene esa
  // columna: si no existe, el estado se muestra como indicador y listo.
  const canEditStatus = !readOnly && Boolean(presentadoCol);
  const canEditArchived = !readOnly && Boolean(archivadoCol);
  const otherStatusHeaders = useMemo(
    () => statusHeaders.filter((column) => column !== presentadoCol && column !== archivadoCol),
    [archivadoCol, presentadoCol, statusHeaders]
  );
  const handleToggleOtherStatus = useCallback(
    (row, column, active) => toggleStatus(row, column, null, active),
    [toggleStatus]
  );

  useImperativeHandle(ref, () => ({ refresh }), [refresh]);

  // Estado derivado de cada fila (presentado, archivado, día de
  // vencimiento, encargado), calculado UNA sola vez por fila.
  //
  // Antes, esos mismos valores se recalculaban muchísimas veces: una vez
  // por fila para las métricas, otra para las prioridades, otra por cada
  // comparación del sort (donde `getDueNumber` corría una expresión
  // regular O(n log n) veces) y otra más por cada fila dibujada. Con la
  // planilla llena eso era el grueso del trabajo en cada tecla del
  // buscador. Ahora se resuelve en una pasada y todo lo demás lee el Map.
  const claveCol = useMemo(() => findClaveMarangatuColumn(headers), [headers]);
  const rowMeta = useMemo(() => {
    const meta = new Map();
    assignedRows.forEach((row) => {
      let marangatu = null;
      if (!readOnly && rucKey && claveCol) {
        const ruc = String(row[rucKey] ?? '').trim();
        const clave = String(row[claveCol] ?? '').trim();
        if (ruc && clave) marangatu = { user: ruc, pass: clave };
      }
      meta.set(row._row, {
        presented: isRowPresentado(row),
        archived: isArchived(row, archivadoCol, archivadoPorCol),
        due: getDueNumber(row, vencimientoKey),
        assignee: String(row._assignedUser || '').trim(),
        marangatu,
      });
    });
    return meta;
  }, [assignedRows, archivadoCol, archivadoPorCol, isRowPresentado, vencimientoKey, readOnly, rucKey, claveCol]);

  const metrics = useMemo(() => {
    let presented = 0;
    let archived = 0;
    assignedRows.forEach((row) => {
      const meta = rowMeta.get(row._row);
      if (meta?.presented) presented += 1;
      if (meta?.archived) archived += 1;
    });
    return {
      total: assignedRows.length,
      presented,
      pending: assignedRows.length - presented,
      archived,
    };
  }, [assignedRows, rowMeta]);

  const completion = metrics.total
    ? Math.round((metrics.presented / metrics.total) * 100)
    : 0;

  const priorityRows = useMemo(
    () =>
      assignedRows
        .filter((row) => !rowMeta.get(row._row)?.presented)
        .sort(
          (left, right) =>
            (rowMeta.get(left._row)?.due ?? Infinity) -
            (rowMeta.get(right._row)?.due ?? Infinity)
        )
        .slice(0, 3),
    [assignedRows, rowMeta]
  );

  // Resumen por día de vencimiento (existía en la versión anterior). Deja
  // ver, de un vistazo, cuántos clientes vencen cada día y cuántos de esos
  // ya están presentados: es la lectura que usa el estudio para saber
  // dónde se está por atrasar.
  const vencimientoDigits = useMemo(
    () => new Map(availableVencimientos.map((day, digit) => [String(day), digit])),
    [availableVencimientos]
  );

  const dailySummary = useMemo(() => {
    if (!vencimientoKey) return [];
    const totals = new Map();

    assignedRows.forEach((row) => {
      const meta = rowMeta.get(row._row);
      const due = meta?.due;
      const key = Number.isFinite(due) ? due : null;
      const current = totals.get(key) || { due: key, total: 0, presented: 0 };
      current.total += 1;
      if (meta?.presented) current.presented += 1;
      totals.set(key, current);
    });

    return [...totals.values()].sort((left, right) => {
      if (left.due === null) return 1;
      if (right.due === null) return -1;
      return left.due - right.due;
    });
  }, [assignedRows, rowMeta, vencimientoKey]);

  const workload = useMemo(() => {
    const totals = new Map();
    assignedRows.forEach((row) => {
      const assignee = rowMeta.get(row._row)?.assignee || 'Sin asignar';
      totals.set(assignee, (totals.get(assignee) || 0) + 1);
    });
    return [...totals.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5);
  }, [assignedRows, rowMeta]);

  // Un solo Collator para todo el ordenamiento. Pasarle las opciones a
  // localeCompare dentro del comparador construía uno nuevo en cada
  // comparación, que es de lo más caro que puede hacer un sort largo.
  const collator = useMemo(
    () => new Intl.Collator('es', { numeric: true, sensitivity: 'base' }),
    []
  );

  const filteredRows = useMemo(() => {
    const rows = applySharedFilters(assignedRows).filter((row) => {
      const meta = rowMeta.get(row._row);
      const assignee = meta?.assignee ?? '';
      if (quickFilter === 'mine') return assignee === user;
      if (quickFilter === 'pending') return !meta?.presented;
      if (quickFilter === 'early') return (meta?.due ?? Infinity) <= 15;
      if (quickFilter === 'unassigned') return !assignee;
      return true;
    });

    return rows.sort((left, right) => {
      if (sortBy === 'vencimiento') {
        const dueDifference =
          (rowMeta.get(left._row)?.due ?? Infinity) - (rowMeta.get(right._row)?.due ?? Infinity);
        if (dueDifference !== 0) return dueDifference;
      }
      return collator.compare(String(left[nameKey] || ''), String(right[nameKey] || ''));
    });
  }, [applySharedFilters, assignedRows, collator, nameKey, quickFilter, rowMeta, sortBy, user]);

  // La lista se dibuja con el resultado "diferido": mientras se tipea, React
  // prioriza pintar el texto del input y actualiza la tabla enseguida
  // después, sin bloquear la escritura.
  const deferredRows = useDeferredValue(filteredRows);
  const isFiltering = deferredRows !== filteredRows;

  const scrollToClients = useCallback(() => {
    window.requestAnimationFrame(() => {
      clientSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const showPendingClients = useCallback(() => {
    setQuickFilter('pending');
    onGoToClients?.();
    scrollToClients();
  }, [onGoToClients, scrollToClients]);

  const pickSummaryDay = useCallback(
    (key) => {
      setSelectedVencimiento(key);
      setQuickFilter('all');
      onGoToClients?.();
      scrollToClients();
    },
    [onGoToClients, setSelectedVencimiento, scrollToClients]
  );

  const showStats = section === 'all' || section === 'stats';
  const showClients = section === 'all' || section === 'clients';

  // `loading` es sólo la primera carga del período: ahí va el esqueleto.
  // Las recargas (`refreshing`) mantienen el panel en pantalla.
  if (loading && !assignedRows.length) {
    return <DashboardSkeleton />;
  }

  if (error && !assignedRows.length) {
    return (
      <main className="real-exec-screen real-exec-centered">
        <AlertCircle size={30} />
        <strong>No se pudo cargar el panel</strong>
        <span>{error}</span>
        <button type="button" onClick={() => reload(true)}><RefreshCw size={15} /> Reintentar</button>
      </main>
    );
  }

  return (
    <main className={`real-exec-screen ${withDesktopSidebar ? 'has-desktop-sidebar' : ''}`}>
      {refreshing && (
        <div className="real-exec-refresh-notice" role="status">
          <RefreshCw className="real-exec-spin" size={13} />
          <span>Actualizando la planilla…</span>
        </div>
      )}
      {error && (
        <div className="real-exec-action-error" role="alert">
          <AlertCircle size={15} />
          <span>{error}</span>
          <button type="button" onClick={() => reload(true)} aria-label="Reintentar">
            <RefreshCw size={13} />
          </button>
        </div>
      )}

      {showStats && (
        <>
          <HeroSection
            metrics={metrics}
            completion={completion}
            month={month}
            year={year}
            onShowPending={showPendingClients}
          />

          <MetricsSection metrics={metrics} />

          <InsightsSection
            priorityRows={priorityRows}
            rowMeta={rowMeta}
            workload={workload}
            total={metrics.total}
            nameKey={nameKey}
            rucKey={rucKey}
            onSelect={onSelect}
          />

          <SummarySection
            dailySummary={dailySummary}
            selectedVencimiento={selectedVencimiento}
            onPickDay={pickSummaryDay}
            digitByDay={vencimientoDigits}
          />
        </>
      )}

      {showClients && <section className="real-exec-clients" ref={clientSectionRef}>
        <div className="real-exec-section-heading real-exec-clients-heading">
          <div>
            <span>CARTERA ACTIVA</span>
            <h2>Todos los clientes</h2>
            <p>Consulta de estados, responsables y vencimientos.</p>
          </div>
          <div className="real-exec-clients-actions">
            {!readOnly && onNewClient && headers && headers.length ? (
              <button type="button" className="real-exec-new-client-btn"
                onClick={() => onNewClient(headers)} title="Cargar un cliente nuevo">
                <Plus size={15} /><span>Nuevo cliente</span>
              </button>
            ) : null}
            <small><strong>{deferredRows.length}</strong> de {metrics.total}</small>
          </div>
        </div>

        <div className="real-exec-search-row">
          <label className="real-exec-search">
            <Search size={17} />
            <input
              type="search"
              value={searchText}
              onChange={(event) => handleSearchChange(event.target.value)}
              placeholder="Buscar cliente o RUC…"
            />
            {searchText && (
              <button type="button" onClick={clearSearch} aria-label="Limpiar búsqueda">
                <X size={14} />
              </button>
            )}
          </label>
          <div className="real-exec-filters">
            <Filter size={14} />
            {QUICK_FILTERS.map((filter) => (
              <button
                type="button"
                className={quickFilter === filter.id ? 'is-active' : ''}
                key={filter.id}
                onClick={() => setQuickFilter(filter.id)}
              >
                {filter.label}
              </button>
            ))}
            <label className="real-exec-sort-control">
              <span>Orden</span>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                <option value="alpha">A–Z</option>
                <option value="vencimiento">Vencimiento</option>
              </select>
            </label>
            <button
              type="button"
              className={`real-exec-more-filters ${advancedOpen ? 'is-active' : ''}`}
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((open) => !open)}
            >
              <SlidersHorizontal size={13} />
              <span>Más filtros</span>
              {activeFilterCount > 0 && <em>{activeFilterCount}</em>}
            </button>
          </div>
        </div>

        {/* Filtros detallados (vencimiento, estado y encargado). Existían en
            la versión anterior y viven en el contexto compartido, así que lo
            que se elige acá también aplica en "Asignar clientes". */}
        {advancedOpen && (
          <div className="real-exec-advanced-filters">
            {availableVencimientos.length > 0 && (
              <div className="real-exec-filter-group">
                <span className="real-exec-filter-label">Vencimiento</span>
                <div className="real-exec-filter-chips">
                  <button
                    type="button"
                    className={selectedVencimiento === 'todos' ? 'is-active' : ''}
                    onClick={() => setSelectedVencimiento('todos')}
                  >
                    Todos
                  </button>
                  {availableVencimientos.map((day, digit) => (
                    <VencimientoPill
                      key={day}
                      day={day}
                      digit={digit}
                      active={selectedVencimiento === day}
                      onClick={() => setSelectedVencimiento(day)}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="real-exec-filter-group">
              <span className="real-exec-filter-label">Estado</span>
              <div className="real-exec-filter-chips">
                {[
                  { id: 'todos', label: 'Todos' },
                  { id: 'presentado', label: 'Presentados' },
                  { id: 'pendiente', label: 'Pendientes' },
                ].map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={selectedStatus === option.id ? 'is-active' : ''}
                    onClick={() => setSelectedStatus(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="real-exec-filter-group">
              <span className="real-exec-filter-label">Encargado</span>
              <div className="real-exec-filter-chips">
                {[
                  { id: 'todos', label: 'Todos' },
                  { id: 'mis', label: 'Mis clientes' },
                  { id: 'sin_asignar', label: 'Sin asignar' },
                ].map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={selectedAssignee === option.id ? 'is-active' : ''}
                    onClick={() => setSelectedAssignee(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
                {teamUsers.map((member) => (
                  <button
                    key={member}
                    type="button"
                    className={selectedAssignee === member ? 'is-active' : ''}
                    onClick={() => setSelectedAssignee(member)}
                  >
                    {member}
                  </button>
                ))}
              </div>
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                className="real-exec-clear-filters"
                onClick={() => {
                  clearFilters();
                  setQuickFilter('all');
                }}
              >
                <X size={13} /> Limpiar filtros
              </button>
            )}
          </div>
        )}

        {actionError && (
          <div className="real-exec-action-error" role="alert">
            <AlertCircle size={15} />
            <span>{actionError}</span>
            <button type="button" onClick={() => setActionError('')} aria-label="Cerrar aviso">
              <X size={13} />
            </button>
          </div>
        )}

        {deferredRows.length ? (
          <div className={`real-exec-table ${isFiltering ? 'is-filtering' : ''}`}>
            <div className="real-exec-table-head">
              <span>N.º</span><span>Cliente</span><span>Encargado</span><span>Vence</span><span>Estados</span><span />
            </div>
            <VirtualClientRows
              rows={deferredRows}
              nameKey={nameKey}
              rucKey={rucKey}
              rowMeta={rowMeta}
              onSelect={onSelect}
              onTogglePresented={canEditStatus ? handleTogglePresented : undefined}
              onToggleArchived={canEditArchived ? handleToggleArchived : undefined}
              otherStatusHeaders={otherStatusHeaders}
              onToggleOtherStatus={!readOnly ? handleToggleOtherStatus : undefined}
              savingRowSet={savingRowSet}
            />
          </div>
        ) : (
          <div className="real-exec-empty">
            <Building2 size={24} />
            <strong>No encontramos clientes</strong>
            <span>Probá cambiando la búsqueda o el filtro seleccionado.</span>
          </div>
        )}
      </section>}
    </main>
  );
});

export default ExecutiveDashboard;
