import * as React from "react"
import { CircleAlert, ShieldCheck, WalletCards } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { useSession } from "@/components/session-provider"

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.8Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.94-2.92l-3.88-3a7.2 7.2 0 0 1-10.72-3.78H1.32v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.34 14.3a7.19 7.19 0 0 1 0-4.6V6.61H1.32a12 12 0 0 0 0 10.78l4.02-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.96 1.19 15.24 0 12 0A12 12 0 0 0 1.32 6.61l4.02 3.09A7.16 7.16 0 0 1 12 4.75Z"
      />
    </svg>
  )
}

export function LoginScreen() {
  const { signInWithGoogle, signInWithPassword } = useSession()
  const [mode, setMode] = React.useState<"pemohon" | "admin">("pemohon")
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState("")

  const handleGoogle = async () => {
    setError("")
    setPending(true)
    try {
      await signInWithGoogle()
      // On success the browser navigates to Google, so `pending` stays true.
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : String(signInError))
      setPending(false)
    }
  }

  const handlePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError("")
    setPending(true)
    try {
      await signInWithPassword(email.trim(), password)
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : String(signInError))
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="grid min-h-svh bg-muted/30 lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-2xl bg-primary-foreground/15">
            <WalletCards className="size-5" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">Kasbonku</p>
            <p className="text-xs text-primary-foreground/70">ABS Group</p>
          </div>
        </div>
        <div className="max-w-md">
          <h1 className="text-3xl font-semibold tracking-tight">
            Pengajuan kasbon karyawan, tanpa Google Form.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-primary-foreground/80">
            Ajukan kasbon, tanda tangan dokumen secara digital, dan pantau status
            angsuran yang dipotong dari gaji — semuanya dari satu dashboard.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-primary-foreground/85">
            <li className="flex gap-3">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary-foreground/60" />
              Limit otomatis sesuai jabatan dan maksimal 6 bulan angsuran.
            </li>
            <li className="flex gap-3">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary-foreground/60" />
              Biaya provisi 1,5% dan admin bulanan 1% dihitung sistem.
            </li>
            <li className="flex gap-3">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary-foreground/60" />
              Notifikasi email setiap kali status pengajuan berubah.
            </li>
          </ul>
        </div>
        <p className="text-xs text-primary-foreground/60">
          © {new Date().getFullYear()} ABS Group. Sistem internal karyawan.
        </p>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="grid size-10 place-items-center rounded-2xl bg-primary text-primary-foreground">
              <WalletCards className="size-5" />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight">Kasbonku</p>
              <p className="text-xs text-muted-foreground">ABS Group</p>
            </div>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight">Masuk ke Kasbonku</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {mode === "pemohon"
              ? "Gunakan akun Google kantor kamu. Email ini juga dipakai untuk notifikasi."
              : "Masuk dengan kredensial admin yang diberikan pengelola sistem."}
          </p>

          <div
            className="mt-6 flex items-center rounded-full border border-border bg-muted/40 p-0.5"
            role="tablist"
            aria-label="Pilih cara masuk"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === "pemohon"}
              onClick={() => {
                setMode("pemohon")
                setError("")
              }}
              className={
                mode === "pemohon"
                  ? "flex-1 rounded-full bg-background px-3 py-1.5 text-xs font-medium shadow-sm"
                  : "flex-1 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              }
            >
              Karyawan
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "admin"}
              onClick={() => {
                setMode("admin")
                setError("")
              }}
              className={
                mode === "admin"
                  ? "flex-1 rounded-full bg-background px-3 py-1.5 text-xs font-medium shadow-sm"
                  : "flex-1 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              }
            >
              Admin
            </button>
          </div>

          <Card className="mt-4 border-border/80 shadow-none">
            <CardContent className="p-5">
              {mode === "pemohon" ? (
                <div className="space-y-4">
                  <Button
                    size="lg"
                    variant="outline"
                    className="w-full gap-2"
                    onClick={handleGoogle}
                    disabled={pending}
                  >
                    {pending ? <Spinner /> : <GoogleMark />}
                    Masuk dengan Google
                  </Button>
                  <div className="flex items-start gap-2.5 rounded-2xl bg-muted/60 p-3">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Setelah masuk pertama kali, lengkapi data jabatan dan masa
                      kontrak sebelum bisa mengajukan kasbon.
                    </p>
                  </div>
                </div>
              ) : (
                <form className="space-y-4" onSubmit={handlePassword}>
                  <div className="space-y-2">
                    <Label htmlFor="admin-email">Email admin</Label>
                    <Input
                      id="admin-email"
                      type="email"
                      autoComplete="username"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="admin@absgroup.biz.id"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="admin-password">Kata sandi</Label>
                    <Input
                      id="admin-password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" size="lg" className="w-full" disabled={pending}>
                    {pending ? <Spinner /> : null}
                    Masuk sebagai admin
                  </Button>
                </form>
              )}

              {error ? (
                <div
                  role="alert"
                  className="mt-4 flex items-start gap-2 rounded-2xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
                >
                  <CircleAlert className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Separator className="my-6" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Butuh akun admin atau kesulitan masuk? Hubungi pengelola sistem
            Kasbonku di ABS Group.
          </p>
        </div>
      </section>
    </main>
  )
}
