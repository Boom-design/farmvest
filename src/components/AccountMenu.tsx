import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { IonIcon } from '@ionic/react';
import { chevronDownOutline, logOutOutline, personCircle, personOutline } from 'ionicons/icons';
import { useAuth } from '../contexts/AuthContext';
import './AccountMenu.css';

type AccountMenuProps = {
  /** Falls back to the role when the profile has no name yet. */
  accountName: string;
};

/** Account chip in the header, with My Account and Logout. */
const AccountMenu: React.FC<AccountMenuProps> = ({ accountName }) => {
  const { profile, role, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, right: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // The panel is portalled to the body: inside the Ionic toolbar it is painted
  // under the page content, whatever the z-index.
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

  const handleLogout = async () => {
    setOpen(false);
    await signOut();
    navigate('/login', {
      replace: true,
      state: { notice: 'You have been logged out successfully.' },
    });
  };

  return (
    <div className="account-menu" ref={containerRef}>
      <button
        type="button"
        className="account-menu__trigger"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {profile?.avatar_url ? (
          <img src={profile.avatar_url} alt="" className="account-menu__photo" />
        ) : (
          <IonIcon icon={personCircle} className="account-menu__avatar" />
        )}
        <span className="account-menu__name">{accountName}</span>
        <IonIcon icon={chevronDownOutline} className="account-menu__caret" />
      </button>

      {open &&
        createPortal(
          <div
            className="account-menu__panel"
            role="menu"
            ref={panelRef}
            style={{ top: position.top, right: position.right }}
          >
            <div className="account-menu__identity">
              <p className="account-menu__identity-name">{accountName}</p>
              <p className="account-menu__identity-meta">{profile?.email ?? ''}</p>
              {role && <span className="dash-pill dash-pill--slate">{role}</span>}
            </div>

            <button
              type="button"
              className="account-menu__item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                navigate('/account');
              }}
            >
              <IonIcon icon={personOutline} />
              My Account
            </button>

            <button
              type="button"
              className="account-menu__item account-menu__item--danger"
              role="menuitem"
              onClick={handleLogout}
            >
              <IonIcon icon={logOutOutline} />
              Logout
            </button>
          </div>,
          document.body
        )}
    </div>
  );
};

export default AccountMenu;
