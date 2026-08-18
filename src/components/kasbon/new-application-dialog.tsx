import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CircleAlert, FilePlus2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import {
  ApplicationFormFields,
  initialApplicationValues,
  toSubmitInput,
  validateApplicationValues,
} from "@/components/kasbon/application-form"
import type { ApplicationFormValues } from "@/components/kasbon/application-form"
import { submitApplication } from "@/lib/api"
import type { Application, Profile } from "@/lib/kasbon"

/**
 * Dialog pengajuan kasbon berikutnya (bukan pertama kali). Data diri
 * auto-terisi dari profil tapi tetap bisa diedit (misal kontrak diperpanjang).
 * Untuk revisi, data transaksi di-pre-fill dari pengajuan yang ditolak.
 *
 * Submit memanggil RPC `submit_application` yang menulis profil + pengajuan
 * dalam satu transaksi, lalu auto-generate dokumen resmi.
 */
export function NewApplicationDialog({
  open,
  onOpenChange,
  profile,
  revisionOf,
  onSubmitted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  profile: Profile
  revisionOf?: Application | null
  onSubmitted: (message: string) => void
}) {
  const queryClient = useQueryClient()
  const scrollRef = React.useRef<HTMLDivElement>(null)

  const [values, setValues] = React.useState<ApplicationFormValues>(() =>
    initialApplicationValues(profile, revisionOf)
  )
  const [formError, setFormError] = React.useState("")

  React.useEffect(() => {
    if (!open) return
    setFormError("")
    setValues(initialApplicationValues(profile, revisionOf))
    scrollRef.current?.scrollTo({ top: 0 })
  }, [open, revisionOf, profile])

  const onChange = React.useCallback(
    (patch: Partial<ApplicationFormValues>) => {
      setValues((prev) => ({ ...prev, ...patch }))
      setFormError("")
    },
    []
  )

  const submit = useMutation({
    mutationFn: async () => {
      const validationError = validateApplicationValues(values)
      if (validationError) throw new Error(validationError)
      const input = toSubmitInput(values, profile, revisionOf)
      return submitApplication(input)
    },
    onSuccess: async (application) => {
      setFormError("")
      onOpenChange(false)
      await queryClient.invalidateQueries({ queryKey: ["applications"] })
      await queryClient.invalidateQueries({ queryKey: ["stats"] })
      onSubmitted(
        `Pengajuan ${application.code} terkirim. Dokumen resmi otomatis dibuat dan admin akan meninjau.`
      )
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error)
      setFormError(
        message.includes("applications_one_active_per_user")
          ? "Kamu masih punya kasbon yang berjalan. Selesaikan dulu sebelum mengajukan lagi."
          : message
      )
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl overflow-hidden p-0">
        <form
          className="flex max-h-[88vh] flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            submit.mutate()
          }}
        >
          <DialogHeader className="border-b border-border/70 p-6 pr-12">
            <DialogTitle>
              {revisionOf
                ? `Revisi pengajuan ${revisionOf.code}`
                : "Ajukan kasbon baru"}
            </DialogTitle>
            <DialogDescription className="mt-1">
              {revisionOf
                ? "Data lama sudah terisi. Perbaiki bagian yang diminta admin lalu kirim ulang."
                : "Lengkapi data pengajuan. Data diri sudah terisi dari profil — edit jika perlu. Dokumen resmi otomatis dibuat setelah submit."}
            </DialogDescription>
          </DialogHeader>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
            {revisionOf?.admin_note ? (
              <div className="mb-5 flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                <span>
                  <strong className="font-medium">Catatan admin:</strong>{" "}
                  {revisionOf.admin_note}
                </span>
              </div>
            ) : null}

            <ApplicationFormFields
              values={values}
              onChange={onChange}
              email={profile.email}
              idPrefix="new-app"
            />

            {formError ? (
              <p
                role="alert"
                className="mt-5 rounded-2xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {formError}
              </p>
            ) : null}
          </div>

          <DialogFooter className="border-t border-border/70 p-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Batal
            </Button>
            <Button type="submit" disabled={submit.isPending}>
              {submit.isPending ? <Spinner /> : <FilePlus2 />}
              {revisionOf ? "Kirim revisi" : "Kirim pengajuan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
