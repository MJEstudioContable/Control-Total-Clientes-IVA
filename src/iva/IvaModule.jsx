import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { useClientsData, useClientsMeta } from '../context/ClientsContext';
import { compactHeader, findClaveMarangatuColumn } from '../utils';
import {
  DEFAULT_COLORS,
  DIAS_C,
  MESES,
  calc,
  colorFor,
  exportPeriodoPDF,
  fechaCorta,
  firma,
  gs,
  lastDigit,
  monthIndexFromSheet,
  normalizeConfig,
  parsePer,
  perLabel,
  rucTexto,
  shiftPer,
  splitRuc,
  textOn,
  toNum,
  vencAuto,
  vencDe,
  ym,
} from './ivaCore';
import './iva.css';

const IvaEditor = lazy(() => import('./IvaEditor'));

// La hoja mensual de la planilla es el mes en que vencen las obligaciones;
// el IVA que se liquida en ese mes es el del período fiscal anterior.
// (Hoja "Octubre" → período fiscal septiembre, que vence en octubre.)
const DESFASE_PERIODO_FISCAL = -1;
const REFRESH_MS = 60_000;

const ESTADO_TAG = {
  none: ['none', 'Sin cargar'],
  pend: ['pend', 'Pendiente'],
  env: ['env', 'Enviado'],
  pres: ['pres', 'Presentado'],
};

function initialPeriodo(year, month) {
  const idx = monthIndexFromSheet(month);
  const yearInSheet = String(month || '').match(/\b(20\d{2})\b/);
  const y = Number(yearInSheet ? yearInSheet[1] : year);
  if (idx === null || !y) {
    const now = new Date();
    return ym(now.getFullYear(), now.getMonth() + DESFASE_PERIODO_FISCAL);
  }
  return ym(y, idx + DESFASE_PERIODO_FISCAL);
}

function liqKey(ruc, periodo) {
  return ruc + '_' + periodo;
}

function findDvColumn(headers) {
  return headers.find((h) => ['dv', 'digitoverificador', 'digito'].includes(compactHeader(h))) || null;
}

function findWhatsappColumn(headers) {
  return headers.find((h) => /whats|celular|telef|movil/.test(compactHeader(h))) || null;
}

