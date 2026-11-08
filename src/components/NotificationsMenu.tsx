import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { IonIcon, IonSpinner } from '@ionic/react';
import { notificationsOutline } from 'ionicons/icons';
import { useAuth } from '../contexts/AuthContext';
import EmptyState from './EmptyState';

/** Shares its chunk with the empty-state illustration, so the engine downloads once. */
const LottiePlayer = lazy(() => import('./LottiePlayer'));
import {
  countUnseen,
  getLastSeen,
  loadNotifications,
  markAllSeen,
  timeAgo,
  type AppNotification,
} from '../lib/notifications';
import './NotificationsMenu.css';

/** How many fit in the dropdown before "View more" takes over. */
const PREVIEW_COUNT = 5;

/**
 * Bell in the header. The panel is portalled to the body for the same reason as
 * the account menu: inside the Ionic toolbar it is painted under the page.
 */
const NotificationsMenu: React.FC = () => {
  const { profile, role } = useAuth();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const [position, setPosition] = useState({ top: 0, right: 0 });
  const [ringing, setRinging] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (!role || !profile) return;

    setItems(await loadNotifications(role, profile.users_id));
    setLastSeen(getLastSeen(profile.users_id));
    setLoading(false);
  }, [role, profile]);

  useEffect(() => {
    load();
  }, [load]);

  useLayoutEffect(() => {
    if (!open || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    setPosition({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const unseen = countUnseen(items, lastSeen);

  // Opening the panel is the read receipt, so the badge clears on open.
  const toggle = () => {
    const next = !open;
    setOpen(next);

    // Rings on every open, so the button reacts even when there is nothing to
    // show; the class is dropped again once the keyframes finish.
    if (next) {
      setRinging(true);
      window.setTimeout(() => setRinging(false), 600);
    }

    if (next && profile) {
      load();
      markAllSeen(profile.users_id);
      setLastSeen(new Date().toISOString());
    }
  };

  const go = (route: string) => {
    setOpen(false);
    navigate(route);
  };

  return (
    <div className="notif" ref={containerRef}>
      <button
        type="button"
        className={`notif__trigger${ringing ? ' notif__trigger--ringing' : ''}`}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={unseen > 0 ? `Notifications, ${unseen} new` : 'Notifications'}
      >
        {unseen > 0 ? (
          <Suspense fallback={<IonIcon icon={notificationsOutline} />}>
            <span className="notif__lottie">
              <LottiePlayer animation="bell" size={26} />
            </span>
          </Suspense>
        ) : (
          <IonIcon icon={notificationsOutline} />
        )}

        {unseen > 0 && <span className="notif__badge">{unseen > 9 ? '9+' : unseen}</span>}
      </button>

      {open &&
        createPortal(
          <div
            className="notif__panel"
            role="menu"
            ref={panelRef}
            style={{ top: position.top, right: position.right }}
          >
            <div className="notif__head">
              <p className="notif__title">Notifications</p>
              <span className="notif__count">{items.length}</span>
            </div>

            <div className="notif__list">
              {loading ? (
                <div className="notif__loading">
                  <IonSpinner name="crescent" />
                </div>
              ) : items.length === 0 ? (
                <EmptyState title="You are all caught up" size={110} />
              ) : (
                items.slice(0, PREVIEW_COUNT).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    className="notif__item"
                    onClick={() => go(item.route)}
                  >
                    <span className={`notif__icon notif__icon--${item.tone}`}>
                      <IonIcon icon={item.icon} />
                    </span>
                    <span className="notif__text">
                      <span className="notif__item-title">{item.title}</span>
                      <span className="notif__item-body">{item.body}</span>
                    </span>
                    <span className="notif__time">{timeAgo(item.at)}</span>
                  </button>
                ))
              )}
            </div>

            <button
              type="button"
              className="notif__more"
              role="menuitem"
              onClick={() => go('/notifications')}
            >
              View more
            </button>
          </div>,
          document.body
        )}
    </div>
  );
};

export default NotificationsMenu;
