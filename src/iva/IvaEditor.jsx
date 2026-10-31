import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { api } from '../api';
import { enviarContextoApp, enviarWhatsappExtension, mensajeDeError, sendIvaToMarangatu } from '../marangatu';
import DescargaFormularios from './DescargaFormularios';
import {
  ESTADOS,
  casillasFormulario120,
  casillasTexto,
  IVA_DEFAULT_NUEVO,
  LISTS,
  LIST_BY,
  VENTAS_KEYS,
  calc,
  cleanDraft,
  exportFichaPDF,
  exportLibroPDF,
  fichaBlob,
  fichaModel,
  fileBase,
  firma,
  getItems,
  gs,
  iso,
  lastDigit,
  normDraft,
  perLabel,
  shiftPer,
  resumenHoja,
  textOn,
  toNum,
  vencDe,
  waChatUrl,
  waMensaje,
  waTelefono,
  waText,
} from './ivaCore';

const SAVE_DELAY_MS = 600;
const WA_DESTINO_KEY = 'venc-iva-wa-destino';

function readWaDestino() {
  try {
    return localStorage.getItem(WA_DESTINO_KEY) === 'app' ? 'app' : 'web';
  } catch {
    return 'web';
  }
}

// Teléfono o tablet: el menú de compartir del sistema puede llevar la imagen
// directo a WhatsApp. En la PC se usa el portapapeles.
function esTactil() {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
}
const LIBRO_STORAGE_KEY = 'venc-iva-libro';

