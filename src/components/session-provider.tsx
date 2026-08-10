import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"

import { insforge, oauthRedirectUrl } from "@/lib/insforge"
import { ensureProfile, fetchProfile } from "@/lib/api"
import type { Profile } from "@/lib/kasbon"

type SessionStatus = "loading" | "authenticated" | "anonymous"

type SessionValue = {
  status: SessionStatus
  userId: string | null
  /** Alamat akun yang dipakai masuk — tetap ada walau profilnya ditolak. */
  email: string | null
  profile: Profile | null
  isAdmin: boolean
  error: string | null
  refreshProfile: () => Promise<void>
  signInWithGoogle: () => Promise<void>
  signInWithPassword: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const SessionContext = React.createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = React.useState<SessionStatus>("loading")
  const [userId, setUserId] = React.useState<string | null>(null)
  const [email, setEmail] = React.useState<string | null>(null)
  const [profile, setProfile] = React.useState<Profile | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  // Resolves the session once on mount. getCurrentUser() also completes a
  // pending Google OAuth callback (?insforge_code=...) before it answers, so a
  // redirect back from Google lands here already signed in.
  const load = React.useCallback(async () => {
    try {
      const { data } = await insforge.auth.getCurrentUser()
      const user = data.user

      if (!user?.id) {
        setUserId(null)
        setEmail(null)
        setProfile(null)
        setStatus("anonymous")
        return
      }

      setUserId(user.id)
      setEmail(user.email)

      // ensure_profile() refuses an email that is not in the HR register.
      // That is a legitimate answer, not a crash: keep the session so the UI
      // can explain it and offer sign-out.
      let ensured: Profile | null = null
      let ensureError: string | null = null
      try {
        ensured = await ensureProfile()
      } catch (profileError) {
        ensureError =
          profileError instanceof Error ? profileError.message : String(profileError)
      }

      setProfile(ensured ?? (await fetchProfile(user.id)))
      setStatus("authenticated")
      setError(ensureError)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
      setStatus("anonymous")
    }
  }, [])

  React.useEffect(() => {
    void load()
    const unsubscribe = insforge.auth.onAuthStateChange(() => {
      void load()
    })
    return unsubscribe
  }, [load])

  const refreshProfile = React.useCallback(async () => {
    if (!userId) return
    setProfile(await fetchProfile(userId))
  }, [userId])

  const signInWithGoogle = React.useCallback(async () => {
    setError(null)
    const { error: oauthError } = await insforge.auth.signInWithOAuth("google", {
      redirectTo: oauthRedirectUrl(),
      additionalParams: { prompt: "select_account" },
    })
    if (oauthError) {
      setError(oauthError.message)
      throw new Error(oauthError.message)
    }
  }, [])

  const signInWithPassword = React.useCallback(
    async (loginEmail: string, password: string) => {
      setError(null)
      const { error: signInError } = await insforge.auth.signInWithPassword({
        email: loginEmail,
        password,
      })
      if (signInError) {
        setError(signInError.message)
        throw new Error(signInError.message)
      }
      await load()
    },
    [load]
  )

  const signOut = React.useCallback(async () => {
    await insforge.auth.signOut()
    setUserId(null)
    setEmail(null)
    setProfile(null)
    setStatus("anonymous")
    // Otherwise the next account would briefly see the previous one's cache.
    queryClient.clear()
  }, [queryClient])

  const value = React.useMemo<SessionValue>(
    () => ({
      status,
      userId,
      email,
      profile,
      isAdmin: profile?.role === "admin",
      error,
      refreshProfile,
      signInWithGoogle,
      signInWithPassword,
      signOut,
    }),
    [
      status,
      userId,
      email,
      profile,
      error,
      refreshProfile,
      signInWithGoogle,
      signInWithPassword,
      signOut,
    ]
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const context = React.useContext(SessionContext)
  if (!context) {
    throw new Error("useSession harus dipakai di dalam <SessionProvider>")
  }
  return context
}
