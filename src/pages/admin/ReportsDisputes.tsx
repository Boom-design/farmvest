import { useState } from 'react';
import { IonContent, IonIcon, IonPage } from '@ionic/react';
import { searchOutline } from 'ionicons/icons';
import DashboardHeader from '../../components/DashboardHeader';
import { useAuth } from '../../contexts/AuthContext';
import DisputesTab from './reports/DisputesTab';
import CaseHistoryTab from './reports/CaseHistoryTab';
import RevenueTab from './reports/RevenueTab';
import {
  CompletedProjectsTab,
  InvestmentsTab,
  MaintenanceTab,
  RentalsTab,
} from './reports/RecordTabs';
import { emptyFilters, type ReportFilters } from './reports/reportFilters';
import '../../theme/dashboard.css';

/**
 * Reports is where the Admin looks at what already happened, plus the one thing
 * that still needs deciding. Disputes comes first on purpose: a new case must not
 * be buried under the archive. Everything after it is read-only history.
 */
const TABS = [
  'Disputes',
  'Livestock Projects',
  'Investment Transactions',
  'Rental Bookings',
  'Equipment Maintenance',
  'Revenue Summary',
  'Case History',
] as const;

type Tab = (typeof TABS)[number];

const SUBTITLE: Record<Tab, string> = {
  Disputes: 'Cases filed against an account, and the evidence behind them.',
  'Livestock Projects': 'Projects that reached Completed, with what each one raised.',
  'Investment Transactions': 'Every investment that went through, and the commission on it.',
  'Rental Bookings': 'Bookings that were returned and closed, with the fee earned.',
  'Equipment Maintenance': 'Service history and running cost of the FarmVest fleet.',
  'Revenue Summary': 'Commission and rental income, month by month.',
  'Case History': 'Disputes that have already been decided.',
};

const ReportsDisputes: React.FC = () => {
  const { profile } = useAuth();

  const [tab, setTab] = useState<Tab>('Disputes');
  const [filters, setFilters] = useState<ReportFilters>(emptyFilters);
  const [error, setError] = useState<string | null>(null);

  const setField = (field: keyof ReportFilters, value: string) =>
    setFilters((current) => ({ ...current, [field]: value }));

  const switchTab = (value: Tab) => {
    setTab(value);
    setError(null);
    setFilters(emptyFilters);
  };

  // The revenue tab is read a calendar year at a time, so it carries its own
  // year picker instead of the shared date range.
  const showRange = tab !== 'Revenue Summary';

  return (
    <IonPage>
      <DashboardHeader
        title="Reports"
        subtitle={SUBTITLE[tab]}
        accountName={profile?.name || 'System Administrator'}
      />

      <IonContent className="dash-content">
        <div className="dash-page">
          {error && <p className="dash-error">{error}</p>}

          <div className="dash-toolbar-row">
            {TABS.map((value) => (
              <button
                key={value}
                type="button"
                className={`dash-tab${tab === value ? ' dash-tab--active' : ''}`}
                onClick={() => switchTab(value)}
              >
                {value}
              </button>
            ))}
          </div>

          {showRange && (
            <div className="dash-toolbar-row">
              <div className="dash-field">
                <label htmlFor="report-from">From</label>
                <input
                  id="report-from"
                  type="date"
                  className="dash-input"
                  value={filters.from}
                  onChange={(event) => setField('from', event.target.value)}
                />
              </div>

              <div className="dash-field">
                <label htmlFor="report-to">To</label>
                <input
                  id="report-to"
                  type="date"
                  className="dash-input"
                  value={filters.to}
                  onChange={(event) => setField('to', event.target.value)}
                />
              </div>

              <button
                type="button"
                className="dash-btn dash-btn--slate"
                onClick={() => setFilters(emptyFilters)}
              >
                Clear Filters
              </button>

              <label className="dash-search dash-spacer">
                <IonIcon icon={searchOutline} />
                <input
                  type="search"
                  placeholder="Search this report"
                  value={filters.search}
                  onChange={(event) => setField('search', event.target.value)}
                />
              </label>
            </div>
          )}

          <section className="dash-panel">
            <div className="dash-panel__head">
              <h2 className="dash-panel__title">{tab}</h2>
              <span className="dash-stat__hint">
                {filters.from || filters.to
                  ? `${filters.from || 'the beginning'} to ${filters.to || 'today'}`
                  : 'All dates'}
              </span>
            </div>

            <div className="dash-panel__body">
              {tab === 'Disputes' && <DisputesTab filters={filters} onError={setError} />}
              {tab === 'Livestock Projects' && (
                <CompletedProjectsTab filters={filters} onError={setError} />
              )}
              {tab === 'Investment Transactions' && (
                <InvestmentsTab filters={filters} onError={setError} />
              )}
              {tab === 'Rental Bookings' && <RentalsTab filters={filters} onError={setError} />}
              {tab === 'Equipment Maintenance' && (
                <MaintenanceTab filters={filters} onError={setError} />
              )}
              {tab === 'Revenue Summary' && <RevenueTab onError={setError} />}
              {tab === 'Case History' && <CaseHistoryTab filters={filters} onError={setError} />}
            </div>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default ReportsDisputes;
