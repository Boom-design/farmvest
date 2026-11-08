import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import logo from '../assets/Logo.png';
import './PublicNav.css';

/** Sections of the landing page, in the order they appear. */
const LINKS = [
  { label: 'Home', href: '#top' },
  { label: 'Projects', href: '#projects' },
  { label: 'Equipment', href: '#equipment' },
  { label: 'How It Works', href: '#how' },
  { label: 'FAQ', href: '#faq' },
];

/**
 * The public header.
 *
 * Deliberately not the dashboard SideNav: a visitor has no role, no counts and
 * nothing to be notified about, so the two share no state. This one is a plain
 * anchor bar that collapses into a sheet on a phone.
 */
const PublicNav: React.FC = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // The bar sits on the hero image, so it only earns its shadow once the page
  // has moved under it.
  //
  // Listened for in the capture phase on the document rather than on window:
  // the landing page scrolls inside IonContent's own scroll element, and a
  // scroll event from there never reaches window.
  useEffect(() => {
    const onScroll = (event: Event) => {
      const target = event.target as HTMLElement | Document | null;
      const top =
        target instanceof HTMLElement ? target.scrollTop : window.scrollY;
      setScrolled(top > 8);
    };

    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, []);

  // A menu left open behind a resize would cover the desktop layout.
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 900) setOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const go = (href: string) => {
    setOpen(false);

    const target = href === '#top' ? null : document.querySelector(href);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <header className={`pubnav${scrolled ? ' pubnav--scrolled' : ''}`}>
      <div className="pubnav__inner">
        <button type="button" className="pubnav__brand" onClick={() => go('#top')}>
          <img src={logo} alt="" className="pubnav__logo" />
          <span className="pubnav__name">
            Farm<span>Vest</span>
          </span>
        </button>

        <nav className={`pubnav__links${open ? ' pubnav__links--open' : ''}`}>
          {LINKS.map((link) => (
            <button
              key={link.href}
              type="button"
              className="pubnav__link"
              onClick={() => go(link.href)}
            >
              {link.label}
            </button>
          ))}

          <div className="pubnav__cta">
            <button
              type="button"
              className="pubnav__btn pubnav__btn--ghost"
              onClick={() => navigate('/login')}
            >
              Log In
            </button>
            <button
              type="button"
              className="pubnav__btn pubnav__btn--solid"
              onClick={() => navigate('/register')}
            >
              Get Started
            </button>
          </div>
        </nav>

        <button
          type="button"
          className="pubnav__burger"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={open ? 'Close menu' : 'Open menu'}
        >
          <span />
          <span />
          <span />
        </button>
      </div>
    </header>
  );
};

export default PublicNav;
