import { IonButtons, IonHeader, IonIcon, IonToolbar } from '@ionic/react';
import { menuOutline } from 'ionicons/icons';
import { useSideNav } from './SideNav';
import AccountMenu from './AccountMenu';
import NotificationsMenu from './NotificationsMenu';
import './DashboardHeader.css';

type DashboardHeaderProps = {
  title: string;
  subtitle?: string;
  /** Name shown in the account chip on the right. */
  accountName: string;
};

/* The header carries the page identity on the left and the two account controls
 * on the right. There is no search field: a bar that filtered nothing only
 * crowded the bell, and filtering lives on each page's own toolbar. */
const DashboardHeader: React.FC<DashboardHeaderProps> = ({ title, subtitle, accountName }) => {
  const { toggle } = useSideNav();

  return (
    <IonHeader className="dash-header">
      <IonToolbar className="dash-header__toolbar">
        <IonButtons slot="start">
          <button
            type="button"
            className="dash-header__nav-toggle"
            onClick={toggle}
            aria-label="Open navigation"
          >
            <IonIcon icon={menuOutline} />
          </button>
        </IonButtons>

        <div className="dash-header__titles">
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>

        <IonButtons slot="end">
          <NotificationsMenu />
          <AccountMenu accountName={accountName} />
        </IonButtons>
      </IonToolbar>
    </IonHeader>
  );
};

export default DashboardHeader;
