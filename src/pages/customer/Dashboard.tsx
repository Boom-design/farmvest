import { useState } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import DashboardHeader from '../../components/DashboardHeader';
import FarmOwnerDashboard from '../FarmOwnerDashboard';
import InvestorDashboard from '../InvestorDashboard';
import { useAuth } from '../../contexts/AuthContext';
import '../../theme/dashboard.css';

const VIEWS = ['Farming', 'Investing'] as const;
type View = (typeof VIEWS)[number];

const SUBTITLE: Record<View, string> = {
  Farming: 'Your livestock projects, equipment rentals, and the weather over your farm.',
  Investing: 'Your portfolio, what to fund next, and how the farms you backed are doing.',
};

/**
 * The customer dashboard.
 *
 * One account now farms and invests, so there are two dashboards worth of
 * figures to show. Stacking them would make a screen nobody reaches the bottom
 * of, and merging the numbers would produce totals that mean nothing: money
 * raised and money invested move in opposite directions.
 *
 * So they stay two views behind a switch. Farming opens first because a
 * customer who has done neither is far more likely to post a project than to
 * fund one, and because it is the half that needs the account set up.
 *
 * Both halves are the existing dashboards rendered in embedded mode. Neither
 * was rewritten: the queries and charts already work, and a copy of them here
 * would be a second thing to keep correct.
 */
const CustomerDashboard: React.FC = () => {
  const { profile } = useAuth();
  const [view, setView] = useState<View>('Farming');

  return (
    <IonPage>
      <DashboardHeader
        title="Dashboard"
        subtitle={SUBTITLE[view]}
        accountName={profile?.name || ''}
      />

      <IonContent className="dash-content">
        <div className="dash-switch-row">
          {VIEWS.map((value) => (
            <button
              key={value}
              type="button"
              className={`dash-switch${view === value ? ' dash-switch--active' : ''}`}
              onClick={() => setView(value)}
            >
              {value}
            </button>
          ))}
        </div>

        {/* Both stay mounted so switching back does not refetch everything and
            flash a spinner over figures the customer just read. */}
        <div hidden={view !== 'Farming'}>
          <FarmOwnerDashboard embedded />
        </div>

        <div hidden={view !== 'Investing'}>
          <InvestorDashboard embedded />
        </div>
      </IonContent>
    </IonPage>
  );
};

export default CustomerDashboard;