function readLibroPreference() {
  try {
    return localStorage.getItem(LIBRO_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function emptyRow(iva = IVA_DEFAULT_NUEVO, f = '') {
  return { m: 0, iva, f, n: '', t: '' };
}

// Monto en guaraníes con separador de miles mientras se escribe. El cursor
// se conserva contando desde el final, como en la versión anterior.
function MoneyInput({ value, onValue, className = '', ...rest }) {
  const ref = useRef(null);
  const fromEnd = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (fromEnd.current === null || !el || el !== document.activeElement) return;
    const pos = Math.max(0, el.value.length - fromEnd.current);
    el.setSelectionRange(pos, pos);
    fromEnd.current = null;
  });
  return (
    <input
      ref={ref}
      className={className}
      inputMode="numeric"
      placeholder="0"
      value={value ? gs(value) : ''}
      onChange={(e) => {
        fromEnd.current = e.target.value.length - (e.target.selectionStart ?? e.target.value.length);
        onValue(toNum(e.target.value));
      }}
      onFocus={(e) => e.target.select()}
      {...rest}
    />
  );
}

export default function IvaEditor({
  cliente, periodo, config, summaryDoc, prevDoc, onBack, onDocSaved, onClienteSaved, toast,
}) {
  const ctx = useMemo(() => ({ config, cliente, periodo }), [config, cliente, periodo]);
  const prevCalc = useMemo(
    () => (prevDoc ? calc(prevDoc, { ...ctx, periodo: prevDoc.periodo || periodo }) : null),
    [prevDoc, ctx, periodo]
  );

  const [draft, setDraft] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [libroMode, setLibroMode] = useState(readLibroPreference);
  const [notas, setNotas] = useState(cliente.notas || '');
  const [wa, setWa] = useState(cliente.wa || '');
  const [focusTarget, setFocusTarget] = useState(null);
  const [marangatuOpen, setMarangatuOpen] = useState(false);
  const [waDestino, setWaDestino] = useState(readWaDestino);
  const [descargaOpen, setDescargaOpen] = useState(false);
  const rootRef = useRef(null);
  const fichaRef = useRef(null);

  // Apertura: si ya hay liquidación se trae completa (con el detalle de
  // comprobantes); si no, se arranca con los saldos del mes anterior.
  useEffect(() => {
    let cancelled = false;
    async function open() {
      if (!summaryDoc) {
        setDraft(normDraft({
          clienteId: cliente.ruc,
          periodo,
          estado: 'pend',
          sant: prevCalc ? prevCalc.cas[47] : 0,
          sret: prevCalc ? prevCalc.cas[54] : 0,
          sire: prevDoc ? Number(prevDoc.sire) || 0 : 0,
        }));
        return;
      }
      try {
        const full = (await api.iva.getDoc(periodo, cliente.ruc)) || summaryDoc;
        if (cancelled) return;
        const d = normDraft({ ...full });
        if (LISTS.some((L) => getItems(d, L.k).some((x) => x.f || x.n || x.t))) setLibroMode(true);
        setDraft(d);
      } catch (error) {
        if (!cancelled) setLoadError(error.message || 'No se pudo abrir el cliente. Revisá la conexión y reintentá.');
      }
    }
    open();
    return () => { cancelled = true; };
  // Sólo al abrir: el editor se vuelve a montar (key) al cambiar de cliente o
  // período, y las recargas del tablero no deben pisar lo que se está cargando.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- Guardado automático ---------- */
  const dirty = useRef(false);
  const saveTimer = useRef(null);
  const saveChain = useRef(Promise.resolve());
  const draftRef = useRef(null);
  useEffect(() => { draftRef.current = draft; }, [draft]);

  const persist = useCallback((d) => {
    dirty.current = false;
    const data = { ...cleanDraft(d), clienteId: cliente.ruc, periodo, actualizado: Date.now() };
    onDocSaved(cliente.ruc, periodo, data);
    // En serie: dos guardados seguidos nunca llegan desordenados a la hoja.
    saveChain.current = saveChain.current
      .then(() => api.iva.saveDoc(periodo, cliente.ruc, data, resumenHoja(ctx, d)))
      .catch((error) => toast(error.message || 'No se pudo guardar. Revisá la conexión y volvé a intentar.'));
  }, [cliente.ruc, periodo, ctx, onDocSaved, toast]);

  const flush = useCallback(() => {
    clearTimeout(saveTimer.current);
    if (dirty.current && draftRef.current) persist(draftRef.current);
  }, [persist]);

  // Al salir del editor se guarda lo que quedó pendiente del debounce.
  const flushRef = useRef(flush);
  useEffect(() => { flushRef.current = flush; }, [flush]);
  useEffect(() => () => flushRef.current(), []);

  useEffect(() => {
    if (!draft || !dirty.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(draft), SAVE_DELAY_MS);
  }, [draft, persist]);

  const update = useCallback((fn) => {
    dirty.current = true;
    setDraft((d) => fn(d));
  }, []);
  const setField = (k, v) => update((d) => ({ ...d, [k]: v }));
  const setItem = (k, i, patch) => update((d) => ({ ...d, [k]: d[k].map((x, j) => (j === i ? { ...x, ...patch } : x)) }));

  const addRow = (k) => {
    const rows = draft[k];
    const last = rows[rows.length - 1];
    if (last && !last.m) { setFocusTarget(k + ':' + (rows.length - 1)); return; }
    update((d) => ({ ...d, [k]: [...d[k], emptyRow(last ? last.iva : IVA_DEFAULT_NUEVO, libroMode && last && last.f ? last.f : '')] }));
    setFocusTarget(k + ':' + rows.length);
  };
  const removeRow = (k, i) => update((d) => {
    const rows = d[k].filter((_, j) => j !== i);
    return { ...d, [k]: rows.length ? rows : [emptyRow()] };
  });

  // Mientras este cliente está abierto, la extensión (y su panel en Marangatu)
  // sabe que se trabaja con él; al salir se limpia.
  useEffect(() => {
    enviarContextoApp({ ruc: cliente.ruc, nombre: cliente.nombre });
    return () => { enviarContextoApp(null); };
  }, [cliente.ruc, cliente.nombre]);

  useEffect(() => {
    if (!focusTarget || !rootRef.current) return;
    const sel = libroMode ? `[data-d="${focusTarget}:f"]` : `[data-a="${focusTarget}"]`;
    rootRef.current.querySelector(sel)?.focus();
    setFocusTarget(null);
  }, [focusTarget, libroMode, draft]);

  const markSent = () => {
    if (draftRef.current?.estado === 'pend') setField('estado', 'env');
  };

  // WhatsApp no deja adjuntar archivos por enlace. En el teléfono la imagen
  // va por el menú de compartir del sistema; en la PC se copia al
  // portapapeles y se abre el chat del cliente para pegarla (Ctrl+V).
  // El portapapeles se escribe ANTES de abrir el chat: Chrome sólo lo permite
  // mientras esta pestaña tiene el foco.
  const enviarPorWhatsapp = async (fctx) => {
    const blobPromise = fichaBlob(fichaRef.current);
    const nombre = fileBase(fctx) + '.png';

    if (esTactil() && navigator.canShare) {
      try {
        const file = new File([await blobPromise], nombre, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], text: waMensaje(fctx, draft) });
          markSent();
          return;
        }
      } catch (error) {
        if (error?.name === 'AbortError') return; // la persona cerró el menú
      }
    }

    let copiada = false;
    try {
      // Con la promesa adentro, el permiso del clic se conserva mientras se arma la imagen.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
      copiada = true;
    } catch {
      // Sin portapapeles de imágenes: se descarga para adjuntarla a mano.
      try {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(await blobPromise);
        a.download = nombre;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch { /* sin imagen: igual se abre el chat */ }
    }

    // Con la extensión y WhatsApp Web, la imagen se pega sola en el chat, en
    // la pestaña de WhatsApp Web que ya esté abierta. Si la extensión está
    // instalada, la app NUNCA abre otra pestaña: si algo falla, lo avisa.
    if (waDestino === 'web') {
      let resp = { ok: false, error: 'NO_EXTENSION' };
      try {
        const blob = await blobPromise;
        const imagen = await new Promise((resolve, reject) => {
          const lector = new FileReader();
          lector.onload = () => resolve(lector.result);
          lector.onerror = reject;
          lector.readAsDataURL(blob);
        });
        resp = await enviarWhatsappExtension({
          telefono: waTelefono(fctx.cliente),
          texto: waMensaje(fctx, draft),
          imagen,
          nombre,
        });
      } catch {
        resp = { ok: false, error: 'WA_IMAGEN' };
      }
      if (resp.ok) {
        toast('WhatsApp Web: se abre el chat con el texto y la imagen. Revisá y tocá Enviar.');
        markSent();
        return;
      }
      if (resp.error !== 'NO_EXTENSION') {
        toast(mensajeDeError(resp.error));
        return;
      }
      // Sin extensión: no hay forma de pegar la imagen sola; sigue con el
      // chat común y el portapapeles, y se avisa para no confundirlo con un
      // fallo de la extensión.
      const url = waChatUrl(fctx, draft, 'web');
      window.open(url, '_blank', 'noopener');
      toast(copiada
        ? 'No se detectó la extensión Ekuatia: se abrió WhatsApp Web aparte. Pegá la imagen con Ctrl+V.'
        : 'No se detectó la extensión Ekuatia: se descargó la imagen para adjuntarla a mano.');
      markSent();
      return;
    }

    const url = waChatUrl(fctx, draft, waDestino);
    if (waDestino === 'app') window.location.href = url;
    else window.open(url, '_blank', 'noopener');
    toast(copiada
      ? 'Imagen copiada. En el chat de WhatsApp pegala con Ctrl+V y enviá.'
      : 'Se descargó la imagen: adjuntala en el chat de WhatsApp.');
    markSent();
  };

  const saveCliente = async (patch) => {
    const data = { nombre: cliente.nombre, wa, notas, ...patch };
    try {
      await api.iva.saveCliente(cliente.ruc, data);
      onClienteSaved(cliente.ruc, { wa: data.wa, notas: data.notas });
      toast('Datos del cliente guardados');
    } catch (error) {
      toast(error.message || 'No se pudieron guardar los datos del cliente');
    }
  };

  const goBack = () => {
    flush();
    onBack();
  };

  if (loadError) {
    return (
      <div className="iva-panel iva-error" role="alert">
        {loadError} <button type="button" className="iva-btn sm" onClick={onBack}>Volver</button>
      </div>
    );
  }
  if (!draft) return <div className="iva-empty">Cargando liquidación…</div>;

  const k = calc(draft, ctx);
  const v = vencDe(config, cliente, draft, periodo);
  const t = lastDigit(cliente.ruc);
  const showUsePrev = prevCalc && (Number(draft.sant || 0) !== prevCalc.cas[47] || Number(draft.sret || 0) !== prevCalc.cas[54]);
  const currentCliente = { ...cliente, wa, notas };
  const fichaCtx = { ...ctx, cliente: currentCliente };

  const casValue = (key) => {
    const value = k.cas[key];
    if (key === 'pct') return Math.round(value * 100) + '%';
    if (key === 'ratio') return value.toFixed(2).replace('.', ',');
    if (key === 'dias' || key === 'meses') return String(value);
    return gs(value);
  };

  const fld = (key, label) => (
    <div className="f" key={key}>
      <label htmlFor={`iva-f-${key}`}>{label}</label>
      <MoneyInput id={`iva-f-${key}`} value={draft[key]} onValue={(n) => setField(key, n)} />
    </div>
  );
  const tr = (cas, label, key, cls = '') => (
    <tr className={cls} key={label}><td className="cas">{cas}</td><td>{label}</td><td className="num">{casValue(key)}</td></tr>
  );
  const trIn = (cas, label, field) => (
    <tr key={label}>
      <td className="cas">{cas}</td><td>{label}</td>
      <td className="num"><MoneyInput className="amt sm" value={draft[field]} onValue={(n) => setField(field, n)} aria-label={label} /></td>
    </tr>
  );

  const listBlock = (key) => {
    const d = LIST_BY[key];
    const rows = draft[key] || [];
    const c = k.C[key];
    const tl = VENTAS_KEYS.has(key) ? 'Cliente (RUC o nombre)' : 'Proveedor (RUC o nombre)';
    return (
      <div className="iva-cat" key={key}>
        <div className="cat-h">
          <span className="cas">{d.cas}</span>
          <span className="cat-t">{d.t}</span>
          <span className="cat-sum">{c.sum ? 'Total ' + gs(c.sum) + (d.r ? ' · IVA ' + gs(c.iva) : '') : ''}</span>
        </div>
        {rows.map((x, i) => (
          <div className={`arow ${libroMode ? 'libro' : ''}`} key={i}>
            {libroMode && (
              <>
                <input type="date" className="dt" data-d={`${key}:${i}:f`} value={x.f || ''} onChange={(e) => setItem(key, i, { f: e.target.value })} aria-label={`Fecha del comprobante ${i + 1}`} />
                <input className="nm" placeholder="N° comprobante" maxLength={40} value={x.n || ''} onChange={(e) => setItem(key, i, { n: e.target.value })} aria-label={`Número de comprobante ${i + 1}`} />
                <input className="tc" placeholder={tl} maxLength={80} value={x.t || ''} onChange={(e) => setItem(key, i, { t: e.target.value })} aria-label={`${tl} ${i + 1}`} />
              </>
            )}
            <MoneyInput
              className="amt"
              data-a={`${key}:${i}`}
              placeholder="Monto"
              value={x.m}
              onValue={(n) => setItem(key, i, { m: n })}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRow(key); } }}
              aria-label={`${d.t}, monto ${i + 1}`}
            />
            {d.r ? (
              <select className="ivasel" value={x.iva ? '1' : '0'} onChange={(e) => setItem(key, i, { iva: e.target.value === '1' })} aria-label={`IVA del monto ${i + 1}`}>
                {/* "IVA incluido" suma el IVA encima del monto (iva: false);
                    "Sin IVA" lo extrae del monto (iva: true). Ver ivaCore. */}
                <option value="0">IVA incluido</option>
                <option value="1">Sin IVA</option>
              </select>
            ) : <span className="sub exen">Exento</span>}
            {rows.length > 1 && (
              <button type="button" className="x" onClick={() => removeRow(key, i)} aria-label={`Quitar monto ${i + 1}`} title="Quitar este monto">×</button>
            )}
          </div>
        ))}
        <button type="button" className="iva-linkbtn addrow" onClick={() => addRow(key)}>+ Agregar {libroMode ? 'otro comprobante' : 'otro monto'}</button>
      </div>
    );
  };

  return (
    <div ref={rootRef}>
      <div className="iva-ehead">
        <button type="button" className="iva-btn" onClick={goBack}><ArrowLeft size={15} /> Volver</button>
        <h2>{cliente.nombre}</h2>
        <span className="sub">{perLabel(periodo)}{cliente.encargado ? ' · Encargado: ' + cliente.encargado : ''}</span>
      </div>

      <div className="iva-editor">
        <div className="iva-panel iva-form">
          <div className="iva-meta">
            <div className="f">
              <label htmlFor="iva-est">Estado</label>
              <select id="iva-est" value={draft.estado || 'pend'} onChange={(e) => setField('estado', e.target.value)}>
                {Object.entries(ESTADOS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </div>
            <div className="f">
              <label htmlFor="iva-vm">Vencimiento</label>
              <input type="date" id="iva-vm" value={v ? iso(v.fecha) : ''} onChange={(e) => setField('vencManual', e.target.value || null)} />
              <div className="hint">
                {v && v.manual
                  ? <>Ajustada a mano. <button type="button" className="iva-linkbtn" onClick={() => setField('vencManual', null)}>Volver a la fecha automática</button></>
                  : t === null ? 'RUC inválido: cargá la fecha a mano.' : `Automática: VENC. ${t}, día ${7 + 2 * t}${v && v.inhabil ? ' (cae en día inhábil)' : ''}`}
              </div>
            </div>
            <div className="f">
              <label htmlFor="iva-pago">Fecha de pago prevista</label>
              <input type="date" id="iva-pago" value={draft.pago || ''} onChange={(e) => setField('pago', e.target.value || null)} />
              <div className="hint">
                {draft.pago
                  ? <button type="button" className="iva-linkbtn" onClick={() => setField('pago', null)}>Pago en término (sin mora)</button>
                  : 'Vacía = paga en término. Si es posterior al vencimiento se calcula la mora.'}
              </div>
            </div>
            <div className="f">
              <label htmlFor="iva-man">IVA a pagar</label>
              <select id="iva-man" value={draft.manual ? '1' : '0'} onChange={(e) => setField('manual', e.target.value === '1')}>
                <option value="0">Calcular automáticamente</option>
                <option value="1">Ingresar a mano</option>
              </select>
              {draft.manual && (
                <MoneyInput className="iva-mt" value={draft.ivaManual} onValue={(n) => setField('ivaManual', n)} placeholder="Monto a pagar" aria-label="Monto a pagar" />
              )}
            </div>
          </div>

          <div className="iva-notebox">
            <h3>Notas y excepciones del cliente</h3>
            <textarea
              value={notas}
              placeholder="Anotá acá cualquier excepción de este cliente. Se guarda para todos los meses."
              onChange={(e) => setNotas(e.target.value)}
              onBlur={() => { if (notas.trim() !== (cliente.notas || '')) saveCliente({ notas: notas.trim() }); }}
            />
            <label className="iva-wa" htmlFor="iva-wa">WhatsApp para enviar la ficha</label>
            <input
              id="iva-wa"
              placeholder="0981 123456"
              value={wa}
              onChange={(e) => setWa(e.target.value)}
              onBlur={() => { if (wa.trim() !== (cliente.wa || '')) saveCliente({ wa: wa.trim() }); }}
            />
          </div>

          <label className="iva-chk">
            <input
              type="checkbox"
              checked={libroMode}
              onChange={(e) => {
                setLibroMode(e.target.checked);
                try { localStorage.setItem(LIBRO_STORAGE_KEY, e.target.checked ? '1' : '0'); } catch { /* preferencia opcional */ }
              }}
            />
            <span>Cargar detalle de comprobantes (fecha, número y cliente/proveedor) para el libro de ventas y compras</span>
          </label>

          <div className="iva-rubro first">Saldos anteriores (información inicial del período)</div>
          <div className="iva-fields">
            {fld('sant', 'Saldo anterior de IVA (técnico) · cas. 46')}
            {fld('sret', 'Saldo anterior de retenciones (financiero) · cas. 51')}
            {fld('sire', 'Saldo anterior de Renta (IRE, informativo)')}
          </div>
          {showUsePrev && (
            <div className="hint">
              El mes anterior dejó saldo de IVA Gs. {gs(prevCalc.cas[47])} y de retenciones Gs. {gs(prevCalc.cas[54])}.{' '}
              <button type="button" className="iva-linkbtn" onClick={() => update((d) => ({ ...d, sant: prevCalc.cas[47], sret: prevCalc.cas[54] }))}>Usar esos saldos</button>
            </div>
          )}

          <div className="iva-rubro">Rubro 1 – Ventas del período (IVA débito)</div>
          {['v10', 'v5a', 'v5', 'vex', 'ncvex'].map(listBlock)}
          <div className="iva-subh">Notas de crédito recibidas de proveedores (suman al IVA débito)</div>
          {['ncc10', 'ncc5a', 'ncc5', 'nccex'].map(listBlock)}
          <div className="iva-totrow"><span>Total ventas (base) · cas. 18: <b>{casValue('ventasBase')}</b></span><span>Total IVA débito · cas. 44: <b>{casValue(44)}</b></span></div>

          <div className="iva-rubro">Rubro 3 – Compras del período (IVA crédito)</div>
          {['c10', 'c5'].map(listBlock)}
          <div className="iva-subh">Notas de crédito emitidas a clientes (suman al IVA crédito)</div>
          {['ncv10', 'ncv5'].map(listBlock)}
          <div className="iva-totrow"><span>Total compras gravadas (base): <b>{casValue('comprasBase')}</b></span><span>Total IVA crédito · cas. 43: <b>{casValue(45)}</b></span></div>

          <div className="iva-rubro">Rubro 4 – Determinación del impuesto o del saldo técnico</div>
          <div className="iva-tblw"><table className="iva-tbl"><tbody>
            {tr(44, 'a) IVA Débito (suma casillas 21 y 24 del Rubro 1)', 44)}
            {tr(45, 'b) IVA Crédito (casilla 43 del Rubro 3)', 45)}
            {tr(46, 'c) Saldo anterior de IVA – saldo técnico a favor del contribuyente', 46)}
            {tr(166, 'd) Saldo a favor del contribuyente (45 + 46 – 44, si 45 + 46 es mayor)', 166)}
            {trIn(167, 'e) Saldo a favor remitido al Fisco (último párrafo Art. 91, Ley 6380/19)', 'remit')}
            {tr(47, 'f) Saldo técnico trasladable a la casilla 46 del mes siguiente (166 – 167)', 47)}
            {tr(48, 'g) Saldo a favor del Fisco (44 – 45 – 46, si 44 es mayor)', 48)}
            {trIn(49, 'h) IVA Crédito por exportación (solo exportadores, si hay saldo en 48)', 'expo')}
            {trIn(168, 'i) Deducción por incorporación de personas con discapacidad (Ley 4962/13) – no trasladable', 'disc')}
            {tr(50, 'j) IMPUESTO DETERMINADO (48 – 49 – 168)', 50, 'strong')}
          </tbody></table></div>

          <div className="iva-rubro">Rubro 5 – Impuesto determinado y/o saldo financiero a favor del contribuyente</div>
          <div className="iva-tblw"><table className="iva-tbl"><tbody>
            {tr(55, 'a) Impuesto determinado (casilla 50 del Rubro 4)', 55)}
            {tr(51, 'b) Saldo anterior de retenciones – saldo financiero a favor', 51)}
            {trIn(52, 'c) Retenciones de IVA practicadas EN EL PERÍODO (sector público, exportadores, tarjetas, otros agentes)', 'ret')}
            {trIn(169, 'd) Percepciones (despachantes de aduana)', 'perc')}
            {tr(56, 'e) Multa por contravención – presentación tardía de la DJ (Art. 176 Ley 125/91)', 56)}
            {tr(53, 'f) Total pagos a cuenta (51 + 52 + 169)', 53)}
            {tr(57, 'g) Total impuesto y multa (55 + 56)', 57)}
            {tr(58, 'h) SALDO A PAGAR AL FISCO (57 – 53, si 57 es mayor)', 58, 'strong')}
            {tr(54, 'i) Saldo de retenciones trasladable a la casilla 51 del mes siguiente (53 – 57, si 53 es mayor)', 54)}
          </tbody></table></div>

          <div className="iva-rubro">Rubro 6 – Compras exoneradas / no alcanzadas (informativo, sin crédito fiscal)</div>
          {listBlock('cex')}
          <div className="iva-totrow"><span>(-) NC recibidas por compras exoneradas (cas. 17, del Rubro 1): <b>{casValue('nccex')}</b></span><span>Total compras exoneradas (neto): <b>{casValue('nr')}</b></span></div>

          <div className="iva-rubro">Cálculo por mora – Art. 171 Ley 125/91 (solo si la fecha de pago es posterior al vencimiento)</div>
          <div className="iva-tblw"><table className="iva-tbl"><tbody>
            {tr('', 'Días de atraso (fecha de pago – fecha de vencimiento)', 'dias')}
            {tr('', 'Meses de atraso (toda fracción de mes cuenta como mes completo)', 'meses')}
            {tr('', 'Porcentaje de multa por mora (4% hasta 1 mes; 6%, 8%, 10%, 12%; 14% desde 5 meses)', 'pct')}
            {tr('', 'Base de cálculo: impuesto no pagado en término (impuesto determinado – pagos a cuenta)', 'baseMora')}
            {tr('', 'Multa por mora (base × %)', 'multa')}
            {tr('', 'Intereses moratorios (base × tasa diaria × días de atraso)', 'interes')}
            {tr('', 'TOTAL A PAGAR CON MORA (saldo casilla 58 + multa por mora + intereses)', 'totalMora', 'strong')}
          </tbody></table></div>

          <div className="iva-rubro">Saldos a trasladar al período siguiente</div>
          <div className="iva-tblw"><table className="iva-tbl"><tbody>
            {tr('→ 46', 'Saldo anterior de IVA (técnico) – tomado de la casilla 47', 47)}
            {tr('→ 51', 'Saldo anterior de retenciones (financiero) – tomado de la casilla 54', 54)}
            {tr('IRE', 'Saldo anterior de Renta (informativo, sin cambios en esta liquidación)', 'sire')}
          </tbody></table></div>

          <div className="iva-rubro">Indicadores del período</div>
          <div className="iva-tblw"><table className="iva-tbl"><tbody>
            {tr('', 'Ventas gravadas netas (base)', 'ventasNetas')}
            {tr('', 'Compras gravadas netas (base)', 'comprasNetas')}
            {tr('', 'Margen bruto aparente (ventas – compras gravadas)', 'margen')}
            {tr('', 'IVA crédito / IVA débito', 'ratio')}
          </tbody></table></div>

          <div className="iva-group">
            <h3>Nota de este mes (no sale en la ficha)</h3>
            <input type="text" value={draft.nota || ''} onChange={(e) => setField('nota', e.target.value)} aria-label="Nota de este mes" />
          </div>
        </div>

        <aside className="iva-side">
          <Ficha ref={fichaRef} model={fichaModel(fichaCtx, draft)} firmaTxt={firma(config)} />
          <div className="iva-actions">
            <button
              type="button"
              className="iva-btn primary"
              onClick={async () => {
                try {
                  const blob = await fichaBlob(fichaRef.current);
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(blob);
                  a.download = fileBase(fichaCtx) + '.png';
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  markSent();
                } catch { toast('No se pudo generar la imagen'); }
              }}
            >
              Descargar imagen
            </button>
            <button
              type="button"
              className="iva-btn"
              onClick={async () => {
                try { await exportFichaPDF(fichaCtx, draft); markSent(); } catch { toast('No se pudo generar el PDF'); }
              }}
            >
              Descargar PDF
            </button>
            <button
              type="button"
              className="iva-btn"
              onClick={async () => {
                try { await exportLibroPDF(fichaCtx, draft); } catch (error) { toast(error.message || 'No se pudo generar el libro en PDF'); }
              }}
            >
              Libro de compras y ventas (PDF)
            </button>
            <button type="button" className="iva-btn" onClick={() => setMarangatuOpen(true)}>
              Copiar a Marangatu
            </button>
            <button type="button" className="iva-btn" onClick={() => setDescargaOpen(true)}>
              Descargar formularios
            </button>
            <button
              type="button"
              className="iva-btn"
              onClick={async () => {
                try {
                  const blob = await fichaBlob(fichaRef.current);
                  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                  toast('Imagen copiada, pegala en el chat del cliente');
                  markSent();
                } catch { toast('Este navegador no permite copiar imágenes; usá Descargar imagen'); }
              }}
            >
              Copiar imagen
            </button>
            <button
              type="button"
              className="iva-btn"
              onClick={async () => {
                try { await navigator.clipboard.writeText(waText(fichaCtx, draft)); toast('Texto copiado'); } catch { toast('No se pudo copiar'); }
              }}
            >
              Copiar texto
            </button>
            {wa.trim() && (
              <span className="iva-wa-grupo">
                <button type="button" className="iva-btn iva-btn-wa" onClick={() => enviarPorWhatsapp(fichaCtx)}>
                  Enviar por WhatsApp
                </button>
                <select
                  className="iva-wa-destino"
                  value={waDestino}
                  onChange={(e) => {
                    setWaDestino(e.target.value);
                    try { localStorage.setItem(WA_DESTINO_KEY, e.target.value); } catch { /* preferencia opcional */ }
                  }}
                  aria-label="Abrir el chat en"
                  title="Dónde se abre el chat"
                >
                  <option value="web">WhatsApp Web</option>
                  <option value="app">App de escritorio</option>
                </select>
              </span>
            )}
          </div>
          <div className="hint">Así ve el cliente la ficha. El color del encabezado corresponde a su día de vencimiento.</div>
        </aside>
      </div>

      {marangatuOpen && (
        <MarangatuModal ctx={fichaCtx} draft={draft} onClose={() => setMarangatuOpen(false)} toast={toast} />
      )}
      {descargaOpen && <DescargaFormularios ctx={fichaCtx} onClose={() => setDescargaOpen(false)} />}
    </div>
  );
}

// Revisión de las casillas antes de mandarlas a la extensión, que después
// las escribe en el Formulario 120 de Marangatu. La presentación la confirma
// siempre la persona: la extensión nunca pulsa "Presentar".
function MarangatuModal({ ctx, draft, onClose, toast }) {
  const { cargar, control, avisos } = useMemo(() => casillasFormulario120(ctx, draft), [ctx, draft]);
  const [soloConImporte, setSoloConImporte] = useState(true);
  const [status, setStatus] = useState('idle'); // idle | sending | sent | no-extension
  const visibles = soloConImporte ? cargar.filter((c) => c.valor) : cargar;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(casillasTexto(ctx, draft));
      toast('Lista de casillas copiada');
    } catch {
      toast('No se pudo copiar');
    }
  };

  const enviar = async () => {
    setStatus('sending');
    const resp = await sendIvaToMarangatu({
      ruc: ctx.cliente.ruc,
      nombre: ctx.cliente.nombre,
      periodo: ctx.periodo,
      casillas: cargar,
      control,
      credentials: ctx.cliente.marangatu,
    });
    if (resp.ok) setStatus('sent');
    else if (resp.error === 'NO_EXTENSION') setStatus('no-extension');
    else {
      setStatus('idle');
      toast(resp.error === 'TAREA_EN_CURSO' ? mensajeDeError(resp.error) : 'La extensión rechazó el envío: ' + resp.error);
    }
  };

  return (
    <div className="iva-modal-backdrop" onClick={onClose}>
      <div className="iva-modal" role="dialog" aria-modal="true" aria-labelledby="iva-mg-title" onClick={(e) => e.stopPropagation()}>
        <div className="iva-modal-head">
          <div>
            <h2 id="iva-mg-title">Copiar a Marangatu</h2>
            <p className="sub">Formulario 120 · {ctx.cliente.nombre}</p>
            <p className="iva-ref">
              IVA de <b>{perLabel(ctx.periodo)}</b> (se presenta en {perLabel(shiftPer(ctx.periodo, 1))}).
              En Marangatu: <b>211 - IVA General · Mensual · {perLabel(ctx.periodo).split(' ')[1]} · {perLabel(ctx.periodo).split(' ')[0]}</b>
            </p>
          </div>
          <button type="button" className="iva-iconbtn" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </div>

        {status === 'sent' ? (
          <div className="iva-modal-body">
            <ol className="iva-steps">
              <li>{ctx.cliente.marangatu ? 'Se abrió Marangatu e inicia sesión con la clave del cliente.' : 'Se abrió Marangatu: iniciá sesión con la clave del cliente.'}</li>
              <li>La extensión entra a <b>Presentar Declaración</b> y elige <b>211 - IVA General · Mensual · {perLabel(ctx.periodo)}</b>. Revisá la selección y continuá.</li>
              <li>En el formulario, tocá el ícono de la extensión <b>Ekuatia Login</b> → <b>Completar formulario</b>.</li>
              <li>Revisá cada casilla marcada en amarillo y presentá vos la declaración.</li>
            </ol>
            <p className="hint">Los datos quedan en la extensión 30 minutos y se borran al cerrar el navegador.</p>
          </div>
        ) : (
          <div className="iva-modal-body">
            <label className="iva-chk sm">
              <input type="checkbox" checked={soloConImporte} onChange={(e) => setSoloConImporte(e.target.checked)} />
              <span>Mostrar sólo casillas con importe</span>
            </label>
            <div className="iva-tblw iva-modal-list">
              <table className="iva-tbl">
                <tbody>
                  <tr className="strong"><td colSpan={3}>Se cargan (monto imponible; Marangatu calcula el IVA)</td></tr>
                  {visibles.map((c) => (
                    <tr key={c.cas}><td className="cas">{c.cas}</td><td>{c.label}</td><td className="num">{gs(c.valor)}</td></tr>
                  ))}
                  {!visibles.length && <tr><td colSpan={3} className="sub">No hay casillas con importe todavía.</td></tr>}
                  <tr className="strong"><td colSpan={3}>Control: Marangatu tiene que llegar a</td></tr>
                  {control.map((c) => (
                    <tr key={'k' + c.cas}><td className="cas">{c.cas}</td><td>{c.label}</td><td className="num">{gs(c.valor)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="iva-avisos">
              {avisos.map((a) => <li key={a}>{a}</li>)}
            </ul>
            {status === 'no-extension' && (
              <div className="iva-error iva-modal-alert" role="alert">
                No se encontró la extensión Ekuatia Login (o falta configurar su ID). Podés copiar la lista y cargarla a mano.
              </div>
            )}
            <p className="hint">Revisá los importes antes de enviarlos. La extensión sólo completa los campos: la presentación la confirmás vos en Marangatu.</p>
          </div>
        )}

        <div className="iva-modal-foot">
          <button type="button" className="iva-btn" onClick={copiar}>Copiar lista</button>
          {status === 'sent' ? (
            <button type="button" className="iva-btn primary" onClick={onClose}>Listo</button>
          ) : (
            <button type="button" className="iva-btn primary" onClick={enviar} disabled={status === 'sending'}>
              {status === 'sending' ? 'Enviando…' : 'Enviar a la extensión'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// La ficha mantiene colores fijos (fondo blanco) en ambos temas: es la
// imagen que recibe el cliente.
function Ficha({ ref, model: m, firmaTxt }) {
  const resCol = m.aPagar ? '#B42318' : '#0E6B4F';
  const resBg = m.aPagar ? '#FDECEA' : '#E6F4EE';
  return (
    <div className="iva-ficha" ref={ref}>
      <div className="fh" style={{ background: m.color, color: textOn(m.color) }}>
        <div className="per">{m.per.replace('IVA - ', 'IVA · ')}</div>
        <div className="cl">{m.nombre}</div>
        <div className="ruc">{m.ruc}</div>
      </div>
      <div className="body">
        {m.secs.map((s) => (
          <div key={s.t}>
            <div className="sec">{s.t}</div>
            {s.lines.map(([a, b]) => (
              <div className="ln" key={a}><span>{a}</span><span>{gs(b)}</span></div>
            ))}
          </div>
        ))}
      </div>
      <div className="res" style={{ background: resBg, color: resCol }}>
        <div className="k">{m.resLabel}</div>
        <div className="v">Gs. {gs(m.resVal)}</div>
      </div>
      <div className="venc"><span>Vencimiento</span><b>{m.venc}</b></div>
      <div className="pie">{m.pie}</div>
      <div className="pie firma">{firmaTxt}</div>
    </div>
  );
}
