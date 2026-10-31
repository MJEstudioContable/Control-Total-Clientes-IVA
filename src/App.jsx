import { lazy, Suspense, useCallback, useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import NamePicker from './screens/NamePicker';
import PinLogin from './screens/PinLogin';
import PinSetup from './screens/PinSetup';
import YearPicker from './screens/YearPicker';
import MonthPicker from './screens/MonthPicker';
// Pantallas pesadas que no hacen falta para arrancar (el selector de
// usuario / PIN se muestra sin descargarlas): van en chunks aparte.
const ClientDetail = lazy(() => import('./screens/ClientDetail'));
const NewClient = lazy(() => import('./screens/NewClient'));
const AssignClients = lazy(() => import('./screens/AssignClients'));
const IvaModule = lazy(() => import('./iva/IvaModule'));
const MarcacionesModule = lazy(() => import('./marcaciones/MarcacionesModule'));
// La planilla de marcaciones cargada se descarta al cerrar sesión o cambiar de usuario.
onPrivateDataCleared(olvidarPlanilla);
import AppSplashLoader from './components/AppSplashLoader';
import ScreenErrorBoundary from './components/ScreenErrorBoundary';
import MobileTabBar from './components/MobileTabBar';
import DesktopSidebar from './components/DesktopSidebar';
import useMediaQuery from './hooks/useMediaQuery';
const SettingsDialog = lazy(() => import('./components/SettingsDialog'));
import { ClientsProvider, useClientsActions } from './context/ClientsContext';
import { STORAGE_KEY_USER } from './config';
import {
  FONT_SCALE_OPTIONS,
  persistFontScale,
  readStoredFontScale,
} from './uiPreferences';
import { formatPeriodLabel } from './utils';
import { api, onPrivateDataCleared } from './api';
import { olvidarPlanilla } from './marcaciones/marcacionesStore';
import { Calendar, User, Menu, X, UserCog, RefreshCw, Settings } from 'lucide-react';
import './styles.css';

const INITIAL_AUTH_STATE = {
  status: 'anonymous',
  session: null,
  error: '',
  errorCode: '',
  attemptsRemaining: undefined,
  lockedUntil: 0,
};

const pageVariants = {
  initial: { opacity: 0, y: 22, scale: 0.98 },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring', stiffness: 320, damping: 28 },
  },
  exit: {
    opacity: 0,
    y: -16,
    scale: 0.97,
    transition: { duration: 0.18, ease: 'easeIn' },
  },
};

function authStateFromError(error, defaultMessage = 'No se pudo validar el acceso') {
  const code = error?.code || 'AUTH_ERROR';
  const requiresInitialPin = code === 'PIN_SETUP_REQUIRED';
  return {
    status: requiresInitialPin ? 'setup-pin' : 'needs-pin',
    session: null,
    error: code === 'PIN_REQUIRED' || requiresInitialPin
      ? ''
      : (error?.message || defaultMessage),
    errorCode: code,
    attemptsRemaining: Number.isInteger(error?.attemptsRemaining)
      ? error.attemptsRemaining
      : undefined,
    lockedUntil: Number(error?.lockedUntil || 0),
  };
}

function pinSetupStateFromError(error) {
  const code = error?.code || 'PIN_SETUP_ERROR';
  return {
    status: code === 'PIN_ALREADY_CONFIGURED' ? 'needs-pin' : 'setup-pin',
    session: null,
    error: error?.message || 'No se pudo configurar el PIN',
    errorCode: code,
    attemptsRemaining: undefined,
    lockedUntil: 0,
  };
}

