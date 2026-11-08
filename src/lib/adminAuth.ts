/**
 * Who the System Administrator is.
 *
 * The Admin does not register through the public signup form: the account is
 * created once in the Supabase dashboard using this email, and the database
 * trigger gives that email the Admin role automatically. The same address is
 * defined in SQL as public.admin_email(), which is the authority.
 *
 * The password is deliberately not here. Anything in this folder is compiled
 * into the JavaScript bundle that every visitor downloads, so a password written
 * here would be readable by anyone who opens the browser dev tools. The Admin
 * signs in through the normal login form like any other user; Supabase Auth
 * checks the password server-side and issues the session that row level security
 * reads through auth.uid().
 */

export const ADMIN_EMAIL = 'admin@farmvest.com';

export const isAdminEmail = (email: string): boolean =>
  email.trim().toLowerCase() === ADMIN_EMAIL;
