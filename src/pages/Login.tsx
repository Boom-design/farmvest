import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { IonContent, IonIcon, IonPage } from '@ionic/react';
import {
  arrowBackOutline,
  checkmarkCircle,
  ellipseOutline,
  callOutline,
  eyeOffOutline,
  eyeOutline,
  lockClosedOutline,
  mailOutline,
  personAddOutline,
  personOutline,
  shieldCheckmarkOutline,
} from 'ionicons/icons';
import { setRememberMe, supabase } from '../supabaseClient';
import { homeRouteForRole, type UserRole } from '../contexts/AuthContext';
import AddressPicker, { type AddressValue } from '../components/AddressPicker';
import { useToast } from '../components/Toast';
import IdentityVerification from '../components/IdentityVerification';
import {
  clearFailedAttempts,
  formatRemaining,
  getAttemptsBeforeLockout,
  getLockoutRemainingMs,
  registerFailedAttempt,
} from '../lib/loginLockout';
import logo from '../assets/Logo.png';
import hero from '../assets/login-hero.png';
import iconInvestments from '../assets/icon-investments.png';
import iconProjects from '../assets/icon-projects.png';
import iconEquipment from '../assets/icon-equipment.png';
import './Login.css';

type Feedback = { text: string; tone: 'danger' | 'success' } | null;

/**
 * What a password has to contain.
 *
 * Written as a list rather than one regular expression so the form can show
 * which rules are already met. A single pass/fail message leaves the person
 * guessing which character class they are missing, and they guess wrong.
 *
 * Eight characters rather than Supabase's default six: four classes in six
 * characters leaves almost nothing to choose from.
 */
const PASSWORD_RULES = [
  { label: 'At least 8 characters', test: (value: string) => value.length >= 8 },
  { label: 'An uppercase letter', test: (value: string) => /[A-Z]/.test(value) },
  { label: 'A lowercase letter', test: (value: string) => /[a-z]/.test(value) },
  { label: 'A number', test: (value: string) => /[0-9]/.test(value) },
  {
    label: 'A special character',
    test: (value: string) => /[^A-Za-z0-9]/.test(value),
  },
];

