import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';

/**
 * Two roles, not three.
 *
 * Farm Owner and Investor were separate accounts, which was wrong about the
 * people using FarmVest: a farm owner with a good year has money to put into
 * someone else's project, and an investor who buys land becomes a farm owner.
 * One Customer does both, from one account and one verified identity.
 */
export type UserRole = 'Customer' | 'Admin';
/**
 * Pending before verification is attempted, Approved on a clear automatic pass,
 * Flagged when the face match was borderline and an Admin should look, Rejected
 * when an Admin decided against it.
 */
export type VerificationStatus = 'Pending' | 'Flagged' | 'Approved' | 'Rejected';

export type Profile = {
  users_id: string;
  name: string;
  email: string;
  contact_number: string;
  user_type: UserRole;
  verification_status: VerificationStatus;
  account_status: 'Active' | 'Inactive';
  avatar_url: string | null;
};

export const PROFILE_COLUMNS =
  'users_id, name, email, contact_number, user_type, verification_status, account_status, avatar_url';

type AuthContextValue = {
  session: Session | null;
  profile: Profile | null;
  role: UserRole | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

/** Landing route for each role, used for redirects after login. */
export const homeRouteForRole = (role: UserRole | null): string => {
  switch (role) {
    case 'Customer':
      return '/app';
    case 'Admin':
      return '/admin';
    default:
      return '/login';
  }
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('users')
      .select(PROFILE_COLUMNS)
      .eq('users_id', userId)
      .maybeSingle();

    if (error) {
      setProfile(null);
      return;
    }

    setProfile((data as Profile) ?? null);
  }, []);

  useEffect(() => {
    let active = true;

    const init = async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;

      setSession(data.session);
      if (data.session?.user) {
        await loadProfile(data.session.user.id);
      }
      if (active) setLoading(false);
    };

    init();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);

      if (nextSession?.user) {
        // Deferred out of the callback on purpose: supabase-js holds its auth
        // lock while this runs, and calling the client from inside it can leave
        // the next request waiting on a lock that is never released. That showed
        // up as a sign-in whose profile lookup came back empty, which the login
        // screen then read as an unapproved account.
        const userId = nextSession.user.id;
        setTimeout(() => loadProfile(userId), 0);
      } else {
        setProfile(null);
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    setProfile(null);
    await supabase.auth.signOut();
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session?.user) {
      await loadProfile(session.user.id);
    }
  }, [session, loadProfile]);

  // Every signed-in account carries its role. Verification no longer decides
  // this: it decides whether a project may be posted, and is asked for there.
  // A deactivated account is treated as signed out, because an Admin turned it
  // off and nothing in the app should still be reachable.
  const role: UserRole | null =
    profile && profile.account_status !== 'Inactive' ? profile.user_type : null;

  const value = useMemo<AuthContextValue>(
    () => ({ session, profile, role, loading, signOut, refreshProfile }),
    [session, profile, role, loading, signOut, refreshProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider');
  }
  return context;
};
