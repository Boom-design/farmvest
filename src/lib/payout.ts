/**
 * A customer's payout accounts: where FarmVest sends their money, whether that
 * is a farm owner's released funds or an investor's payout. A customer may keep
 * several, with one marked as the default.
 */
export type PayoutAccountRow = {
  payout_accounts_id: string;
  method: string;
  account_name: string;
  account_number: string;
  bank_name: string;
  is_default: boolean;
};

/** The shape a customers embed takes when it carries the accounts. */
export type PayoutAccount = { payout_accounts?: PayoutAccountRow[] | null };

export const PAYOUT_METHODS = ['GCash', 'Maya', 'Bank Transfer'] as const;

/** Embed inside a customers(...) select wherever the Admin sends someone money. */
export const PAYOUT_COLUMNS =
  'payout_accounts(payout_accounts_id, method, account_name, account_number, bank_name, is_default)';

/** The accounts, default first, then oldest first as they were added. */
export const accountsOf = (customer: PayoutAccount | null | undefined) =>
  [...(customer?.payout_accounts ?? [])].sort((a, b) => Number(b.is_default) - Number(a.is_default));

/** Whether at least one account has been set. */
export const hasPayoutAccount = (customer: PayoutAccount | null | undefined) => accountsOf(customer).length > 0;

/** One line the Admin can read off while making the transfer. */
export const describeAccount = (account: PayoutAccountRow) => {
  const bank = account.method === 'Bank Transfer' && account.bank_name !== 'None' ? ` (${account.bank_name})` : '';
  return `${account.method}${bank} · ${account.account_number} · ${account.account_name}`;
};

/** The default account, described; or a note that there is none. */
export const describePayout = (customer: PayoutAccount | null | undefined) => {
  const first = accountsOf(customer)[0];
  return first ? describeAccount(first) : 'No payout account set';
};
