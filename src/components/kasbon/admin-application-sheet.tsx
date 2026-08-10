import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BadgeCheck,
  Check,
  CircleAlert,
  Clock3,
  FileCog,
  FileText,
  PenLine,
  Send,
  Upload,
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
  fetchDocuments,
  fetchOfficialDocumentHtml,
  flushNotifications,
  generateDocuments,
  setApplicationStatus,
  uploadSignedScan,
  writeHtmlToTab,
} from "@/lib/api"
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format"
import { POSITION_LIMITS, remainingContract } from "@/lib/kasbon"
import type { Application } from "@/lib/kasbon"

/**
 * The admin side of the flow in PRD 5: generate the official document, send it
 * to the applicant for signing, review it, circulate the printout for wet
 * signatures, then disburse — or reject with a note the applicant can act on.
 *
 * Laid out as a wide two-column dialog: the left column is the case file the
 * admin reads, the right column is what they act on.
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
  const scanInputRef = React.useRef<HTMLInputElement>(null)
  const noteRef = React.useRef<HTMLTextAreaElement>(null)

  React.useEffect(() => {
    setNote("")
    setError("")
    setRejecting(false)
  }, [application?.id])

  // The reject form lives further up the action column, so bring it into view
  // instead of leaving the admin staring at an unchanged screen.
  React.useEffect(() => {
    if (!rejecting) return
    noteRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
    noteRef.current?.focus({ preventScroll: true })
  }, [rejecting])

  const events = useQuery({
    queryKey: ["application-events", application?.id],
    queryFn: () => fetchApplicationEvents(application!.id),
    enabled: Boolean(application),
  })

  const documents = useQuery({
    queryKey: ["documents", application?.id],
    queryFn: () => fetchDocuments(application!.id),
    enabled: Boolean(application),
  })

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["applications"] })
    await queryClient.invalidateQueries({ queryKey: ["documents"] })
    await queryClient.invalidateQueries({ queryKey: ["receivables"] })
    await queryClient.invalidateQueries({ queryKey: ["stats"] })
    await queryClient.invalidateQueries({ queryKey: ["application-events"] })
  }

  const generate = useMutation({
    mutationFn: () => generateDocuments(application!.id),
    onSuccess: async () => {
      setError("")
      await invalidate()
      onNotify("Dokumen resmi berhasil dibuat dan siap dikirim ke pemohon.")
    },
    onError: (mutationError) => setError(errorText(mutationError)),
  })

  const changeStatus = useMutation({
    mutationFn: (input: {
      status: Application["status"]
      note?: string | null
    }) => setApplicationStatus(application!.id, input.status, input.note),
    onSuccess: async (_data, input) => {
      setError("")
      await invalidate()
      void flushNotifications()
      // The wet-signature stage keeps the dialog open: the upload happens here.
      if (input.status !== "Menunggu TTD Basah") onClose()
      onNotify(STATUS_MESSAGES[input.status] ?? "Status pengajuan diperbarui.")
    },
    onError: (mutationError) => setError(errorText(mutationError)),
  })

  const uploadScan = useMutation({
    mutationFn: (file: File) => uploadSignedScan(application!, file),
    onSuccess: async () => {
      setError("")
      await invalidate()
      void flushNotifications()
      onNotify("Scan dokumen lengkap tersimpan. Dana sudah bisa dicairkan.")
    },
    onError: (mutationError) => setError(errorText(mutationError)),
  })

  /**
   * Passing review is also the cue to print, so the document opens straight
   * away. The tab is claimed inside the click — opening it after the awaits
   * would be a popup the browser blocks. The HTML is written into the tab
   * rather than pointed at a signed URL: storage serves the document as an
   * attachment, which shows a blank tab and a download instead of the page.
   */
  const startWetSignature = () => {
    const printTab = window.open("about:blank", "_blank")

    changeStatus.mutate(
      { status: "Menunggu TTD Basah" },
      {
        onSuccess: async () => {
          try {
            const { html } = await fetchOfficialDocumentHtml(application!.id)
            writeHtmlToTab(html, printTab)
          } catch (openError) {
            printTab?.close()
            setError(
              `Status sudah diperbarui, tapi dokumen gagal dibuka: ${errorText(openError)}`
            )
          }
        },
        onError: () => printTab?.close(),
      }
    )
  }

  if (!application) return null

  const profile = application.profiles
  const sisaKontrak = remainingContract(application.contract_end)
  const busy =
    generate.isPending || changeStatus.isPending || uploadScan.isPending

  const canGenerate = ["Diajukan", "Diproses Admin", "Ditolak"].includes(
    application.status
  )
  const canSend = ["Diproses Admin", "Ditolak", "Menunggu Review"].includes(
    application.status
  )
  const canStartWetSignature = application.status === "Menunggu Review"
  const collectingWetSignature = application.status === "Menunggu TTD Basah"
  // The same rule is enforced by a database trigger; this only keeps the admin
  // from pressing a button that would fail.
  const hasSignedScan = Boolean(
    documents.data?.some((document) => document.kind === "ttd_scan")
  )
  const canDisburse = collectingWetSignature && hasSignedScan
  const canReject = [
    "Diajukan",
    "Diproses Admin",
    "Menunggu TTD",
    "Menunggu Review",
    "Menunggu TTD Basah",
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
                <span aria-hidden="true">·</span>
                <span>{application.jabatan}</span>
                {profile?.branch ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{profile.branch}</span>
                  </>
                ) : null}
                <span aria-hidden="true">·</span>
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
                  {application.tenure_months} bulan ·{" "}
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
                  <span className="font-semibold">Pengajuan revisi</span> —
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

              {/* Jabatan diisi pemohon sendiri dan menentukan limit pinjaman,
                  jadi ia ditonjolkan: review admin adalah satu-satunya tahap
                  yang bisa menangkap klaim jabatan yang keliru. */}
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
                  description="Satu file resmi berisi permohonan, persetujuan, dan penyerahan."
                />
                <DocumentList
                  applicationId={application.id}
                  emptyLabel="Belum ada dokumen. Klik “Generate dokumen” untuk membuat satu dokumen resmi."
                />
                {canStartWetSignature ? (
                  <p className="flex items-start gap-2 rounded-2xl bg-background/70 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                    <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                    Periksa “Scan TTD pemohon & atasan langsung” dulu: pastikan
                    tanda tangan pemohon dan kolom “Mengetahui” sudah terisi
                    sebelum dokumen diedarkan ke manajemen.
                  </p>
                ) : null}
              </section>

              {collectingWetSignature ? (
                <section className="space-y-3 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4 dark:border-indigo-900/70 dark:bg-indigo-950/30">
                  <DetailSectionHeading
                    icon={PenLine}
                    title="Tanda tangan basah"
                    description="Kumpulkan tanda tangan wakil ketua, ketua, sekretaris, dan bendahara, lalu unggah hasil scannya."
                  />
                  <p className="flex items-start gap-2 rounded-xl bg-background/70 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                    {hasSignedScan ? (
                      <>
                        <BadgeCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
                        Scan dokumen lengkap sudah diarsipkan. Dana siap
                        dicairkan — unggah lagi kalau ada versi perbaikan.
                      </>
                    ) : (
                      <>
                        <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                        Dana belum bisa dicairkan sebelum scan dokumen bertanda
                        tangan lengkap diunggah.
                      </>
                    )}
                  </p>
                  <input
                    ref={scanInputRef}
                    type="file"
                    accept="application/pdf,image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      event.target.value = ""
                      if (file) uploadScan.mutate(file)
                    }}
                  />
                  <Button
                    variant="outline"
                    className="w-full bg-background/80"
                    onClick={() => scanInputRef.current?.click()}
                    disabled={busy}
                  >
                    {uploadScan.isPending ? <Spinner /> : <Upload />}
                    {hasSignedScan
                      ? "Unggah ulang scan dokumen"
                      : "Unggah scan dokumen lengkap"}
                  </Button>
                </section>
              ) : null}

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
              {canStartWetSignature ? (
                <Button
                  className="w-full"
                  onClick={startWetSignature}
                  disabled={busy}
                >
                  {changeStatus.isPending ? <Spinner /> : <PenLine />}
                  Lolos review — buka dokumen untuk dicetak
                </Button>
              ) : null}

              {collectingWetSignature ? (
                <Button
                  className="w-full"
                  onClick={() =>
                    changeStatus.mutate({ status: "Disetujui / Cair" })
                  }
                  disabled={busy || !canDisburse}
                >
                  {changeStatus.isPending ? <Spinner /> : <BadgeCheck />}
                  {canDisburse
                    ? "Setujui dan cairkan dana"
                    : "Cairkan dana (perlu scan dokumen)"}
                </Button>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-2">
                {canGenerate ? (
                  <Button
                    variant={canSend ? "outline" : "default"}
                    className="w-full"
                    onClick={() => generate.mutate()}
                    disabled={busy}
                  >
                    {generate.isPending ? <Spinner /> : <FileCog />}
                    Generate dokumen
                  </Button>
                ) : null}

                {canSend ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() =>
                      changeStatus.mutate({ status: "Menunggu TTD" })
                    }
                    disabled={busy}
                  >
                    {changeStatus.isPending ? <Spinner /> : <Send />}
                    Kirim ke pemohon
                  </Button>
                ) : null}
              </div>

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
                <p className="rounded-2xl bg-muted/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                  Kasbon sudah dicairkan. Kelola pemotongan gaji dari menu Kartu
                  piutang — status Lunas terbentuk otomatis saat seluruh
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
  "Menunggu TTD": "Dokumen dikirim ke pemohon. Notifikasi email menyusul.",
  "Menunggu TTD Basah":
    "Dokumen dibuka di tab baru. Cetak, kumpulkan tanda tangan basah, lalu unggah scannya.",
  "Disetujui / Cair":
    "Kasbon disetujui. Kartu piutang dan jadwal angsuran otomatis dibuat.",
  Ditolak: "Pengajuan ditolak. Pemohon dapat merevisi dan mengajukan ulang.",
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
