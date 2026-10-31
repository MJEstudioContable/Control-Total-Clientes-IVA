import { useState } from 'react';
import { motion } from 'motion/react';
import { api } from '../api';
import {
  getFieldType,
  getDisplayHeader,
  formatPeriodLabel,
  findEncargadoColumn,
} from '../utils';
import {
  ArrowLeft,
  UserPlus,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Calendar,
} from 'lucide-react';

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

export default function NewClient({
  year,
  month,
  headers,
  canAssignClients,
  onCreated,
  onCancel,
}) {
  const encargadoCol = findEncargadoColumn(headers);
  const [values, setValues] = useState(() => {
    const initial = {};
    headers.forEach((h) => {
      initial[h] = '';
    });
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleCreate() {
    setSaving(true);
    setError('');
    try {
      await api.createClient({ year, sheet: month, values });
      onCreated();
    } catch (err) {
      setError(err.message || 'Ocurrió un error al crear el cliente');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="screen wide">
      <div className="screen-header">
        <motion.button
          className="back-btn"
          whileHover={{ scale: 1.04, x: -2 }}
          whileTap={{ scale: 0.95 }}
          onClick={onCancel}
        >
          <ArrowLeft size={16} />
          <span>Cancelar</span>
        </motion.button>

        <div className="save-all-notice">
          <Calendar size={14} />
          <span>Planilla {formatPeriodLabel(month, year)}</span>
        </div>
      </div>

      <motion.div
        className="client-detail-header"
        style={{ marginBottom: '24px' }}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      >
        <div className="client-detail-identity">
          <motion.div
            className="client-detail-avatar"
            style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
            initial={{ scale: 0, rotate: -15 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20, delay: 0.1 }}
          >
            <UserPlus size={24} />
          </motion.div>
          <div>
            <h2 className="client-detail-title">Nuevo Cliente</h2>
            <div className="client-detail-meta">
              Completá los campos para agregar un nuevo registro a la planilla.
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

      <motion.div
        className="field-grid"
        variants={gridVariants}
        initial="hidden"
        animate="visible"
      >
        {headers.map((header) => {
          const isEncargadoField = Boolean(encargadoCol) && header === encargadoCol;
          const fieldType = getFieldType(header, values[header]);
          const val = values[header] || '';

          return (
            <motion.div
              className="field-card"
              key={header}
              variants={cardVariants}
              whileHover={{ y: -2, transition: { duration: 0.15 } }}
            >
              <div className="field-label">
                <span>{getDisplayHeader(header)}</span>
              </div>

              {isEncargadoField && !canAssignClients ? (
                <div className="field-readonly-value" title="Solo administradores pueden asignar clientes">
                  Sin asignar
                </div>
              ) : fieldType === 'pure_yesno' ? (
                <div className="yesno-toggle-group">
                  <motion.button
                    type="button"
                    className={`yesno-toggle-btn ${val === 'SI' || val === 'SÍ' ? 'active-si' : ''}`}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setValues({ ...values, [header]: 'SI' })}
                  >
                    <CheckCircle2 size={14} />
                    <span>SÍ</span>
                  </motion.button>

                  <motion.button
                    type="button"
                    className={`yesno-toggle-btn ${val === 'NO' ? 'active-no' : ''}`}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setValues({ ...values, [header]: 'NO' })}
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
                    onClick={() => setValues({ ...values, [header]: '' })}
                  >
                    -
                  </motion.button>
                </div>
              ) : fieldType === 'hybrid' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div className="yesno-toggle-group">
                    <motion.button
                      type="button"
                      className={`yesno-toggle-btn ${val === 'SI' || val === 'SÍ' ? 'active-si' : ''}`}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => setValues({ ...values, [header]: 'SI' })}
                    >
                      <CheckCircle2 size={13} />
                      <span>SÍ</span>
                    </motion.button>

                    <motion.button
                      type="button"
                      className={`yesno-toggle-btn ${val === 'NO' ? 'active-no' : ''}`}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => setValues({ ...values, [header]: 'NO' })}
                    >
                      <XCircle size={13} />
                      <span>NO</span>
                    </motion.button>
                  </div>

                  <input
                    type="text"
                    className="field-input"
                    placeholder="Escribir texto o nombre..."
                    value={val}
                    onChange={(e) => setValues({ ...values, [header]: e.target.value })}
                  />
                </div>
              ) : (
                <input
                  type="text"
                  className="field-input"
                  placeholder={`Ingresar ${header.toLowerCase()}...`}
                  value={val}
                  onChange={(e) => setValues({ ...values, [header]: e.target.value })}
                />
              )}
            </motion.div>
          );
        })}
      </motion.div>

      <div className="bottom-submit-bar">
        <motion.button
          className="btn-primary"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          style={{ width: '100%', padding: '14px', fontSize: 'calc(16px * var(--ui-font-scale, 1))' }}
          disabled={saving}
          onClick={handleCreate}
        >
          {saving ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              <span>Guardando en Google Sheets...</span>
            </>
          ) : (
            <>
              <UserPlus size={18} />
              <span>Crear e Insertar Cliente</span>
            </>
          )}
        </motion.button>
      </div>
    </div>
  );
}

