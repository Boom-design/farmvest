import { Fragment, createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { IonIcon } from '@ionic/react';
import {
  bagHandleOutline,
  barChartOutline,
  calendarOutline,
  cameraOutline,
  cashOutline,
  searchOutline,
  closeOutline,
  constructOutline,
  documentTextOutline,
  gridOutline,
  leafOutline,
  logOutOutline,
  partlySunnyOutline,
  shieldCheckmarkOutline,
} from 'ionicons/icons';
import { useAuth, type UserRole } from '../contexts/AuthContext';
import logo from '../assets/Logo.png';
import barn from '../assets/barn.png';
import './SideNav.css';

type NavItem = {
  label: string;
  icon: string;
  /** Routes that do not exist yet render as disabled entries. */
  route?: string;
  /**
   * Heading this item sits under. Ten flat entries is a wall on a phone, and
   * the two halves of the platform are genuinely different work, so they are
   * labelled rather than merely ordered. Items with no group sit at the top.
   */
  group?: 'Farming' | 'Investing';
};

const NAV_ITEMS: Record<UserRole, NavItem[]> = {
  // The Admin runs the platform: account approval, the FarmVest equipment fleet,
  // rental operations, and dispute handling.
  Admin: [
    { label: 'Dashboard', icon: gridOutline, route: '/admin' },
    { label: 'User Management', icon: shieldCheckmarkOutline, route: '/admin/users' },
    { label: 'Livestock Projects', icon: leafOutline, route: '/admin/projects' },
    { label: 'Investment Transactions', icon: cashOutline, route: '/admin/investments' },
    { label: 'Equipment Fleet', icon: constructOutline, route: '/admin/equipment' },
    { label: 'Rental Bookings', icon: calendarOutline, route: '/admin/rentals' },
    { label: 'Reports', icon: documentTextOutline, route: '/admin/reports' },
  ],
  // One list for both halves of the marketplace. Dashboard and Reports sit
  // outside the groups because each covers both: the dashboard opens on
  // whatever needs attention, and a finished project and a finished investment
  // are both records.
  //
  // Wallet and Transactions are deliberately absent. FarmVest never moves
  // money, so there is no balance to show, and an investment record is the
  // transaction, so a second screen for it would list the same rows twice.
  Customer: [
    { label: 'Dashboard', icon: gridOutline, route: '/app' },

    { label: 'My Projects', icon: leafOutline, route: '/app/projects', group: 'Farming' },
    { label: 'Rent Equipment', icon: constructOutline, route: '/app/equipment', group: 'Farming' },
    { label: 'My Rentals', icon: bagHandleOutline, route: '/app/rentals', group: 'Farming' },
    { label: 'Progress Updates', icon: barChartOutline, route: '/app/progress', group: 'Farming' },
    { label: 'Weather Advisory', icon: partlySunnyOutline, route: '/app/weather', group: 'Farming' },

    { label: 'Browse Projects', icon: searchOutline, route: '/app/browse', group: 'Investing' },
    { label: 'My Investments', icon: cashOutline, route: '/app/investments', group: 'Investing' },
    { label: 'Progress Monitoring', icon: cameraOutline, route: '/app/monitoring', group: 'Investing' },

    { label: 'Reports', icon: documentTextOutline, route: '/app/reports' },
  ],
};

type SideNavValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
};

const SideNavContext = createContext<SideNavValue>({
  isOpen: false,
  open: () => undefined,
  close: () => undefined,
  toggle: () => undefined,
});

export const useSideNav = () => useContext(SideNavContext);

export const SideNavProvider = ({ children }: { children: ReactNode }) => {
  const [isOpen, setIsOpen] = useState(false);

  const value = useMemo<SideNavValue>(
    () => ({
      isOpen,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      toggle: () => setIsOpen((current) => !current),
    }),
    [isOpen]
  );

  return <SideNavContext.Provider value={value}>{children}</SideNavContext.Provider>;
};

/** Screens that never show navigation, even when a session is still active. */
const PUBLIC_ROUTES = ['/', '/login', '/register', '/forgot-password'];

/**
 * Brand sidebar for all three roles.
 *
 * This is a plain fixed element rather than an IonMenu inside an IonSplitPane:
 * Ionic decides on its own when a menu and its toggle button are available, and
 * on phones that left the dashboard with no way to reach the other pages. Here
 * the drawer is permanent from 992px up and slides in below that, driven only by
 * the CSS in SideNav.css and the open state in this file.
 */
export const AppSidebar: React.FC = () => {
  const { role, signOut } = useAuth();
  const { isOpen, close } = useSideNav();
  const navigate = useNavigate();
  const location = useLocation();

  const isPublicRoute = PUBLIC_ROUTES.includes(location.pathname);
  const showNav = Boolean(role) && !isPublicRoute;

  // Shifts the router outlet to the right of the sidebar on wide screens.
  useEffect(() => {
    document.body.classList.toggle('has-sidenav', showNav);
    return () => document.body.classList.remove('has-sidenav');
  }, [showNav]);

  // A drawer left open across a navigation would cover the new page.
  useEffect(() => {
    close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  if (!showNav || !role) return null;

  const items = NAV_ITEMS[role];

  const go = (route?: string) => {
    if (!route) return;
    navigate(route);
    close();
  };

  const handleLogout = async () => {
    close();
    await signOut();
    navigate('/login', {
      replace: true,
      state: { notice: 'You have been logged out successfully.' },
    });
  };

  return (
    <>
      <div
        className={`sidenav-backdrop${isOpen ? ' sidenav-backdrop--visible' : ''}`}
        onClick={close}
        aria-hidden="true"
      />

      <aside className={`sidenav${isOpen ? ' sidenav--open' : ''}`}>
        <div className="sidenav__brand">
          <img src={logo} alt="" className="sidenav__brand-logo" />
          <div>
            <p className="sidenav__brand-name">
              Farm<span>Vest</span>
            </p>
            <p className="sidenav__brand-tagline">Grow Together, Harvest Future.</p>
          </div>

          <button
            type="button"
            className="sidenav__close"
            onClick={close}
            aria-label="Close navigation"
          >
            <IonIcon icon={closeOutline} />
          </button>
        </div>

        <nav className="sidenav__list">
          {items.map((item, index) => (
            <Fragment key={item.label}>
              {/* The heading is printed by the first item carrying that group,
                  so the list stays one flat array and the order in NAV_ITEMS is
                  the order on screen. */}
              {item.group && item.group !== items[index - 1]?.group && (
                <p className="sidenav__group">{item.group}</p>
              )}

              <button
                type="button"
                disabled={!item.route}
                className={`sidenav__item${item.route === location.pathname ? ' sidenav__item--active' : ''}`}
                onClick={() => go(item.route)}
              >
                <IonIcon icon={item.icon} />
                <span>{item.label}</span>
              </button>
            </Fragment>
          ))}
        </nav>

        <div className="sidenav__art">
          <img src={barn} alt="" />
        </div>

        <div className="sidenav__footer">
          <button type="button" className="sidenav__item" onClick={handleLogout}>
            <IonIcon icon={logOutOutline} />
            <span>Logout</span>
          </button>
        </div>
      </aside>
    </>
  );
};

export default AppSidebar;