const FEATURES = [
  { icon: iconInvestments, label: 'Smart Investments' },
  { icon: iconProjects, label: 'Diverse Farm Projects' },
  { icon: iconEquipment, label: 'Equipment Rental' },
];

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { showSuccess } = useToast();
  const location = useLocation();

  // The path is what puts the page in sign-up mode, so a refresh of /register
  // stays on the registration form.
  const [isSignup, setIsSignup] = useState(location.pathname === '/register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [contactNumber, setContactNumber] = useState('');

  const [farmAddress, setFarmAddress] = useState<AddressValue>({
    province: '',
    city: '',
    barangay: '',
  });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [remember, setRemember] = useState(true);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [loading, setLoading] = useState(false);

  const [lockoutMs, setLockoutMs] = useState(0);

  const timerRef = useRef<number | null>(null);

  /** Path to return to after a successful sign-in, when the landing page sent one. */
  const returnToRef = useRef<string | null>(null);

  // Keep the lockout countdown in sync with whichever email is being typed.
  useEffect(() => {
    const tick = () => setLockoutMs(getLockoutRemainingMs(email));

    tick();
    timerRef.current = window.setInterval(tick, 1000);

    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, [email]);

  // Everything the previous page asked for arrives in the router state:
  //   notice   a one-off message, set by logging out
  //   mode     'signup', set by the landing page's Get Started button
  //   role     which account type to preselect on the signup form
  //   returnTo where to land after signing in, set by a gated View More
  //
  // The state is cleared from history straight after, so a refresh does not
  // replay the notice or silently reopen the signup form.
  useEffect(() => {
    const state = location.state as {
      notice?: string;
      mode?: 'signup' | 'login';
      returnTo?: string;
    } | null;
    if (!state) return;

    if (state.notice) setFeedback({ text: state.notice, tone: 'success' });
    if (state.mode === 'signup') setIsSignup(true);

    // Kept in a ref rather than state: it is read once, after the session
    // exists, and it must survive the history wipe on the next line.
    returnToRef.current = state.returnTo ?? null;

    window.history.replaceState({}, '');
  }, [location.state]);

  const isLocked = lockoutMs > 0;

  const passwordChecks = PASSWORD_RULES.map((rule) => ({
    label: rule.label,
    met: rule.test(password),
  }));

  const passwordStrong = passwordChecks.every((check) => check.met);

  // Kept in step with the address bar: the two modes are two routes.
  useEffect(() => {
    setIsSignup(location.pathname === '/register');
  }, [location.pathname]);

  const switchMode = () => {
    setFeedback(null);
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setShowConfirm(false);
    navigate(isSignup ? '/login' : '/register', { replace: true });
  };

  const handleSignup = async () => {
    if (!name.trim() || !email.trim() || !contactNumber.trim() || !password) {
      setFeedback({ text: 'Please fill in all fields.', tone: 'danger' });
      return;
    }

    if (!/^\d{11}$/.test(contactNumber)) {
      setFeedback({
        text: 'The contact number must be 11 digits, for example 09171234567.',
        tone: 'danger',
      });
      return;
    }

    if (!farmAddress.province || !farmAddress.city || !farmAddress.barangay) {
      setFeedback({
        text: 'Please choose your address: province, city or municipality, and barangay.',
        tone: 'danger',
      });
      return;
    }

    if (!passwordStrong) {
      setFeedback({
        text: 'Your password does not meet all five requirements listed under the field.',
        tone: 'danger',
      });
      return;
    }

    if (password !== confirmPassword) {
      setFeedback({ text: 'The two passwords do not match.', tone: 'danger' });
      return;
    }

    setLoading(true);
    setFeedback(null);

    // The profile row in the users table is written by the handle_new_user
    // trigger from this metadata rather than by an insert from here, so it is
    // created server-side and a client cannot choose its own verification
    // status or role.
    //
    // No confirmation email is sent, and no identity check happens here.
    // Signing up costs nothing and commits to nothing, so it asks for nothing:
    // the government ID and the face match are required at the point the
    // customer starts asking other people for money, which is posting a
    // project. The address is still the sign-in identifier and still receives
    // the forgot-password code.
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          name: name.trim(),
          contact_number: contactNumber.trim(),
          // Four fields rather than one string: the readable label is what the
          // profile shows, and the parts are what the weather geocoder needs.
          farm_location: `${farmAddress.barangay}, ${farmAddress.city}, ${farmAddress.province}`,
          farm_province: farmAddress.province,
          farm_city: farmAddress.city,
          farm_barangay: farmAddress.barangay,
        },
      },
    });

    if (error) {
      setFeedback({ text: error.message, tone: 'danger' });
    } else if (!data.session) {
      // The project asks for the address to be confirmed first: there is no
      // session yet, so say so here rather than bouncing to an empty sign-in.
      setPassword('');
      setConfirmPassword('');
      setFeedback({
        text: 'Registration successful. Check your email to confirm your account, then sign in.',
        tone: 'success',
      });
      navigate('/login', { replace: true, state: { notice: 'Registration successful. Check your email to confirm your account, then sign in.' } });
    } else {
      // signUp returns a session, so the account is usable immediately. The
      // toast lives above the router, so it stays up across the redirect.
      setFeedback(null);
      setPassword('');
      setConfirmPassword('');
      showSuccess(`Registration successful. Welcome to FarmVest, ${name.trim()}!`);
      navigate('/app', { replace: true });
    }

    setLoading(false);
  };

  const handleLogin = async () => {
    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password) {
      setFeedback({ text: 'Please enter your email and password.', tone: 'danger' });
      return;
    }

    const remaining = getLockoutRemainingMs(trimmedEmail);
    if (remaining > 0) {
      setFeedback({
        text: `Too many failed attempts. Please try again in ${formatRemaining(remaining)}.`,
        tone: 'danger',
      });
      return;
    }

    setLoading(true);
    setFeedback(null);

    // Decides whether the session survives a closed browser.
    setRememberMe(remember);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    if (error) {
      const lockMs = registerFailedAttempt(trimmedEmail);
      setLockoutMs(getLockoutRemainingMs(trimmedEmail));

      if (lockMs > 0) {
        setFeedback({
          text: `Too many failed attempts. Login is locked for ${formatRemaining(lockMs)}.`,
          tone: 'danger',
        });
      } else {
        const left = getAttemptsBeforeLockout(trimmedEmail);
        setFeedback({
          text: `${error.message}. ${left} attempt${left === 1 ? '' : 's'} left before your account is temporarily locked.`,
          tone: 'danger',
        });
      }

      setLoading(false);
      return;
    }

    clearFailedAttempts(trimmedEmail);

    // Verification does not gate signing in any more: it gates posting a
    // project, and is asked for there. What still gates signing in is whether
    // an Admin has deactivated the account.
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('user_type, account_status, suspended_reason')
      .eq('users_id', data.user.id)
      .maybeSingle();

    // A failed lookup is not a rejected account: reporting it as one signed the
    // user out and told an approved account it was still pending.
    if (profileError || !profile) {
      await supabase.auth.signOut();
      setLoading(false);
      setFeedback({
        text: profileError
          ? `Could not load your account: ${profileError.message}`
          : 'Your account has no profile yet. Please contact the administrator.',
        tone: 'danger',
      });
      return;
    }

    if (profile.account_status === 'Inactive') {
      await supabase.auth.signOut();
      setLoading(false);
      setFeedback({
        text: `This account has been deactivated. Reason: ${profile.suspended_reason}`,
        tone: 'danger',
      });
      return;
    }

    setLoading(false);

    // A visitor sent here by a locked card goes back to that card; everyone
    // else goes to the dashboard their role owns.
    const destination =
      returnToRef.current ?? homeRouteForRole((profile.user_type as UserRole) ?? null);
    navigate(destination, { replace: true });
  };

  // The card is a real form, so pressing Enter in any field submits it the same
  // way clicking the button does.
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (loading || (!isSignup && isLocked)) return;

    if (isSignup) {
      handleSignup();
    } else {
      handleLogin();
    }
  };

  return (
    <IonPage>
      <IonContent className="auth-content">
        <div className="auth-layout">
          <aside className="auth-brand">
            <div className="auth-brand__top">
              <img src={logo} alt="" className="auth-brand__logo" />
              <h1 className="auth-brand__name">
                Farm<span>Vest</span>
              </h1>
              <p className="auth-brand__tagline">Invest in Growth. Harvest the Future.</p>
              <p className="auth-brand__copy">
                Invest in poultry, piggery, and other agricultural projects, or rent quality farm
                equipment. Grow your returns. Empower farmers.
              </p>

              <ul className="auth-features">
                {FEATURES.map((feature) => (
                  <li key={feature.label}>
                    <span className="auth-features__icon">
                      <img src={feature.icon} alt="" />
                    </span>
                    {feature.label}
                  </li>
                ))}
              </ul>
            </div>

            <img src={hero} alt="" className="auth-brand__hero" />
          </aside>

          <main className="auth-panel">
            <form
              className={`auth-card${isSignup ? ' auth-card--signup' : ''}`}
              onSubmit={handleSubmit}
            >
              {/* The catalogue is the front door, so signing in has to be
                * escapable: a visitor who only wanted to look around gets back
                * without using the browser's own back button. */}
              <button type="button" className="auth-back" onClick={() => navigate('/')}>
                <IonIcon icon={arrowBackOutline} />
                Back to Home
              </button>

              <h2 className="auth-card__title">{isSignup ? 'Create Account' : 'Welcome!'}</h2>
              <p className="auth-card__subtitle">
                {isSignup
                  ? 'One account to fund a farm, or to get yours funded'
                  : 'Login to your FarmVest account'}
              </p>

              {isSignup && (
                <>
                  {/* Paired side by side on a wide panel, so the sign-up form stays
                    * short enough to read without a long scroll. */}
                  <div className="auth-pair">
                    <div className="auth-field">
                      <label htmlFor="signup-name">Full Name</label>
                      <div className="auth-input">
                        <IonIcon icon={personOutline} />
                        <input
                          id="signup-name"
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          placeholder="Juan Dela Cruz"
                          autoComplete="name"
                        />
                      </div>
                    </div>

                    <div className="auth-field">
                      <label htmlFor="signup-contact">Contact Number</label>
                      <div className="auth-input">
                        <IonIcon icon={callOutline} />
                        <input
                          id="signup-contact"
                          type="tel"
                          inputMode="numeric"
                          maxLength={11}
                          value={contactNumber}
                          // Digits only, at most 11: a Philippine mobile number.
                          onChange={(event) =>
                            setContactNumber(event.target.value.replace(/\D/g, '').slice(0, 11))
                          }
                          placeholder="09171234567"
                          autoComplete="tel"
                        />
                      </div>
                    </div>
                  </div>

                  {/* No role to pick and no farm address asked for. One
                      account does both, and the address is collected when the
                      first project is posted, where its purpose is obvious. */}

                  <div className="auth-field">
                    <label htmlFor="address-province">Address</label>
                    <AddressPicker value={farmAddress} onChange={setFarmAddress} />
                  </div>

                  <p className="auth-hint">
                    If you farm, this is the location the weather advisory forecasts for and the
                    area investors see on your projects. Signing up is otherwise free: proof of
                    identity is asked for only when you post a project of your own.
                  </p>
                </>
              )}

              {/* Login keeps these stacked and full width; sign-up pairs them to
                * save a row. */}
              <div className={isSignup ? 'auth-pair' : undefined}>
                <div className="auth-field">
                  <label htmlFor="auth-email">Email</label>
                  <div className="auth-input">
                    <IonIcon icon={mailOutline} />
                    <input
                      id="auth-email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="Enter your email"
                      autoComplete="email"
                    />
                  </div>
                </div>

                <div className="auth-field">
                  <label htmlFor="auth-password">Password</label>
                  <div className="auth-input">
                    <IonIcon icon={lockClosedOutline} />
                    <input
                      id="auth-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Enter your password"
                      autoComplete={isSignup ? 'new-password' : 'current-password'}
                    />
                    <button
                      type="button"
                      className="auth-input__eye"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      <IonIcon icon={showPassword ? eyeOffOutline : eyeOutline} />
                    </button>
                  </div>

                  {isSignup && password.length > 0 && !passwordStrong && (
                    <ul className="auth-rules">
                      {passwordChecks.map((check) => (
                        <li
                          key={check.label}
                          className={`auth-rules__item${
                            check.met ? ' auth-rules__item--met' : ''
                          }`}
                        >
                          <IonIcon icon={check.met ? checkmarkCircle : ellipseOutline} />
                          <span>{check.label}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {isSignup && (
                  <div className="auth-field">
                    <label htmlFor="auth-confirm">Confirm Password</label>
                    <div className="auth-input">
                      <IonIcon icon={lockClosedOutline} />
                      <input
                        id="auth-confirm"
                        type={showConfirm ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        placeholder="Type it again"
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        className="auth-input__eye"
                        onClick={() => setShowConfirm(!showConfirm)}
                        aria-label={showConfirm ? 'Hide password' : 'Show password'}
                      >
                        <IonIcon icon={showConfirm ? eyeOffOutline : eyeOutline} />
                      </button>
                    </div>

                    {confirmPassword.length > 0 && confirmPassword !== password && (
                      <p className="auth-rules__mismatch">The two passwords do not match.</p>
                    )}
                  </div>
                )}
              </div>

              {!isSignup && (
                <div className="auth-row">
                  <label className="auth-check">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(event) => setRemember(event.target.checked)}
                    />
                    Remember me
                  </label>

                  <button
                    type="button"
                    className="auth-link"
                    onClick={() => navigate('/forgot-password')}
                  >
                    Forgot Password?
                  </button>
                </div>
              )}

              {!isSignup && isLocked && (
                <p className="auth-alert auth-alert--danger">
                  Login locked. Try again in {formatRemaining(lockoutMs)}.
                </p>
              )}

              <button
                type="submit"
                className="auth-submit"
                disabled={loading || (!isSignup && isLocked)}
              >
                {loading ? 'Please wait...' : isSignup ? 'CREATE ACCOUNT' : 'LOGIN'}
              </button>

              <div className="auth-divider">
                <span>or</span>
              </div>

              <button type="button" className="auth-secondary" onClick={switchMode}>
                <IonIcon icon={isSignup ? personOutline : personAddOutline} />
                {isSignup ? 'ALREADY HAVE AN ACCOUNT? LOGIN' : "DON'T HAVE AN ACCOUNT? SIGN UP"}
              </button>

              {feedback && (
                <p className={`auth-alert auth-alert--${feedback.tone}`}>{feedback.text}</p>
              )}

              {/* Dropped on sign-up: the form is already long, and the badge is
                * reassurance rather than something the user acts on. */}
              {!isSignup && (
                <div className="auth-trust">
                  <IonIcon icon={shieldCheckmarkOutline} />
                  <div>
                    <p className="auth-trust__title">Secure. Transparent. Profitable.</p>
                    <p className="auth-trust__copy">
                      Your investments and rentals are protected with security and transparency.
                    </p>
                  </div>
                </div>
              )}
            </form>
          </main>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Login;
