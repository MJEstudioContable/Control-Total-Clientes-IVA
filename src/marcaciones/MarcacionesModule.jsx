import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Upload } from 'lucide-react';
import { api } from '../api';
import './marcaciones.css';
import {
  DIAS, calcularEmpleados, clearLocalConfig, fmtMin, leerAttlog, loadConfig, normalizeConfig, saveConfig, signed, tone, claveDiaMarcacion,
} from './marcacionesCore';
import {
  guardarPlanilla, leerPlanilla, quitarPlanilla, recordarActivo, setRecordar,
} from './marcacionesStore';

const DIAS_ORDEN = [1, 2, 3, 4, 5, 6, 0];
const fechaCorta = (f) => f.split('-').reverse().slice(0, 2).join('/');
const origen = (v) => (v ? `${v > 0 ? '+' : '−'}${Math.abs(v)}` : '·');

// Sólo ADMINISTRADOR y SUPERUSUARIO llegan acá (App.jsx filtra la pestaña con
// canAssignClients) y el backend vuelve a validar el rol al leer/guardar. El .dat
// se procesa en el navegador; se guardan en el servidor las marcas procesadas,
// las correcciones y las confirmaciones de asistencia por mes, nunca el archivo original.
export default function MarcacionesModule({ withDesktopSidebar = false }) {
  const [tab, setTab] = useState('saldos');
  const [regs, setRegs] = useState(() => leerPlanilla()?.regs ?? []);
  const [info, setInfo] = useState(() => leerPlanilla()?.info ?? '');
  const [error, setError] = useState('');
  const [mes, setMes] = useState(() => leerPlanilla()?.mes ?? '');
  const [edits, setEdits] = useState(() => leerPlanilla()?.edits ?? {});
  const [remoteMonths, setRemoteMonths] = useState([]);
  const [dataSave, setDataSave] = useState('idle');
  const [recordar, setRecordarUi] = useState(recordarActivo);
  const [printMode, setPrintMode] = useState(null); // null | 'todos' | cédula
  const [sel, setSel] = useState(null);
  const [cfg, setCfg] = useState(loadConfig);
  const [remote, setRemote] = useState('loading'); // loading | ok | error
  const [remoteError, setRemoteError] = useState('');
  const [saveState, setSaveState] = useState('idle'); // idle | pending | saving | saved | error
  const cfgRef = useRef(cfg);
  const remoteRef = useRef('loading');
  const dirtyRef = useRef(false);
  const dataDirtyRef = useRef(false);
  const regsRef = useRef(regs);
  const editsRef = useRef(edits);
  const mesRef = useRef(mes);
  const infoRef = useRef(info);

  const meses = useMemo(() => [...new Set([...remoteMonths, ...regs.map((r) => r.f.slice(0, 7))])].sort(), [regs, remoteMonths]);
  const empleados = useMemo(
    () => (mes ? calcularEmpleados(regs, mes, cfg, edits).sort((a, b) => a.nom.localeCompare(b.nom)) : []),
    [regs, mes, cfg, edits],
  );
  const delArchivo = useMemo(
    () => [...new Set(regs.map((r) => r.id))]
      .map((id) => ({ id, nom: (cfg.emp[id]?.nom || '').trim() || id }))
      .sort((a, b) => a.nom.localeCompare(b.nom)),
    [regs, cfg],
  );

  const updateCfg = useCallback((fn) => {
    dirtyRef.current = true;
    setSaveState('pending');
    setCfg((prev) => fn(prev));
  }, []);

  useEffect(() => { cfgRef.current = cfg; }, [cfg]);
  useEffect(() => { regsRef.current = regs; }, [regs]);
  useEffect(() => { editsRef.current = edits; }, [edits]);
  useEffect(() => { mesRef.current = mes; }, [mes]);
  useEffect(() => { infoRef.current = info; }, [info]);
  useEffect(() => { remoteRef.current = remote; }, [remote]);

  const aplicarRemoto = useCallback((config) => {
    if (config) {
      dirtyRef.current = false;
      setCfg(normalizeConfig(config));
      setSaveState('idle');
      clearLocalConfig();
    } else if (Object.keys(cfgRef.current.emp).length) {
      // Primera vez con el servidor: sube lo que había guardado en este dispositivo.
      dirtyRef.current = true;
      setSaveState('pending');
      setCfg((c) => ({ ...c }));
    }
    remoteRef.current = 'ok';
    setRemote('ok');
  }, []);
  const fallarRemoto = useCallback((e) => {
    setRemote('error');
    setRemoteError(e?.message || 'sin conexión');
  }, []);
  const reintentarCarga = useCallback(() => {
    setRemote('loading');
    setRemoteError('');
    api.marcaciones.getConfig().then(aplicarRemoto, fallarRemoto);
  }, [aplicarRemoto, fallarRemoto]);
  useEffect(() => {
    api.marcaciones.getConfig().then(aplicarRemoto, fallarRemoto);
    api.marcaciones.getMonths().then(async (list) => {
      setRemoteMonths(list);
      const local = leerPlanilla();
      if (!local?.regs?.length && list.length) {
        const latest = list[list.length - 1];
        const saved = await api.marcaciones.getMonth(latest);
        if (saved) {
          setRegs(saved.regs || []); setEdits(saved.edits || {}); setInfo(saved.info || ''); setMes(latest);
          guardarPlanilla({ regs: saved.regs || [], edits: saved.edits || {}, info: saved.info || '', mes: latest });
        }
      }
    }).catch(fallarRemoto);
  }, [aplicarRemoto, fallarRemoto]);

  const guardar = useCallback(async () => {
    if (!dirtyRef.current || remoteRef.current !== 'ok') return;
    dirtyRef.current = false;
    setSaveState('saving');
    const snapshot = cfgRef.current;
    try {
      await api.marcaciones.saveConfig(snapshot);
      clearLocalConfig();
      setSaveState(dirtyRef.current ? 'pending' : 'saved');
    } catch {
      dirtyRef.current = true;
      saveConfig(snapshot); // respaldo local hasta que el servidor responda
      setSaveState('error');
    }
  }, []);

  // Guarda 0,8 s después del último cambio; sin conexión, sólo en el dispositivo.
  useEffect(() => {
    if (!dirtyRef.current) return undefined;
    if (remote === 'error') { saveConfig(cfg); return undefined; }
    if (remote !== 'ok') return undefined;
    const t = setTimeout(guardar, 800);
    return () => clearTimeout(t);
  }, [cfg, remote, guardar]);

  // Al salir de la pestaña con cambios pendientes, los envía igual.
  useEffect(() => () => {
    if (dirtyRef.current && remoteRef.current === 'ok') {
      api.marcaciones.saveConfig(cfgRef.current).then(clearLocalConfig).catch(() => saveConfig(cfgRef.current));
    }
  }, []);
  const guardarMesRemoto = useCallback(async (month, allRegs, allEdits, text) => {
    if (!month) return;
    const monthRegs = allRegs.filter((r) => r.f.slice(0, 7) === month);
    const monthEdits = Object.fromEntries(Object.entries(allEdits).filter(([key]) => key.includes(`|${month}-`)));
    await api.marcaciones.saveMonth(month, { regs: monthRegs, edits: monthEdits, info: text || '' });
    setRemoteMonths((prev) => [...new Set([...prev, month])].sort());
    setDataSave('saved');
  }, []);

  const updateDay = useCallback((key, value) => {
    dataDirtyRef.current = true;
    setDataSave('saving');
    setEdits((prev) => {
      const next = { ...prev, [key]: { ...(prev[key] || {}), ...value } };
      editsRef.current = next;
      guardarPlanilla({ regs: regsRef.current, edits: next, info: infoRef.current, mes: mesRef.current });
      return next;
    });
  }, []);

  useEffect(() => {
    if (!dataDirtyRef.current || remote !== 'ok' || !mes) return undefined;
    const timer = setTimeout(async () => {
      dataDirtyRef.current = false;
      setDataSave('saving');
      try {
        await guardarMesRemoto(mes, regs, edits, info);
      } catch (e) {
        dataDirtyRef.current = true;
        setDataSave('error');
        setRemoteError(e?.message || 'No se pudieron guardar las marcaciones editadas');
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [regs, edits, info, mes, remote, guardarMesRemoto]);

  const updateEmp = useCallback((id, patch) => {
    updateCfg((c) => ({
      ...c,
      emp: { ...c.emp, [id]: { lab: [1, 2, 3, 4, 5], ...(c.emp[id] || {}), ...patch } },
    }));
  }, [updateCfg]);

  const onFile = async (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    setError('');
    try {
      const { registros, ignoradas } = leerAttlog(await file.text());
      if (!registros.length) throw new Error('no se encontraron marcaciones. Subí el archivo .dat que exporta el reloj.');
      const ms = [...new Set(registros.map((r) => r.f.slice(0, 7)))].sort();
      const texto = `${file.name}: ${registros.length} marcaciones de ${new Set(registros.map((r) => r.id)).size} empleados`
        + (ignoradas ? ` (${ignoradas} línea(s) ignoradas)` : '');
      const ultimo = ms[ms.length - 1];
      const editsPreservadas = { ...editsRef.current };
      for (const month of ms) {
        try {
          const previo = await api.marcaciones.getMonth(month);
          if (previo?.edits) Object.assign(editsPreservadas, previo.edits);
        } catch { /* el guardado posterior informará si el servidor no está disponible */ }
      }
      setRegs(registros); setEdits(editsPreservadas); setMes(ultimo); setSel(null); setInfo(texto);
      regsRef.current = registros; editsRef.current = editsPreservadas; mesRef.current = ultimo; infoRef.current = texto;
      guardarPlanilla({ regs: registros, edits: editsPreservadas, info: texto, mes: ultimo });
      setDataSave('saving');
      try {
        for (const month of ms) await guardarMesRemoto(month, registros, editsPreservadas, texto);
        setDataSave('saved');
      } catch (saveError) {
        dataDirtyRef.current = true;
        setDataSave('error');
        setRemoteError(saveError?.message || 'No se pudo guardar la planilla en el servidor');
      }
    } catch (e) {
      setError(`No se pudo leer el archivo: ${e.message}`);
    }
  };

  const actual = empleados.find((e) => e.id === sel) || empleados[0];

  // Imprime con el diálogo del navegador (permite "Guardar como PDF").
  useEffect(() => {
    if (!printMode) return undefined;
    document.body.classList.add('mrc-printing');
    const terminar = () => setPrintMode(null);
    window.addEventListener('afterprint', terminar, { once: true });
    const t = setTimeout(() => window.print(), 60);
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', terminar);
      document.body.classList.remove('mrc-printing');
    };
  }, [printMode]);

  return (
    <main className={`real-exec-screen mrc-root ${withDesktopSidebar ? 'has-desktop-sidebar' : ''}`}>
      <header className="mrc-head">
        <div>
          <h1>Marcaciones</h1>
          <p>Saldo de horas a favor y en contra, día a día</p>
        </div>
        <nav className="mrc-tabs" aria-label="Secciones de marcaciones">
          <button type="button" aria-current={tab === 'saldos'} onClick={() => setTab('saldos')}>Saldos</button>
          <button type="button" aria-current={tab === 'horarios'} onClick={() => setTab('horarios')}>Horarios</button>
        </nav>
      </header>

      <section className="mrc-panel mrc-toolbar">
        <div className="mrc-toolbar-main">
          <label className="mrc-btn primary">
            <Upload size={16} />
            <span>{regs.length ? 'Cambiar archivo' : 'Subir archivo .dat del reloj'}</span>
            <input type="file" accept=".dat,.txt" onChange={onFile} hidden />
          </label>
          <p className="mrc-file">{info || 'Subí el archivo .dat del reloj para calcular los saldos.'}</p>
          {meses.length > 0 && (
            <label className="mrc-month">
              <span>Mes</span>
              <select
                value={mes}
                onChange={async (e) => { const nextMonth = e.target.value; setSel(null); if (regs.some((r) => r.f.startsWith(nextMonth))) { setMes(nextMonth); mesRef.current = nextMonth; guardarPlanilla({ regs, edits, info, mes: nextMonth }); } else { try { setDataSave('saving'); const saved = await api.marcaciones.getMonth(nextMonth); if (saved) { setRegs(saved.regs || []); setEdits(saved.edits || {}); setInfo(saved.info || ''); setMes(nextMonth); regsRef.current = saved.regs || []; editsRef.current = saved.edits || {}; infoRef.current = saved.info || ''; mesRef.current = nextMonth; guardarPlanilla({ regs: saved.regs || [], edits: saved.edits || {}, info: saved.info || '', mes: nextMonth }); setDataSave('saved'); } } catch (err) { setError(`No se pudo cargar el mes: ${err.message}`); setDataSave('error'); } } }}
              >
                {meses.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
          )}
        </div>
        {regs.length > 0 && (
          <div className="mrc-toolbar-actions">
            <button type="button" className="mrc-btn" onClick={() => setPrintMode('todos')}>Imprimir todos</button>
            <button
              type="button" className="mrc-btn ghost"
              onClick={() => { quitarPlanilla(); setRegs([]); setEdits({}); setInfo(''); setMes(''); setSel(null); regsRef.current = []; editsRef.current = {}; mesRef.current = ''; infoRef.current = ''; }}
            >
              Quitar de este dispositivo
            </button>
          </div>
        )}
        <label className="mrc-remember" title="Guarda la planilla cargada en este navegador. Se borra al cerrar sesión.">
          <input
            type="checkbox" checked={recordar}
            onChange={(e) => { setRecordar(e.target.checked); setRecordarUi(e.target.checked); }}
          />
          <span>Recordar la planilla en este dispositivo</span>
        </label>
      </section>

      {dataSave !== 'idle' && <div className={`mrc-status-line ${dataSave === 'error' ? 'error' : ''}`} role={dataSave === 'error' ? 'alert' : 'status'}><span>{dataSave === 'saving' ? 'Guardando planilla y ajustes en el servidor…' : dataSave === 'saved' ? 'Planilla y ajustes guardados en el servidor.' : 'No se pudo guardar en el servidor; los cambios siguen en pantalla.'}</span>{dataSave === 'error' && <button type="button" className="mrc-btn" onClick={async () => { setDataSave('saving'); try { await guardarMesRemoto(mes, regs, edits, info); dataDirtyRef.current = false; } catch (e) { setDataSave('error'); setRemoteError(e?.message || 'Error al guardar'); } }}>Reintentar guardado</button>}</div>}
      {error && <div className="mrc-panel mrc-error" role="alert">{error}</div>}

      {tab === 'saldos' ? (
        <Saldos empleados={empleados} actual={actual} onSelect={setSel} onPrint={() => setPrintMode(actual.id)} onUpdateDay={updateDay} />
      ) : (
        <Horarios
          cfg={cfg} empleados={delArchivo} updateCfg={updateCfg} updateEmp={updateEmp}
          estado={{ remote, remoteError, saveState, onRetryLoad: reintentarCarga, onRetrySave: guardar }}
        />
      )}

      <p className="mrc-muted mrc-foot">
        A favor: llegar antes, almorzar menos o irse después. En contra: lo contrario. El almuerzo se
        mide por su duración, sin hora fija. Los horarios se guardan en el servidor.
      </p>
      {printMode && (
        <ReporteImpresion
          lista={printMode === 'todos' ? empleados : empleados.filter((e) => e.id === printMode)}
          cfg={cfg} mes={mes} completo={printMode === 'todos'}
        />
      )}
    </main>
  );
}

function Saldos({ empleados, actual, onSelect, onPrint, onUpdateDay }) {
  if (!empleados.length) return null;
  const ultimo = actual.cf && !actual.flexible ? [...actual.dias].reverse().find((d) => d.net != null) : null;
  return (
    <>
      <section className="mrc-panel mrc-scroll">
        <table className="mrc-table">
          <thead>
            <tr>
              <th>Empleado</th><th className="n">Días</th><th className="n">A favor</th>
              <th className="n">En contra</th><th className="n">Saldo / horas</th><th className="n">Pendientes</th><th className="n">Avisos</th>
            </tr>
          </thead>
          <tbody>
            {empleados.map((e) => (
              <tr
                key={e.id}
                className={`click ${e.id === actual.id ? 'sel' : ''}`}
                tabIndex={0}
                onClick={() => onSelect(e.id)}
                onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(e.id); } }}
              >
                <td><strong>{e.nom}</strong>{e.flexible && <span className="mrc-badge">Sin horario fijo</span>}</td>
                <td className="n">{e.dias.length}</td>
                {e.flexible ? (
                  <><td className="n">—</td><td className="n">—</td><td className="n"><strong>{fmtMin(e.horas)}</strong></td><td className="n">{e.dias.filter((d) => d.workMin == null).length || '—'}</td></>
                ) : e.cf ? (
                  <>
                    <td className="n pos">{fmtMin(e.P)}</td>
                    <td className="n neg">{fmtMin(e.N)}</td>
                    <td className={`n ${tone(e.S)}`}><strong>{signed(e.S)}</strong></td>
                    <td className="n">{e.dias.filter((d) => d.pendiente).length || '—'}</td>
                  </>
                ) : <><td className="n warn" colSpan={3}>Sin horario configurado</td><td className="n">—</td></>}
                <td className="n">{e.avisos || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mrc-panel">
        <div className="mrc-detail-head">
          <h2>{actual.nom} · día a día</h2>
          <button type="button" className="mrc-btn" onClick={onPrint}>Imprimir empleado</button>
        </div>
        {actual.flexible ? (
          <p className="mrc-totals">Horas trabajadas del mes: <strong>{fmtMin(actual.horas)}</strong></p>
        ) : !actual.cf ? (
          <p className="warn">Configurá su horario en la pestaña Horarios para ver los saldos.</p>
        ) : (
          <p className="mrc-totals">
            <span>Saldo total del mes: <strong className={tone(actual.S)}>{signed(actual.S)}</strong></span>
            {ultimo && <span>Saldo del último día ({fechaCorta(ultimo.f)}): <strong className={tone(ultimo.net)}>{signed(ultimo.net)}</strong></span>}
          </p>
        )}
        <TablaDias actual={actual} onUpdateDay={onUpdateDay} />
      </section>
    </>
  );
}

function EditorDia({ day, onSave, onCancel }) {
  const align = (raw, missing) => {
    const result = Array(4).fill('');
    let source = 0;
    for (let i = 0; i < 4; i++) if (i !== missing && source < raw.length) result[i] = raw[source++];
    return result;
  };
  const [missing, setMissing] = useState(0);
  const [slots, setSlots] = useState(() => {
    if (day.editado) return [...day.slots];
    if (day.rawSlots.length === 3) return align(day.rawSlots, 0);
    return [...day.slots];
  });
  const labels = ['Entrada', 'Salida al almuerzo', 'Regreso del almuerzo', 'Salida del día'];
  const chooseMissing = (index) => { setMissing(index); setSlots(align(day.rawSlots, index)); };
  return (
    <div className="mrc-day-editor">
      <strong>Editar marcas de {fechaCorta(day.f)}</strong>
      {!day.editado && day.rawSlots.length === 3 && (
        <label className="mrc-missing">Marca faltante en el reloj
          <select value={missing} onChange={(e) => chooseMissing(Number(e.target.value))}>
            {labels.map((label, i) => <option key={label} value={i}>{label}</option>)}
          </select>
        </label>
      )}
      <div className="mrc-slot-grid">
        {labels.map((label, i) => (
          <label key={label}>{label}
            <input type="time" value={slots[i] || ''} onChange={(e) => setSlots((prev) => prev.map((v, n) => n === i ? e.target.value : v))} />
          </label>
        ))}
      </div>
      <div className="mrc-inline">
        <button type="button" className="mrc-btn primary" onClick={() => onSave(slots)}>Guardar y recalcular</button>
        <button type="button" className="mrc-btn" onClick={onCancel}>Cancelar</button>
        <span className="mrc-muted">Las marcas originales del reloj se conservan; estos horarios serán los usados para el cálculo.</span>
      </div>
    </div>
  );
}

function TablaDias({ actual, onUpdateDay }) {
  const [editing, setEditing] = useState('');
  if (actual.flexible) {
    return (
      <div className="mrc-scroll">
        <table className="mrc-table">
          <thead><tr><th>Fecha</th><th>Marcas</th><th className="n">Horas trabajadas</th><th>Asistencia</th><th>Aviso</th><th /></tr></thead>
          <tbody>{actual.dias.map((d) => {
            const key = claveDiaMarcacion(actual.id, d.f);
            return <Fragment key={d.f}>
              <tr>
                <td>{DIAS[d.dw]} {fechaCorta(d.f)}</td>
                <td>{d.mk || d.slots.filter(Boolean).join(' · ')}</td>
                <td className="n">{d.workMin == null ? 'Pendiente' : fmtMin(d.workMin)}</td>
                <td><label className="mrc-attendance"><input type="checkbox" checked={d.asistencia} disabled={!onUpdateDay} onChange={(e) => onUpdateDay?.(key, { attendance: e.target.checked })} />Asistió</label></td>
                <td className="warn small">{d.al.map((a) => <div key={a}>{a}</div>)}</td>
                <td>{onUpdateDay && <button type="button" className="mrc-btn" onClick={() => setEditing(editing === key ? '' : key)}>{editing === key ? 'Cerrar' : 'Editar marcas'}</button>}</td>
              </tr>
              {editing === key && onUpdateDay && <tr><td colSpan={6}><EditorDia day={d} onSave={(slots) => { onUpdateDay(key, { slots }); setEditing(''); }} onCancel={() => setEditing('')} /></td></tr>}
            </Fragment>;
          })}</tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="mrc-scroll">
      <table className="mrc-table">
        <thead><tr><th>Fecha</th><th>Marcaciones</th><th className="n">Entrada</th><th className="n">Almuerzo</th><th className="n">Salida</th><th className="n">Saldo del día</th><th className="n">Saldo total</th><th>Avisos / acción</th></tr></thead>
        <tbody>{actual.dias.map((d) => {
          const key = claveDiaMarcacion(actual.id, d.f);
          const marks = d.slots.filter(Boolean).join(' · ') || d.mk;
          return <Fragment key={d.f}>
            <tr>
              <td>{DIAS[d.dw]} {fechaCorta(d.f)}</td><td>{marks}</td>
              {d.net == null ? <><td /><td /><td /><td /><td /></> : <>
                {['e', 'a', 's'].map((k) => <td key={k} className={`n ${tone(d.o?.[k] || 0)}`}>{origen(d.o?.[k] || 0)}</td>)}
                <td className={`n ${tone(d.net)}`}>{signed(d.net)}</td><td className={`n ${tone(d.sal)}`}><strong>{signed(d.sal)}</strong></td>
              </>}
              <td className="warn small">{d.al.map((a) => <div key={a}>{a}</div>)}{d.rep?.length > 0 && <div className="mrc-note">Marcación repetida ignorada ({d.rep.join(', ')})</div>} {onUpdateDay && <button type="button" className="mrc-btn" onClick={() => setEditing(editing === key ? '' : key)}>{editing === key ? 'Cerrar' : 'Editar marcas'}</button>}</td>
            </tr>
            {editing === key && onUpdateDay && <tr><td colSpan={8}><EditorDia day={d} onSave={(slots) => { onUpdateDay(key, { slots }); setEditing(''); }} onCancel={() => setEditing('')} /></td></tr>}
          </Fragment>;
        })}</tbody>
        {actual.cf && <tfoot><tr><td colSpan={2}><strong>Total del mes</strong></td>{['e', 'a', 's'].map((k) => <td key={k} className={`n ${tone(actual.T[k])}`}><strong>{actual.T[k] ? origen(actual.T[k]) : '0'}</strong></td>)}<td className={`n ${tone(actual.S)}`}><strong>{signed(actual.S)}</strong></td><td /><td /></tr></tfoot>}
      </table>
    </div>
  );
}

function EstadoGuardado({ remote, remoteError, saveState, onRetryLoad, onRetrySave }) {
  if (remote === 'loading') return <p className="mrc-muted mrc-status">Cargando horarios del servidor…</p>;
  if (remote === 'error') {
    return (
      <div className="mrc-panel mrc-status-warn" role="alert">
        <span>No se pudo conectar con el servidor ({remoteError}). Los cambios quedan sólo en este dispositivo.</span>
        <button type="button" className="mrc-btn" onClick={onRetryLoad}>Reintentar</button>
      </div>
    );
  }
  if (saveState === 'error') {
    return (
      <div className="mrc-panel mrc-status-warn" role="alert">
        <span>No se pudo guardar en el servidor. Los cambios siguen en este dispositivo.</span>
        <button type="button" className="mrc-btn" onClick={onRetrySave}>Reintentar</button>
      </div>
    );
  }
  const texto = {
    idle: 'Los cambios se guardan solos en el servidor.',
    pending: 'Cambios sin guardar…',
    saving: 'Guardando…',
    saved: 'Guardado en el servidor.',
  }[saveState];
  return <p className="mrc-muted mrc-status" role="status">{texto}</p>;
}

function Horarios({ cfg, empleados, updateCfg, updateEmp, estado }) {
  return (
    <>
      <EstadoGuardado {...estado} />
      <fieldset className="mrc-lock" disabled={estado.remote === 'loading'}>
      <section className="mrc-panel mrc-config">
        <div className="mrc-config-group">
          <h3>Almuerzo</h3>
          <label>
            Permitido para todos (min)
            <input
              type="number" min="0" value={cfg.al}
              onChange={(e) => updateCfg((c) => ({ ...c, al: e.target.value === '' ? '' : Number(e.target.value) }))}
            />
          </label>
          <span className="mrc-muted">Cada empleado puede tener uno propio en su tarjeta.</span>
        </div>
        <div className="mrc-config-group">
          <h3>Sábado</h3>
          <div className="mrc-config-fields">
            <label>
              Entrada
              <input type="time" value={cfg.sab.e} onChange={(e) => updateCfg((c) => ({ ...c, sab: { ...c.sab, e: e.target.value } }))} />
            </label>
            <label>
              Salida
              <input type="time" value={cfg.sab.s} onChange={(e) => updateCfg((c) => ({ ...c, sab: { ...c.sab, s: e.target.value } }))} />
            </label>
          </div>
          <span className="mrc-muted">Sin almuerzo. Aplica a quien tenga marcado «sáb».</span>
        </div>
        <div className="mrc-config-group">
          <h3>Marcaciones repetidas</h3>
          <label>
            Ignorar repetidas a menos de (min)
            <input
              type="number" min="0" value={cfg.dup}
              onChange={(e) => updateCfg((c) => ({ ...c, dup: e.target.value === '' ? '' : Number(e.target.value) }))}
            />
          </label>
          <span className="mrc-muted">Si alguien marca dos veces seguidas, vale la primera.</span>
        </div>
      </section>

      {!empleados.length ? (
        <p className="mrc-muted">Subí primero el archivo .dat para ver a los empleados.</p>
      ) : (
        <div className="mrc-grid">
          {empleados.map(({ id, nom }) => {
            const c = cfg.emp[id] || { lab: [1, 2, 3, 4, 5] };
            return (
              <section key={id} className="mrc-panel mrc-card">
                <h2>{nom}</h2>
                <div className="mrc-fields">
                  <label className="full">Nombre
                    <input
                      type="text" maxLength={60} value={c.nom || ''} placeholder={`Cédula ${id}`}
                      onChange={(e) => updateEmp(id, { nom: e.target.value })}
                    />
                  </label>
                  <label className="full">Modalidad de control
                    <select value={c.tipo || 'fijo'} onChange={(e) => updateEmp(id, { tipo: e.target.value })}>
                      <option value="fijo">Horario fijo (saldo contra horario)</option>
                      <option value="flexible">Sin horario fijo (horas trabajadas)</option>
                    </select>
                  </label>
                  <label>Entrada<input type="time" value={c.e || ''} onChange={(e) => updateEmp(id, { e: e.target.value })} /></label>
                  <label>Salida<input type="time" value={c.s || ''} onChange={(e) => updateEmp(id, { s: e.target.value })} /></label>
                  <label>Almuerzo propio (min)
                    <input
                      type="number" min="0" value={c.al ?? ''} placeholder={String(cfg.al)}
                      onChange={(e) => updateEmp(id, { al: e.target.value === '' ? '' : Number(e.target.value) })}
                    />
                  </label>
                  <label>Tolerancia en contra (min)
                    <input
                      type="number" min="0" value={c.tol ?? ''} placeholder={String(cfg.tol || 0)}
                      onChange={(e) => updateEmp(id, { tol: e.target.value === '' ? undefined : Number(e.target.value) })}
                    />
                  </label>
                </div>
                {(c.tipo === 'flexible') && <p className="mrc-muted">Se suman horas trabajadas a partir de las marcas; no se compara con las horas de entrada y salida configuradas.</p>}
                <div className="mrc-days">
                  {DIAS_ORDEN.map((d) => (
                    <label key={d}>
                      <input
                        type="checkbox" checked={(c.lab || []).includes(d)}
                        onChange={(e) => updateEmp(id, {
                          lab: e.target.checked ? [...new Set([...(c.lab || []), d])] : (c.lab || []).filter((x) => x !== d),
                        })}
                      />
                      {DIAS[d]}
                    </label>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      </fieldset>
    </>
  );
}

const mesLargo = (mes) => new Date(`${mes}-01T00:00:00Z`)
  .toLocaleDateString('es-PY', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function horarioTexto(c, cfg) {
  if (!c?.e || !c?.s) return '';
  const lab = c.lab || [];
  const dias = DIAS_ORDEN.filter((d) => lab.includes(d)).map((d) => DIAS[d]).join(', ') || 'sin días';
  const al = c.al === '' || c.al == null ? cfg.al : c.al;
  return `${c.e} a ${c.s} · almuerzo ${al} min · ${dias}`
    + (lab.includes(6) ? ` · sábado ${cfg.sab.e} a ${cfg.sab.s} (sin almuerzo)` : '');
}

// Contenido sólo visible al imprimir (ver marcaciones.css).
function ReporteImpresion({ lista, cfg, mes, completo }) {
  const hoy = new Date().toLocaleDateString('es-PY');
  return createPortal(
    <div className="mrc-print">
      {completo && (
        <section className="mrc-print-page">
          <h1>Reporte de marcaciones · {mesLargo(mes)}</h1>
          <p>Generado el {hoy}</p>
          <table className="mrc-table">
            <thead>
              <tr>
                <th>Empleado</th><th className="n">Días</th><th className="n">A favor</th>
                <th className="n">En contra</th><th className="n">Saldo / horas</th><th className="n">Pendientes</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((e) => (
                <tr key={e.id}>
                  <td>{e.nom}</td><td className="n">{e.dias.length}</td>
                  {e.flexible ? (
                    <><td className="n">—</td><td className="n">—</td><td className="n">{fmtMin(e.horas)}</td><td className="n">{e.dias.filter((d) => d.workMin == null).length || '—'}</td></>
                  ) : e.cf ? (
                    <>
                      <td className="n pos">{fmtMin(e.P)}</td>
                      <td className="n neg">{fmtMin(e.N)}</td>
                      <td className={`n ${tone(e.S)}`}><strong>{signed(e.S)}</strong></td>
                      <td className="n">{e.dias.filter((d) => d.pendiente).length || '—'}</td>
                    </>
                  ) : (
                    <><td className="n warn" colSpan={3}>Sin horario configurado</td><td className="n">—</td></>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {lista.map((e) => (
        <section key={e.id} className="mrc-print-page">
          <h1>{e.nom}</h1>
          <p>Marcaciones de {mesLargo(mes)} · generado el {hoy}</p>
          {e.flexible ? (
            <p>Horas trabajadas del mes: <strong>{fmtMin(e.horas)}</strong></p>
          ) : e.cf ? (
            <>
              <p>Horario: {horarioTexto(cfg.emp[e.id], cfg)}</p>
              <p className="mrc-print-tot">
                A favor <strong className="pos">{fmtMin(e.P)}</strong>
                {' · '}En contra <strong className="neg">{fmtMin(e.N)}</strong>
                {' · '}Saldo total <strong className={tone(e.S)}>{signed(e.S)}</strong>
              </p>
            </>
          ) : (
            <p className="warn">Sin horario configurado: no se calcularon saldos.</p>
          )}
          <TablaDias actual={e} />
        </section>
      ))}
    </div>,
    document.body,
  );
}
