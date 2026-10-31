import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { api } from '../api';
import { STORAGE_KEY_USER } from '../config';
import { Users, User, AlertCircle, RefreshCw } from 'lucide-react';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 18, scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring', stiffness: 350, damping: 25 },
  },
};

export default function NamePicker({ onPick, onReady }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  function loadUsers() {
    setLoading(true);
    setError('');
    api
      .listUsers()
      .then(setUsers)
      .catch((err) => setError(err.message))
      .finally(() => {
        setLoading(false);
        onReady?.();
      });
  }

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar; el reintento manual vive en el botón
  }, []);

  function choose(name) {
    localStorage.setItem(STORAGE_KEY_USER, name);
    onPick(name);
  }

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
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20, delay: 0.15 }}
        >
          <Users size={28} />
        </motion.div>
        <h1 className="picker-title">¿Quién sos?</h1>
        <p className="picker-subtitle">
          Seleccioná tu usuario para registrar tus cambios en la planilla remota.
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
                onClick={loadUsers}
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
            {users.map((u) => {
              const name = typeof u === 'string' ? u : u.name;

              return (
                <motion.button
                  key={name}
                  className="picker-btn"
                  variants={itemVariants}
                  whileHover={{ scale: 1.03, y: -2 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => choose(name)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div className="avatar-badge" style={{ width: '38px', height: '38px' }}>
                      <User size={20} />
                    </div>
                    <span style={{ fontWeight: 600 }}>{name}</span>
                  </div>
                </motion.button>
              );
            })}
          </motion.div>
        )}

        {!loading && !error && users.length === 0 && (
          <div className="error-banner">
            <AlertCircle size={18} />
            <span>No se encontraron usuarios cargados en la pestaña "Usuarios".</span>
          </div>
        )}
      </motion.div>
    </div>
  );
}

