import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { api } from '../api';
import { Calendar, AlertCircle, RefreshCw, ChevronRight } from 'lucide-react';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.05,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16, scale: 0.96 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring', stiffness: 350, damping: 26 },
  },
};

export default function YearPicker({ onPick, onReady }) {
  const [years, setYears] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  function loadYears() {
    setLoading(true);
    setError('');
    api
      .listYears()
      .then(setYears)
      .catch((err) => setError(err.message))
      .finally(() => {
        setLoading(false);
        onReady?.();
      });
  }

  useEffect(() => {
    loadYears();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar; el reintento manual vive en el botón
  }, []);

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
          <Calendar size={28} />
        </motion.div>
        <h1 className="picker-title">¿Qué año?</h1>
        <p className="picker-subtitle">
          Elegí el año de la planilla con la que querés trabajar.
        </p>

        {loading && (
          <div className="skeleton-container" style={{ margin: '0 auto' }}>
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
              <strong>Error al conectar</strong>
              <div style={{ fontSize: 'calc(13px * var(--ui-font-scale, 1))', marginTop: '2px' }}>{error}</div>
              <motion.button
                className="btn-secondary"
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.95 }}
                style={{ marginTop: '10px', padding: '6px 12px', fontSize: 'calc(13px * var(--ui-font-scale, 1))' }}
                onClick={loadYears}
              >
                <RefreshCw size={14} /> Reintentar
              </motion.button>
            </div>
          </motion.div>
        )}

        {!loading && !error && (
          <motion.div
            className="picker-list-vertical"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            {years.map((y) => (
              <motion.button
                key={y}
                className="picker-btn year-row-btn"
                variants={itemVariants}
                whileHover={{ scale: 1.02, x: 4 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => onPick(y)}
                onMouseEnter={() => api.listMonths(y)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Calendar size={20} style={{ color: 'var(--primary)' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 'calc(17px * var(--ui-font-scale, 1))', fontWeight: 700, color: 'var(--text-main)' }}>Planilla {y}</span>
                  </div>
                </div>
                <ChevronRight size={20} className="year-row-chevron" />
              </motion.button>
            ))}
          </motion.div>
        )}

        {!loading && !error && years.length === 0 && (
          <div className="error-banner">
            <AlertCircle size={18} />
            <span>No se encontraron planillas configuradas en la hoja "Planillas".</span>
          </div>
        )}
      </motion.div>
    </div>
  );
}

