import { useCallback, useEffect, useRef, useState } from 'react';
import { IonContent, IonIcon, IonPage } from '@ionic/react';
import {
  callOutline,
  cameraOutline,
  documentTextOutline,
  locationOutline,
  mailOutline,
  personCircle,
  shieldCheckmarkOutline,
  walletOutline,
} from 'ionicons/icons';
import DashboardHeader from '../components/DashboardHeader';
import AddressPicker from '../components/AddressPicker';
import { supabase } from '../supabaseClient';
import PayoutAccountCard from '../components/PayoutAccountCard';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { hasValue, NONE, orNone, pillClass } from '../lib/format';
import '../theme/dashboard.css';
import './AccountProfile.css';
import Skeleton from '../components/Skeleton';

type Details = {
  account_status: string;
  created_at: string;
  /** Identity is an account fact, so both roles have one. */
  valid_id_type: string;
  valid_id_url: string | null;
  /**
   * Null for the Admin, who has no customers row. Both halves are nullable for
   * everyone else: a customer who only invests never fills in a farm, and one
   * who only farms never sets a budget.
   */
  customers: {
    farm_location: string | null;
    farm_province: string | null;
    farm_city: string | null;
    farm_barangay: string | null;
    investment_budget: number | null;
  } | null;
};

/**
 * A FarmVest account a renter sends payment to.
 *
 * Kept on the Admin's own account page rather than on a settings screen of its
 * own: there is one FarmVest, the Admin is it, and this is the Admin saying
 * where to send the money.
 */
type PaymentMethod = {
  payment_methods_id: string;
  method: 'GCash' | 'Bank Transfer' | 'Other';
  account_name: string;
  account_number: string;
  bank_name: string;
  instructions: string;
  is_active: boolean;
};

const METHODS = ['GCash', 'Bank Transfer', 'Other'] as const;

const emptyMethod = {
  method: 'GCash' as PaymentMethod['method'],
  account_name: '',
  account_number: '',
  bank_name: '',
  instructions: '',
};

type Note = { text: string; tone: 'success' | 'danger' } | null;