export default function App({
  readOnlyPreview = false,
  uiMode = 'classic',
  periodOverviewComponent: PeriodOverviewComponent = null,
}) {
  const [user, setUser] = useState(() => localStorage.getItem(STORAGE_KEY_USER));
  const [year, setYear] = useState(null);
  const [month, setMonth] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);
  const [creatingWithHeaders, setCreatingWithHeaders] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [assignClientsOpen, setAssignClientsOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState('clients');
  // RUC a abrir en Vencimientos IVA al llegar desde el detalle del cliente.
  const [ivaOpenRuc, setIvaOpenRuc] = useState(null);
  const isMobilePeriodNav = useMediaQuery('(max-width: 860px)');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pinChangeError, setPinChangeError] = useState('');
  const [pinChangeSubmitting, setPinChangeSubmitting] = useState(false);
  const [pinChangeNotice, setPinChangeNotice] = useState('');
  const [syncStatus, setSyncStatus] = useState({ status: 'idle', pendingCount: 0 });
  const [initialScreenReady, setInitialScreenReady] = useState(false);
  const markInitialScreenReady = useCallback(() => setInitialScreenReady(true), []);

  const [authState, setAuthState] = useState(() => ({
    status: user ? 'checking' : 'anonymous',
    session: null,
    error: '',
    errorCode: '',
    attemptsRemaining: undefined,
    lockedUntil: 0,
  }));
  const [authGeneration, setAuthGeneration] = useState(0);
  const authAttemptRef = useRef(0);
  const periodOverviewRef = useRef(null);
  const periodTabScrollRef = useRef({ stats: 0, clients: 0, assign: 0 });
  const authenticated = authState.status === 'authenticated';
  const userRole = authenticated ? authState.session?.user?.role : null;
  const mustChangePin = Boolean(authenticated && authState.session?.mustChangePin);
  const activeSessionToken = authState.session?.token || '';
  const activeSessionExpiresAt = Number(authState.session?.expiresAt || 0);
  const activeSessionIdleMs = Number(authState.session?.idleTimeoutMs || 0);
  const canAssignClients =
    !readOnlyPreview && (userRole === 'SUPERUSUARIO' || userRole === 'ADMINISTRADOR');
  const authReady = !user || authState.status !== 'checking';
  const initialContentReady = initialScreenReady && authReady;

  // Suscripción al estado de la cola de guardado en memoria y protección
  // antes de cerrar o esconder la pestaña cuando todavía hay cambios sin
  // confirmar en la planilla.
  useEffect(() => api.onSyncStatusChange(setSyncStatus), []);

  useEffect(() => {
    const flushIfPending = () => {
      if (api.hasPendingSaves()) {
        api.flushPendingSaves().catch(() => {});
      }
    };

    const handleBeforeUnload = (event) => {
      if (!api.hasPendingSaves()) return;
      flushIfPending();
      event.preventDefault();
      event.returnValue = '';
    };

    const handleVisibilityHidden = () => {
      if (document.visibilityState === 'hidden') {
        flushIfPending();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', flushIfPending);
    document.addEventListener('visibilitychange', handleVisibilityHidden);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', flushIfPending);
      document.removeEventListener('visibilitychange', handleVisibilityHidden);
    };
  }, []);

  const resetPrivateNavigation = useCallback(() => {
    setYear(null);
    setMonth(null);
    setSelectedClient(null);
    setCreatingWithHeaders(null);
    setAssignClientsOpen(false);
    setMobileTab('clients');
    setIvaOpenRuc(null);
    setMobileMenuOpen(false);
  }, []);

  const restartAuthentication = useCallback(() => {
    api.clearSession();
    resetPrivateNavigation();
    setAuthState((previous) => ({
      ...previous,
      status: 'checking',
      session: null,
      error: '',
      errorCode: '',
      attemptsRemaining: undefined,
      lockedUntil: 0,
    }));
    setAuthGeneration((value) => value + 1);
  }, [resetPrivateNavigation]);

  // Primero intenta recuperar una sesión todavía válida. Si no existe, envía
  // un login sin PIN: el backend lo acepta únicamente para una cuenta sin hash
  // cuando ALLOW_PINLESS_LOGIN=true; una cuenta con PIN responde PIN_REQUIRED.
  useEffect(() => {
    if (!user) {
      api.clearSession();
      return;
    }

    const attemptId = ++authAttemptRef.current;
    let cancelled = false;

    const applySession = (session) => {
      if (cancelled || authAttemptRef.current !== attemptId) return;
      setAuthState({
        status: 'authenticated',
        session,
        error: '',
        errorCode: '',
        attemptsRemaining: undefined,
        lockedUntil: 0,
      });
    };

    async function authenticate() {
      setAuthState({
        status: 'checking',
        session: null,
        error: '',
        errorCode: '',
        attemptsRemaining: undefined,
        lockedUntil: 0,
      });

      const stored = api.getStoredSession();
      if (stored?.user?.name === user) {
        try {
          applySession(await api.validateSession({ notifyOnFailure: false }));
          return;
        } catch {
          // La sesión vencida se elimina en silencio y luego se intenta login.
        }
      } else if (stored) {
        api.clearSession();
      }

      try {
        applySession(await api.login(user, ''));
      } catch (error) {
        if (!cancelled && authAttemptRef.current === attemptId) {
          setAuthState(authStateFromError(error));
        }
      }
    }

    authenticate();
    return () => {
      cancelled = true;
    };
  }, [user, authGeneration]);

  // Cualquier rechazo de sesión durante una lectura o escritura vuelve a
  // ejecutar el flujo de acceso. Un usuario sin PIN en modo testing entra de
  // nuevo automáticamente; uno con PIN vuelve a la pantalla protegida.
  useEffect(() => api.onAuthFailure(restartAuthentication), [restartAuthentication]);

  // Mantiene sincronizada la inactividad visible con Apps Script. Mientras la
  // persona usa la app se valida la sesión periódicamente; al recuperar el foco
  // se valida de inmediato contra el servidor y al dejarla sin actividad o si
  // no se puede renovar autorización reiteradamente se bloquea (fail closed) y
  // se limpia el contenido privado en memoria.
  useEffect(() => {
    if (!authenticated || !activeSessionToken) return undefined;

    const idleTimeoutMs = Math.max(activeSessionIdleMs, 60_000);
    const heartbeatIntervalMs = Math.min(10 * 60_000, Math.max(60_000, idleTimeoutMs / 3));
    const focusCheckMinIntervalMs = 5_000;
    let lastActivityAt = Date.now();
    let lastServerCheckAt = Date.now();
    let consecutiveFailures = 0;
    let idleTimer;
    let checkingServer = false;
    let stopped = false;

    const expireLocally = () => {
      if (stopped) return;
      restartAuthentication();
    };

    const scheduleIdleCheck = () => {
      clearTimeout(idleTimer);
      const remaining = idleTimeoutMs - (Date.now() - lastActivityAt);
      if (remaining <= 0) {
        expireLocally();
        return;
      }
      idleTimer = setTimeout(expireLocally, remaining);
    };

    const checkServerSession = async ({ onFocus = false } = {}) => {
      if (checkingServer || stopped) return;
      const now = Date.now();
      if (
        (activeSessionExpiresAt > 0 && now >= activeSessionExpiresAt) ||
        now - lastActivityAt >= idleTimeoutMs
      ) {
        expireLocally();
        return;
      }
      checkingServer = true;
      lastServerCheckAt = now;
      try {
        const refreshed = await api.validateSession();
        consecutiveFailures = 0;
        if (!stopped) {
          setAuthState((previous) =>
            previous.status === 'authenticated'
              ? { ...previous, session: refreshed }
              : previous
          );
        }
      } catch {
        // Si fue error de sesión (SESSION_REVOKED, SESSION_EXPIRED...), api.js
        // ya notificó el rechazo y restartAuthentication limpió la memoria.
        // Si fue falla de transporte al volver al foco y se repite, bloqueamos
        // fail closed cuando no se puede renovar autorización.
        consecutiveFailures += 1;
        if ((onFocus && consecutiveFailures >= 2) || consecutiveFailures >= 3) {
          expireLocally();
        }
      } finally {
        checkingServer = false;
      }
    };

    const recordActivity = () => {
      const now = Date.now();
      if (
        (activeSessionExpiresAt > 0 && now >= activeSessionExpiresAt) ||
        now - lastActivityAt >= idleTimeoutMs
      ) {
        expireLocally();
        return;
      }
      lastActivityAt = now;
      scheduleIdleCheck();
      if (now - lastServerCheckAt >= heartbeatIntervalMs) checkServerSession();
    };

    const handleRegainFocus = () => {
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (
        (activeSessionExpiresAt > 0 && now >= activeSessionExpiresAt) ||
        now - lastActivityAt >= idleTimeoutMs
      ) {
        expireLocally();
        return;
      }
      lastActivityAt = now;
      scheduleIdleCheck();
      if (now - lastServerCheckAt >= focusCheckMinIntervalMs) {
        checkServerSession({ onFocus: true });
      }
    };

    ['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => {
      window.addEventListener(eventName, recordActivity, { passive: true });
    });
    document.addEventListener('visibilitychange', handleRegainFocus);
    window.addEventListener('focus', handleRegainFocus);
    scheduleIdleCheck();

    const heartbeat = setInterval(() => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - lastActivityAt < idleTimeoutMs
      ) {
        checkServerSession();
      }
    }, heartbeatIntervalMs);

    const maxRemaining = activeSessionExpiresAt - Date.now();
    const maximumTimer = maxRemaining > 0
      ? setTimeout(expireLocally, maxRemaining)
      : setTimeout(expireLocally, 0);

    return () => {
      stopped = true;
      clearTimeout(idleTimer);
      clearTimeout(maximumTimer);
      clearInterval(heartbeat);
      ['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => {
        window.removeEventListener(eventName, recordActivity);
      });
      document.removeEventListener('visibilitychange', handleRegainFocus);
      window.removeEventListener('focus', handleRegainFocus);
    };
  }, [
    authenticated,
    activeSessionToken,
    activeSessionExpiresAt,
    activeSessionIdleMs,
    restartAuthentication,
  ]);

  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('app-theme');
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  // Tamaño de texto elegido en Configuración. Se guarda por dispositivo:
  // la misma cuenta puede querer texto grande en el teléfono y normal en
  // la PC. El valor se aplica en <html> y toda la escala tipográfica del
  // tema ejecutivo se multiplica por él (ver --ui-font-scale en styles.css).
  const [fontScale, setFontScale] = useState(readStoredFontScale);

  useEffect(() => {
    document.documentElement.setAttribute('data-font-scale', fontScale);
    persistFontScale(fontScale);
  }, [fontScale]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('app-theme', theme);

    // Mantiene los íconos de la barra de estado (hora, batería, señal)
    // legibles según el tema: claros sobre el fondo oscuro de la app,
    // oscuros sobre el fondo claro. Solo aplica en la app nativa (no
    // hace nada en el navegador/PWA web).
    // Mantiene los íconos de las barras del sistema (hora/batería arriba,
    // gestos abajo) legibles según el tema. Desde Capacitor 8.3+ esto se
    // hace con el SystemBars nativo (no el plugin @capacitor/status-bar
    // viejo, que en Android 16 quedó sin efecto porque el sistema fuerza
    // el modo "edge-to-edge" y ya no deja pintar un color de fondo fijo).
    if (Capacitor.isNativePlatform()) {
      SystemBars.setStyle({
        style: theme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
      }).catch(() => {});
    }
  }, [theme]);

  // Botón / gesto "atrás" del sistema en Android: en vez de cerrar la app
  // de una, navega hacia atrás DENTRO de la app, con la misma prioridad
  // que ya usan los botones "volver" de cada pantalla. Si no hay nada más
  // atrás (estamos en la pantalla de elegir año, la primera pantalla real
  // después de elegir usuario), ahí sí cierra la app.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const listenerPromise = CapacitorApp.addListener('backButton', () => {
      if (assignClientsOpen) {
        setAssignClientsOpen(false);
        setMobileTab('clients');
      } else if (creatingWithHeaders) {
        setCreatingWithHeaders(null);
      } else if (selectedClient) {
        setSelectedClient(null);
      } else if (mobileTab !== 'clients') {
        setMobileTab('clients');
      } else if (month) {
        setMonth(null);
      } else if (year) {
        setYear(null);
      } else {
        CapacitorApp.exitApp();
      }
    });

    return () => {
      listenerPromise.then((listener) => listener.remove());
    };
  }, [assignClientsOpen, creatingWithHeaders, mobileTab, selectedClient, month, year]);

  // La confirmación de PIN actualizado desaparece sola para no acumular
  // avisos en pantalla.
  useEffect(() => {
    if (!pinChangeNotice) return undefined;
    const timer = setTimeout(() => setPinChangeNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [pinChangeNotice]);

  function handlePickUser(chosenUser) {
    localStorage.setItem(STORAGE_KEY_USER, chosenUser);
    setUser(chosenUser);
  }

  function handlePickYear(chosenYear) {
    setMobileMenuOpen(false);
    setYear(chosenYear);
  }

  function handlePickMonth(chosenMonth) {
    setMobileMenuOpen(false);
    periodTabScrollRef.current = { stats: 0, clients: 0, assign: 0 };
    setMobileTab('clients');
    setMonth(chosenMonth);
  }

  const handleMobileTabChange = useCallback((tab) => {
    // Marcaciones es sólo para ADMINISTRADOR y SUPERUSUARIO.
    if (tab === 'marcaciones' && !canAssignClients) return;
    periodTabScrollRef.current[mobileTab] = window.scrollY;
    setSelectedClient(null);
    setCreatingWithHeaders(null);
    // Al entrar a IVA desde la pestaña se abre el tablero, no el último cliente.
    setIvaOpenRuc(null);
    setMobileTab(tab);
    setAssignClientsOpen(tab === 'assign');
  }, [mobileTab, canAssignClients]);

  useEffect(() => {
    if (!year || !month || selectedClient || creatingWithHeaders) return undefined;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: periodTabScrollRef.current[mobileTab] || 0, behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [creatingWithHeaders, mobileTab, month, selectedClient, year]);

  async function handlePinSubmit(pin) {
    const attemptId = ++authAttemptRef.current;
    setAuthState((previous) => ({
      ...previous,
      status: 'submitting',
      error: '',
      errorCode: '',
    }));

    try {
      const session = await api.login(user, pin);
      if (authAttemptRef.current !== attemptId) return;
      setAuthState({
        status: 'authenticated',
        session,
        error: '',
        errorCode: '',
        attemptsRemaining: undefined,
        lockedUntil: 0,
      });
    } catch (error) {
      if (authAttemptRef.current === attemptId) {
        setAuthState(authStateFromError(error));
      }
    }
  }

  async function handleInitialPinSetup(pin) {
    const attemptId = ++authAttemptRef.current;
    setAuthState((previous) => ({
      ...previous,
      status: 'setting-pin',
      error: '',
      errorCode: '',
    }));

    try {
      const session = await api.setupPin(user, pin);
      if (authAttemptRef.current !== attemptId) return;
      setAuthState({
        status: 'authenticated',
        session,
        error: '',
        errorCode: '',
        attemptsRemaining: undefined,
        lockedUntil: 0,
      });
    } catch (error) {
      if (authAttemptRef.current === attemptId) {
        setAuthState(pinSetupStateFromError(error));
      }
    }
  }

  async function handleChangeUser() {
    authAttemptRef.current += 1;
    setSettingsOpen(false);
    setPinChangeError('');
    try {
      await api.flushPendingSaves();
    } catch {
      // Si la sesión ya venció, la cola informa su propio error y se limpia.
    }
    try {
      await api.logout();
    } catch {
      api.clearSession();
    }

    resetPrivateNavigation();
    localStorage.removeItem(STORAGE_KEY_USER);
    setAuthState({ ...INITIAL_AUTH_STATE });
    setUser(null);
  }

  // Cierra el menú mobile antes de navegar a otra pantalla. No hay doble
  // render: si el menú ya está cerrado, el estado no cambia.
  function closeMobileMenu() {
    setMobileMenuOpen(false);
  }

  function openSettings() {
    setMobileMenuOpen(false);
    setPinChangeError('');
    setSettingsOpen(true);
  }

  async function handleChangePin(currentPin, newPin) {
    if (pinChangeSubmitting) return;
    setPinChangeSubmitting(true);
    setPinChangeError('');

    try {
      const session = await api.changePin(currentPin, newPin);
      setAuthState((previous) => ({
        ...previous,
        status: 'authenticated',
        session,
        error: '',
        errorCode: '',
        attemptsRemaining: undefined,
        lockedUntil: 0,
      }));
      setSettingsOpen(false);
      setPinChangeNotice('PIN actualizado correctamente. Las sesiones anteriores de tu cuenta se cerraron.');
    } catch (error) {
      setPinChangeError(error?.message || 'No se pudo cambiar el PIN. Probá nuevamente.');
    } finally {
      setPinChangeSubmitting(false);
    }
  }

  // Navbar for authenticated screens
  const renderNavbar = () => {
    if (uiMode === 'executive') {
      return (
        <header className="real-exec-navbar">
          {/* Sin marca: el logo y el lema no aportan a la operación diaria.
              La barra queda limpia con las acciones (período, actualizar,
              configuración, usuario). */}

          <div className="real-exec-navbar-actions">
            {syncStatus.status === 'syncing' && (
              <span
                className="sync-queue-pill"
                role="status"
                aria-live="polite"
                title="Sincronizando cambios con la planilla"
              >
                <RefreshCw size={12} className="animate-spin" />
                <span>Sincronizando…</span>
              </span>
            )}
            {year && month && !selectedClient && mobileTab !== 'iva' && mobileTab !== 'marcaciones' && (
              <button
                type="button"
                className="real-exec-refresh-button"
                onClick={() => periodOverviewRef.current?.refresh()}
                title="Actualizar clientes y equipo"
              >
                <RefreshCw size={14} />
                <span>Actualizar</span>
              </button>
            )}
            {year && month && (
              <button
                type="button"
                className="real-exec-period-button"
                onClick={() => {
                  if (api.hasPendingSaves()) {
                    api.flushPendingSaves().catch(() => {});
                  }
                  setSelectedClient(null);
                  setMobileTab('clients');
                  setMonth(null);
                }}
                title="Cambiar período"
              >
                <Calendar size={14} />
                <span>{formatPeriodLabel(month, year)}</span>
              </button>
            )}
            {canAssignClients && year && month && !selectedClient && (
              <button type="button"
                className="real-exec-period-button real-exec-assign-button"
                onClick={() => handleMobileTabChange('assign')}
                title="Asignar clientes">
                <UserCog size={14} />
                <span>Asignar</span>
              </button>
            )}
            <button
              type="button"
              className="real-exec-theme-button real-exec-settings-button"
              onClick={openSettings}
              title="Configuración"
              aria-label="Abrir configuración"
            >
              <Settings size={16} />
            </button>
            <button
              type="button"
              className="real-exec-user-button"
              onClick={handleChangeUser}
              title="Cambiar de usuario"
            >
              <span>{String(user || '?').charAt(0).toUpperCase()}</span>
              <span><strong>{user}</strong><small>{userRole || 'Usuario'}</small></span>
            </button>
          </div>
        </header>
      );
    }

    return (
      <>
      <header className="app-navbar">
        <div className="navbar-content">
          <motion.div
            className="brand-badge hide-mobile"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <div className="brand-icon-wrapper">
              <img src="/logo-mj.webp" alt="" className="brand-logo-img" />
            </div>
            <span>Control Clientes</span>
          </motion.div>

          <div className="nav-pills">
            {/* Menú hamburguesa: solo visible en mobile (ver CSS), va
                primero para quedar pegado a la izquierda del todo. Por
                ahora solo tiene el toggle de tema; a futuro va a sumar
                configuración y otras funciones. */}
            {user && (
              <div className="mobile-nav-left">
                <img src="/logo-mj.webp" alt="MJ Estudio Contable" className="mobile-nav-logo" />
                <motion.button
                  className="mobile-menu-btn"
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: 0.92 }}
                  onClick={() => setMobileMenuOpen(true)}
                  title="Menú"
                  aria-label="Abrir menú"
                >
                  <Menu size={18} />
                </motion.button>
              </div>
            )}

            {user && year && month && (
              <motion.button
                className="pill-btn active period-pill"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  setSelectedClient(null);
                  setCreatingWithHeaders(null);
                  setAssignClientsOpen(false);
                  setMonth(null);
                  setMobileMenuOpen(false);
                }}
                title="Cambiar mes o año"
              >
                <Calendar size={14} />
                <span>{formatPeriodLabel(month, year)}</span>
              </motion.button>
            )}

            {/* Configuración: acceso directo en desktop; en mobile vive
                dentro del drawer para no saturar la barra. */}
            {user && (
              <motion.button
                className="pill-btn settings-btn hide-mobile"
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.95 }}
                onClick={openSettings}
                title="Configuración"
                aria-label="Abrir configuración"
              >
                <Settings size={14} />
              </motion.button>
            )}

            {/* Acceso directo en desktop (ahí no hay drawer -- el
                hamburguesa es mobile-only). En mobile esta misma función
                vive adentro del drawer, así que acá se oculta con
                .hide-mobile para no duplicarla. */}
            {canAssignClients && year && month && (
              <motion.button
                className="pill-btn hide-mobile"
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  setSelectedClient(null);
                  setCreatingWithHeaders(null);
                  setAssignClientsOpen(true);
                }}
                title="Asignar clientes"
              >
                <UserCog size={14} />
                <span>Asignar</span>
              </motion.button>
            )}

            {/* Píldora de usuario: visible siempre, en desktop y mobile,
                pegada a la derecha del todo. */}
            {user && (
              <motion.button
                className="pill-btn"
                title={`Usuario actual: ${user} (Haz clic para cambiar de usuario)`}
                onClick={handleChangeUser}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.95 }}
                style={{ cursor: 'pointer', gap: '6px' }}
              >
                <div className="avatar-badge" style={{ display: 'flex', alignItems: 'center' }}>
                  <User size={14} />
                </div>
                <span className="nav-user-name" style={{ fontSize: 'calc(13px * var(--ui-font-scale, 1))', fontWeight: 600 }}>
                  {user}
                </span>
              </motion.button>
            )}
          </div>
        </div>
      </header>

      {/* Drawer del menú hamburguesa (solo mobile): se desliza desde la
          izquierda hacia la derecha. Por ahora solo trae el toggle de
          tema; queda con lugar para sumar "Configuración" y otras
          opciones más adelante sin tener que rehacer la estructura.
          IMPORTANTE: esto va A PROPÓSITO fuera del <header>, como
          hermano y no como hijo. El navbar tiene backdrop-filter (efecto
          vidrio esmerilado), y backdrop-filter/filter/transform en un
          ancestro hace que los descendientes con position:fixed dejen de
          posicionarse respecto a toda la pantalla y pasen a posicionarse
          respecto a ese ancestro -- por eso antes el drawer y el fondo
          oscuro quedaban atrapados en la franja del navbar en vez de
          cubrir la pantalla completa. */}
      <AnimatePresence>
        {mobileMenuOpen && user && (
          <>
            <motion.div
              className="mobile-drawer-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setMobileMenuOpen(false)}
            />
            <motion.div
              className="mobile-drawer-panel"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            >
              <div className="mobile-drawer-header">
                <span className="mobile-drawer-title">
                  <img src="/logo-mj.webp" alt="" className="mobile-drawer-logo" />
                  Menú
                </span>
                <button
                  type="button"
                  className="mobile-drawer-close"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Cerrar menú"
                >
                  <X size={18} />
                </button>
              </div>

              <button
                type="button"
                className="mobile-menu-item"
                onClick={() => {
                  setMobileMenuOpen(false);
                  openSettings();
                }}
              >
                <Settings size={17} />
                <span>Configuración</span>
              </button>

              {canAssignClients && year && month && (
                <button
                  type="button"
                  className="mobile-menu-item"
                  onClick={() => {
                    closeMobileMenu();
                    setSelectedClient(null);
                    setCreatingWithHeaders(null);
                    setAssignClientsOpen(true);
                  }}
                >
                  <UserCog size={17} />
                  <span>Asignar clientes</span>
                </button>
              )}

              {/* Próximamente: Configuración, Equipo, etc. */}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
    );
  };

  // Las pantallas del período (lista, asignar, detalle, nuevo cliente)
  // viven DENTRO del <ClientsProvider>: comparten un único estado de la
  // planilla, así lo que se cambia en una se refleja en las otras sin
  // recargar. Ese estado se lee con un hook, por eso el render se delega
  // al componente <PeriodScreens> de más abajo.
  return (
    <div className={`app-container ${uiMode === 'executive' ? 'real-exec-app' : ''}`}>
      <AppSplashLoader
        logoSrc="/logo-mj.webp"
        ready={initialContentReady}
        minDurationMs={600}
        maxDurationMs={1600}
      />
      {authenticated && renderNavbar()}
      {pinChangeNotice && (
        <div className="pin-change-notice" role="status">
          {pinChangeNotice}
        </div>
      )}
      {authenticated && authState.session?.pinless && (
        <div className="auth-test-banner" role="status">
          Modo de prueba: este usuario ingresó sin PIN
        </div>
      )}
      <ClientsProvider
        user={authenticated ? user : null}
        userRole={userRole}
        year={authenticated ? year : null}
        month={authenticated ? month : null}
      >
        <PeriodScreens
          user={user}
          authState={authState}
          readOnlyPreview={readOnlyPreview}
          PeriodOverviewComponent={PeriodOverviewComponent}
          periodOverviewRef={periodOverviewRef}
          canAssignClients={canAssignClients}
          onInitialContentReady={markInitialScreenReady}
          year={year}
          month={month}
          onPickUser={handlePickUser}
          onPinSubmit={handlePinSubmit}
          onPinSetup={handleInitialPinSetup}
          onChangeUser={handleChangeUser}
          onPickYear={handlePickYear}
          onPickMonth={handlePickMonth}
          onChangeYear={() => setYear(null)}
          onChangeMonth={() => {
            setMobileTab('clients');
            setMonth(null);
          }}
          selectedClient={selectedClient}
          onSelectClient={setSelectedClient}
          onBackFromDetail={() => setSelectedClient(null)}
          onOpenIva={(ruc) => {
            setSelectedClient(null);
            setAssignClientsOpen(false);
            setIvaOpenRuc(ruc);
            setMobileTab('iva');
          }}
          ivaOpenRuc={ivaOpenRuc}
          creatingWithHeaders={creatingWithHeaders}
          onNewClient={setCreatingWithHeaders}
          onCancelNewClient={() => setCreatingWithHeaders(null)}
          assignClientsOpen={canAssignClients && assignClientsOpen}
          onBackFromAssign={() => {
            setAssignClientsOpen(false);
            setMobileTab('clients');
          }}
          usePeriodTabs={uiMode === 'executive'}
          isMobilePeriodNav={uiMode === 'executive' && isMobilePeriodNav}
          mobileTab={mobileTab}
          onMobileTabChange={handleMobileTabChange}
        />
      </ClientsProvider>

      {uiMode === 'executive' && !isMobilePeriodNav && authenticated && year && month &&
        !selectedClient && !creatingWithHeaders && (
          <DesktopSidebar
            activeTab={assignClientsOpen ? 'assign' : mobileTab}
            canAssignClients={canAssignClients}
            onChange={handleMobileTabChange}
          />
        )}

      {uiMode === 'executive' && isMobilePeriodNav && authenticated && year && month &&
        !selectedClient && !creatingWithHeaders && (
          <MobileTabBar
            activeTab={assignClientsOpen ? 'assign' : mobileTab}
            canAssignClients={canAssignClients}
            onChange={handleMobileTabChange}
          />
        )}

      {(settingsOpen || mustChangePin) && (
      <Suspense fallback={null}>
      <SettingsDialog
        key={mustChangePin ? 'settings-must-change-pin' : 'settings-open'}
        open={settingsOpen || mustChangePin}
        user={user}
        userRole={userRole}
        mustChangePin={mustChangePin}
        theme={theme}
        fontScale={fontScale}
        fontScaleOptions={FONT_SCALE_OPTIONS}
        error={pinChangeError}
        submitting={pinChangeSubmitting}
        onClose={() => {
          if (!pinChangeSubmitting && !mustChangePin) setSettingsOpen(false);
        }}
        onChangePin={handleChangePin}
        onChangeUser={handleChangeUser}
        onThemeChange={setTheme}
        onFontScaleChange={setFontScale}
      />
      </Suspense>
      )}
    </div>
  );
}

