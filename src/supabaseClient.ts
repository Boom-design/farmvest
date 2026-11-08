import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://xchletvlopsxhxvpsexv.supabase.co'
const supabaseAnonKey = 'sb_publishable_0uIih6bMUo5tbjd7QFTHCw_i6cc5MAk'

const REMEMBER_KEY = 'farmvest.remember-me'

/** Whether the last sign-in asked to be remembered; defaults to yes. */
const remembered = () => {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== 'false'
  } catch {
    return true
  }
}

/** Called by the login form before signing in, so the token lands in the right store. */
export const setRememberMe = (remember: boolean) => {
  try {
    localStorage.setItem(REMEMBER_KEY, remember ? 'true' : 'false')
  } catch {
    // Storage can be unavailable; the session then behaves as remembered.
  }
}

/**
 * "Remember me" decides where the session token is kept: localStorage survives a
 * closed browser, sessionStorage does not. Reads check both, so a session that
 * was written under the other setting is still found.
 */
const authStorage = {
  getItem: (key: string) => {
    try {
      return localStorage.getItem(key) ?? sessionStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem: (key: string, value: string) => {
    try {
      if (remembered()) {
        sessionStorage.removeItem(key)
        localStorage.setItem(key, value)
      } else {
        localStorage.removeItem(key)
        sessionStorage.setItem(key, value)
      }
    } catch {
      // Ignore storage errors.
    }
  },
  removeItem: (key: string) => {
    try {
      localStorage.removeItem(key)
      sessionStorage.removeItem(key)
    } catch {
      // Ignore storage errors.
    }
  },
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { storage: authStorage, persistSession: true, autoRefreshToken: true },
})
