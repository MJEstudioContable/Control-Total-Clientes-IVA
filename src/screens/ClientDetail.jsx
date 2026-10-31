import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useClientsMeta } from '../context/ClientsContext';
import {
  pickNameColumn,
  findUserStampColumn,
  findPresentadoColumn,
  findArchivadoColumn,
  findRucColumn,
  findClaveMarangatuColumn,
  getFieldType,
  getDisplayHeader,
  formatPeriodLabel,
} from '../utils';
import { openMarangatuLogin } from '../marangatu';
import { splitRuc } from '../iva/ivaCore';
import {
  ArrowLeft,
  Receipt,
  Check,
  Save,
  AlertCircle,
  CheckCircle2,
  XCircle,
  FileText,
  Building2,
  Archive,
} from 'lucide-react';

// Cuánto queda visible el ✓ "Guardado" después de pintar el cambio.
const SAVED_FEEDBACK_MS = 1800;

const gridVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.03,
      delayChildren: 0.05,
    },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 12, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring', stiffness: 350, damping: 25 },
  },
};

export default function ClientDetail({
  user,
  year,
  month,
  client,
  onBack,
  canAssignClients,
  readOnlyPreview = false,
  onOpenIva,
}) {
  // El detalle también escribe sobre el estado compartido del período: así
  // lo que se edita acá ya está actualizado en la lista y en "Asignar
  // clientes" cuando se vuelve, sin recargar nada. Usa useClientsMeta()
  // para no re-renderizarse cuando cambian `rows`, filtros o `savedRows`.
  const { saveRowUpdatesInBackground, encargadoCol, teamUsers, repartoUsers } = useClientsMeta();

  const [values, setValues] = useState(client);
  const [savedField, setSavedField] = useState(null);
  const [activeField, setActiveField] = useState(null);
  const [error, setError] = useState('');

  // Timer del ✓ "Guardado". Se limpia al desmontar: si el usuario vuelve a
  // la lista antes de que se cumpla, no queda un setState colgado.
  const savedTimer = useRef(null);
  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    []
  );

  const fields = useMemo(() => {
    // Excluye TODOS los campos internos que arrancan con "_" (no solo
    // _row): son cálculos del frontend (como _assignedUser, el
    // encargado calculado por round-robin) que nunca fueron columnas
    // reales de tu hoja -- si se cuelan acá, aparecen en el formulario
    // con su nombre de variable tal cual ("_assignedUser") en vez de
    // algo legible, porque no existen en getDisplayHeader.
    return Object.keys(client).filter((k) => !k.startsWith('_'));
  }, [client]);

  const nameKey = pickNameColumn(fields);
  const clientName = values[nameKey] || client[nameKey] || 'Cliente';

  const presentadoPorCol = useMemo(() => findUserStampColumn(fields, 'presentado'), [fields]);
  const archivadoPorCol = useMemo(() => findUserStampColumn(fields, 'archivado'), [fields]);

  // El campo Encargado se edita con un desplegable del equipo completo. Los
  // que no participan del reparto automático van en su propio grupo, pero
  // se pueden elegir igual: la lista de participantes acota sólo el reparto,
  // nunca a quién se le puede asignar un cliente a mano.
  const nonParticipants = useMemo(
    () => (teamUsers || []).filter((u) => !(repartoUsers || []).includes(u)),
    [teamUsers, repartoUsers]
  );

  const presUser = presentadoPorCol && values[presentadoPorCol] ? String(values[presentadoPorCol]) : null;
  const archUser = archivadoPorCol && values[archivadoPorCol] ? String(values[archivadoPorCol]) : null;

  // Credenciales de Marangatu de esta fila. Sólo se ofrece el botón cuando
  // la planilla tiene ambas columnas y la fila tiene los dos valores: sin
  // clave no hay nada que autocompletar. En el preview de sólo lectura no
  // se expone.
  const marangatuCredentials = useMemo(() => {
    if (readOnlyPreview) return null;
    const rucColumn = findRucColumn(fields);
    const claveColumn = findClaveMarangatuColumn(fields);
    if (!rucColumn || !claveColumn) return null;

    const ruc = String(values[rucColumn] ?? '').trim();
    const clave = String(values[claveColumn] ?? '').trim();
    if (!ruc || !clave) return null;

    return { user: ruc, pass: clave };
  }, [fields, values, readOnlyPreview]);

  // RUC sin DV: identifica al cliente en Vencimientos IVA.
  const ivaRuc = useMemo(() => {
    const rucColumn = findRucColumn(fields);
    return rucColumn ? splitRuc(values[rucColumn]).ruc : '';
  }, [fields, values]);

  // Guardado fluido: el valor se pinta AL INSTANTE (formulario + estado
  // compartido) y el ✓ "Guardado" aparece en el mismo gesto. La escritura
  // real en la planilla queda delegada en la cola de fondo, que agrupa los
  // cambios y los manda en lote.
  //
  // Antes se esperaba la respuesta del backend (Apps Script tarda 1-3 s)
  // con un spinner y los controles deshabilitados, así que no se podía
  // seguir editando hasta que llegara. Ahora nada se bloquea: si el
  // guardado falla, el contexto revierte el estado compartido y el
  // formulario acompaña revirtiendo sus valores locales, más el banner.
  function saveField(column, newValue) {
    if (readOnlyPreview) return;

    const valToSave = newValue !== undefined ? newValue : values[column];

    const updates = { [column]: valToSave };

    // Auto fill user stamp if marking SÍ on Presentado / Archivado, clear if NO
    if (valToSave === 'SI' || valToSave === 'SÍ') {
      if (findPresentadoColumn([column]) && presentadoPorCol && column !== presentadoPorCol) {
        updates[presentadoPorCol] = user;
      } else if (findArchivadoColumn([column]) && archivadoPorCol && column !== archivadoPorCol) {
        updates[archivadoPorCol] = user;
      }
    } else if (valToSave === 'NO' || valToSave === '') {
      if (findPresentadoColumn([column]) && presentadoPorCol && column !== presentadoPorCol) {
        updates[presentadoPorCol] = '';
      } else if (findArchivadoColumn([column]) && archivadoPorCol && column !== archivadoPorCol) {
        updates[archivadoPorCol] = '';
      }
    }

    // Valores anteriores, para poder rebobinar el formulario si falla.
    const prevValues = {};
    Object.keys(updates).forEach((col) => {
      prevValues[col] = values[col];
    });

    // Pintado inmediato: formulario local + estado compartido (lista y
    // "Asignar clientes" ven el cambio sin recargar).
    setValues((prev) => ({ ...prev, ...updates }));
    setError('');

    // El ✓ se muestra en el mismo gesto, no cuando responde el backend.
    setSavedField(column);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => {
      savedTimer.current = null;
      setSavedField(null);
    }, SAVED_FEEDBACK_MS);

    saveRowUpdatesInBackground(client._row, updates).catch((err) => {
      // El contexto ya revirtió las celdas del estado compartido que todavía
      // conservaban el valor fallido. El formulario hace exactamente lo
      // mismo: sólo rebobina lo que no se volvió a tocar entre medio.
      setSavedField((prev) => (prev === column ? null : prev));
      setValues((prev) => {
        let next = null;
        Object.entries(updates).forEach(([col, val]) => {
          if (prev[col] === val) {
            if (!next) next = { ...prev };
            next[col] = prevValues[col];
          }
        });
        return next || prev;
      });
      setError(`No se pudo guardar "${column}": ${err.message}`);
    });
  }

  return (
    <div className="screen wide">
      <div className="screen-header">
        <motion.button
          className="back-btn"
          whileHover={{ scale: 1.04, x: -2 }}
          whileTap={{ scale: 0.95 }}
          onClick={onBack}
        >
          <ArrowLeft size={16} />
          <span>Volver a la lista</span>
        </motion.button>

        <div className="save-all-notice">
          <FileText size={14} />
          <span>{readOnlyPreview ? 'Vista de sólo lectura' : 'Cambios sincronizados en vivo'}</span>
        </div>
      </div>

      {/* Header Banner Card */}
      <motion.div
        className="client-detail-header"
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      >
        <div className="client-detail-identity">
          <motion.div
            className="client-detail-avatar"
            initial={{ scale: 0, rotate: -15 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20, delay: 0.1 }}
          >
            <Building2 size={24} />
          </motion.div>
          <div>
            <h2 className="client-detail-title">{clientName}</h2>
            <div className="client-detail-meta" style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: '4px' }}>
              <span>Fila #{client._row} • {formatPeriodLabel(month, year)}</span>

              {/* Acceso a Marangatu: abre el login de la SET y, si la
                  extensión está instalada, lo autocompleta con el RUC y la
                  clave de esta fila. Las credenciales viajan sólo por el
                  canal de la extensión (nunca por la URL). */}
              {marangatuCredentials && (
                <button
                  type="button"
                  className="marangatu-btn"
                  title={`Abrir Marangatu con el RUC ${marangatuCredentials.user}`}
                  aria-label="Abrir Marangatu con las credenciales de este cliente"
                  onClick={() => openMarangatuLogin(marangatuCredentials, (m) => window.alert(m))}
                >
                  <img className="marangatu-logo" src="/marangatu.svg" alt="" aria-hidden="true" />
                </button>
              )}

              {onOpenIva && ivaRuc && (
                <button
                  type="button"
                  className="iva-open-btn"
                  title="Abrir la liquidación de IVA de este cliente"
                  onClick={() => onOpenIva(ivaRuc)}
                >
                  <Receipt size={14} />
                  <span>Liquidación IVA</span>
                </button>
              )}

              {(presUser || archUser) && (
                <div className="stamps-row" style={{ marginTop: '2px' }}>
                  {presUser && (
                    <span className="user-stamp-badge presentado">
                      <CheckCircle2 size={11} /> {presUser === user ? 'Presentado por ti' : <>Presentado por: <strong>{presUser}</strong></>}
                    </span>
                  )}
                  {archUser && (
                    <span className="user-stamp-badge archivado">
                      <Archive size={11} /> {archUser === user ? 'Archivado por ti' : <>Archivado por: <strong>{archUser}</strong></>}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {error && (
        <motion.div
          className="error-banner"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <AlertCircle size={20} style={{ flexShrink: 0 }} />
          <div>{error}</div>
        </motion.div>
      )}

      {/* Field Cards Grid */}
      <motion.div
        className="field-grid"
        variants={gridVariants}
        initial="hidden"
        animate="visible"
      >
        {fields.map((field) => {
          const isEncargadoField = Boolean(encargadoCol) && field === encargadoCol;
          // Encargado tiene su rama propia y nunca debe caer en los controles
          // genéricos/híbridos, especialmente para el rol USUARIO.
          const fieldType = isEncargadoField
            ? 'assignment'
            : getFieldType(field, values[field]);
          const isJustSaved = savedField === field;
          const isActive = activeField === field;
          const currentValue = String(values[field] ?? '').trim().toUpperCase();
          // Si la hoja tiene un encargado que ya no está en el equipo
          // sincronizado, se conserva como opción en vez de blanquearlo.
          const encargadoActual = String(values[field] ?? '').trim();
          const encargadoFueraDeEquipo =
            isEncargadoField && encargadoActual && !(teamUsers || []).includes(encargadoActual)
              ? encargadoActual
              : '';

          return (
            <motion.div
              className={`field-card ${isActive ? 'field-card-active' : ''}`}
              key={field}
              variants={cardVariants}
              whileHover={{ y: -2, transition: { duration: 0.15 } }}
            >
              <div className="field-label">
                <span className="field-label-wrapper">
                  <span>{getDisplayHeader(field)}</span>
                  {isActive && <span className="active-field-badge">Activo</span>}
                </span>
                <AnimatePresence>
                  {isJustSaved && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.7 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.7 }}
                      style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: '2px' }}
                    >
                      <Check size={12} /> Guardado
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>

              {readOnlyPreview ? (
                <div className="field-readonly-value" title="Preview ejecutivo de sólo lectura">
                  {String(values[field] ?? '').trim() || '—'}
                </div>
              ) : fieldType === 'pure_yesno' ? (
                <div className="yesno-toggle-group">
                  <motion.button
                    type="button"
                    className={`yesno-toggle-btn ${
                      currentValue === 'SI' || currentValue === 'SÍ' ? 'active-si' : ''
                    }`}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.95 }}
                    onFocus={() => setActiveField(field)}
                    onClick={() => saveField(field, 'SI')}
                  >
                    <CheckCircle2 size={14} />
                    <span>SÍ</span>
                  </motion.button>

                  <motion.button
                    type="button"
                    className={`yesno-toggle-btn ${currentValue === 'NO' ? 'active-no' : ''}`}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.95 }}
                    onFocus={() => setActiveField(field)}
                    onClick={() => saveField(field, 'NO')}
                  >
                    <XCircle size={14} />
                    <span>NO</span>
                  </motion.button>

                  <motion.button
                    type="button"
                    className="yesno-toggle-btn"
                    whileHover={{ scale: 1.08 }}
                    whileTap={{ scale: 0.92 }}
                    style={{ flex: '0 0 auto', padding: '8px' }}
                    title="Limpiar campo"
                    onFocus={() => setActiveField(field)}
                    onClick={() => saveField(field, '')}
                  >
                    -
                  </motion.button>
                </div>
              ) : fieldType === 'hybrid' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div className="yesno-toggle-group">
                    <motion.button
                      type="button"
                      className={`yesno-toggle-btn ${
                        currentValue === 'SI' || currentValue === 'SÍ' ? 'active-si' : ''
                      }`}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => saveField(field, 'SI')}
                    >
                      <CheckCircle2 size={13} />
                      <span>SÍ</span>
                    </motion.button>

                    <motion.button
                      type="button"
                      className={`yesno-toggle-btn ${currentValue === 'NO' ? 'active-no' : ''}`}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => saveField(field, 'NO')}
                    >
                      <XCircle size={13} />
                      <span>NO</span>
                    </motion.button>
                  </div>

                  <div className="field-input-row">
                    <input
                      type="text"
                      className="field-input"
                      placeholder="Escribir texto o nombre..."
                      value={values[field] ?? ''}
                      onFocus={() => setActiveField(field)}
                      onBlur={() => setActiveField((prev) => (prev === field ? null : prev))}
                      onChange={(e) => setValues({ ...values, [field]: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveField(field);
                      }}
                    />
                    <motion.button
                      className={`field-save-btn ${isJustSaved ? 'saved' : ''}`}
                      whileHover={{ scale: 1.08 }}
                      whileTap={{ scale: 0.92 }}
                      disabled={values[field] === client[field]}
                      onClick={() => saveField(field)}
                    >
                      {isJustSaved ? (
                        <Check size={15} />
                      ) : (
                        <Save size={15} />
                      )}
                    </motion.button>
                  </div>
                </div>
              ) : isEncargadoField ? (
                canAssignClients ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {/* Encargado con el equipo COMPLETO: los que participan del
                      reparto automático y los que no. Elegir a uno de afuera
                      es una asignación manual y es totalmente válida. */}
                  <select
                    className="select-input"
                    value={encargadoActual}
                    onFocus={() => setActiveField(field)}
                    onBlur={() => setActiveField((prev) => (prev === field ? null : prev))}
                    onChange={(e) => saveField(field, e.target.value)}
                  >
                    <option value="">Sin asignar</option>
                    {encargadoFueraDeEquipo && (
                      <option value={encargadoFueraDeEquipo}>
                        {encargadoFueraDeEquipo} (fuera del equipo)
                      </option>
                    )}
                    {(repartoUsers || []).length > 0 && (
                      <optgroup label="Participan del reparto">
                        {(repartoUsers || []).map((u) => (
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

                  {/* Se conserva la escritura libre: si hace falta cargar un
                      nombre que no está en el equipo, se puede. */}
                  <div className="field-input-row">
                    <input
                      type="text"
                      className="field-input"
                      placeholder="Otro nombre (se escribe tal cual en la hoja)"
                      value={values[field] ?? ''}
                      onFocus={() => setActiveField(field)}
                      onBlur={() => setActiveField((prev) => (prev === field ? null : prev))}
                      onChange={(e) => setValues({ ...values, [field]: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveField(field);
                      }}
                    />
                    <motion.button
                      className={`field-save-btn ${isJustSaved ? 'saved' : ''}`}
                      whileHover={{ scale: 1.08 }}
                      whileTap={{ scale: 0.92 }}
                      disabled={values[field] === client[field]}
                      onClick={() => saveField(field)}
                    >
                      {isJustSaved ? (
                        <Check size={15} />
                      ) : (
                        <Save size={15} />
                      )}
                    </motion.button>
                  </div>
                </div>
                ) : (
                  <div className="field-readonly-value" title="Solo administradores pueden cambiar este campo">
                    {encargadoActual || 'Sin asignar'}
                  </div>
                )
              ) : (
                <div className="field-input-row">
                  <input
                    type="text"
                    className="field-input"
                    placeholder="Escribir..."
                    value={values[field] ?? ''}
                    onFocus={() => setActiveField(field)}
                    onBlur={() => setActiveField((prev) => (prev === field ? null : prev))}
                    onChange={(e) => setValues({ ...values, [field]: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveField(field);
                    }}
                  />
                  <motion.button
                    className={`field-save-btn ${isJustSaved ? 'saved' : ''}`}
                    whileHover={{ scale: 1.08 }}
                    whileTap={{ scale: 0.92 }}
                    disabled={values[field] === client[field]}
                    onClick={() => saveField(field)}
                  >
                    {isJustSaved ? (
                      <Check size={15} />
                    ) : (
                      <Save size={15} />
                    )}
                  </motion.button>
                </div>
              )}
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}
