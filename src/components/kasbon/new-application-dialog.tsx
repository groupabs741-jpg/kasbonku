import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  CircleAlert,
  CircleDollarSign,
  FilePlus2,
  ShieldCheck,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { Metric, fieldClassName } from "@/components/kasbon/shared"
import { createApplication, flushNotifications } from "@/lib/api"
import { formatCurrency, formatCurrencyInput, formatDate } from "@/lib/format"
import {
  MAX_TENURE_MONTHS,
  POSITION_LIMITS,
  REASON_OPTIONS,
  calculateFees,
  remainingContract,
} from "@/lib/kasbon"
import type { Application, Profile, ReasonCategory } from "@/lib/kasbon"

export function NewApplicationDialog({
  open,
  onOpenChange,
  profile,
  /** Prefills the form from a rejected submission (PRD 5: revisi, bukan mulai dari nol). */
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

  const [amount, setAmount] = React.useState(String(revisionOf?.amount ?? ""))
  const [tenure, setTenure] = React.useState(
    String(revisionOf?.tenure_months ?? 6)
  )
  const [reason, setReason] = React.useState<ReasonCategory>(
    revisionOf?.reason_category ?? "Kesehatan / Medis Darurat"
  )
  const [reasonDetail, setReasonDetail] = React.useState(
    revisionOf?.reason_detail ?? ""
  )
  const [phone, setPhone] = React.useState(
    revisionOf?.phone ?? profile.phone ?? ""
  )
  const [familyPhone, setFamilyPhone] = React.useState(
    revisionOf?.family_phone ?? profile.family_phone ?? ""
  )
  const [formError, setFormError] = React.useState("")

  // Re-seed the form each time the dialog opens so a revision does not inherit
  // whatever the previous open left behind.
  React.useEffect(() => {
    if (!open) return
    setFormError("")
    setAmount(String(revisionOf?.amount ?? ""))
    setTenure(String(revisionOf?.tenure_months ?? 6))
    setReason(revisionOf?.reason_category ?? "Kesehatan / Medis Darurat")
    setReasonDetail(revisionOf?.reason_detail ?? "")
    setPhone(revisionOf?.phone ?? profile.phone ?? "")
    setFamilyPhone(revisionOf?.family_phone ?? profile.family_phone ?? "")
    scrollRef.current?.scrollTo({ top: 0 })
  }, [open, revisionOf, profile])

  const numericAmount = Number(amount) || 0
  const numericTenure = Number(tenure) || 0
  const jabatan = profile.jabatan
  const limit = jabatan ? POSITION_LIMITS[jabatan] : 0
  const fees = calculateFees(numericAmount, numericTenure)
  const sisaKontrak = remainingContract(profile.contract_end)
  const overLimit = numericAmount > limit

  const submit = useMutation({
    mutationFn: async () => {
      if (!jabatan) {
        throw new Error(
          "Jabatan belum ditetapkan admin. Hubungi admin Kasbonku."
        )
      }
      if (!numericAmount) throw new Error("Nominal pengajuan wajib diisi.")
      if (overLimit) {
        throw new Error(
          `Nominal maksimal untuk ${jabatan} adalah ${formatCurrency(limit)}.`
        )
      }
      if (numericTenure < 1 || numericTenure > MAX_TENURE_MONTHS) {
        throw new Error(
          `Jangka waktu angsuran harus antara 1 dan ${MAX_TENURE_MONTHS} bulan.`
        )
      }
      if (!phone.trim() || !familyPhone.trim()) {
        throw new Error("Nomor telepon pemohon dan keluarga wajib diisi.")
      }

      return createApplication({
        user_id: profile.id,
        // Server menimpa ketiganya dari profil; dikirim agar tipe tetap utuh.
        jabatan,
        join_date: profile.join_date,
        contract_start: profile.contract_start ?? "",
        contract_end: profile.contract_end ?? "",
        amount: numericAmount,
        tenure_months: numericTenure,
        phone: phone.trim(),
        family_phone: familyPhone.trim(),
        reason_category: reason,
        reason_detail: reasonDetail.trim() || null,
        revision_of: revisionOf?.id ?? null,
      })
    },
    onSuccess: async (application) => {
      setFormError("")
      onOpenChange(false)
      await queryClient.invalidateQueries({ queryKey: ["applications"] })
      await queryClient.invalidateQueries({ queryKey: ["stats"] })
      void flushNotifications()
      onSubmitted(
        `Pengajuan ${application.code} terkirim. Admin akan memprosesnya.`
      )
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error)
      // The partial unique index is the authoritative guard for PRD 4.5.
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
                : "Lengkapi data pengajuan. Sisa kontrak dan biaya admin dihitung otomatis."}
            </DialogDescription>
          </DialogHeader>

          <div ref={scrollRef} className="flex-1 space-y-6 overflow-y-auto p-6">
            {revisionOf?.admin_note ? (
              <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                <span>
                  <strong className="font-medium">Catatan admin:</strong>{" "}
                  {revisionOf.admin_note}
                </span>
              </div>
            ) : null}

            {/* Data kepegawaian berasal dari catatan admin dan ditampilkan
                read-only — server tetap mengambilnya dari profil, apa pun yang
                dikirim dari sini. */}
            <div className="rounded-2xl border border-border/70 bg-muted/40 p-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-primary" />
                <p className="text-sm font-medium">Data pemohon</p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Metric label="Nama" value={profile.full_name} />
                <Metric
                  label="Email"
                  value={profile.email}
                  valueClassName="text-xs"
                />
                <Metric label="Jabatan" value={profile.jabatan ?? "-"} />
                <Metric
                  label="Masa kontrak"
                  value={`${formatDate(profile.contract_start)} – ${formatDate(profile.contract_end)}`}
                  valueClassName="text-xs"
                />
                <Metric
                  label="Sisa kontrak saat pengajuan"
                  value={sisaKontrak.label}
                />
              </div>
            </div>

            <Separator />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="amount">Nominal pengajuan</Label>
                <Input
                  id="amount"
                  type="text"
                  inputMode="numeric"
                  value={formatCurrencyInput(amount)}
                  onChange={(event) => {
                    setAmount(event.target.value.replace(/\D/g, ""))
                    setFormError("")
                  }}
                  aria-invalid={overLimit}
                  placeholder="Rp 0"
                  required
                />
                <p
                  className={
                    overLimit
                      ? "text-xs text-destructive"
                      : "text-xs text-muted-foreground"
                  }
                >
                  Limit {jabatan}: {formatCurrency(limit)}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tenure">Jangka waktu angsuran</Label>
                <Input
                  id="tenure"
                  type="number"
                  min="1"
                  max={MAX_TENURE_MONTHS}
                  value={tenure}
                  onChange={(event) => {
                    setTenure(event.target.value)
                    setFormError("")
                  }}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Maksimal {MAX_TENURE_MONTHS} bulan.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">No. Telp / WhatsApp</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="08xx xxxx xxxx"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="family-phone">No. Telp keluarga</Label>
                <Input
                  id="family-phone"
                  type="tel"
                  value={familyPhone}
                  onChange={(event) => setFamilyPhone(event.target.value)}
                  placeholder="08xx xxxx xxxx"
                  required
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="reason">Alasan permohonan</Label>
                <Select
                  value={reason}
                  onValueChange={(value) => value && setReason(value)}
                >
                  <SelectTrigger id="reason" className={fieldClassName}>
                    <SelectValue placeholder="Pilih alasan permohonan" />
                  </SelectTrigger>
                  <SelectContent>
                    {REASON_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {
                    REASON_OPTIONS.find((option) => option.value === reason)
                      ?.hint
                  }
                </p>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="reason-detail">
                  Keterangan tambahan{" "}
                  <span className="font-normal text-muted-foreground">
                    (opsional)
                  </span>
                </Label>
                <Textarea
                  id="reason-detail"
                  value={reasonDetail}
                  onChange={(event) => setReasonDetail(event.target.value)}
                  placeholder="Tambahkan konteks singkat untuk admin."
                />
              </div>
            </div>

            <div className="rounded-2xl border border-primary/15 bg-primary/[0.04] p-4">
              <div className="flex items-center gap-2">
                <CircleDollarSign className="size-4 text-primary" />
                <p className="text-sm font-medium">Estimasi pencairan</p>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Metric
                  label="Dana cair"
                  value={formatCurrency(fees.netDisbursement)}
                  highlight
                  valueClassName="text-base"
                />
                <Metric
                  label="Provisi 1,5%"
                  value={formatCurrency(fees.provisi)}
                  valueClassName="text-base"
                />
                <Metric
                  label="Angsuran pokok / bulan"
                  value={formatCurrency(fees.monthlyInstallment)}
                  valueClassName="text-base"
                />
                <Metric
                  label="Admin bulanan 1%"
                  value={formatCurrency(fees.monthlyAdmin)}
                  valueClassName="text-base"
                />
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Kedua biaya dipotong saat pencairan, jadi angsuran bulanan yang
                dipotong dari gaji hanya pokok pinjaman.
              </p>
            </div>

            {formError ? (
              <p
                role="alert"
                className="rounded-2xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
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
