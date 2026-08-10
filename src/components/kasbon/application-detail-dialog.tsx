import { useQuery } from "@tanstack/react-query"
import { CircleAlert, RotateCcw, UploadCloud } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { Metric, StatusBadge, StatusTimeline } from "@/components/kasbon/shared"
import { DocumentList } from "@/components/kasbon/document-list"
import { fetchApplicationEvents } from "@/lib/api"
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format"
import { remainingContract } from "@/lib/kasbon"
import type { Application } from "@/lib/kasbon"

export function ApplicationDetailDialog({
  application,
  onClose,
  onUploadSignature,
  onRevise,
}: {
  application: Application | null
  onClose: () => void
  onUploadSignature: (application: Application) => void
  onRevise: (application: Application) => void
}) {
  const events = useQuery({
    queryKey: ["application-events", application?.id],
    queryFn: () => fetchApplicationEvents(application!.id),
    enabled: Boolean(application),
  })

  if (!application) return null

  const sisaKontrak = remainingContract(application.contract_end)

  return (
    <Dialog
      open={Boolean(application)}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-w-2xl p-0">
        <div className="max-h-[85vh] overflow-y-auto">
          <DialogHeader className="border-b border-border/70 p-6 pr-12">
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>{application.code}</DialogTitle>
              <StatusBadge status={application.status} />
            </div>
            <DialogDescription className="mt-1">
              Diajukan {formatDate(application.submitted_at)} · {application.jabatan}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 p-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <Metric
                label="Nominal pengajuan"
                value={formatCurrency(application.amount)}
                highlight
              />
              <Metric label="Jangka waktu" value={`${application.tenure_months} bulan`} />
              <Metric
                label="Angsuran pokok / bulan"
                value={formatCurrency(application.monthly_installment)}
              />
              <Metric
                label="Dana cair"
                value={formatCurrency(application.net_disbursement)}
              />
              <Metric label="Provisi 1,5%" value={formatCurrency(application.provisi_fee)} />
              <Metric
                label="Admin bulanan 1%"
                value={formatCurrency(application.monthly_admin_fee)}
              />
            </div>

            <div className="rounded-2xl bg-muted/60 p-4">
              <p className="text-xs text-muted-foreground">Alasan permohonan</p>
              <p className="mt-1 text-sm font-medium">{application.reason_category}</p>
              {application.reason_detail ? (
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {application.reason_detail}
                </p>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Metric
                label="Masa kontrak"
                value={`${formatDate(application.contract_start)} – ${formatDate(application.contract_end)}`}
                valueClassName="text-xs"
              />
              <Metric label="Sisa kontrak saat pengajuan" value={sisaKontrak.label} />
              <Metric label="No. Telp" value={application.phone} />
              <Metric label="No. Telp keluarga" value={application.family_phone} />
            </div>

            {application.status === "Ditolak" && application.admin_note ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40">
                <div className="flex items-start gap-3">
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-300" />
                  <div>
                    <p className="text-sm font-medium text-red-900 dark:text-red-200">
                      Catatan admin
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-red-800 dark:text-red-200/80">
                      {application.admin_note}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            <Separator />

            <div>
              <p className="text-sm font-medium">Dokumen</p>
              <div className="mt-3">
                <DocumentList
                  applicationId={application.id}
                  emptyLabel="Dokumen resmi akan muncul setelah admin memprosesnya."
                />
              </div>
            </div>

            <Separator />

            <div>
              <p className="text-sm font-medium">Tahap pengajuan</p>
              <div className="mt-4">
                <StatusTimeline status={application.status} />
              </div>
            </div>

            {events.data && events.data.length > 0 ? (
              <div>
                <p className="text-sm font-medium">Riwayat proses</p>
                <ul className="mt-3 space-y-2">
                  {events.data.map((event) => (
                    <li
                      key={event.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/50 px-3 py-2 text-xs"
                    >
                      <span className="font-medium">
                        {event.from_status
                          ? `${event.from_status} → ${event.to_status}`
                          : event.to_status}
                      </span>
                      <span className="text-muted-foreground">
                        {formatDateTime(event.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <DialogFooter className="border-t border-border/70 p-6">
            <Button variant="outline" onClick={onClose}>
              Tutup
            </Button>
            {application.status === "Menunggu TTD" ? (
              <Button
                onClick={() => {
                  onClose()
                  onUploadSignature(application)
                }}
              >
                <UploadCloud /> Tanda tangan & unggah
              </Button>
            ) : null}
            {application.status === "Ditolak" ? (
              <Button
                onClick={() => {
                  onClose()
                  onRevise(application)
                }}
              >
                <RotateCcw /> Revisi dan ajukan ulang
              </Button>
            ) : null}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
