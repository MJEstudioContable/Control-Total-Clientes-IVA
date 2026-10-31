import { useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Loader2,
  LogOut,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  Type,
  UserCheck,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import { api } from '../api';

function cleanPin(value) {
  return value.replace(/\D/g, '').slice(0, 4);
}

export default function SettingsDialog({
  open,
  user,
  userRole = 'USUARIO',
  mustChangePin = false,
  theme,
  fontScale = 'normal',
  fontScaleOptions = [],
  error,
  submitting,
  onClose,
  onChangePin,
  onChangeUser,
  onThemeChange,
  onFontScaleChange,
}) {
  const [view, setView] = useState(() => (mustChangePin ? 'pin' : 'main'));
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [localError, setLocalError] = useState('');

  // Estado del panel exclusivo para SUPERUSUARIO
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState('');
  const [adminNotice, setAdminNotice] = useState('');
  const [adminBusyUser, setAdminBusyUser] = useState('');
  const [resetTargetUser, setResetTargetUser] = useState('');
  const [tempPinValue, setTempPinValue] = useState('');

  if (!open) return null;

  const isSuperuser = userRole === 'SUPERUSUARIO';
  const activeView = mustChangePin ? 'pin' : view;
  const visibleError = localError || error || '';
  const canSubmitPin =
    currentPin.length === 4 &&
    newPin.length === 4 &&
    confirmation.length === 4 &&
    !submitting;

  function openPinView() {
    setCurrentPin('');
    setNewPin('');
    setConfirmation('');
    setLocalError('');
    setView('pin');
  }

  async function loadAdminUsers() {
    setAdminLoading(true);
    setAdminError('');
    try {
      const list = await api.adminListUsers();
      setAdminUsers(list);
    } catch (err) {
      setAdminError(err?.message || 'No se pudo cargar la lista de usuarios.');
    } finally {
      setAdminLoading(false);
    }
  }

  function openAdminUsersView() {
    setLocalError('');
    setAdminError('');
    setAdminNotice('');
    setResetTargetUser('');
    setTempPinValue('');
    setView('admin-users');
    loadAdminUsers();
  }

  function close() {
    if (submitting || mustChangePin) return;
    setLocalError('');
    setAdminError('');
    setAdminNotice('');
    setResetTargetUser('');
    setTempPinValue('');
    setView('main');
    onClose();
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    if (currentPin.length !== 4 || newPin.length !== 4 || confirmation.length !== 4) {
      setLocalError('Completá los 4 dígitos en todos los campos.');
      return;
    }
    if (newPin !== confirmation) {
      setLocalError('El PIN nuevo no coincide en ambos campos.');
      return;
    }
    if (mustChangePin && newPin === currentPin) {
      setLocalError('Elegí un PIN nuevo distinto del PIN temporal.');
      return;
    }

    const selectedCurrent = currentPin;
    const selectedNew = newPin;
    setCurrentPin('');
    setNewPin('');
    setConfirmation('');
    setLocalError('');
    onChangePin(selectedCurrent, selectedNew);
  }

  async function handleAdminToggleActive(targetUser, nextActive) {
    if (adminBusyUser) return;
    setAdminBusyUser(targetUser);
    setAdminError('');
    setAdminNotice('');
    try {
      const updated = await api.adminSetUserActive(targetUser, nextActive);
      if (updated) {
        setAdminUsers((prev) =>
          prev.map((u) => (u.name === updated.name ? updated : u))
        );
      } else {
        await loadAdminUsers();
      }
      setAdminNotice(
        nextActive
          ? `${targetUser} fue reactivado.`
          : `${targetUser} fue dado de baja y sus sesiones se cerraron.`
      );
    } catch (err) {
      setAdminError(err?.message || 'No se pudo actualizar el estado del usuario.');
    } finally {
      setAdminBusyUser('');
    }
  }

  async function handleAdminRevokeSessions(targetUser) {
    if (adminBusyUser) return;
    setAdminBusyUser(targetUser);
    setAdminError('');
    setAdminNotice('');
    try {
      await api.adminRevokeUserSessions(targetUser);
      setAdminNotice(`Se cerraron las sesiones activas de ${targetUser}.`);
    } catch (err) {
      setAdminError(err?.message || 'No se pudieron revocar las sesiones.');
    } finally {
      setAdminBusyUser('');
    }
  }

  async function handleAdminResetPinSubmit(event, targetUser) {
    event.preventDefault();
    if (adminBusyUser) return;
    if (tempPinValue.length !== 4) {
      setAdminError('El PIN temporal debe tener exactamente 4 dígitos.');
      return;
    }
    setAdminBusyUser(targetUser);
    setAdminError('');
    setAdminNotice('');
    try {
      const updated = await api.adminResetPin(targetUser, tempPinValue);
      if (updated) {
        setAdminUsers((prev) =>
          prev.map((u) => (u.name === updated.name ? updated : u))
        );
      } else {
        await loadAdminUsers();
      }
      setResetTargetUser('');
      setTempPinValue('');
      setAdminNotice(
        `PIN temporal asignado a ${targetUser}. Deberá cambiarlo al ingresar y sus sesiones previas se cerraron.`
      );
    } catch (err) {
      setAdminError(err?.message || 'No se pudo asignar el PIN temporal.');
    } finally {
      setAdminBusyUser('');
    }
  }

  return (
    <div
      className="team-modal-overlay"
      onClick={submitting || mustChangePin ? undefined : close}
      role="presentation"
    >
      <div
        className="team-modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="team-modal-header">
          {activeView === 'main' ? (
            <div className="team-modal-title" id="settings-title">
              Configuración
            </div>
          ) : (
            <div className="team-modal-title settings-title-with-back">
              {!mustChangePin && (
                <button
                  type="button"
                  className="settings-back-btn"
                  onClick={() => setView('main')}
                  disabled={submitting || Boolean(adminBusyUser)}
                  aria-label="Volver a configuración"
                >
                  <ArrowLeft size={16} />
                </button>
              )}
              <span id="settings-title">
                {activeView === 'admin-users'
                  ? 'Gestión de usuarios'
                  : mustChangePin
                    ? 'Cambio obligatorio de PIN'
                    : 'Cambiar mi PIN'}
              </span>
            </div>
          )}
          {!mustChangePin && (
            <button
              type="button"
              className="team-modal-close"
              onClick={close}
              disabled={submitting || Boolean(adminBusyUser)}
              aria-label="Cerrar"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {activeView === 'main' && (
          <div className="settings-main">
            <section className="settings-section">
              <h3 className="settings-section-title">Preferencias</h3>
              <div className="settings-theme-options" role="group" aria-label="Tema de la aplicación">
                <button
                  type="button"
                  className={`settings-theme-option ${theme === 'light' ? 'is-active' : ''}`}
                  onClick={() => onThemeChange('light')}
                >
                  <Sun size={16} />
                  Claro
                </button>
                <button
                  type="button"
                  className={`settings-theme-option ${theme === 'dark' ? 'is-active' : ''}`}
                  onClick={() => onThemeChange('dark')}
                >
                  <Moon size={16} />
                  Oscuro
                </button>
              </div>

              {fontScaleOptions.length > 0 && (
                <div className="settings-subsection">
                  <div className="settings-subsection-header">
                    <span className="settings-subsection-title">
                      <Type size={15} />
                      Tamaño de texto
                    </span>
                    <span className="settings-font-preview" data-scale={fontScale}>
                      Aa
                    </span>
                  </div>
                  <div
                    className="settings-font-options"
                    role="group"
                    aria-label="Tamaño de texto de la aplicación"
                  >
                    {fontScaleOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`settings-font-option ${
                          fontScale === option.id ? 'is-active' : ''
                        }`}
                        aria-pressed={fontScale === option.id}
                        onClick={() => onFontScaleChange?.(option.id)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <p className="settings-note">
                    Se aplica al instante en todas las pantallas y queda guardado en este dispositivo.
                  </p>
                </div>
              )}
            </section>

            <section className="settings-section">
              <h3 className="settings-section-title">Seguridad</h3>
              <button type="button" className="settings-action" onClick={openPinView}>
                <KeyRound size={16} />
                <span>Cambiar mi PIN</span>
              </button>
              <p className="settings-note">
                Actualiza tu PIN de 4 dígitos para volver a ingresar. Al
                confirmarlo, las sesiones anteriores de tu cuenta se cierran.
              </p>
            </section>

            {isSuperuser && (
              <section className="settings-section">
                <h3 className="settings-section-title">Administración (Superusuario)</h3>
                <button
                  type="button"
                  className="settings-action"
                  onClick={openAdminUsersView}
                >
                  <Users size={16} />
                  <span>Gestionar usuarios y accesos</span>
                </button>
                <p className="settings-note">
                  Restablecer PIN temporal con cambio forzado, dar de baja o
                  reactivar cuentas y revocar sesiones activas.
                </p>
              </section>
            )}
          </div>
        )}

        {activeView === 'pin' && (
          <form onSubmit={handleSubmit} className="auth-pin-form settings-pin-form">
            <p className="pin-change-intro">
              {mustChangePin ? (
                <>
                  Usuario: <strong>{user}</strong>. Tu cuenta tiene un{' '}
                  <strong>PIN temporal</strong>: ingresalo y elegí un PIN
                  personal nuevo para continuar.
                </>
              ) : (
                <>
                  Usuario: <strong>{user}</strong>. Ingresá tu PIN actual y elegí uno nuevo.
                </>
              )}
            </p>

            {visibleError && (
              <div className="error-banner auth-error-banner" role="alert">
                <AlertCircle size={18} />
                <span>{visibleError}</span>
              </div>
            )}

            <label className="auth-pin-label" htmlFor="settings-pin-current">
              {mustChangePin ? 'PIN temporal actual' : 'PIN actual'}
            </label>
            <div className="auth-input-icon-wrap">
              <KeyRound size={17} />
              <input
                autoFocus
                id="settings-pin-current"
                className="auth-pin-input auth-pin-input-with-icon"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                pattern="[0-9]{4}"
                maxLength={4}
                value={currentPin}
                disabled={submitting}
                onChange={(event) => {
                  setCurrentPin(cleanPin(event.target.value));
                  setLocalError('');
                }}
              />
            </div>

            <label className="auth-pin-label" htmlFor="settings-pin-new">
              Nuevo PIN
            </label>
            <div className="auth-input-icon-wrap">
              <ShieldCheck size={17} />
              <input
                id="settings-pin-new"
                className="auth-pin-input auth-pin-input-with-icon"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                pattern="[0-9]{4}"
                maxLength={4}
                value={newPin}
                disabled={submitting}
                onChange={(event) => {
                  setNewPin(cleanPin(event.target.value));
                  setLocalError('');
                }}
              />
            </div>

            <label className="auth-pin-label" htmlFor="settings-pin-confirm">
              Repetir nuevo PIN
            </label>
            <div className="auth-input-icon-wrap">
              <CheckCircle2 size={17} />
              <input
                id="settings-pin-confirm"
                className="auth-pin-input auth-pin-input-with-icon"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                pattern="[0-9]{4}"
                maxLength={4}
                value={confirmation}
                disabled={submitting}
                onChange={(event) => {
                  setConfirmation(cleanPin(event.target.value));
                  setLocalError('');
                }}
              />
            </div>

            <button
              type="submit"
              className="btn-primary auth-submit-btn"
              disabled={!canSubmitPin}
            >
              {submitting ? (
                <>
                  <Loader2 size={17} className="animate-spin" /> Guardando…
                </>
              ) : (
                <>
                  <ShieldCheck size={17} /> Guardar nuevo PIN
                </>
              )}
            </button>

            {mustChangePin && onChangeUser && (
              <button
                type="button"
                className="btn-secondary auth-submit-btn"
                disabled={submitting}
                onClick={onChangeUser}
              >
                Cambiar de usuario
              </button>
            )}
          </form>
        )}

        {activeView === 'admin-users' && (
          <div className="settings-admin-users">
            <div className="settings-admin-toolbar">
              <p className="settings-note">
                Cuentas registradas en la hoja <strong>Usuarios</strong>.
              </p>
              <button
                type="button"
                className="settings-admin-refresh-btn"
                onClick={loadAdminUsers}
                disabled={adminLoading || Boolean(adminBusyUser)}
                title="Recargar usuarios"
              >
                <RefreshCw size={14} className={adminLoading ? 'animate-spin' : ''} />
                <span>Actualizar</span>
              </button>
            </div>

            {adminError && (
              <div className="error-banner auth-error-banner" role="alert">
                <AlertCircle size={18} />
                <span>{adminError}</span>
              </div>
            )}

            {adminNotice && (
              <div className="settings-admin-notice" role="status">
                <CheckCircle2 size={16} />
                <span>{adminNotice}</span>
              </div>
            )}

            {adminLoading && adminUsers.length === 0 ? (
              <div className="settings-admin-empty">
                <Loader2 size={18} className="animate-spin" />
                <span>Cargando usuarios…</span>
              </div>
            ) : (
              <div className="settings-admin-list">
                {adminUsers.map((item) => {
                  const isSelf = item.name === user;
                  const isBusy = adminBusyUser === item.name;
                  const isResetting = resetTargetUser === item.name;

                  return (
                    <div
                      key={item.name}
                      className={`settings-admin-card ${!item.active ? 'is-inactive' : ''}`}
                    >
                      <div className="settings-admin-card-head">
                        <div className="settings-admin-user-info">
                          <strong className="settings-admin-user-name">
                            {item.name}
                            {isSelf ? ' (vos)' : ''}
                          </strong>
                          <div className="settings-admin-badges">
                            <span className="settings-admin-badge role">
                              {item.role}
                            </span>
                            <span
                              className={`settings-admin-badge ${
                                item.active ? 'active' : 'inactive'
                              }`}
                            >
                              {item.active ? 'Activo' : 'Inactivo'}
                            </span>
                            <span
                              className={`settings-admin-badge ${
                                item.mustChangePin
                                  ? 'temp-pin'
                                  : item.hasPin
                                    ? 'has-pin'
                                    : 'no-pin'
                              }`}
                            >
                              {item.mustChangePin
                                ? 'PIN temporal'
                                : item.hasPin
                                  ? 'PIN activo'
                                  : 'Sin PIN'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="settings-admin-actions">
                        <button
                          type="button"
                          className="settings-admin-btn"
                          disabled={isBusy}
                          onClick={() => {
                            setAdminError('');
                            setAdminNotice('');
                            setTempPinValue('');
                            setResetTargetUser(isResetting ? '' : item.name);
                          }}
                        >
                          <KeyRound size={14} />
                          <span>PIN temporal</span>
                        </button>

                        <button
                          type="button"
                          className="settings-admin-btn"
                          disabled={isBusy}
                          onClick={() => handleAdminRevokeSessions(item.name)}
                          title="Cerrar todas las sesiones activas de este usuario"
                        >
                          <LogOut size={14} />
                          <span>Cerrar sesiones</span>
                        </button>

                        {!isSelf && (
                          <button
                            type="button"
                            className={`settings-admin-btn ${
                              item.active ? 'danger' : 'success'
                            }`}
                            disabled={isBusy}
                            onClick={() =>
                              handleAdminToggleActive(item.name, !item.active)
                            }
                          >
                            {item.active ? (
                              <>
                                <UserMinus size={14} />
                                <span>Dar de baja</span>
                              </>
                            ) : (
                              <>
                                <UserCheck size={14} />
                                <span>Reactivar</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>

                      {isResetting && (
                        <form
                          className="settings-admin-reset-form"
                          onSubmit={(event) =>
                            handleAdminResetPinSubmit(event, item.name)
                          }
                        >
                          <input
                            type="password"
                            inputMode="numeric"
                            pattern="[0-9]{4}"
                            maxLength={4}
                            placeholder="PIN temporal (4 dígitos)"
                            className="auth-pin-input settings-admin-pin-input"
                            value={tempPinValue}
                            disabled={isBusy}
                            autoFocus
                            onChange={(event) =>
                              setTempPinValue(cleanPin(event.target.value))
                            }
                          />
                          <button
                            type="submit"
                            className="btn-primary settings-admin-save-pin"
                            disabled={isBusy || tempPinValue.length !== 4}
                          >
                            {isBusy ? 'Guardando…' : 'Asignar'}
                          </button>
                        </form>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