/** Matches the file size limit on the avatars bucket. */
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/** Profile page for whoever is signed in: Admin, Farm Owner, or Investor. */
const AccountProfile: React.FC = () => {
  const { profile, role, refreshProfile } = useAuth();
  const isAdmin = role === 'Admin';
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [details, setDetails] = useState<Details | null>(null);

  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [methodForm, setMethodForm] = useState(emptyMethod);
  const [savingMethod, setSavingMethod] = useState(false);
  const [methodNote, setMethodNote] = useState<Note>(null);

  const [budget, setBudget] = useState('');
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [preferencesNote, setPreferencesNote] = useState<Note>(null);

  const [farmAddress, setFarmAddress] = useState({ province: '', city: '', barangay: '' });
  const [savingAddress, setSavingAddress] = useState(false);
  const [addressNote, setAddressNote] = useState<Note>(null);

  const [savingProfile, setSavingProfile] = useState(false);
  const [profileNote, setProfileNote] = useState<Note>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordNote, setPasswordNote] = useState<Note>(null);

  useEffect(() => {
    if (!profile) return;

    setName(profile.name ?? '');
    setContactNumber(profile.contact_number ?? '');

    supabase
      .from('users')
      .select(
        'account_status, created_at, valid_id_type, valid_id_url, customers(farm_location, farm_province, farm_city, farm_barangay, investment_budget)'
      )
      .eq('users_id', profile.users_id)
      .maybeSingle()
      .then(({ data }) => {
        const row = (data as unknown as Details) ?? null;
        setDetails(row);
        setBudget(row?.customers?.investment_budget != null ? String(row.customers.investment_budget) : '');
        // 'None' is the sentinel the schema uses for an unset text column, so
        // it must not reach the picker as a selected province.
        setFarmAddress({
          province: hasValue(row?.customers?.farm_province) ? row!.customers!.farm_province! : '',
          city: hasValue(row?.customers?.farm_city) ? row!.customers!.farm_city! : '',
          barangay: hasValue(row?.customers?.farm_barangay) ? row!.customers!.farm_barangay! : '',
        });
      });
  }, [profile]);

  const saveProfile = async () => {
    if (!profile) return;

    if (!name.trim()) {
      setProfileNote({ text: 'Please enter your full name.', tone: 'danger' });
      return;
    }

    if (contactNumber && !/^\d{11}$/.test(contactNumber)) {
      setProfileNote({
        text: 'The contact number must be 11 digits, for example 09171234567.',
        tone: 'danger',
      });
      return;
    }

    setSavingProfile(true);
    setProfileNote(null);

    const { error } = await supabase
      .from('users')
      .update({ name: name.trim(), contact_number: contactNumber.trim() })
      .eq('users_id', profile.users_id);

    if (error) {
      setProfileNote({ text: error.message, tone: 'danger' });
    } else {
      await refreshProfile();
      setProfileNote({ text: 'Profile updated.', tone: 'success' });
    }

    setSavingProfile(false);
  };

  const loadMethods = useCallback(async () => {
    const { data } = await supabase
      .from('payment_methods')
      .select(
        'payment_methods_id, method, account_name, account_number, bank_name, instructions, is_active'
      )
      .order('created_at');

    setMethods((data ?? []) as PaymentMethod[]);
  }, []);

  useEffect(() => {
    if (isAdmin) loadMethods();
  }, [isAdmin, loadMethods]);

  const addMethod = async () => {
    if (!methodForm.account_name.trim() || !methodForm.account_number.trim()) {
      setMethodNote({ text: 'Enter the account name and number.', tone: 'danger' });
      return;
    }

    setSavingMethod(true);
    setMethodNote(null);

    const { error } = await supabase.from('payment_methods').insert({
      method: methodForm.method,
      account_name: methodForm.account_name.trim(),
      account_number: methodForm.account_number.trim(),
      bank_name: methodForm.bank_name.trim() || NONE,
      instructions: methodForm.instructions.trim() || NONE,
    });

    if (error) {
      setMethodNote({ text: error.message, tone: 'danger' });
    } else {
      setMethodForm(emptyMethod);
      setMethodNote({ text: 'Payment method added.', tone: 'success' });
      await loadMethods();
    }

    setSavingMethod(false);
  };

  // Set inactive rather than deleted: a payment already sent to this account
  // still points at it, and that record has to stay readable.
  const toggleMethod = async (method: PaymentMethod) => {
    const { error } = await supabase
      .from('payment_methods')
      .update({ is_active: !method.is_active })
      .eq('payment_methods_id', method.payment_methods_id);

    if (error) setMethodNote({ text: error.message, tone: 'danger' });
    else await loadMethods();
  };

  /**
   * Save the two fields the investment recommender reads.
   *
   * They live on the customers row rather than on users because they are a
   * preference of the investing role, not a fact about the account, and the row
   * level security policy on that table keeps them private: only the investor
   * and the Admin can read what someone is willing to spend and risk.
   */
  /**
   * Save the farm address.
   *
   * Registration stopped asking for this, because someone who only wants to
   * invest has no farm and should not be made to invent one. It is set here
   * instead, and it is what the weather advisory geocodes.
   */
  const saveFarmAddress = async () => {
    if (!profile) return;

    if (!farmAddress.province || !farmAddress.city || !farmAddress.barangay) {
      setAddressNote({
        text: 'Choose a province, a city or municipality, and a barangay.',
        tone: 'danger',
      });
      return;
    }

    setSavingAddress(true);
    setAddressNote(null);

    const { error } = await supabase
      .from('customers')
      .update({
        farm_province: farmAddress.province,
        farm_city: farmAddress.city,
        farm_barangay: farmAddress.barangay,
        // The readable label, kept in step with the parts it is built from.
        farm_location: `${farmAddress.barangay}, ${farmAddress.city}, ${farmAddress.province}`,
      })
      .eq('customers_id', profile.users_id);

    if (error) {
      setAddressNote({ text: error.message, tone: 'danger' });
    } else {
      setAddressNote({ text: 'Farm address saved.', tone: 'success' });
      setDetails((current) =>
        current
          ? {
              ...current,
              customers: {
                ...(current.customers ?? { investment_budget: null }),
                farm_province: farmAddress.province,
                farm_city: farmAddress.city,
                farm_barangay: farmAddress.barangay,
                farm_location: `${farmAddress.barangay}, ${farmAddress.city}, ${farmAddress.province}`,
              },
            }
          : current
      );
    }

    setSavingAddress(false);
  };

  const savePreferences = async () => {
    if (!profile) return;

    const trimmed = budget.trim();
    const amount = trimmed === '' ? null : Number(trimmed);

    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      setPreferencesNote({ text: 'Enter a budget of zero or more.', tone: 'danger' });
      return;
    }

    setSavingPreferences(true);
    setPreferencesNote(null);

    const { error } = await supabase
      .from('customers')
      .update({ investment_budget: amount })
      .eq('customers_id', profile.users_id);

    if (error) {
      setPreferencesNote({ text: error.message, tone: 'danger' });
    } else {
      setPreferencesNote({ text: 'Investment preferences saved.', tone: 'success' });
    }

    setSavingPreferences(false);
  };

  const uploadPhoto = async (file: File) => {
    if (!profile) return;

    if (file.size > MAX_AVATAR_BYTES) {
      setProfileNote({ text: 'The photo must be 2 MB or smaller.', tone: 'danger' });
      return;
    }

    setUploadingPhoto(true);
    setProfileNote(null);

    // Stored under the user's own id, which is what the storage policy checks.
    const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `${profile.users_id}/avatar-${Date.now()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { contentType: file.type || undefined, upsert: true });

    if (uploadError) {
      setProfileNote({ text: uploadError.message, tone: 'danger' });
      setUploadingPhoto(false);
      return;
    }

    const { data } = supabase.storage.from('avatars').getPublicUrl(path);

    const { error: saveError } = await supabase
      .from('users')
      .update({ avatar_url: data.publicUrl })
      .eq('users_id', profile.users_id);

    if (saveError) {
      setProfileNote({ text: saveError.message, tone: 'danger' });
    } else {
      await refreshProfile();
      setProfileNote({ text: 'Profile photo updated.', tone: 'success' });
    }

    setUploadingPhoto(false);
  };

  const removePhoto = async () => {
    if (!profile) return;

    setUploadingPhoto(true);
    const { error } = await supabase
      .from('users')
      .update({ avatar_url: null })
      .eq('users_id', profile.users_id);

    if (error) {
      setProfileNote({ text: error.message, tone: 'danger' });
    } else {
      await refreshProfile();
    }

    setUploadingPhoto(false);
  };

  const savePassword = async () => {
    if (newPassword.length < 6) {
      setPasswordNote({ text: 'Password must be at least 6 characters long.', tone: 'danger' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordNote({ text: 'Passwords do not match.', tone: 'danger' });
      return;
    }

    setSavingPassword(true);
    setPasswordNote(null);

    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      setPasswordNote({ text: error.message, tone: 'danger' });
    } else {
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswordForm(false);
      setPasswordNote({ text: 'Password changed.', tone: 'success' });
    }

    setSavingPassword(false);
  };

  const viewValidId = async () => {
    if (!details?.valid_id_url) return;

    const { data } = await supabase.storage
      .from('valid-ids')
      .createSignedUrl(details.valid_id_url, 300);

    if (data) window.open(data.signedUrl, '_blank', 'noopener');
  };

  if (!profile) {
    return (
      <IonPage>
        <DashboardHeader title="My Account" accountName="" />
        <IonContent className="dash-content">
          <Skeleton />
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage>
      <DashboardHeader
        title="My Account"
        subtitle="Your profile details and sign-in password."
        accountName={profile.name || (role ?? '')}
      />

      <IonContent className="dash-content">
        <div className="dash-page account-page">
          <section className="dash-card account-hero">
            <div className="account-hero__photo">
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt="" />
              ) : (
                <IonIcon icon={personCircle} />
              )}

              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) uploadPhoto(file);
                  event.target.value = '';
                }}
              />
            </div>

            <div className="account-hero__identity">
              <h2 className="account-hero__name">{profile.name || 'Unnamed account'}</h2>

              <div className="account-hero__facts">
                <span>
                  <IonIcon icon={mailOutline} /> {profile.email}
                </span>
                <span>
                  <IonIcon icon={callOutline} /> {profile.contact_number || 'No contact number'}
                </span>
                {details?.customers?.farm_location && (
                  <span>
                    <IonIcon icon={locationOutline} /> {orNone(details.customers.farm_location)}
                  </span>
                )}
              </div>

              <div className="account-hero__badges">
                <span className="dash-pill dash-pill--slate">{role}</span>
                {isAdmin && (
              <section className="dash-panel account-wide">
                <div className="dash-panel__head">
                  <h2 className="dash-panel__title">Payment Methods</h2>
                  <span className="dash-stat__hint">
                    Shown to a farm owner when they pay for a booking
                  </span>
                </div>

                <div className="dash-panel__body">
                  <p className="dash-stat__hint account-lead">
                    FarmVest is not connected to GCash or to any bank. These are the accounts a
                    renter sends to through their own app, and the reference they give is what you
                    check here before confirming a booking.
                  </p>

                  {methods.length === 0 ? (
                    <p className="dash-stat__hint account-lead">
                      No account added yet. A farm owner has nowhere to send payment until there
                      is one.
                    </p>
                  ) : (
                    methods.map((method) => (
                      <div className="dash-row" key={method.payment_methods_id}>
                        <div
                          className={`dash-row__icon ${
                            method.is_active ? 'dash-stat__icon--green' : 'dash-stat__icon--slate'
                          }`}
                        >
                          <IonIcon icon={walletOutline} />
                        </div>

                        <div>
                          <p className="dash-row__title">
                            {method.method}
                            {hasValue(method.bank_name) ? ` — ${method.bank_name}` : ''}
                          </p>
                          <p className="dash-row__meta">
                            {method.account_number} · {method.account_name}
                          </p>
                          <p className="dash-row__meta">
                            {method.is_active
                              ? 'Farm owners can send payment to this account.'
                              : 'Hidden from farm owners. Past payments to it are kept.'}
                          </p>
                        </div>

                        <div className="dash-row__trailing">
                          <span className={pillClass(method.is_active ? 'Active' : 'Inactive')}>
                            {method.is_active ? 'Active' : 'Inactive'}
                          </span>
                          <button
                            type="button"
                            className="dash-btn dash-btn--ghost"
                            onClick={() => toggleMethod(method)}
                          >
                            {method.is_active ? 'Set Inactive' : 'Set Active'}
                          </button>
                        </div>
                      </div>
                    ))
                  )}

                  <div className="dash-form dash-form--two account-lead" style={{ marginTop: 16 }}>
                    <div className="dash-field">
                      <label htmlFor="method-kind">Method</label>
                      <select
                        id="method-kind"
                        className="dash-select"
                        value={methodForm.method}
                        onChange={(event) =>
                          setMethodForm({
                            ...methodForm,
                            method: event.target.value as PaymentMethod['method'],
                          })
                        }
                      >
                        {METHODS.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="dash-field">
                      <label htmlFor="method-bank">
                        {methodForm.method === 'Bank Transfer' ? 'Bank Name' : 'Bank Name (optional)'}
                      </label>
                      <input
                        id="method-bank"
                        className="dash-input"
                        placeholder="Land Bank of the Philippines"
                        value={methodForm.bank_name}
                        onChange={(event) =>
                          setMethodForm({ ...methodForm, bank_name: event.target.value })
                        }
                      />
                    </div>

                    <div className="dash-field">
                      <label htmlFor="method-name">Account Name</label>
                      <input
                        id="method-name"
                        className="dash-input"
                        placeholder="FarmVest Agri Services"
                        value={methodForm.account_name}
                        onChange={(event) =>
                          setMethodForm({ ...methodForm, account_name: event.target.value })
                        }
                      />
                    </div>

                    <div className="dash-field">
                      <label htmlFor="method-number">Account Number</label>
                      <input
                        id="method-number"
                        className="dash-input"
                        placeholder="0917 123 4567"
                        value={methodForm.account_number}
                        onChange={(event) =>
                          setMethodForm({ ...methodForm, account_number: event.target.value })
                        }
                      />
                    </div>

                    <div className="dash-field" style={{ gridColumn: '1 / -1' }}>
                      <label htmlFor="method-instructions">Instructions (optional)</label>
                      <input
                        id="method-instructions"
                        className="dash-input"
                        placeholder="Put the unit code in the message field."
                        value={methodForm.instructions}
                        onChange={(event) =>
                          setMethodForm({ ...methodForm, instructions: event.target.value })
                        }
                      />
                    </div>
                  </div>

                  <div className="account-actions">
                    <button
                      type="button"
                      className="dash-btn dash-btn--primary"
                      disabled={savingMethod}
                      onClick={addMethod}
                    >
                      {savingMethod ? 'Saving...' : 'Add Payment Method'}
                    </button>
                  </div>

                  {methodNote && (
                    <p className={methodNote.tone === 'danger' ? 'dash-error' : 'account-note'}>
                      {methodNote.text}
                    </p>
                  )}
                </div>
              </section>
            )}

            {role === 'Customer' && (
              <section className="dash-panel">
                <div className="dash-panel__head">
                  <h2 className="dash-panel__title">Farm Address</h2>
                  <span className="dash-stat__hint">Needed only if you farm</span>
                </div>

                <div className="dash-panel__body">
                  <p className="dash-stat__hint account-lead">
                    This is the location the weather advisory forecasts for, and the area investors
                    see on your projects. Leave it blank if you only invest.
                  </p>

                  <div className="dash-field">
                    <label htmlFor="address-province">Where is your farm?</label>
                    <AddressPicker value={farmAddress} onChange={setFarmAddress} />
                  </div>

                  <div className="account-actions">
                    <button
                      type="button"
                      className="dash-btn dash-btn--primary"
                      disabled={savingAddress}
                      onClick={saveFarmAddress}
                    >
                      {savingAddress ? 'Saving...' : 'Save Farm Address'}
                    </button>
                  </div>

                  {addressNote && (
                    <p className={addressNote.tone === 'danger' ? 'dash-error' : 'account-note'}>
                      {addressNote.text}
                    </p>
                  )}
                </div>
              </section>
            )}

            {role === 'Customer' && profile && <PayoutAccountCard userId={profile.users_id} />}

            {role === 'Customer' && (
              <section className="dash-panel">
                <div className="dash-panel__head">
                  <h2 className="dash-panel__title">Investment Preferences</h2>
                  <span className="dash-stat__hint">Only you and the administrator see these</span>
                </div>

                <div className="dash-panel__body">
                  <p className="dash-stat__hint account-lead">
                    Your budget is what the project recommendations are matched against. Leave it
                    blank if you would rather not set one, and nothing is scored until you do.
                  </p>

                  <div className="dash-form dash-form--two">
                    <div className="dash-field">
                      <label htmlFor="account-budget">Investment Budget</label>
                      <input
                        id="account-budget"
                        className="dash-input"
                        type="number"
                        min={0}
                        step={100}
                        value={budget}
                        onChange={(event) => setBudget(event.target.value)}
                        placeholder="50000"
                      />
                    </div>

                  </div>

                  <div className="account-actions">
                    <button
                      type="button"
                      className="dash-btn dash-btn--primary"
                      disabled={savingPreferences}
                      onClick={savePreferences}
                    >
                      {savingPreferences ? 'Saving...' : 'Save Preferences'}
                    </button>
                  </div>

                  {preferencesNote && (
                    <p
                      className={
                        preferencesNote.tone === 'danger' ? 'dash-error' : 'account-note'
                      }
                    >
                      {preferencesNote.text}
                    </p>
                  )}
                </div>
              </section>
            )}

            {!isAdmin && (
                  <>
                    <span className={pillClass(profile.verification_status)}>
                      {profile.verification_status}
                    </span>
                    {details && (
                      <span className={pillClass(details.account_status)}>
                        {details.account_status}
                      </span>
                    )}
                  </>
                )}
              </div>

              <div className="account-hero__photo-actions">
                <button
                  type="button"
                  className="dash-btn dash-btn--slate"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploadingPhoto}
                >
                  <IonIcon icon={cameraOutline} />
                  {uploadingPhoto ? 'Uploading...' : 'Change Profile Picture'}
                </button>

                {profile.avatar_url && (
                  <button
                    type="button"
                    className="dash-btn dash-btn--ghost"
                    onClick={removePhoto}
                    disabled={uploadingPhoto}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </section>

          <div className="account-grid">
            <section className="dash-panel">
              <div className="dash-panel__head">
                <h2 className="dash-panel__title">Profile Details</h2>
                <span className="dash-stat__hint">Name and contact number</span>
              </div>
              <div className="dash-panel__body">
                <div className="dash-form dash-form--two">
                  <div className="dash-field">
                    <label htmlFor="account-name">Full Name</label>
                    <input
                      id="account-name"
                      className="dash-input"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Juan Dela Cruz"
                    />
                  </div>

                  <div className="dash-field">
                    <label htmlFor="account-contact">Contact Number</label>
                    <input
                      id="account-contact"
                      className="dash-input"
                      type="tel"
                      inputMode="numeric"
                      maxLength={11}
                      value={contactNumber}
                      onChange={(event) =>
                        setContactNumber(event.target.value.replace(/\D/g, '').slice(0, 11))
                      }
                      placeholder="09171234567"
                    />
                  </div>

                  <div className="dash-field">
                    <label htmlFor="account-email">Email</label>
                    <input id="account-email" className="dash-input" value={profile.email} disabled />
                  </div>

                  <div className="dash-field">
                    <label htmlFor="account-role">Role</label>
                    <input id="account-role" className="dash-input" value={role ?? ''} disabled />
                  </div>
                </div>

                <div className="account-actions">
                  <button
                    type="button"
                    className="dash-btn dash-btn--primary"
                    disabled={savingProfile}
                    onClick={saveProfile}
                  >
                    {savingProfile ? 'Saving...' : 'Save Changes'}
                  </button>
                  <span className="dash-stat__hint">
                    Email and role are set by the system and cannot be edited here.
                  </span>
                </div>

                {profileNote && (
                  <p className={profileNote.tone === 'danger' ? 'dash-error' : 'account-note'}>
                    {profileNote.text}
                  </p>
                )}
              </div>
            </section>

            {!isAdmin && (
            <section className="dash-panel">
              <div className="dash-panel__head">
                <h2 className="dash-panel__title">Account Status</h2>
              </div>
              <div className="dash-panel__body">
                <div className="dash-row">
                  <div className="dash-row__icon dash-stat__icon--green">
                    <IonIcon icon={shieldCheckmarkOutline} />
                  </div>
                  <div>
                    <p className="dash-row__title">{profile.verification_status}</p>
                    <p className="dash-row__meta">
                      {profile.verification_status === 'Approved'
                        ? 'Approved by the administrator.'
                        : 'Waiting for the administrator to review this account.'}
                    </p>
                  </div>
                </div>

                {hasValue(details?.valid_id_type) ? (
                  <div className="dash-row">
                    <div className="dash-row__icon dash-stat__icon--slate">
                      <IonIcon icon={documentTextOutline} />
                    </div>
                    <div>
                      <p className="dash-row__title">{orNone(details.valid_id_type)}</p>
                      <p className="dash-row__meta">Submitted for verification</p>
                    </div>
                    {hasValue(details.valid_id_url) && (
                      <div className="dash-row__trailing">
                        <button
                          type="button"
                          className="dash-btn dash-btn--slate"
                          onClick={viewValidId}
                        >
                          View
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="dash-stat__hint">No ID document is attached to this account.</p>
                )}
              </div>
            </section>
            )}

            <section className="dash-panel">
              <div className="dash-panel__head">
                <h2 className="dash-panel__title">Change Password</h2>
                <span className="dash-stat__hint">At least 6 characters</span>
              </div>
              <div className="dash-panel__body">
                {!showPasswordForm ? (
                  <div className="account-actions">
                    <button
                      type="button"
                      className="dash-btn dash-btn--slate"
                      onClick={() => {
                        setShowPasswordForm(true);
                        setPasswordNote(null);
                      }}
                    >
                      Change Password
                    </button>
                    <span className="dash-stat__hint">
                      Set a new sign-in password for this account.
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="dash-form dash-form--two">
                      <div className="dash-field">
                        <label htmlFor="account-password">New Password</label>
                        <input
                          id="account-password"
                          type="password"
                          className="dash-input"
                          value={newPassword}
                          onChange={(event) => setNewPassword(event.target.value)}
                          autoComplete="new-password"
                        />
                      </div>

                      <div className="dash-field">
                        <label htmlFor="account-password-confirm">Confirm New Password</label>
                        <input
                          id="account-password-confirm"
                          type="password"
                          className="dash-input"
                          value={confirmPassword}
                          onChange={(event) => setConfirmPassword(event.target.value)}
                          autoComplete="new-password"
                        />
                      </div>
                    </div>

                    <div className="account-actions">
                      <button
                        type="button"
                        className="dash-btn dash-btn--primary"
                        disabled={savingPassword}
                        onClick={savePassword}
                      >
                        {savingPassword ? 'Saving...' : 'Save Password'}
                      </button>
                      <button
                        type="button"
                        className="dash-btn dash-btn--slate"
                        onClick={() => {
                          setShowPasswordForm(false);
                          setNewPassword('');
                          setConfirmPassword('');
                          setPasswordNote(null);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                )}

                {passwordNote && (
                  <p className={passwordNote.tone === 'danger' ? 'dash-error' : 'account-note'}>
                    {passwordNote.text}
                  </p>
                )}
              </div>
            </section>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default AccountProfile;