// initialRuc: cliente a abrir directamente (acceso desde su detalle). El
// módulo se monta de nuevo cada vez que se entra a la pestaña.
export default function IvaModule({ withDesktopSidebar = false, initialRuc = null }) {
  const { year, month, headers, nameKey, rucKey, encargadoCol, userRole } = useClientsMeta();
  const { assignedRows, loading: rowsLoading } = useClientsData();
  const canEditConfig = userRole === 'ADMINISTRADOR' || userRole === 'SUPERUSUARIO';

  const [view, setView] = useState(initialRuc ? 'editor' : 'tablero');
  const [periodo, setPeriodo] = useState(() => initialPeriodo(year, month));
  const [liq, setLiq] = useState({});
  const [extras, setExtras] = useState({});
  const [config, setConfig] = useState(() => normalizeConfig(null));
  // Último período que terminó de cargar (bien o con error): mientras no
  // coincide con el elegido, el tablero está cargando.
  const [loaded, setLoaded] = useState({ periodo: null, error: '' });
  const [refreshing, setRefreshing] = useState(false);
  const [editRuc, setEditRuc] = useState(initialRuc);
  const [dayFilter, setDayFilter] = useState(null);
  const [estadoFilter, setEstadoFilter] = useState('todos');
  const [query, setQuery] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef(null);

  const toast = useCallback((msg) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 2400);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Una entrada por fila de la planilla del mes: la misma lista que la
  // pestaña Clientes. La liquidación se identifica por RUC sin DV, así que
  // una fila sin RUC no se puede liquidar y dos filas con el mismo RUC
  // comparten liquidación; ambos casos se muestran marcados (antes se
  // descartaban en silencio y las listas no coincidían).
  // WhatsApp y notas propias del IVA se guardan aparte ("IVA Clientes").
  const filas = useMemo(() => {
    const dvKey = findDvColumn(headers || []);
    const waKey = findWhatsappColumn(headers || []);
    const claveKey = findClaveMarangatuColumn(headers || []);
    const primeraFila = {};
    return (assignedRows || []).map((row) => {
      const { ruc, dv } = rucKey ? splitRuc(row[rucKey], dvKey ? row[dvKey] : '') : { ruc: '', dv: '' };
      let problema = '';
      if (!ruc) problema = 'sin-ruc';
      else if (primeraFila[ruc]) problema = 'ruc-repetido';
      else primeraFila[ruc] = row._row;
      const extra = (ruc && extras[ruc]) || {};
      return {
        id: 'fila-' + row._row,
        fila: row._row,
        problema,
        filaOriginal: problema === 'ruc-repetido' ? primeraFila[ruc] : null,
        ruc,
        dv,
        nombre: String((nameKey && row[nameKey]) || '').trim() || 'Sin nombre',
        wa: extra.wa || (waKey ? String(row[waKey] || '').trim() : ''),
        notas: extra.notas || '',
        encargado: String((encargadoCol && row[encargadoCol]) || row._assignedUser || ''),
        // Login de Marangatu (RUC tal cual la planilla + Clave MH), igual
        // que el botón de la lista de clientes. Sólo en memoria.
        marangatu: rucKey && claveKey && String(row[claveKey] ?? '').trim()
          ? { user: String(row[rucKey] ?? '').trim(), pass: String(row[claveKey]).trim() }
          : null,
      };
    });
  }, [assignedRows, headers, nameKey, rucKey, encargadoCol, extras]);

  // Para abrir el editor por RUC: la primera fila con ese RUC.
  const clientes = useMemo(() => {
    const out = {};
    filas.forEach((c) => { if (c.ruc && !out[c.ruc]) out[c.ruc] = c; });
    return out;
  }, [filas]);

  // Trae el período y el anterior (para los saldos). El estado se aplica
  // recién cuando responde el servidor.
  const load = useCallback((per) => {
    const periodos = [per, shiftPer(per, -1)];
    return api.iva.load(periodos).then((data) => {
      setLiq((prev) => {
        const next = { ...prev };
        periodos.forEach((p) => {
          Object.keys(next).forEach((k) => { if (k.endsWith('_' + p)) delete next[k]; });
          Object.entries((data.liq && data.liq[p]) || {}).forEach(([ruc, doc]) => { next[liqKey(ruc, p)] = doc; });
        });
        return next;
      });
      setExtras(data.clientes || {});
      setConfig(normalizeConfig(data.config));
      setLoaded({ periodo: per, error: '' });
    }).catch((error) => {
      // El Web App publicado todavía es la versión sin el módulo de IVA.
      const message = error.code === 'UNKNOWN_ACTION'
        ? 'El backend todavía no tiene el módulo de IVA. Copiá el Apps Script actualizado y publicá una nueva versión del Web App (ver README).'
        : error.message || 'No se pudo conectar con el servidor.';
      setLoaded({ periodo: per, error: message });
    }).finally(() => {
      setRefreshing(false);
    });
  }, []);

  useEffect(() => { load(periodo); }, [load, periodo]);

  const loading = loaded.periodo !== periodo || refreshing;
  const refresh = () => {
    setRefreshing(true);
    load(periodo);
  };

  // Actualización periódica sólo en el tablero: dentro del editor se
  // sobrescribiría lo que se está cargando.
  useEffect(() => {
    if (view !== 'tablero') return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load(periodo);
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, periodo, view]);

  const rows = useMemo(() => filas.map((c) => {
    const l = c.ruc ? liq[liqKey(c.ruc, periodo)] : undefined;
    const ctx = { config, cliente: c, periodo };
    return {
      id: c.id, ruc: c.ruc, c, l,
      t: lastDigit(c.ruc),
      v: c.ruc ? vencDe(config, c, l, periodo) : null,
      k: l ? calc(l, ctx) : null,
      estado: l ? (l.estado || 'pend') : 'none',
    };
  }).sort((a, b) => (a.v ? a.v.fecha : 0) - (b.v ? b.v.fecha : 0) || a.c.nombre.localeCompare(b.c.nombre)), [filas, liq, periodo, config]);

  const problemas = useMemo(() => ({
    sinRuc: filas.filter((c) => c.problema === 'sin-ruc').length,
    repetidos: filas.filter((c) => c.problema === 'ruc-repetido').length,
  }), [filas]);

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => (dayFilter === null || r.t === dayFilter)
      && (estadoFilter === 'todos' || r.estado === estadoFilter)
      && (!q || r.c.nombre.toLowerCase().includes(q) || String(r.c.ruc).includes(q)));
  }, [rows, dayFilter, estadoFilter, query]);

  const saveConfig = useCallback(async (next) => {
    const prev = config;
    setConfig(next);
    try {
      await api.iva.saveConfig(next);
      return true;
    } catch (error) {
      setConfig(prev);
      toast(error.message || 'No se pudo guardar la configuración');
      return false;
    }
  }, [config, toast]);

  const handleDocSaved = useCallback((ruc, per, doc) => {
    setLiq((prev) => ({ ...prev, [liqKey(ruc, per)]: doc }));
  }, []);

  const handleClienteSaved = useCallback((ruc, data) => {
    setExtras((prev) => ({ ...prev, [ruc]: { ...(prev[ruc] || {}), ...data } }));
  }, []);

  const closeEditor = useCallback(() => {
    setEditRuc(null);
    setView('tablero');
    load(periodo);
  }, [load, periodo]);

  const exportPdf = async () => {
    toast('Generando PDF…');
    try {
      await exportPeriodoPDF({ config, periodo, rows: visibleRows, dayFilter });
    } catch (error) {
      console.error(error);
      toast('No se pudo generar el PDF');
    }
  };

  const screenClass = `real-exec-screen iva-root ${withDesktopSidebar ? 'has-desktop-sidebar' : ''}`;
  const editCliente = editRuc ? clientes[editRuc] : null;
  const editing = view === 'editor' && Boolean(editCliente);
  // Se pidió abrir un cliente cuyo RUC no aparece en la planilla del mes.
  const missingClient = view === 'editor' && editRuc && !editCliente && !rowsLoading;

  return (
    <main className={screenClass}>
      <header className="iva-head">
        <div>
          <h1>Vencimientos IVA</h1>
          <p>{firma(config)} · liquidación y ficha para el cliente</p>
        </div>
        {!editing && (
          <nav className="iva-tabs" aria-label="Secciones de IVA">
            <button type="button" aria-current={view === 'tablero'} onClick={() => setView('tablero')}>Tablero</button>
            <button type="button" aria-current={view === 'ajustes'} onClick={() => setView('ajustes')}>Colores y feriados</button>
          </nav>
        )}
      </header>

      {loaded.error && (
        <div className="iva-panel iva-error" role="alert">
          {loaded.error}{' '}
          <button type="button" className="iva-btn sm" onClick={refresh}>Reintentar</button>
        </div>
      )}

      {missingClient && (
        <div className="iva-panel iva-error" role="status">
          Este cliente no tiene un RUC válido en la planilla del mes, así que no se puede liquidar su IVA.
        </div>
      )}

      {editing ? (
        <Suspense fallback={<div className="iva-empty">Cargando…</div>}>
          <IvaEditor
            key={editRuc + '_' + periodo}
            cliente={editCliente}
            periodo={periodo}
            config={config}
            summaryDoc={liq[liqKey(editRuc, periodo)] || null}
            prevDoc={liq[liqKey(editRuc, shiftPer(periodo, -1))] || null}
            onBack={closeEditor}
            onDocSaved={handleDocSaved}
            onClienteSaved={handleClienteSaved}
            toast={toast}
          />
        </Suspense>
      ) : view === 'ajustes' ? (
        <AjustesView
          // Los campos se inicializan con la configuración: si llega o cambia
          // desde el servidor, se vuelven a montar con los valores nuevos.
          key={[config.firma, config.mora.interes, config.mora.contrav, config.feriados.join(',')].join('|')}
          config={config}
          canEdit={canEditConfig}
          onSave={saveConfig}
          toast={toast}
        />
      ) : (
        <Tablero
          periodo={periodo}
          onShiftPeriodo={(n) => setPeriodo((p) => shiftPer(p, n))}
          config={config}
          rows={rows}
          visibleRows={visibleRows}
          loading={loading || rowsLoading}
          dayFilter={dayFilter}
          onDayFilter={setDayFilter}
          estadoFilter={estadoFilter}
          onEstadoFilter={setEstadoFilter}
          query={query}
          onQuery={setQuery}
          onOpen={(r) => {
            if (!r.ruc) {
              toast('Esta fila no tiene RUC en la planilla: cargalo en la pestaña Clientes para liquidar su IVA.');
              return;
            }
            setEditRuc(r.ruc);
            setView('editor');
            window.scrollTo(0, 0);
          }}
          onRefresh={refresh}
          onExportPdf={exportPdf}
          hasRucColumn={Boolean(rucKey)}
          problemas={problemas}
        />
      )}

      <div className={`iva-toast ${toastMsg ? 'show' : ''}`} role="status" aria-live="polite">{toastMsg}</div>
    </main>
  );
}

