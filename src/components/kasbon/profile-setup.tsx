import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CircleAlert, FilePlus2, LogOut } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { useSession } from "@/components/session-provider"
import {
  ApplicationFormFields,
  initialApplicationValues,
  toSubmitInput,
  validateApplicationValues,
} from "@/components/kasbon/application-form"
import type { ApplicationFormValues } from "@/components/kasbon/application-form"
import { submitApplication } from "@/lib/api"
import type { Profile } from "@/lib/kasbon"

/**
 * Halaman "Isi Data Diri" yang SEKALIGUS berfungsi sebagai form pengajuan
 * kasbon pertama. Menggabungkan field profil (Nama, Jabatan, Join Date, Masa
 * Kontrak, No. Telp, No. Telp Keluarga) dan field pengajuan (Nominal, Jangka
 * Waktu, Alasan) di satu form. Submit membuat profil + pengajuan dalam satu
 * transaksi via RPC `submit_application`, lalu auto-generate dokumen resmi.
 */
export function ProfileSetup({ profile }: { profile: Profile }) {
  const { refreshProfile, signOut } = useSession()
  const queryClient = useQueryClient()

  const [values, setValues] = React.useState<ApplicationFormValues>(() =>
    initialApplicationValues(profile)
  )
  const [error, setError] = React.useState("")

  const onChange = React.useCallback(
    (patch: Partial<ApplicationFormValues>) => {
      setValues((prev) => ({ ...prev, ...patch }))
      setError("")
    },
    []
  )

  const submit = useMutation({
    mutationFn: async () => {
      const validationError = validateApplicationValues(values)
      if (validationError) throw new Error(validationError)
      const input = toSubmitInput(values, profile)
      return submitApplication(input)
    },
    onSuccess: async (application) => {
      setError("")
      await refreshProfile()
      await queryClient.invalidateQueries({ queryKey: ["applications"] })
      await queryClient.invalidateQueries({ queryKey: ["stats"] })
      // Dashboard akan mengambil alih setelah refreshProfile membuat
      // isProfileComplete() true. Pengajuan sudah tersimpan dan dokumen
      // auto-generate berjalan di backend.
      void application
    },
    onError: (mutationError) => {
      const message =
        mutationError instanceof Error
          ? mutationError.message
          : String(mutationError)
      setError(
        message.includes("applications_one_active_per_user")
          ? "Kamu masih punya kasbon yang berjalan. Selesaikan dulu sebelum mengajukan lagi."
          : message
      )
    },
  })

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-4 py-10 sm:p-8">
      <Card className="w-full max-w-3xl border-border/80 shadow-none">
        <CardHeader className="border-b border-border/70 pb-5">
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
              <FilePlus2 className="size-5" />
            </div>
            <div>
              <CardTitle className="text-lg">
                Isi data diri & ajukan kasbon pertama
              </CardTitle>
              <CardDescription className="mt-1">
                Lengkapi data kepegawaian dan pengajuan kasbon pertama kamu
                sekaligus. Dokumen resmi otomatis dibuat setelah submit — admin
                akan meninjau dan mengirimkannya untuk kamu tanda tangani.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-5 sm:p-6">
          <form
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault()
              submit.mutate()
            }}
          >
            <ApplicationFormFields
              values={values}
              onChange={onChange}
              email={profile.email}
              idPrefix="setup"
            />

            {error ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-2xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
              >
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                onClick={() => void signOut()}
              >
                <LogOut />
                Keluar
              </Button>
              <Button type="submit" size="lg" disabled={submit.isPending}>
                {submit.isPending ? <Spinner /> : <FilePlus2 />}
                Kirim pengajuan
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
