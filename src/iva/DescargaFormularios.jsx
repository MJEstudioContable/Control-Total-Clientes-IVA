import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { cancelarDescargaIva, cerrarSesionMarangatu, mensajeDeError, pedirDescargaIva, suscribirDescargaIva } from '../marangatu';
import { perLabel, shiftPer } from './ivaCore';

// Descarga de los formularios de IVA ya presentados de un cliente (PDF por
// período). La extensión Ekuatia Login hace el trabajo en Marangatu; esta
// ventana pide la descarga y refleja el avance en vivo. Se puede cerrar: la
// descarga sigue y, al volver a abrirla, muestra dónde va.
export default function DescargaFormularios({ ctx, onClose }) {
  const [modo, setModo] = useState('ultimos'); // ultimos | rango
  const [ultimos, setUltimos] = useState(6);
  const [desde, setDesde] = useState(shiftPer(ctx.periodo, -5));
  const [hasta, setHasta] = useState(ctx.periodo);
  const [estado, setEstado] = useState(undefined); // undefined = conectando, null = sin extensión
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => suscribirDescargaIva(setEstado), []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Períodos AAAA-MM entre desde y hasta (el formato que usa la app).
  const periodos = useMemo(() => {
    const out = [];
    let p = desde;
    while (p <= hasta && out.length <= 24) { out.push(p); p = shiftPer(p, 1); }
    return out;
  }, [desde, hasta]);

  const rangoInvalido = modo === 'rango' && (!periodos.length || periodos.length > 24);
  const enCurso = !!estado?.activo;
  const propia = enCurso && (!estado.ruc || estado.ruc === ctx.cliente.ruc);

  const iniciar = async () => {
    setError('');
    setEnviando(true);
    const resp = await pedirDescargaIva({
      ruc: ctx.cliente.ruc,
      nombre: ctx.cliente.nombre,
      ...(modo === 'rango' ? { periodos } : { ultimos }),
      credentials: ctx.cliente.marangatu,
    });
    setEnviando(false);
    if (resp.ok) return;
    if (resp.error === 'NO_EXTENSION') setEstado(null);
    else if (resp.error === 'DESCARGA_EN_CURSO' || resp.error === 'TAREA_EN_CURSO') setError(mensajeDeError(resp.error));
    else setError('La extensión rechazó el pedido: ' + resp.error);
  };

  const cerrarSesion = async () => {
    setError('');
    const resp = await cerrarSesionMarangatu();
    if (!resp.ok && resp.error !== 'NO_EXTENSION') setError(mensajeDeError(resp.error));
  };

  // Sesión abierta en Marangatu y si es de otro cliente que el de esta ficha.
  const sesion = estado?.sesion;
  const rucSesion = sesion?.logueado ? (sesion.rucs || []) : [];
  const norm = (r) => String(r || '').replace(/\D/g, '');
  const mismo = (a, b) => { const x = norm(a); const y = norm(b); return !!x && !!y && (x === y || x.slice(0, -1) === y || x === y.slice(0, -1)); };
  const otroCliente = rucSesion.length > 0 && !rucSesion.some((r) => mismo(ctx.cliente.ruc, r));

  const pct = estado?.total ? Math.round((estado.hechos / estado.total) * 100) : 0;

  return (
    <div className="iva-modal-backdrop" onClick={onClose}>
      <div className="iva-modal" role="dialog" aria-modal="true" aria-labelledby="iva-dl-title" onClick={(e) => e.stopPropagation()}>
        <div className="iva-modal-head">
          <div>
            <h2 id="iva-dl-title">Descargar formularios</h2>
            <p className="sub">Declaraciones de IVA presentadas · {ctx.cliente.nombre}</p>
          </div>
          <button type="button" className="iva-iconbtn" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </div>

        <div className="iva-modal-body">
          {estado === null && (
            <div className="iva-error iva-modal-alert" role="alert">
              No se encontró la extensión Ekuatia Login (o falta configurar su ID en VITE_MARANGATU_EXT_ID).
            </div>
          )}

          {sesion?.logueado && (
            <p className={otroCliente ? 'iva-error iva-modal-alert' : 'hint'} role={otroCliente ? 'alert' : undefined}>
              {otroCliente
                ? `Hay una sesión abierta en Marangatu de otro RUC (${rucSesion.join(', ')}). Al descargar se cierra y se entra con este cliente.`
                : `Sesión abierta en Marangatu${sesion.usuario ? ' · ' + sesion.usuario : ''}${rucSesion.length ? ' · RUC ' + rucSesion.join(', ') : ''}.`}
            </p>
          )}
          {estado?.aviso && <div className="iva-error iva-modal-alert" role="alert">{estado.aviso}</div>}

          {enCurso ? (
            <div role="status" aria-live="polite">
              <p><b>{propia ? ctx.cliente.nombre : (estado.nombre || 'Otro cliente')}</b>: {estado.mensaje}</p>
              {estado.total > 0 && (
                <>
                  <div className="iva-prog" aria-hidden="true"><div style={{ width: pct + '%' }} /></div>
                  <p className="hint">{estado.hechos} de {estado.total} formularios</p>
                </>
              )}
              <p className="hint">Por cada formulario aparece el diálogo de impresión del navegador: elegí «Guardar como PDF».</p>
            </div>
          ) : (
            <>
              {estado?.fase === 'terminado' && <p className="iva-ok" role="status">{estado.mensaje}</p>}
              {estado?.fase === 'error' && <div className="iva-error iva-modal-alert" role="alert">{estado.error}</div>}
              {estado?.fase === 'cancelado' && <p className="hint">{estado.mensaje}</p>}

              <div className="iva-dl-ops">
                <label className="iva-chk sm">
                  <input type="radio" name="iva-dl-modo" checked={modo === 'ultimos'} onChange={() => setModo('ultimos')} />
                  <span>Últimos</span>
                  <select value={ultimos} onChange={(e) => setUltimos(Number(e.target.value))} disabled={modo !== 'ultimos'}>
                    {[1, 3, 6, 12].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'mes' : 'meses'}</option>)}
                  </select>
                </label>
                <label className="iva-chk sm">
                  <input type="radio" name="iva-dl-modo" checked={modo === 'rango'} onChange={() => setModo('rango')} />
                  <span>Rango</span>
                  <input type="month" value={desde} max={hasta} onChange={(e) => e.target.value && setDesde(e.target.value)} disabled={modo !== 'rango'} />
                  <span>a</span>
                  <input type="month" value={hasta} min={desde} onChange={(e) => e.target.value && setHasta(e.target.value)} disabled={modo !== 'rango'} />
                </label>
              </div>
              {modo === 'rango' && !rangoInvalido && (
                <p className="hint">{perLabel(desde)} a {perLabel(hasta)} · {periodos.length} {periodos.length === 1 ? 'formulario' : 'formularios'}</p>
              )}
              {rangoInvalido && <p className="hint">Elegí un rango de hasta 24 meses.</p>}
              {error && <div className="iva-error iva-modal-alert" role="alert">{error}</div>}
              <p className="hint">
                {ctx.cliente.marangatu
                  ? 'La extensión inicia sesión con la clave del cliente y baja cada formulario.'
                  : 'Se abre Marangatu: iniciá sesión con la clave del cliente y la extensión sigue sola.'}
                {' '}Los archivos se llaman IVA_AAAA_MM_RUC.pdf.
              </p>
            </>
          )}
        </div>

        <div className="iva-modal-foot">
          {enCurso ? (
            <button type="button" className="iva-btn" onClick={() => cancelarDescargaIva()}>Cancelar descarga</button>
          ) : (
            <button type="button" className="iva-btn primary" onClick={iniciar} disabled={enviando || rangoInvalido || estado === null}>
              {enviando ? 'Enviando…' : 'Descargar'}
            </button>
          )}
          {sesion?.logueado && (
            <button type="button" className="iva-btn" onClick={cerrarSesion}>{enCurso ? 'Cancelar y cerrar sesión' : 'Cerrar sesión de Marangatu'}</button>
          )}
          <button type="button" className="iva-btn" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
