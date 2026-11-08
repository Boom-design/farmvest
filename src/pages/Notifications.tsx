import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IonContent, IonIcon, IonPage } from '@ionic/react';
import { chevronForwardOutline } from 'ionicons/icons';
import DashboardHeader from '../components/DashboardHeader';
import EmptyState from '../components/EmptyState';
import { useAuth } from '../contexts/AuthContext';
import {
  loadNotifications,
  markAllSeen,
  timeAgo,
  type AppNotification,
} from '../lib/notifications';
import { shortDate } from '../lib/format';
import '../theme/dashboard.css';
import Skeleton from '../components/Skeleton';

/** The full list behind "View more" in the header bell. */
const Notifications: React.FC = () => {
  const { profile, role } = useAuth();
  const navigate = useNavigate();

  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!role || !profile) return;

    setItems(await loadNotifications(role, profile.users_id));
    markAllSeen(profile.users_id);
    setLoading(false);
  }, [role, profile]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <IonPage>
      <DashboardHeader
        title="Notifications"
        subtitle="Everything that needs your attention, newest first."
        accountName={profile?.name || ''}
      />

      <IonContent className="dash-content">
        <div className="dash-page">
          <section className="dash-panel">
            <div className="dash-panel__head">
              <h2 className="dash-panel__title">All Notifications</h2>
              <span className="dash-stat__hint">{items.length} total</span>
            </div>

            <div className="dash-panel__body">
              {loading ? (
                <Skeleton />
              ) : items.length === 0 ? (
                <EmptyState
                  title="Nothing needs your attention yet"
                  message="New sign-ups, projects, bookings and reports show up here as they happen."
                />
              ) : (
                items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="dash-row dash-row--button"
                    onClick={() => navigate(item.route)}
                  >
                    <span className={`dash-row__icon dash-stat__icon--${item.tone}`}>
                      <IonIcon icon={item.icon} />
                    </span>
                    <span className="dash-row__text">
                      <span className="dash-row__title">{item.title}</span>
                      <span className="dash-row__meta">{item.body}</span>
                      <span className="dash-row__meta">
                        {timeAgo(item.at)} · {shortDate(item.at)}
                      </span>
                    </span>
                    <span className="dash-row__trailing">
                      <IonIcon icon={chevronForwardOutline} />
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Notifications;
