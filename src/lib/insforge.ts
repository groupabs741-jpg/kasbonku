import { createClient } from "@insforge/sdk"

const baseUrl = import.meta.env.VITE_INSFORGE_URL as string | undefined
const anonKey = import.meta.env.VITE_INSFORGE_ANON_KEY as string | undefined

if (!baseUrl || !anonKey) {
  throw new Error(
    "VITE_INSFORGE_URL dan VITE_INSFORGE_ANON_KEY belum diisi. Salin .env.example ke .env."
  )
}

export const insforge = createClient({ baseUrl, anonKey })

/** Where Google sends the browser back after sign-in. */
export const oauthRedirectUrl = () =>
  typeof window === "undefined" ? "/" : `${window.location.origin}/`
