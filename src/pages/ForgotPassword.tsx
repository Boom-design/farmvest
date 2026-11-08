import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IonContent, IonIcon, IonPage } from '@ionic/react';
import {
  arrowBackOutline,
  eyeOffOutline,
  eyeOutline,
  keyOutline,
  lockClosedOutline,
  mailOutline,
  refreshOutline,
  shieldCheckmarkOutline,
  timeOutline,
} from 'ionicons/icons';
import { supabase } from '../supabaseClient';
import logo from '../assets/Logo.png';
import hero from '../assets/login-hero.png';
import './Login.css';

type Feedback = { text: string; tone: 'danger' | 'success' } | null;

/**
 * How long a reset code stays valid, in seconds.
 *
 * This mirrors otp_expiry in supabase/config.toml and the Email OTP Expiration
 * setting on the hosted project; the server is the authority and this copy only
 * drives the countdown. Change one and change the others, or the page will
 * promise a window the server does not honour.
 */
const OTP_TTL_SECONDS = 60;

/**
 * Password reset by one-time code, on the same split layout as the login page.
 *
 * Step 1 emails a 6-digit code, but only to an address that already has an
 * account (shouldCreateUser is false, so an unknown email creates nothing).
 * Step 2 verifies the code, which signs the user in long enough to set a new
 * password, after which they are signed out and sent back to the login page.
 */
