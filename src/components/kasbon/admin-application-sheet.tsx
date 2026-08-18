import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Check,
  CircleAlert,
  Clock3,
  FileText,
  Landmark,
  UserRound,
  X,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import {
  ApplicantAvatar,
  Metric,
  StatusBadge,
  StatusTimeline,
} from "@/components/kasbon/shared"
import { DocumentList } from "@/components/kasbon/document-list"
import {
  fetchApplicationEvents,
  flushNotifications,
  setApplicationStatus,
} from "@/lib/api"
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format"
import { POSITION_LIMITS, remainingContract } from "@/lib/kasbon"
import type { Application } from "@/lib/kasbon"

/**
 * Detail pengajuan dari sisi admin. Dokumen resmi sudah otomatis dibuat saat
 * pemohon submit — admin tinggal klik "Kirim Dokumen ke Pemohon" untuk
 * memindahkan status ke "Menunggu TTD". Setelah pemohon upload scan TTD, admin
 * review lalu setujui atau tolak.
 */
export function AdminApplicationSheet({
  application,
  onClose,
  onNotify,
}: {
  application: Application | null
  onClose: () => void
  onNotify: (message: string) => void
}) {
  const queryClient = useQueryClient()
  const [note, setNote] = React.useState("")
  const [error, setError] = React.useState("")
  const [rejecting, setRejecting] = React.useState(false)
  const [disbursing, setDisbursing] = React.useState(false)
  const noteRef = React.useRef<HTMLTextAreaElement>(null)

  React.useEffect(() => {
    setNote("")
    setError("")
    setRejecting(false)
    setDisbursing(false)
  }, [application?.id])

  React.useEffect(() => {
    if (!rejecting) return
    setDisbursing(false)
    noteRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
    noteRef.current?.focus({ preventScroll: true })
  }, [rejecting])

  React.useEffect(() => {
    if (disbursing) setRejecting(false)
  }, [disbursing])

  const events = useQuery({
    queryKey: ["application-events", application?.id],
    queryFn: () => fetchApplicationEvents(application!.id),
    enabled: Boolean(application),
  })

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["applications"] })
    await queryClient.invalidateQueries({ queryKey: ["documents"] })
    await queryClient.invalidateQueries({ queryKey: ["receivables"] })
    await queryClient.invalidateQueries({ queryKey: ["stats"] })
    await queryClient.invalidateQueries({ queryKey: ["application-events"] })
  }

  const changeStatus = useMutation({
    mutationFn: (input: {
      status: Application["status"]
      note?: string | null
    }) => setApplicationStatus(application!.id, input.status, input.note),
    onSuccess: async (_data, input) => {
      setError("")
      await invalidate()
      void flushNotifications()
      onClose()
      onNotify(STATUS_MESSAGES[input.status] ?? "Status pengajuan diperbarui.")
    },
    onError: (mutationError) => setError(errorText(mutationError)),
  })

  if (!application) return null

  const profile = application.profiles
  const sisaKontrak = remainingContract(application.contract_end)
  const busy = changeStatus.isPending

  // Dokumen resmi + email berisi detail & lampiran otomatis terkirim ke pemohon
  // saat submit — pengajuan langsung 'Menunggu TTD', admin tidak kirim manual.
  // Admin hanya menunggu scan TTD pemohon ('Menunggu Review') lalu setujui/tolak.
  const canApprove = application.status === "Menunggu Review"
  const canReject = [
    "Diajukan",
    "Menunggu TTD",
    "Menunggu Review",
  ].includes(application.status)
  const settled =
    application.status === "Disetujui / Cair" || application.status === "Lunas"

  return (
    <Dialog
      open={Boolean(application)}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="flex max-h-[92vh] w-[min(96vw,64rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="shrink-0 border-b border-border/70 bg-muted/25 px-6 py-5 pr-14">
          <div className="flex items-start gap-3">
            <ApplicantAvatar
              name={profile?.full_name}
              size="lg"
              className="mt-0.5"
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium tracking-wide text-primary">
                Detail pengajuan
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <DialogTitle className="text-lg font-semibold tracking-tight">
                  {profile?.full_name ?? "Pemohon"}
                </DialogTitle>
                <StatusBadge status={application.status} />
              </div>
              <DialogDescription className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="font-medium text-foreground/80">
                  {application.code}
                </span>
                <span aria-hidden="true">&middot;</span>
                <span>{application.jabatan}</span>
                {profile?.branch ? (
                  <>
                    <span aria-hidden="true">&middot;</span>
                    <span>{profile.branch}</span>
                  </>
                ) : null}
                <span aria-hidden="true">&middot;</span>
                <span>Diajukan {formatDate(application.submitted_at)}</span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[1.35fr_1fr] lg:overflow-hidden">
          {/* Kiri: berkas yang dibaca admin. */}
          <div className="space-y-5 px-6 py-5 lg:overflow-y-auto">
            <section className="rounded-2xl border border-primary/20 bg-primary/[0.06] p-4">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-medium text-primary">
                    Nominal pengajuan
                  </p>
                  <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
                    {formatCurrency(application.amount)}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {application.tenure_months} bulan &middot;{" "}
                  {formatCurrency(application.monthly_installment)} / bulan
                </p>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2.5 border-t border-primary/15 pt-3 sm:grid-cols-4">
                <Metric
                  label="Dana cair"
                  value={formatCurrency(application.net_disbursement)}
                  highlight
                  valueClassName="text-sm"
                  className="border-transparent bg-background/70 p-2.5"
                />
                <Metric
                  label="Angsuran"
                  value={formatCurrency(application.monthly_installment)}
                  valueClassName="text-sm"
                  className="border-transparent bg-background/70 p-2.5"
                />
                <Metric
                  label="Provisi 1,5%"
                  value={formatCurrency(application.provisi_fee)}
                  valueClassName="text-sm"
                  className="border-transparent bg-background/70 p-2.5"
                />
                <Metric
                  label="Admin 1%/bln"
                  value={formatCurrency(application.monthly_admin_fee)}
                  valueClassName="text-sm"
                  className="border-transparent bg-background/70 p-2.5"
                />
              </div>
            </section>

            <section>
              <DetailSectionHeading icon={FileText} title="Alasan pengajuan" />
              <p className="mt-3 text-sm font-semibold">
                {application.reason_category}
              </p>
              {application.reason_detail ? (
                <p className="mt-2 border-l-2 border-primary/30 pl-3 text-sm leading-relaxed text-muted-foreground">
                  {application.reason_detail}
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  Tidak ada keterangan tambahan dari pemohon.
                </p>
              )}
            </section>

            {application.revision_of ? (
              <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-3 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" />
                <p className="text-xs leading-relaxed">
                  <span className="font-semibold">Pengajuan revisi</span> &mdash;
                  versi perbaikan dari pengajuan sebelumnya yang ditolak.
                </p>
              </div>
            ) : null}

            <section>
              <DetailSectionHeading
                icon={UserRound}
                title="Data pemohon"
                description="Diisi sendiri oleh pemohon — cocokkan dengan data kepegawaian."
              />

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
                <div className="min-w-0">
                  <p className="text-xs text-amber-800 dark:text-amber-300/80">
                    Jabatan yang diklaim pemohon
                  </p>
                  <p className="mt-1 text-sm font-semibold text-amber-900 dark:text-amber-200">
                    {application.jabatan}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-amber-800 dark:text-amber-300/80">
                    Limit yang berlaku
                  </p>
                  <p className="mt-1 text-sm font-semibold text-amber-900 tabular-nums dark:text-amber-200">
                    {formatCurrency(POSITION_LIMITS[application.jabatan])}
                  </p>
                </div>
              </div>

              <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                <Metric
                  label="Email"
                  value={profile?.email ?? "-"}
                  valueClassName="text-xs"
                  className="border-transparent bg-muted/45 p-3"
                />
                <Metric
                  label="No. telepon"
                  value={application.phone}
                  valueClassName="text-sm"
                  className="border-transparent bg-muted/45 p-3"
                />
                <Metric
                  label="No. telp keluarga"
                  value={application.family_phone}
                  valueClassName="text-sm"
                  className="border-transparent bg-muted/45 p-3"
                />
                <Metric
                  label="Join date"
                  value={formatDate(application.join_date)}
                  valueClassName="text-sm"
                  className="border-transparent bg-muted/45 p-3"
                />
                <Metric
                  label="Masa kontrak"
                  value={`${formatDate(application.contract_start)} – ${formatDate(application.contract_end)}`}
                  valueClassName="text-xs"
                  className="border-transparent bg-muted/45 p-3"
                />
                <Metric
                  label="Sisa kontrak"
                  value={sisaKontrak.label}
                  valueClassName="text-sm"
                  className="border-transparent bg-muted/45 p-3"
                />
              </div>
            </section>
          </div>

          {/* Kanan: dokumen, progres, dan tombol aksi. */}
          <div className="flex min-h-0 flex-col border-t border-border/70 bg-muted/20 lg:border-t-0 lg:border-l">
            <div className="space-y-5 px-6 py-5 lg:overflow-y-auto">
              <section className="space-y-3">
                <DetailSectionHeading
                  icon={FileText}
                  title="Dokumen"
                  description="Dokumen resmi otomatis dibuat saat pemohon submit."
                />
                <DocumentList
                  applicationId={application.id}
                  emptyLabel="Dokumen resmi sedang diproses. Muat ulang sebentar lagi."
                />
              </section>

              <section>
                <DetailSectionHeading
                  icon={Clock3}
                  title="Riwayat status"
                  description="Perjalanan pengajuan dari masuk hingga selesai."
                />
                <div className="mt-3 rounded-2xl bg-background/70 p-3.5">
                  <StatusTimeline status={application.status} />
                </div>
                {events.data && events.data.length > 0 ? (
                  <ul className="relative mt-4 space-y-2.5 pl-4 before:absolute before:inset-y-1 before:left-0 before:w-px before:bg-border">
                    {events.data.map((event) => (
                      <li key={event.id} className="relative pl-3">
                        <span className="absolute top-1.5 -left-[0.1875rem] size-1.5 rounded-full bg-primary ring-4 ring-muted/20" />
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <span className="text-xs font-medium">
                            {event.from_status
                              ? `${event.from_status} → ${event.to_status}`
                              : event.to_status}
                          </span>
                          <span className="text-[11px] text-muted-foreground tabular-nums">
                            {formatDateTime(event.created_at)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>

              {rejecting ? (
                <div className="space-y-2 rounded-2xl border border-destructive/30 bg-destructive/[0.04] p-4">
                  <label
                    htmlFor="reject-note"
                    className="text-sm font-medium text-destructive"
                  >
                    Alasan penolakan
                  </label>
                  <Textarea
                    id="reject-note"
                    ref={noteRef}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Jelaskan apa yang perlu diperbaiki pemohon."
                    rows={3}
                    className="bg-background"
                  />
                  <p className="text-xs text-muted-foreground">
                    Catatan ini dikirim ke pemohon lewat email dan tampil saat
                    mereka merevisi pengajuan.
                  </p>
                </div>
              ) : null}

              {error ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-2xl border border-destructive/20 bg-destructive/[0.06] px-4 py-3 text-sm text-destructive"
                >
                  <CircleAlert className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}
            </div>

            <div className="shrink-0 space-y-2 border-t border-border/70 bg-background/80 px-6 py-4">
              {canApprove ? (
                disbursing ? (
                  <div className="space-y-5 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.08] to-transparent p-5 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/20 text-primary">
                        <Landmark className="size-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold tracking-tight text-foreground">
                          Instruksi Pencairan
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Lakukan transfer dana ke rekening di bawah ini.
                        </p>
                      </div>
                    </div>

                    <div className="overflow-hidden rounded-xl border border-border/60 bg-background/95 shadow-sm backdrop-blur">
                      <div className="border-b border-border/40 bg-muted/40 px-4 py-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Total Transfer
                        </p>
                        <p className="mt-1 text-xl font-bold tracking-tight text-primary tabular-nums">
                          {formatCurrency(application.net_disbursement)}
                        </p>
                      </div>
                      <div className="space-y-2.5 px-4 py-3.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">Bank Tujuan</span>
                          <span className="text-sm font-semibold">{application.bank_name || "-"}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">No. Rekening</span>
                          <span className="text-sm font-bold tracking-wider tabular-nums">{application.bank_account || "-"}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">Atas Nama</span>
                          <span className="text-sm font-medium">{profile?.full_name || "-"}</span>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-2.5 pt-1 sm:grid-cols-2">
                      <Button
                        variant="ghost"
                        onClick={() => setDisbursing(false)}
                        disabled={busy}
                        className="hover:bg-background/60"
                      >
                        Batal
                      </Button>
                      <Button
                        onClick={() =>
                          changeStatus.mutate({ status: "Disetujui / Cair" })
                        }
                        disabled={busy}
                        className="shadow-sm"
                      >
                        {changeStatus.isPending ? <Spinner /> : <Check />}
                        Konfirmasi Transfer
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    className="w-full"
                    onClick={() => setDisbursing(true)}
                    disabled={busy || rejecting}
                  >
                    <Check />
                    Setujui dan cairkan dana
                  </Button>
                )
              ) : null}

              {canReject ? (
                rejecting ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      variant="ghost"
                      onClick={() => setRejecting(false)}
                      disabled={busy}
                    >
                      Batal
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={busy || note.trim().length < 5}
                      onClick={() =>
                        changeStatus.mutate({
                          status: "Ditolak",
                          note: note.trim(),
                        })
                      }
                    >
                      {changeStatus.isPending ? <Spinner /> : <Check />}
                      Konfirmasi tolak
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setRejecting(true)}
                    disabled={busy}
                  >
                    <X />
                    Tolak dan minta revisi
                  </Button>
                )
              ) : null}

              {settled ? (
                <p className="rounded-2xl bg-muted/60 px-4 py-3 text-center text-xs text-muted-foreground">
                  Kasbon sudah dicairkan. Kelola pemotongan gaji dari menu Kartu
                  piutang &mdash; status Lunas terbentuk otomatis saat seluruh
                  angsuran ditandai.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DetailSectionHeading({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon
  title: string
  description?: string
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="grid size-9 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
        <Icon className="size-4.5" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold tracking-tight">{title}</p>
        {description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  )
}

const STATUS_MESSAGES: Partial<Record<Application["status"], string>> = {
  "Disetujui / Cair":
    "Kasbon disetujui. Kartu piutang dan jadwal angsuran otomatis dibuat.",
  Ditolak: "Pengajuan ditolak. Pemohon dapat merevisi dan mengajukan ulang.",
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