function Tablero({
  periodo, onShiftPeriodo, config, rows, visibleRows, loading, dayFilter, onDayFilter,
  estadoFilter, onEstadoFilter, query, onQuery, onOpen, onRefresh, onExportPdf, hasRucColumn, problemas,
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { y, m } = parsePer(periodo);
  const venceMes = new Date(y, m + 1, 1);

  const chip = (k, label) => (
    <button key={k} type="button" className="iva-chip" aria-pressed={estadoFilter === k} onClick={() => onEstadoFilter(k)}>{label}</button>
  );

  let body;
  if (!hasRucColumn) {
    body = <div className="iva-empty">La planilla de este mes no tiene una columna de RUC. Agregala (por ejemplo "R.U.C.") para liquidar el IVA.</div>;
  } else if (loading && !rows.length) {
    body = <div className="iva-empty">Cargando…</div>;
  } else if (!rows.length) {
    body = <div className="iva-empty">No hay clientes en la planilla de este mes.</div>;
  } else if (!visibleRows.length) {
    body = <div className="iva-empty">Ningún cliente coincide con el filtro.</div>;
  } else {
    body = (
      <div className="iva-list">
        <table className="iva-rows">
          <thead>
            <tr><th aria-hidden="true" /><th>Cliente</th><th>Vence</th><th className="num">Resultado</th><th>Estado</th></tr>
          </thead>
          <tbody>
            {visibleRows.map((r) => {
              const col = r.t === null ? '#999' : colorFor(config, r.t);
              const [tagCls, tagLabel] = ESTADO_TAG[r.estado];
              return (
                <tr
                  key={r.id}
                  className="r"
                  tabIndex={0}
                  onClick={() => onOpen(r)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onOpen(r); }}
                >
                  <td className="band"><span style={{ background: col }} /></td>
                  <td>
                    <div className="name">
                      {r.c.nombre}
                      {r.c.notas && <span className="iva-tag exc" title={r.c.notas}>Excepción</span>}
                      {r.c.problema === 'sin-ruc' && <span className="iva-tag exc">Sin RUC</span>}
                      {r.c.problema === 'ruc-repetido' && (
                        <span className="iva-tag pend" title={`Mismo RUC que la fila ${r.c.filaOriginal}: comparten la liquidación`}>RUC repetido</span>
                      )}
                    </div>
                    <div className="sub">
                      {r.ruc ? 'RUC ' + rucTexto(r.c) : 'Fila ' + r.c.fila + ' de la planilla'}
                      {r.c.encargado ? ' · ' + r.c.encargado : ''}
                    </div>
                  </td>
                  <td>
                    {r.v ? (
                      <>
                        <div>{DIAS_C[r.v.fecha.getDay()]} {fechaCorta(r.v.fecha)}</div>
                        <div className="sub">{r.v.manual ? 'Fecha ajustada a mano' : 'VENC. ' + r.t + (r.v.inhabil ? ' · cae en día inhábil' : '')}</div>
                      </>
                    ) : <span className="sub">{r.ruc ? 'RUC inválido' : 'Sin RUC'}</span>}
                  </td>
                  <td className="num">
                    {r.k
                      ? (r.k.pagar > 0
                        ? <span className="pay">A pagar {gs(r.k.pagar)}</span>
                        : r.k.favor > 0 ? <span className="favor">A favor {gs(r.k.favor)}</span> : 'Gs. 0')
                      : <span className="sub">—</span>}
                  </td>
                  <td><span className={`iva-tag ${tagCls}`}>{tagLabel}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      <div className="iva-period">
        <button type="button" className="iva-iconbtn" aria-label="Período anterior" onClick={() => onShiftPeriodo(-1)}><ChevronLeft size={18} /></button>
        <div>
          <div className="lbl">Período fiscal</div>
          <strong>{perLabel(periodo)}</strong>
        </div>
        <button type="button" className="iva-iconbtn" aria-label="Período siguiente" onClick={() => onShiftPeriodo(1)}><ChevronRight size={18} /></button>
        <span className="lbl">Vence en {MESES[venceMes.getMonth()]} {venceMes.getFullYear()}</span>
        <button type="button" className="iva-btn sm iva-refresh" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>

      <div className="iva-strip">
        {Array.from({ length: 10 }, (_, t) => {
          const v = vencAuto(config, t, periodo);
          const col = colorFor(config, t);
          const mine = rows.filter((r) => r.t === t);
          const done = mine.filter((r) => r.estado === 'pres').length;
          return (
            <button
              key={t}
              type="button"
              className={`iva-day ${v.fecha < today ? 'past' : ''}`}
              aria-pressed={dayFilter === t}
              style={{ background: col, color: textOn(col) }}
              title={`VENC. ${t}, día ${7 + 2 * t}`}
              onClick={() => onDayFilter(dayFilter === t ? null : t)}
            >
              <div className="d">{v.fecha.getDate()}</div>
              <div className="w">{DIAS_C[v.fecha.getDay()]} · VENC. {t}</div>
              <div className="n">{mine.length ? `${done}/${mine.length} listos` : '—'}</div>
            </button>
          );
        })}
      </div>

      <div className="iva-filters">
        <input type="search" placeholder="Buscar por nombre o RUC" value={query} onChange={(e) => onQuery(e.target.value)} aria-label="Buscar cliente" />
        {chip('todos', 'Todos')}{chip('none', 'Sin cargar')}{chip('pend', 'Pendientes')}{chip('env', 'Enviados')}{chip('pres', 'Presentados')}
        {dayFilter !== null && <button type="button" className="iva-linkbtn" onClick={() => onDayFilter(null)}>Ver todos los días</button>}
        <button type="button" className="iva-btn iva-push" onClick={onExportPdf} disabled={!visibleRows.length}>
          Exportar PDF{dayFilter !== null ? ' del día ' + vencAuto(config, dayFilter, periodo).fecha.getDate() : ''}
        </button>
      </div>

      <p className="iva-conteo sub">
        {rows.length} clientes de la planilla (los mismos que en Clientes)
        {problemas.sinRuc ? ` · ${problemas.sinRuc} sin RUC (no se pueden liquidar hasta cargarlo)` : ''}
        {problemas.repetidos ? ` · ${problemas.repetidos} con RUC repetido` : ''}
      </p>
      <div className="iva-panel">{body}</div>
    </>
  );
}

function AjustesView({ config, canEdit, onSave, toast }) {
  const [feriados, setFeriados] = useState(() => (config.feriados || []).join('\n'));
  const mora = config.mora;

  if (!canEdit) {
    return (
      <div className="iva-panel iva-settings">
        <h2>Colores y feriados</h2>
        <p>Sólo un administrador puede cambiar los colores, los feriados, los valores de mora y el nombre del estudio.</p>
      </div>
    );
  }

  const setColor = (t, value) => onSave({ ...config, colores: { ...config.colores, [t]: value } });

  return (
    <div className="iva-stack iva-settings">
      <div className="iva-panel">
        <h2>Colores por vencimiento</h2>
        <p>Cada vencimiento (VENC. 0 al 9) tiene su día fijo y su color. Podés pegar el código hexadecimal (por ejemplo #1B5E9E).</p>
        <div className="iva-colors">
          {Array.from({ length: 10 }, (_, t) => {
            const c = colorFor(config, t);
            return (
              <div className="c" key={t}>
                <input type="color" value={c} aria-label={`Color VENC. ${t}`} onChange={(e) => setColor(t, e.target.value)} />
                <div>
                  <div className="name">VENC. {t} · día {7 + 2 * t}</div>
                  <input
                    type="text"
                    defaultValue={c}
                    key={c}
                    aria-label={`Código de color VENC. ${t}`}
                    onBlur={(e) => {
                      let v = e.target.value.trim();
                      if (!v.startsWith('#')) v = '#' + v;
                      if (/^#[0-9a-fA-F]{6}$/.test(v)) { if (v !== c) setColor(t, v); }
                      else toast('Usá un código como #1B5E9E');
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div className="iva-pad">
          <button type="button" className="iva-btn" onClick={() => onSave({ ...config, colores: { ...DEFAULT_COLORS } })}>Restablecer colores de ejemplo</button>
        </div>
      </div>

      <div className="iva-panel">
        <h2>Feriados</h2>
        <p>Un feriado por línea, formato AAAA-MM-DD. Las fechas de vencimiento no cambian nunca: los feriados solo sirven para avisar en la lista cuando un vencimiento cae en día inhábil.</p>
        <textarea spellCheck={false} value={feriados} onChange={(e) => setFeriados(e.target.value)} aria-label="Feriados" />
        <div className="iva-pad">
          <button
            type="button"
            className="iva-btn primary"
            onClick={async () => {
              const list = feriados.split(/\s+/).map((s) => s.trim()).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
              const unique = [...new Set(list)].sort();
              if (await onSave({ ...config, feriados: unique })) {
                setFeriados(unique.join('\n'));
                toast(unique.length + ' feriados guardados');
              }
            }}
          >
            Guardar feriados
          </button>
        </div>
      </div>

      <div className="iva-panel">
        <h2>Nombre del estudio</h2>
        <p>Aparece en las fichas y en los PDF que se envían a los clientes.</p>
        <div className="iva-morag">
          <div>
            <label htmlFor="iva-firma">Nombre</label>
            <input
              id="iva-firma"
              className="left"
              defaultValue={firma(config)}
              onBlur={async (e) => {
                const value = e.target.value.trim();
                if (value !== firma(config) && await onSave({ ...config, firma: value })) toast('Nombre guardado');
              }}
            />
          </div>
        </div>
      </div>

      <div className="iva-panel">
        <h2>Mora</h2>
        <p>Valores para calcular la multa cuando la fecha de pago prevista es posterior al vencimiento (Art. 171 y 176, Ley 125/91). Verificá los importes vigentes antes de usarlos.</p>
        <div className="iva-morag">
          <div>
            <label htmlFor="iva-mi">Interés moratorio por día (%)</label>
            <input
              id="iva-mi"
              inputMode="decimal"
              defaultValue={String(+(mora.interes * 100).toFixed(4)).replace('.', ',')}
              onBlur={async (e) => {
                const v = parseFloat(e.target.value.replace(',', '.'));
                if (!Number.isFinite(v) || v < 0 || v / 100 === mora.interes) return;
                if (await onSave({ ...config, mora: { ...mora, interes: v / 100 } })) toast('Valores de mora guardados');
              }}
            />
          </div>
          <div>
            <label htmlFor="iva-mcv">Multa por presentación tardía de la DJ (Gs.)</label>
            <input
              id="iva-mcv"
              inputMode="numeric"
              defaultValue={gs(mora.contrav)}
              onBlur={async (e) => {
                const v = toNum(e.target.value);
                e.target.value = gs(v);
                if (v === mora.contrav) return;
                if (await onSave({ ...config, mora: { ...mora, contrav: v } })) toast('Valores de mora guardados');
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
