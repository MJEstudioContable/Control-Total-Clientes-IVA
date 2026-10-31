import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Loader2,
  ShieldCheck,
  UserRoundCog,
} from 'lucide-react';

export default function PinSetup({
  user,
  status,
  error,
  errorCode,
  onSubmit,
  onChangeUser,
  onReady,
}) {
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [localError, setLocalError] = useState('');
  const pinRef = useRef(null);
  const submitting = status === 'setting-pin';
  const setupDisabled = errorCode === 'PIN_SETUP_DISABLED';

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  useEffect(() => {
    if (!submitting && !setupDisabled) pinRef.current?.focus();
  }, [setupDisabled, submitting]);

  function updatePin(setter, value) {
    setter(value.replace(/\D/g, '').slice(0, 4));
    setLocalError('');
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (submitting || setupDisabled) return;

    if (pin.length !== 4 || confirmation.length !== 4) {
      setLocalError('Completá los 4 dígitos en ambos campos.');
      return;
    }
    if (pin !== confirmation) {
      setLocalError('Los PIN no coinciden. Volvé a ingresarlos.');
      return;
    }

    const selectedPin = pin;
    setPin('');
    setConfirmation('');
    setLocalError('');
    onSubmit(selectedPin);
  }

  const visibleError = localError || error;

  return (
    <div className="screen centered auth-screen">
      <motion.div
        className="hero-card auth-card"
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
      >
        <div className="picker-icon-box auth-icon-box">
          {submitting ? (
            <Loader2 size={28} className="animate-spin" />
          ) : (
            <ShieldCheck size={28} />
          )}
        </div>

        <h1 className="picker-title">Configurá tu acceso</h1>
        <p className="picker-subtitle auth-user-label">
          Usuario: <strong>{user}</strong>
        </p>
        <p className="auth-setup-copy">
          Elegí un PIN personal de 4 dígitos. No se mostrarán clientes hasta terminar este paso.
        </p>

        <form onSubmit={handleSubmit} className="auth-pin-form">
          {visibleError && (
            <div className="error-banner auth-error-banner" role="alert">
              <AlertCircle size={18} />
              <span>{visibleError}</span>
            </div>
          )}

          {!setupDisabled && (
            <>
              <label className="auth-pin-label" htmlFor="new-user-pin">
                Nuevo PIN
              </label>
              <div className="auth-input-icon-wrap">
                <KeyRound size={17} />
                <input
                  ref={pinRef}
                  id="new-user-pin"
                  className="auth-pin-input auth-pin-input-with-icon"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  value={pin}
                  disabled={submitting}
                  onChange={(event) => updatePin(setPin, event.target.value)}
                  aria-invalid={Boolean(localError)}
                />
              </div>

              <label className="auth-pin-label" htmlFor="confirm-user-pin">
                Repetir PIN
              </label>
              <div className="auth-input-icon-wrap">
                <CheckCircle2 size={17} />
                <input
                  id="confirm-user-pin"
                  className="auth-pin-input auth-pin-input-with-icon"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  value={confirmation}
                  disabled={submitting}
                  onChange={(event) => updatePin(setConfirmation, event.target.value)}
                  aria-invalid={Boolean(localError)}
                />
              </div>

              <div className="auth-pin-help">
                Este PIN será necesario para volver a ingresar con tu usuario.
              </div>

              <motion.button
                type="submit"
                className="btn-primary auth-submit-btn"
                disabled={pin.length !== 4 || confirmation.length !== 4 || submitting}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
              >
                {submitting ? (
                  <>
                    <Loader2 size={17} className="animate-spin" /> Guardando…
                  </>
                ) : (
                  <>
                    <ShieldCheck size={17} /> Establecer mi PIN
                  </>
                )}
              </motion.button>
            </>
          )}
        </form>

        <button
          type="button"
          className="auth-change-user"
          onClick={onChangeUser}
          disabled={submitting}
        >
          <UserRoundCog size={16} />
          Cambiar de usuario
        </button>
      </motion.div>
    </div>
  );
}
