import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, KeyRound, Loader2, LogIn, UserRoundCog } from 'lucide-react';

const INITIAL_NOW = Date.now();

function formatRemainingTime(lockedUntil, now) {
  const remainingSeconds = Math.max(0, Math.ceil((lockedUntil - now) / 1000));
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function PinLogin({
  user,
  status,
  error,
  errorCode,
  attemptsRemaining,
  lockedUntil,
  onSubmit,
  onChangeUser,
  onReady,
}) {
  const [pin, setPin] = useState('');
  const [now, setNow] = useState(INITIAL_NOW);
  const inputRef = useRef(null);
  const checking = status === 'checking' || status === 'submitting';
  const pinNotConfigured = errorCode === 'PIN_NOT_CONFIGURED';
  const isLocked = Number(lockedUntil || 0) > now;

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  useEffect(() => {
    if (!lockedUntil) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [lockedUntil]);

  useEffect(() => {
    if (!checking && !pinNotConfigured && !isLocked) inputRef.current?.focus();
  }, [checking, isLocked, pinNotConfigured]);

  const helperText = useMemo(() => {
    if (isLocked) return `Volvé a intentar en ${formatRemainingTime(lockedUntil, now)}`;
    if (Number.isInteger(attemptsRemaining) && attemptsRemaining > 0) {
      return `${attemptsRemaining} intento${attemptsRemaining === 1 ? '' : 's'} disponible${attemptsRemaining === 1 ? '' : 's'}`;
    }
    return 'Ingresá los 4 dígitos asignados a tu usuario.';
  }, [attemptsRemaining, isLocked, lockedUntil, now]);

  function handleSubmit(event) {
    event.preventDefault();
    if (pin.length !== 4 || checking || isLocked || pinNotConfigured) return;
    const submittedPin = pin;
    setPin('');
    onSubmit(submittedPin);
  }

  return (
    <div className="screen centered auth-screen">
      <motion.div
        className="hero-card auth-card"
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
      >
        <div className="picker-icon-box auth-icon-box">
          {checking ? <Loader2 size={28} className="animate-spin" /> : <KeyRound size={28} />}
        </div>

        <h1 className="picker-title">
          {status === 'checking' ? 'Validando sesión' : 'Acceso protegido'}
        </h1>
        <p className="picker-subtitle auth-user-label">
          Usuario: <strong>{user}</strong>
        </p>

        {status === 'checking' ? (
          <div className="auth-checking-copy">Comprobando tu acceso con el servidor…</div>
        ) : (
          <form onSubmit={handleSubmit} className="auth-pin-form">
            {error && (
              <div className="error-banner auth-error-banner" role="alert">
                <AlertCircle size={18} />
                <span>{error}</span>
              </div>
            )}

            {!pinNotConfigured && (
              <>
                <label className="auth-pin-label" htmlFor="user-pin">
                  PIN de 4 dígitos
                </label>
                <input
                  ref={inputRef}
                  id="user-pin"
                  className="auth-pin-input"
                  type="password"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  value={pin}
                  disabled={checking || isLocked}
                  onChange={(event) => {
                    setPin(event.target.value.replace(/\D/g, '').slice(0, 4));
                  }}
                  aria-describedby="pin-help"
                />
                <div id="pin-help" className="auth-pin-help">
                  {helperText}
                </div>

                <motion.button
                  type="submit"
                  className="btn-primary auth-submit-btn"
                  disabled={pin.length !== 4 || checking || isLocked}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                >
                  {checking ? (
                    <>
                      <Loader2 size={17} className="animate-spin" /> Verificando…
                    </>
                  ) : (
                    <>
                      <LogIn size={17} /> Ingresar
                    </>
                  )}
                </motion.button>
              </>
            )}
          </form>
        )}

        <button type="button" className="auth-change-user" onClick={onChangeUser} disabled={checking}>
          <UserRoundCog size={16} />
          Cambiar de usuario
        </button>
      </motion.div>
    </div>
  );
}
