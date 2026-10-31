import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { api } from '../api';
import { Layers, AlertCircle, RefreshCw, ArrowLeft } from 'lucide-react';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.05,
    },
  },
};

const tileVariants = {
  hidden: { opacity: 0, scale: 0.88, y: 12 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 380, damping: 24 },
  },
};

export default function MonthPicker({ year, onPick, onChangeYear }) {
  const [months, setMonths] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  function loadMonths(force = false) {
    // Refresco manual: la carga inicial deja `mountedRef.current` en false
    // al terminar y en ese caso el efecto no vuelve a correr, así que se
    // habilita acá para que los setState de esta carga manual no se salten.
    mountedRef.current = true;
    setLoading(true);
    setError('');
    api
      .listMonths(year, force)
      .then((data) => {
        if (mountedRef.current) setMonths(data);
      })
      .catch((err) => {
        if (mountedRef.current) setError(err.message);
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }

  // La carga del año se dispara cuando cambia `year`. `lastYearLoaded` y
  // `hasLoaded` derivan del estado para no setear loading/error sincrónicamente
  // dentro del efecto (la primer carga ya arranca con loading=true).
  const [lastYearLoaded, setLastYearLoaded] = useState(null);
  const mountedRef = useRef(true);
  const hasLoaded = lastYearLoaded === year && (months.length > 0 || Boolean(error) || !loading);
  useEffect(() => {
    if (hasLoaded) return;
    mountedRef.current = true;
    let cancelled = false;
    api
      .listMonths(year)
      .then((data) => {
        if (!cancelled) setMonths(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
        setLastYearLoaded(year);
        mountedRef.current = false;
      });

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [year, hasLoaded]);

  return (
    <div className="screen centered">
      <motion.div
        className="hero-card"
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
      >
        <motion.div
          className="picker-icon-box"
          initial={{ scale: 0, rotate: -15 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20, delay: 0.1 }}
        >
          <Layers size={28} />
        </motion.div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
          <h1 className="picker-title" style={{ margin: 0 }}>Mes de {year}</h1>
          <motion.button
            className="back-btn"
            style={{ padding: '6px', borderRadius: '50%', minHeight: 'unset' }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => loadMonths(true)}
            title="Buscar nuevas hojas de meses en Google Sheets"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </motion.button>
        </div>
        <p className="picker-subtitle">
          Seleccioná la hoja mensual sobre la que vas a trabajar.
        </p>

        {loading && (
          <div className="skeleton-container" style={{ margin: '0 auto' }}>
            <div className="skeleton-item" />
            <div className="skeleton-item" />
            <div className="skeleton-item" />
          </div>
        )}

        {error && (
          <motion.div
            className="error-banner"
            style={{ textAlign: 'left' }}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <AlertCircle size={20} style={{ flexShrink: 0 }} />
            <div>
              <strong>Error de conexión</strong>
              <div style={{ fontSize: 'calc(13px * var(--ui-font-scale, 1))', marginTop: '2px' }}>{error}</div>
              <motion.button
                className="btn-secondary"
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.95 }}
                style={{ marginTop: '10px', padding: '6px 12px', fontSize: 'calc(13px * var(--ui-font-scale, 1))' }}
                onClick={loadMonths}
              >
                <RefreshCw size={14} /> Reintentar
              </motion.button>
            </div>
          </motion.div>
        )}

        {!loading && !error && (
          <motion.div
            className="picker-grid"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            {months.map((m) => (
              <motion.button
                key={m}
                className="picker-btn"
                variants={tileVariants}
                whileHover={{ scale: 1.05, y: -2 }}
                whileTap={{ scale: 0.94 }}
                onClick={() => onPick(m)}
                onMouseEnter={() => api.readClients(year, m)}
              >
                <span style={{ fontSize: 'calc(15px * var(--ui-font-scale, 1))', fontWeight: 700 }}>{m}</span>
              </motion.button>
            ))}
          </motion.div>
        )}

        {!loading && !error && months.length === 0 && (
          <div className="error-banner">
            <AlertCircle size={18} />
            <span>No hay hojas de meses cargadas en la planilla de {year}.</span>
          </div>
        )}
      </motion.div>

      {onChangeYear && (
        <motion.button
          className="back-btn"
          whileHover={{ scale: 1.03, x: -2 }}
          whileTap={{ scale: 0.95 }}
          onClick={onChangeYear}
        >
          <ArrowLeft size={14} />
          <span>Cambiar año ({year})</span>
        </motion.button>
      )}
    </div>
  );
}