const ForgotPassword: React.FC = () => {
  const navigate = useNavigate();

  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [loading, setLoading] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  // Held in a ref rather than in state: the deadline is read by the tick below
  // and never drawn on its own, so storing it would re-render for nothing.
  const expiresAt = useRef(0);

  /*
   * A one-minute code needs a visible clock. Without one the page looks the
   * same whether the code is still good or already dead, and the only way to
   * find out is to type six digits and be refused.
   */
  useEffect(() => {
    if (step !== 'verify') return;

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((expiresAt.current - Date.now()) / 1000));
      setSecondsLeft(remaining);
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [step]);

  const sendCode = async () => {
    if (!email.trim()) {
      setFeedback({ text: 'Please enter your email address.', tone: 'danger' });
      return;
    }

    setLoading(true);
    setFeedback(null);

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false },
    });

    if (error) {
      setFeedback({ text: error.message, tone: 'danger' });
    } else {
      expiresAt.current = Date.now() + OTP_TTL_SECONDS * 1000;
      setSecondsLeft(OTP_TTL_SECONDS);
      setCode('');
      setStep('verify');
      setFeedback({
        text: 'If that email is registered, a 6-digit code has been sent to it. The code expires in 1 minute.',
        tone: 'success',
      });
    }

    setLoading(false);
  };

  const resetPassword = async () => {
    if (!code.trim()) {
      setFeedback({ text: 'Please enter the code from your email.', tone: 'danger' });
      return;
    }

    if (newPassword.length < 6) {
      setFeedback({ text: 'Password must be at least 6 characters long.', tone: 'danger' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setFeedback({ text: 'Passwords do not match.', tone: 'danger' });
      return;
    }

    setLoading(true);
    setFeedback(null);

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    });

    if (verifyError) {
      setFeedback({ text: `Invalid or expired code. ${verifyError.message}`, tone: 'danger' });
      setLoading(false);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });

    if (updateError) {
      setFeedback({ text: updateError.message, tone: 'danger' });
      setLoading(false);
      return;
    }

    await supabase.auth.signOut();
    setLoading(false);
    navigate('/login', {
      replace: true,
      state: { notice: 'Your password has been changed. Please sign in with the new one.' },
    });
  };

  // Which action Enter runs depends on which step is on screen.
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (loading) return;

    if (step === 'request') {
      sendCode();
    } else {
      resetPassword();
    }
  };

  const restart = () => {
    setStep('request');
    setCode('');
    setNewPassword('');
    setConfirmPassword('');
    setFeedback(null);
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
                Forgot your password? Enter the email you signed up with and we will send a code to
                reset it. Your account and your records stay exactly as they are.
              </p>
            </div>

            <img src={hero} alt="" className="auth-brand__hero" />
          </aside>

          <main className="auth-panel">
            <form className="auth-card" onSubmit={handleSubmit}>
              <button type="button" className="auth-back" onClick={() => navigate('/login')}>
                <IonIcon icon={arrowBackOutline} /> Back to login
              </button>

              <h2 className="auth-card__title">
                {step === 'request' ? 'Reset Password' : 'Enter Your Code'}
              </h2>
              <p className="auth-card__subtitle">
                {step === 'request'
                  ? 'We will email you a 6-digit code'
                  : `Sent to ${email.trim()}`}
              </p>

              {/* Two short steps, so where the user is in them is always visible. */}
              <ol className="auth-steps">
                <li className={step === 'request' ? 'auth-steps--active' : 'auth-steps--done'}>
                  <span>1</span> Email
                </li>
                <li className={step === 'verify' ? 'auth-steps--active' : ''}>
                  <span>2</span> Code and new password
                </li>
              </ol>

              <div className="auth-field">
                <label htmlFor="reset-email">Email</label>
                <div className="auth-input">
                  <IonIcon icon={mailOutline} />
                  <input
                    id="reset-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="Enter your email"
                    autoComplete="email"
                    disabled={step === 'verify'}
                  />
                </div>
              </div>

              {step === 'verify' && (
                <>
                  <div className="auth-field">
                    <label htmlFor="reset-code">Verification Code</label>
                    <div className="auth-input">
                      <IonIcon icon={keyOutline} />
                      <input
                        id="reset-code"
                        className="auth-input__code"
                        inputMode="numeric"
                        maxLength={6}
                        value={code}
                        onChange={(event) => setCode(event.target.value)}
                        placeholder="000000"
                        autoComplete="one-time-code"
                      />
                    </div>
                  </div>

                  <div className="auth-field">
                    <label htmlFor="reset-password">New Password</label>
                    <div className="auth-input">
                      <IonIcon icon={lockClosedOutline} />
                      <input
                        id="reset-password"
                        type={showPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        placeholder="At least 6 characters"
                        autoComplete="new-password"
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
                  </div>

                  <div className="auth-field">
                    <label htmlFor="reset-confirm">Confirm New Password</label>
                    <div className="auth-input">
                      <IonIcon icon={lockClosedOutline} />
                      <input
                        id="reset-confirm"
                        type={showPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        placeholder="Re-enter your new password"
                        autoComplete="new-password"
                      />
                    </div>
                  </div>
                </>
              )}

              <button type="submit" className="auth-submit" disabled={loading}>
                {loading
                  ? 'Please wait...'
                  : step === 'request'
                    ? 'SEND RESET CODE'
                    : 'RESET PASSWORD'}
              </button>

              {step === 'verify' && (
                <>
                  {secondsLeft > 0 ? (
                    <p className="auth-countdown">
                      <IonIcon icon={timeOutline} />
                      Code expires in {secondsLeft}s
                    </p>
                  ) : (
                    <p className="auth-countdown auth-countdown--expired">
                      <IonIcon icon={timeOutline} />
                      That code has expired. Send a new one.
                    </p>
                  )}

                  <div className="auth-divider">
                    <span>or</span>
                  </div>

                  <button
                    type="button"
                    className="auth-secondary"
                    disabled={loading}
                    onClick={sendCode}
                  >
                    <IonIcon icon={refreshOutline} />
                    SEND A NEW CODE
                  </button>

                  <button type="button" className="auth-secondary" onClick={restart}>
                    <IonIcon icon={mailOutline} />
                    USE A DIFFERENT EMAIL
                  </button>
                </>
              )}

              {feedback && (
                <p className={`auth-alert auth-alert--${feedback.tone}`}>{feedback.text}</p>
              )}

              <div className="auth-trust">
                <IonIcon icon={shieldCheckmarkOutline} />
                <div>
                  <p className="auth-trust__title">
                    {step === 'request' ? 'Only registered emails' : 'Did not get the code?'}
                  </p>
                  <p className="auth-trust__copy">
                    {step === 'request'
                      ? 'A code is sent only to an address that already has a FarmVest account. Nothing is created for an unknown email.'
                      : 'The code is good for one minute. Check your spam folder, and send a new code if the timer runs out.'}
                  </p>
                </div>
              </div>
            </form>
          </main>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default ForgotPassword;
