import { lazy, Suspense } from 'react';
import './EmptyState.css';

/** Loaded on demand: the Lottie engine is large and only empty screens need it. */
const LottiePlayer = lazy(() => import('./LottiePlayer'));

type EmptyStateProps = {
  title: string;
  message?: string;
  /** Pixel size of the illustration; the dropdown uses a smaller one. */
  size?: number;
};

/**
 * The "there is nothing here yet" panel.
 *
 * A screen with no rows is normal in this system rather than an error: a fresh
 * admin account has no disputes, a new farm owner has no bookings. The
 * illustration says so without the page looking broken.
 *
 * The animation is skipped for a viewer whose device asks for reduced motion;
 * the wording carries the same message on its own.
 */
const EmptyState: React.FC<EmptyStateProps> = ({ title, message, size = 150 }) => {
  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <div className="empty-state">
      {!reduceMotion && (
        // The placeholder holds the same box, so the text below does not jump
        // when the animation finishes loading.
        <Suspense fallback={<div style={{ width: size, height: size }} />}>
          <LottiePlayer animation="empty" size={size} />
        </Suspense>
      )}

      <p className="empty-state__title">{title}</p>
      {message && <p className="empty-state__message">{message}</p>}
    </div>
  );
};

export default EmptyState;
