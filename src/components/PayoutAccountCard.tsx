import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { PAYOUT_METHODS, describeAccount, type PayoutAccountRow } from '../lib/payout';

type Note = { text: string; tone: 'success' | 'danger' } | null;

const blank = { method: 'GCash', name: '', number: '', bank: '' };

/**
 * Where FarmVest sends this customer's money: the funds released to their
 * project, and their payout when a project they invested in is repaid. Several
 * accounts may be kept; the default is the one FarmVest uses unless told
 * otherwise.
 */
const PayoutAccountCard = ({ userId }: { userId: string }) => {
  const [accounts, setAccounts] = useState<PayoutAccountRow[]>([]);
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('payout_accounts')
      .select('payout_accounts_id, method, account_name, account_number, bank_name, is_default')
      .eq('customers_id', userId)
      .order('created_at', { ascending: true });
    if (error) setNote({ text: error.message, tone: 'danger' });
    else setAccounts((data ?? []) as PayoutAccountRow[]);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    if (!form.name.trim() || !form.number.trim()) {
      setNote({ text: 'Enter the account name and the account or mobile number.', tone: 'danger' });
      return;
    }
    if (form.method === 'Bank Transfer' && !form.bank.trim()) {
      setNote({ text: 'Enter the name of the bank.', tone: 'danger' });
      return;
    }
    if (form.method !== 'Bank Transfer' && !/^09\d{9}$/.test(form.number.replace(/\s|-/g, ''))) {
      setNote({ text: `Enter the 11-digit ${form.method} mobile number, starting with 09.`, tone: 'danger' });
      return;
    }

    setBusy(true);
    setNote(null);
    const { error } = await supabase.from('payout_accounts').insert({
      customers_id: userId,
      method: form.method,
      account_name: form.name.trim(),
      account_number: form.number.trim(),
      bank_name: form.method === 'Bank Transfer' ? form.bank.trim() : 'None',
      // The first account becomes the default on its own.
      is_default: accounts.length === 0,
    });

    if (error) {
      setNote({ text: error.message, tone: 'danger' });
    } else {
      setForm(blank);
      setNote({ text: 'Payout account added.', tone: 'success' });
      await load();
    }
    setBusy(false);
  };

  const makeDefault = async (id: string) => {
    setBusy(true);
    setNote(null);
    // Clear the old default first: only one may be set at a time.
    const cleared = await supabase
      .from('payout_accounts')
      .update({ is_default: false })
      .eq('customers_id', userId)
      .eq('is_default', true);
    const error =
      cleared.error ??
      (await supabase.from('payout_accounts').update({ is_default: true }).eq('payout_accounts_id', id)).error;
    if (error) setNote({ text: error.message, tone: 'danger' });
    await load();
    setBusy(false);
  };

  const remove = async (account: PayoutAccountRow) => {
    setBusy(true);
    setNote(null);
    const { error } = await supabase
      .from('payout_accounts')
      .delete()
      .eq('payout_accounts_id', account.payout_accounts_id);
    if (error) {
      setNote({ text: error.message, tone: 'danger' });
    } else if (account.is_default) {
      // Removing the default hands it to the oldest account left, if any.
      const next = accounts.find((row) => row.payout_accounts_id !== account.payout_accounts_id);
      if (next) {
        await supabase.from('payout_accounts').update({ is_default: true }).eq('payout_accounts_id', next.payout_accounts_id);
      }
    }
    await load();
    setBusy(false);
  };

  return (
    <section className="dash-panel">
      <div className="dash-panel__head">
        <h2 className="dash-panel__title">Payout Accounts</h2>
        <span className="dash-stat__hint">Only you and the administrator see these</span>
      </div>

      <div className="dash-panel__body">
        <p className="dash-stat__hint account-lead">
          Where FarmVest sends your money: the funds released to your project, and your return
          when a project you invested in is repaid. Add as many as you use; the default is sent to
          first.
          {accounts.length === 0 && ' Nothing can be sent to you until at least one is added.'}
        </p>

        {accounts.length > 0 && (
          <div className="dash-table-wrap">
            <table className="dash-table">
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.payout_accounts_id}>
                    <td>
                      <p className="dash-row__title">{describeAccount(account)}</p>
                    </td>
                    <td>
                      {account.is_default ? (
                        <span className="dash-pill dash-pill--success">Default</span>
                      ) : (
                        <button
                          type="button"
                          className="dash-btn dash-btn--ghost"
                          disabled={busy}
                          onClick={() => makeDefault(account.payout_accounts_id)}
                        >
                          Set as Default
                        </button>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="dash-btn dash-btn--ghost"
                        disabled={busy}
                        onClick={() => remove(account)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="dash-field-label" style={{ marginTop: 16 }}>
          Add an Account
        </p>
        <div className="dash-form dash-form--two">
          <div className="dash-field">
            <label htmlFor="payout-method">Method</label>
            <select
              id="payout-method"
              className="dash-input"
              value={form.method}
              onChange={(event) => setForm({ ...form, method: event.target.value })}
            >
              {PAYOUT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </div>

          {form.method === 'Bank Transfer' && (
            <div className="dash-field">
              <label htmlFor="payout-bank">Bank Name</label>
              <input
                id="payout-bank"
                className="dash-input"
                value={form.bank}
                onChange={(event) => setForm({ ...form, bank: event.target.value })}
                placeholder="Land Bank of the Philippines"
              />
            </div>
          )}

          <div className="dash-field">
            <label htmlFor="payout-name">Account Name</label>
            <input
              id="payout-name"
              className="dash-input"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Juan Dela Cruz"
            />
          </div>

          <div className="dash-field">
            <label htmlFor="payout-number">
              {form.method === 'Bank Transfer' ? 'Account Number' : `${form.method} Mobile Number`}
            </label>
            <input
              id="payout-number"
              className="dash-input"
              value={form.number}
              onChange={(event) => setForm({ ...form, number: event.target.value })}
              placeholder={form.method === 'Bank Transfer' ? '1234 5678 9012' : '09171234567'}
              inputMode={form.method === 'Bank Transfer' ? 'text' : 'numeric'}
            />
          </div>
        </div>

        <div className="account-actions">
          <button type="button" className="dash-btn dash-btn--primary" disabled={busy} onClick={add}>
            {busy ? 'Saving...' : 'Add Payout Account'}
          </button>
        </div>

        {note && <p className={note.tone === 'danger' ? 'dash-error' : 'account-note'}>{note.text}</p>}
      </div>
    </section>
  );
};

export default PayoutAccountCard;
