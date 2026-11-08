import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import './Toast.css';

/** Shares its chunk with the other animations, so the engine downloads once. */
const LottiePlayer = lazy(() => import('./LottiePlayer'));

type ToastValue = {
  /** Confirms an operation that actually changed something. */
  showSuccess: (message: string) => void;
};

const ToastContext = createContext<ToastValue>({ showSuccess: () => undefined });

export const useToast = () => useContext(ToastContext);

/** Long enough to read a short sentence, short enough not to sit in the way. */
const VISIBLE_MS = 3200;

/**
 * One confirmation for every successful write in the app.
 *
 * Before this, a save was reported three different ways depending on the page:
 * a green banner, an inline alert, or nothing at all. A single toast means the
 * user learns one signal and sees it everywhere.
 */
export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const showSuccess = useCallback((text: string) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);

    setMessage(text);
    timerRef.current = window.setTimeout(() => setMessage(null), VISIBLE_MS);
  }, []);

  const value = useMemo<ToastValue>(() => ({ showSuccess }), [showSuccess]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      {message !== null &&
        createPortal(
          // role="status" so a screen reader announces it without stealing focus.
          <div className="toast" role="status" aria-live="polite">
            <span className="toast__icon">
              <Suspense fallback={null}>
                {/* One shot: the tick marks a thing that happened once. */}
                <LottiePlayer animation="tick" size={34} loop={false} />
              </Suspense>
            </span>

            <p className="toast__message">{message}</p>

            <button
              type="button"
              className="toast__close"
              onClick={() => setMessage(null)}
              aria-label="Dismiss"
            >
              &times;
            </button>
          </div>,
          document.body
        )}
    </ToastContext.Provider>
  );
};

export default ToastProvider;