// Pantallas del período elegido. Vive dentro del <ClientsProvider> para
// poder usar el contexto compartido: los datos de la planilla, el equipo
// y los filtros son los mismos para la lista y para "Asignar clientes".
function PeriodScreens({
  user,
  authState,
  readOnlyPreview,
  PeriodOverviewComponent,
  periodOverviewRef,
  canAssignClients,
  onInitialContentReady,
  year,
  month,
  onPickUser,
  onPinSubmit,
  onPinSetup,
  onChangeUser,
  onPickYear,
  onPickMonth,
  onChangeYear,
  onChangeMonth,
  selectedClient,
  onSelectClient,
  onBackFromDetail,
  onOpenIva,
  ivaOpenRuc,
  creatingWithHeaders,
  onNewClient,
  onCancelNewClient,
  assignClientsOpen,
  onBackFromAssign,
  usePeriodTabs,
  isMobilePeriodNav,
  mobileTab,
  onMobileTabChange,
}) {
  const { reload } = useClientsActions();

  const getScreenContent = () => {
    if (!user) {
      return (
        <motion.div key="name-picker" variants={pageVariants} initial="initial" animate="animate" exit="exit">
          <NamePicker onPick={onPickUser} onReady={onInitialContentReady} />
        </motion.div>
      );
    }

    if (authState.status === 'setup-pin' || authState.status === 'setting-pin') {
      return (
        <motion.div key={`pin-setup-${user}`} variants={pageVariants} initial="initial" animate="animate" exit="exit">
          <PinSetup
            user={user}
            status={authState.status}
            error={authState.error}
            errorCode={authState.errorCode}
            onSubmit={onPinSetup}
            onChangeUser={onChangeUser}
            onReady={onInitialContentReady}
          />
        </motion.div>
      );
    }

    if (authState.status !== 'authenticated') {
      return (
        <motion.div key={`pin-login-${user}`} variants={pageVariants} initial="initial" animate="animate" exit="exit">
          <PinLogin
            user={user}
            status={authState.status}
            error={authState.error}
            errorCode={authState.errorCode}
            attemptsRemaining={authState.attemptsRemaining}
            lockedUntil={authState.lockedUntil}
            onSubmit={onPinSubmit}
            onChangeUser={onChangeUser}
            onReady={onInitialContentReady}
          />
        </motion.div>
      );
    }

    if (!year) {
      return (
        <motion.div key="year-picker" variants={pageVariants} initial="initial" animate="animate" exit="exit">
          <YearPicker onPick={onPickYear} user={user} onReady={onInitialContentReady} />
        </motion.div>
      );
    }

    if (!month) {
      return (
        <motion.div key={`month-picker-${year}`} variants={pageVariants} initial="initial" animate="animate" exit="exit">
          <MonthPicker year={year} onPick={onPickMonth} onChangeYear={onChangeYear} />
        </motion.div>
      );
    }

    if (assignClientsOpen && canAssignClients) {
      return (
        <motion.div key={`assign-clients-${year}-${month}`} variants={pageVariants} initial="initial" animate="animate" exit="exit">
          <AssignClients onBack={onBackFromAssign} />
        </motion.div>
      );
    }

    if (creatingWithHeaders) {
      return (
        <motion.div key={`new-client-${year}-${month}`} variants={pageVariants} initial="initial" animate="animate" exit="exit">
          <NewClient
            year={year}
            month={month}
            canAssignClients={canAssignClients}
            headers={creatingWithHeaders}
            onCancel={onCancelNewClient}
            onCreated={() => {
              onCancelNewClient();
              // El cliente nuevo entra al estado compartido: la lista y
              // "Asignar clientes" lo ven sin necesidad de recargar a mano.
              reload(true);
            }}
          />
        </motion.div>
      );
    }

    if (selectedClient) {
      return (
        <motion.div
          key={`client-detail-${selectedClient._row}-${year}-${month}`}
          variants={pageVariants}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <ClientDetail
            user={user}
            year={year}
            month={month}
            client={selectedClient}
            onBack={onBackFromDetail}
            canAssignClients={canAssignClients}
            readOnlyPreview={readOnlyPreview}
            onOpenIva={usePeriodTabs && !readOnlyPreview ? onOpenIva : undefined}
          />
        </motion.div>
      );
    }

    if (usePeriodTabs && canAssignClients && mobileTab === 'marcaciones') {
      return (
        <motion.div key={`marcaciones-${year}-${month}`} variants={pageVariants} initial="initial" animate="animate" exit="exit">
          <MarcacionesModule withDesktopSidebar={!isMobilePeriodNav} />
        </motion.div>
      );
    }

    if (usePeriodTabs && mobileTab === 'iva') {
      return (
        <motion.div key={`iva-${year}-${month}`} variants={pageVariants} initial="initial" animate="animate" exit="exit">
          <IvaModule
            withDesktopSidebar={!isMobilePeriodNav}
            initialRuc={ivaOpenRuc}
          />
        </motion.div>
      );
    }

    return (
      <motion.div key={`executive-overview-${year}-${month}-${usePeriodTabs ? mobileTab : 'all'}`} variants={pageVariants} initial="initial" animate="animate" exit="exit">
        <PeriodOverviewComponent ref={periodOverviewRef}
          onSelect={onSelectClient} onNewClient={onNewClient}
          readOnly={readOnlyPreview}
          section={usePeriodTabs ? mobileTab : 'all'}
          withDesktopSidebar={usePeriodTabs && !isMobilePeriodNav}
          onGoToClients={() => onMobileTabChange('clients')} />
      </motion.div>
    );
  };

  const screenBoundaryKey = !user
    ? 'name-picker'
    : authState.status !== 'authenticated'
      ? `auth-${user}-${authState.status}`
      : !year
        ? `year-picker-${user}`
        : !month
          ? `month-picker-${year}`
          : assignClientsOpen && canAssignClients
            ? `assign-${year}-${month}`
            : creatingWithHeaders
              ? `new-client-${year}-${month}`
              : selectedClient
                ? `client-detail-${selectedClient._row}-${year}-${month}`
                : `executive-overview-${year}-${month}-${usePeriodTabs ? mobileTab : 'all'}`;

  // Cada pantalla vuelve a una ruta segura diferente. Cambiar la key desmonta
  // el boundary que falló para que el error no sobreviva a la navegación.
  const handleScreenErrorBack = () => {
    if (!user) {
      window.location.reload();
    } else if (authState.status !== 'authenticated' || !year) {
      onChangeUser();
    } else if (!month) {
      onChangeYear();
    } else if (assignClientsOpen && canAssignClients) {
      onBackFromAssign();
    } else if (creatingWithHeaders) {
      onCancelNewClient();
    } else if (selectedClient) {
      onBackFromDetail();
    } else {
      onChangeMonth();
    }
  };

  // mode="popLayout" en vez de "wait": con "wait", la pantalla que
  // salía tenía que desmontarse del todo (y ClientDetail terminar su
  // carga inicial) ANTES de que la nueva empezara a aparecer -- ese
  // hueco se sentía como un microcorte al entrar/salir de un
  // cliente. Con "popLayout" ambas se animan superpuestas (la que
  // sale se saca del flujo normal así no empuja el layout), sin
  // instante en blanco en el medio.
  return (
    <ScreenErrorBoundary key={screenBoundaryKey} onBack={handleScreenErrorBack}>
      <Suspense fallback={<div className="lazy-screen-fallback" aria-busy="true" />}>
        <AnimatePresence mode="popLayout">{getScreenContent()}</AnimatePresence>
      </Suspense>
    </ScreenErrorBoundary>
  );
}
