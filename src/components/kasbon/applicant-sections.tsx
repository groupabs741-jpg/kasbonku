import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleDollarSign,
  FileText,
  Plus,
  ReceiptText,
  RotateCcw,
  UploadCloud,
  WalletCards,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  Metric,
  PageIntro,
  ProgressStepper,
  StatCard,
  StatusBadge,
  fieldClassName,
} from "@/components/kasbon/shared"
import { DocumentList } from "@/components/kasbon/document-list"
import { fetchInstallments } from "@/lib/api"
import { formatCurrency, formatDate } from "@/lib/format"
import { ACTIVE_STATUSES, statusNarrative } from "@/lib/kasbon"
import type { Application, Receivable } from "@/lib/kasbon"

type ApplicantData = {
  applications: Application[]
  receivables: Receivable[]
  isPending: boolean
  error: unknown
}

type ApplicantActions = {
  onNewApplication: () => void
  onOpenApplication: (application: Application) => void
  onUploadSignature: (application: Application) => void
  onRevise: (application: Application) => void
}

function ApplicationCard({
  application,
  onDetail,
  onUpload,
  onRevise,
}: {
  application: Application
  onDetail: () => void
  onUpload: () => void
  onRevise: () => void
}) {
  return (
    <Card className="border-border/80 shadow-none">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
              <FileText className="size-4.5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{application.code}</p>
                <StatusBadge status={application.status} />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Diajukan {formatDate(application.submitted_at)}
              </p>
              <p className="mt-2 text-sm text-foreground/80">
                {application.reason_category}
              </p>
            </div>
          </div>
          {/* Blok kanan membungkus (`flex-wrap`): saat kartu berada di kolom
              sempit dan metrik + tombol tak muat sebaris, grup tombol turun ke
              bawah metrik alih-alih menindih nilai Angsuran. Metrik memakai
              `whitespace-nowrap` supaya tidak pernah terpotong. */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border/70 pt-3 sm:justify-end lg:border-t-0 lg:pt-0">
            <div className="grid grid-cols-2 gap-x-8 gap-y-1">
              <div>
                <p className="text-xs text-muted-foreground">Nominal</p>
                <p className="mt-1 text-sm font-semibold whitespace-nowrap">
                  {formatCurrency(application.amount)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Angsuran</p>
                <p className="mt-1 text-sm font-semibold whitespace-nowrap">
                  {formatCurrency(application.monthly_installment)} / bln
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 max-sm:ml-auto">
              <Button variant="outline" size="sm" onClick={onDetail}>
                Detail
              </Button>
              {application.status === "Menunggu TTD" ? (
                <Button
                  size="sm"
                  className="whitespace-nowrap"
                  onClick={onUpload}
                >
                  Unggah dokumen TTD
                </Button>
              ) : null}
              {application.status === "Ditolak" ? (
                <Button size="sm" onClick={onRevise}>
                  Revisi
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Kartu "Progress Pengajuan" — landing view utama pemohon. Stepper horizontal
 * menampilkan tahap pengajuan yang sedang berjalan beserta tombol aksi
 * kontekstual sesuai status aktif (upload TTD, revisi, atau ajukan baru).
 */
function ProgressPengajuanCard({
  openApplication,
  rejected,
  actions,
}: {
  /** Pengajuan yang masih berjalan (ACTIVE_STATUSES), jika ada. */
  openApplication: Application | null
  /** Pengajuan ditolak yang menunggu revisi — hanya saat tak ada yang berjalan. */
  rejected: Application | null
  actions: ApplicantActions
}) {
  // Kasbon yang sudah cair dan masih diangsur menahan pengajuan baru.
  const running = openApplication?.status === "Disetujui / Cair"
  const stepperApplication = openApplication ?? rejected
  const badgeStatus = stepperApplication?.status ?? null

  return (
    <Card className="border-primary/15 bg-primary/[0.03] shadow-none">
      <CardHeader className="border-b border-border/70 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">Progress pengajuan</CardTitle>
            <CardDescription className="mt-1">
              {openApplication
                ? `Posisi pengajuan ${openApplication.code} saat ini.`
                : rejected
                  ? `Pengajuan ${rejected.code} ditolak dan menunggu revisi kamu.`
                  : "Belum ada pengajuan yang sedang berjalan."}
            </CardDescription>
          </div>
          {badgeStatus ? <StatusBadge status={badgeStatus} /> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-5">
        {stepperApplication ? (
          <ProgressStepper status={stepperApplication.status} />
        ) : null}

        {openApplication ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {statusNarrative(openApplication.status)}
          </p>
        ) : rejected ? (
          <div className="flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              {rejected.admin_note ? (
                <>
                  <strong className="font-medium">Catatan admin:</strong>{" "}
                  {rejected.admin_note}
                </>
              ) : (
                "Pengajuan ditolak. Revisi datanya lalu ajukan ulang."
              )}
            </span>
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-muted-foreground">
            Ajukan kasbon untuk mulai melacak prosesnya di kartu ini.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {openApplication?.status === "Menunggu TTD" ? (
            <Button onClick={() => actions.onUploadSignature(openApplication)}>
              <UploadCloud />
              Unggah dokumen TTD
            </Button>
          ) : null}

          {rejected ? (
            <Button onClick={() => actions.onRevise(rejected)}>
              <RotateCcw />
              Revisi & ajukan ulang
            </Button>
          ) : null}

          {!openApplication && !rejected ? (
            <Button onClick={actions.onNewApplication}>
              <Plus />
              Ajukan kasbon baru
            </Button>
          ) : null}

          {running ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex" />}>
                  <Button disabled>
                    <Plus />
                    Ajukan kasbon baru
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Selesaikan kasbon yang sedang berjalan dulu sebelum mengajukan
                  lagi.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}

          {openApplication ? (
            <Button
              variant="ghost"
              onClick={() => actions.onOpenApplication(openApplication)}
            >
              Lihat detail
              <ChevronRight />
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

export function ApplicantOverview({
  data,
  actions,
  firstName,
}: {
  data: ApplicantData
  actions: ApplicantActions
  firstName: string
}) {
  if (data.isPending) return <LoadingBlock />
  if (data.error) return <ErrorBlock error={data.error} />

  const openApplication = data.applications.find((item) =>
    ACTIVE_STATUSES.includes(item.status)
  )
  // Only surface a rejected application for action when nothing is in flight; a
  // revision starts a fresh submission, so this is the one actionable reject.
  const rejectedActionable = openApplication
    ? null
    : (data.applications.find((item) => item.status === "Ditolak") ?? null)
  const activeReceivable = data.receivables.find(
    (item) => item.status === "Aktif"
  )
  const settledCount = data.applications.filter(
    (item) => item.status === "Lunas"
  ).length

  return (
    <div className="space-y-6">
      <PageIntro
        title={`Halo, ${firstName}.`}
        description="Pantau progress pengajuan dan potongan angsuran dari satu ruang kerja."
      />

      <ProgressPengajuanCard
        openApplication={openApplication ?? null}
        rejected={rejectedActionable}
        actions={actions}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Kasbon aktif"
          value={
            activeReceivable ? formatCurrency(activeReceivable.principal) : "—"
          }
          detail={
            activeReceivable
              ? `${activeReceivable.paid_months}/${activeReceivable.tenure_months} angsuran selesai`
              : "Tidak ada kasbon berjalan"
          }
          icon={WalletCards}
        />
        <StatCard
          label="Sisa piutang"
          value={
            activeReceivable
              ? formatCurrency(activeReceivable.remaining)
              : formatCurrency(0)
          }
          detail={
            activeReceivable
              ? `${activeReceivable.tenure_months - activeReceivable.paid_months} bulan tersisa`
              : "Semua kasbon lunas"
          }
          icon={CircleDollarSign}
        />
        <StatCard
          label="Angsuran per bulan"
          value={
            activeReceivable
              ? formatCurrency(activeReceivable.monthly_installment)
              : "—"
          }
          detail="Dipotong langsung dari gaji"
          icon={CalendarDays}
        />
        <StatCard
          label="Riwayat pengajuan"
          value={`${data.applications.length} pengajuan`}
          detail={`${settledCount} lunas`}
          icon={FileText}
        />
      </div>
    </div>
  )
}

export function ApplicantApplications({
  data,
  actions,
}: {
  data: ApplicantData
  actions: ApplicantActions
}) {
  const [filter, setFilter] = React.useState("all")

  if (data.isPending) return <LoadingBlock />
  if (data.error) return <ErrorBlock error={data.error} />

  const needsAction = data.applications.filter(
    (item) => item.status === "Menunggu TTD" || item.status === "Ditolak"
  )
  const visible = filter === "action" ? needsAction : data.applications
  const canApply = !data.applications.some((item) =>
    ACTIVE_STATUSES.includes(item.status)
  )

  return (
    <div className="space-y-6">
      <PageIntro
        title="Riwayat pengajuan"
        description="Semua pengajuan tersimpan di sini, termasuk yang sudah selesai dan ditolak."
        action={
          <Button onClick={actions.onNewApplication} disabled={!canApply}>
            <Plus />
            Ajukan kasbon
          </Button>
        }
      />

      <Tabs value={filter} onValueChange={setFilter} className="gap-5">
        <TabsList>
          <TabsTrigger value="all">Semua pengajuan</TabsTrigger>
          <TabsTrigger value="action">
            Butuh tindakan
            {needsAction.length > 0 ? ` (${needsAction.length})` : ""}
          </TabsTrigger>
        </TabsList>
        <TabsContent value={filter} className="space-y-3">
          {visible.length === 0 ? (
            <EmptyState
              icon={FileText}
              title={
                filter === "action"
                  ? "Tidak ada yang perlu ditindaklanjuti"
                  : "Belum ada pengajuan"
              }
              description={
                filter === "action"
                  ? "Semua pengajuan kamu sedang dalam proses review."
                  : "Ajukan kasbon pertama kamu untuk mulai melacak prosesnya di sini."
              }
            />
          ) : (
            visible.map((application) => (
              <ApplicationCard
                key={application.id}
                application={application}
                onDetail={() => actions.onOpenApplication(application)}
                onUpload={() => actions.onUploadSignature(application)}
                onRevise={() => actions.onRevise(application)}
              />
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ReceivableCard({ receivable }: { receivable: Receivable }) {
  const installments = useQuery({
    queryKey: ["installments", receivable.id],
    queryFn: () => fetchInstallments(receivable.id),
  })

  const progress = Math.round(
    (receivable.paid_months / receivable.tenure_months) * 100
  )

  return (
    <Card className="border-border/80 shadow-none">
      <CardHeader className="border-b border-border/70 pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base">
              {receivable.applications?.code ?? "Kartu piutang"}
            </CardTitle>
            <CardDescription className="mt-1">
              Dicairkan {formatDate(receivable.disbursed_on)} ·{" "}
              {receivable.tenure_months} bulan
            </CardDescription>
          </div>
          <StatusBadge
            status={receivable.status === "Lunas" ? "Lunas" : "Aktif"}
          />
        </div>
      </CardHeader>
      <CardContent className="grid gap-6 p-5 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="space-y-5">
          <div className="rounded-2xl bg-primary/[0.06] p-4">
            <p className="text-xs text-muted-foreground">Sisa piutang</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight">
              {formatCurrency(receivable.remaining)}
            </p>
            <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {receivable.paid_months} dari {receivable.tenure_months} bulan
                selesai
              </span>
              <span>{progress}%</span>
            </div>
            <Progress value={progress} className="mt-2 gap-0" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Metric
              label="Pokok pinjaman"
              value={formatCurrency(receivable.principal)}
            />
            <Metric
              label="Angsuran pokok"
              value={formatCurrency(receivable.monthly_installment)}
            />
            <Metric
              label="Admin provisi"
              value={formatCurrency(receivable.provisi_fee)}
            />
            <Metric
              label="Admin bulanan"
              value={formatCurrency(receivable.monthly_admin_fee)}
            />
          </div>
        </div>
        <div className="rounded-2xl border border-border/70 p-2 sm:p-3">
          {installments.isPending ? (
            <LoadingBlock label="Memuat rincian angsuran…" />
          ) : installments.isError ? (
            <ErrorBlock error={installments.error} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bulan</TableHead>
                    <TableHead>Jatuh tempo</TableHead>
                    <TableHead>Nominal</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {installments.data.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">
                        {row.month_no}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(row.due_date)}
                      </TableCell>
                      <TableCell>{formatCurrency(row.amount)}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            row.status === "Sudah Dipotong"
                              ? "border-primary/20 bg-primary/5 text-primary"
                              : "border-border text-muted-foreground"
                          }
                        >
                          {row.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </CardContent>
      <CardFooter className="border-t border-border/70 px-5 py-4 text-xs text-muted-foreground">
        Data angsuran diperbarui admin sesuai potongan gaji aktual.
      </CardFooter>
    </Card>
  )
}

export function ApplicantInstallments({ data }: { data: ApplicantData }) {
  if (data.isPending) return <LoadingBlock />
  if (data.error) return <ErrorBlock error={data.error} />

  const active = data.receivables.filter((item) => item.status === "Aktif")
  const settled = data.receivables.filter((item) => item.status === "Lunas")

  return (
    <div className="space-y-6">
      <PageIntro
        title="Angsuran & kartu piutang"
        description="Kartu piutang read-only milikmu: nominal pokok, biaya admin, rincian per bulan, dan sisa piutang yang dikelola admin."
      />
      <Tabs defaultValue="active" className="gap-5">
        <TabsList>
          <TabsTrigger value="active">
            Kasbon aktif ({active.length})
          </TabsTrigger>
          <TabsTrigger value="history">
            Riwayat lunas ({settled.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="active" className="space-y-4">
          {active.length === 0 ? (
            <EmptyState
              icon={ReceiptText}
              title="Belum ada kasbon berjalan"
              description="Kartu piutang muncul otomatis setelah dana kasbon dicairkan admin."
            />
          ) : (
            active.map((receivable) => (
              <ReceivableCard key={receivable.id} receivable={receivable} />
            ))
          )}
        </TabsContent>
        <TabsContent value="history" className="space-y-4">
          {settled.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="Belum ada kasbon lunas"
              description="Kasbon yang seluruh angsurannya selesai akan tercatat di sini."
            />
          ) : (
            settled.map((receivable) => (
              <ReceivableCard key={receivable.id} receivable={receivable} />
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

export function ApplicantDocuments({ data }: { data: ApplicantData }) {
  const [selectedId, setSelectedId] = React.useState<string>("")

  if (data.isPending) return <LoadingBlock />
  if (data.error) return <ErrorBlock error={data.error} />

  if (data.applications.length === 0) {
    return (
      <div className="space-y-6">
        <PageIntro
          title="Dokumen"
          description="Dokumen pengajuan yang diterima, perlu ditandatangani, dan sudah selesai."
        />
        <EmptyState
          icon={FileText}
          title="Belum ada dokumen"
          description="Dokumen resmi muncul otomatis begitu kamu mengirim pengajuan."
        />
      </div>
    )
  }

  const selected =
    data.applications.find((item) => item.id === selectedId) ??
    data.applications[0]

  return (
    <div className="space-y-6">
      <PageIntro
        title="Dokumen"
        description="Dokumen pengajuan yang diterima, perlu ditandatangani, dan sudah selesai."
      />
      <Card className="border-border/80 shadow-none">
        <CardHeader className="border-b border-border/70 pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Pilih pengajuan</CardTitle>
              <CardDescription className="mt-1">
                Setiap pengajuan memiliki satu dokumen resmi yang memuat tiga
                bagian.
              </CardDescription>
            </div>
            <Select
              value={selected.id}
              onValueChange={(value) => value && setSelectedId(value)}
            >
              <SelectTrigger className={`${fieldClassName} sm:w-64`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {data.applications.map((application) => (
                  <SelectItem key={application.id} value={application.id}>
                    {application.code} · {application.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-5">
          <DocumentList
            applicationId={selected.id}
            emptyLabel="Dokumen resmi sedang disiapkan. Muat ulang sebentar lagi."
          />
        </CardContent>
        <CardFooter className="border-t border-border/70 px-5 py-4 text-xs leading-relaxed text-muted-foreground">
          Tanda tangan pemohon ditempatkan langsung ke file yang sama, lalu
          dokumen dicetak untuk tanda tangan basah atasan langsung. Kolom Wakil
          Ketua, Ketua, Sekretaris, dan Bendahara diisi belakangan oleh admin.
        </CardFooter>
      </Card>
    </div>
  )
}
