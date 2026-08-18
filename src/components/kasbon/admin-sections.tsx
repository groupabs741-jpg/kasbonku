import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Download,
  FilePlus2,
  FileSpreadsheet,
  Filter,
  Search,
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
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ApplicantAvatar,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  Metric,
  PageIntro,
  StatCard,
  StatusBadge,
} from "@/components/kasbon/shared"
import {
  downloadReport,
  fetchInstallments,
  fetchInstallmentsFor,
  setInstallmentStatus,
} from "@/lib/api"
import {
  formatCompactCurrency,
  formatCurrency,
  formatDate,
  toDateInput,
} from "@/lib/format"
import type {
  Application,
  DashboardStats,
  Installment,
  Receivable,
} from "@/lib/kasbon"
import type { ReportType } from "@/lib/api"
import { cn } from "@/lib/utils"

type AdminData = {
  applications: Application[]
  receivables: Receivable[]
  stats: DashboardStats | undefined
  isPending: boolean
  error: unknown
}

const NEEDS_ACTION: Application["status"][] = [
  "Diajukan",
  "Menunggu Review",
]

export function AdminOverview({
  data,
  onOpenApplication,
  onOpenSection,
}: {
  data: AdminData
  onOpenApplication: (application: Application) => void
  onOpenSection: (section: "pengajuan" | "piutang" | "laporan") => void
}) {
  if (data.isPending) return <LoadingBlock />
  if (data.error) return <ErrorBlock error={data.error} />

  const stats = data.stats
  const queue = data.applications.filter((item) =>
    NEEDS_ACTION.includes(item.status)
  )

  return (
    <div className="space-y-6">
      <PageIntro
        title="Ringkasan operasional"
        description="Pantau pengajuan masuk, review dokumen, dan piutang berjalan ABS Group."
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total pengajuan"
          value={String(stats?.applications_total ?? 0)}
          detail={`${queue.length} perlu tindakan`}
          icon={FilePlus2}
        />
        <StatCard
          label="Menunggu review"
          value={String(stats?.applications_review ?? 0)}
          detail="Dokumen TTD masuk"
          icon={ClipboardCheck}
        />
        <StatCard
          label="Piutang berjalan"
          value={formatCompactCurrency(stats?.outstanding_total ?? 0)}
          detail={`${stats?.receivables_active ?? 0} kartu aktif`}
          icon={WalletCards}
        />
        <StatCard
          label="Biaya admin terkumpul"
          value={formatCompactCurrency(stats?.admin_fee_total ?? 0)}
          detail="Provisi + admin bulanan"
          icon={CircleDollarSign}
        />
      </div>

      <Card className="border-border/80 shadow-none">
        <CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-border/70 pb-4">
          <div>
            <CardTitle className="text-base">Perlu tindakan</CardTitle>
            <CardDescription className="mt-1">
              Pengajuan yang menunggu diproses atau direview admin.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenSection("pengajuan")}
          >
            Semua pengajuan
            <ChevronRight />
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {queue.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">
              Semua pengajuan sudah ditindaklanjuti.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pemohon</TableHead>
                    <TableHead>Pengajuan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queue.slice(0, 5).map((application) => (
                    <TableRow key={application.id}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <ApplicantAvatar
                            name={application.profiles?.full_name}
                            size="default"
                          />
                          <div>
                            <p className="font-medium">
                              {application.profiles?.full_name ?? "—"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {application.profiles?.branch ??
                                application.jabatan}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">
                          {formatCurrency(application.amount)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {application.code}
                        </p>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={application.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onOpenApplication(application)}
                        >
                          Buka
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export function AdminApplications({
  data,
  onOpenApplication,
}: {
  data: AdminData
  onOpenApplication: (application: Application) => void
}) {
  const [filter, setFilter] = React.useState<"all" | "action" | "active">("all")
  const [query, setQuery] = React.useState("")

  if (data.isPending) return <LoadingBlock />
  if (data.error) return <ErrorBlock error={data.error} />

  const normalizedQuery = query.trim().toLowerCase()
  const filtered = data.applications.filter((application) => {
    const matchesFilter =
      filter === "all" ||
      (filter === "action"
        ? NEEDS_ACTION.includes(application.status) ||
          application.status === "Menunggu TTD"
        : application.status === "Disetujui / Cair")
    const matchesQuery =
      !normalizedQuery ||
      (application.profiles?.full_name ?? "")
        .toLowerCase()
        .includes(normalizedQuery) ||
      application.code.toLowerCase().includes(normalizedQuery)
    return matchesFilter && matchesQuery
  })

  return (
    <div className="space-y-6">
      <PageIntro
        title="Semua pengajuan"
        description="Review data pemohon, kirim dokumen, dan kelola status setiap pengajuan."
      />
      <Card className="border-border/80 shadow-none">
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari nama atau nomor pengajuan"
              className="h-10 rounded-2xl pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={filter === "all" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setFilter("all")}
            >
              Semua
            </Button>
            <Button
              variant={filter === "action" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setFilter("action")}
            >
              <Filter /> Perlu tindakan
            </Button>
            <Button
              variant={filter === "active" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setFilter("active")}
            >
              <CircleDollarSign /> Cair
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card className="border-border/80 shadow-none">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-12 text-center">
              <Search className="size-5 text-muted-foreground" />
              <p className="text-sm font-medium">Pengajuan tidak ditemukan</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Ubah kata kunci atau filter untuk melihat data lain.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pemohon</TableHead>
                    <TableHead>Nominal</TableHead>
                    <TableHead>Alasan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Diajukan</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((application) => (
                    <TableRow key={application.id}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <ApplicantAvatar
                            name={application.profiles?.full_name}
                            size="default"
                          />
                          <div>
                            <p className="font-medium">
                              {application.profiles?.full_name ?? "—"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {application.jabatan}
                              {application.profiles?.branch
                                ? ` · ${application.profiles.branch}`
                                : ""}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">
                        {formatCurrency(application.amount)}
                      </TableCell>
                      <TableCell className="max-w-48 truncate text-muted-foreground">
                        {application.reason_category}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={application.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(application.submitted_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onOpenApplication(application)}
                        >
                          Buka detail
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ReceivableDetail({
  receivable,
  onNotify,
}: {
  receivable: Receivable
  onNotify: (message: string) => void
}) {
  const queryClient = useQueryClient()
  const [error, setError] = React.useState("")

  const installments = useQuery({
    queryKey: ["installments", receivable.id],
    queryFn: () => fetchInstallments(receivable.id),
  })

  const toggle = useMutation({
    mutationFn: setInstallmentStatus,
    onSuccess: async (row) => {
      setError("")
      await queryClient.invalidateQueries({
        queryKey: ["installments", receivable.id],
      })
      await queryClient.invalidateQueries({ queryKey: ["receivables"] })
      await queryClient.invalidateQueries({ queryKey: ["applications"] })
      await queryClient.invalidateQueries({ queryKey: ["stats"] })
      onNotify(
        `Angsuran bulan ${row.month_no} ditandai "${row.status}" untuk ${
          receivable.profiles?.full_name ?? "karyawan"
        }.`
      )
    },
    onError: (mutationError) =>
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : String(mutationError)
      ),
  })

  return (
    <Card className="border-border/80 shadow-none">
      <CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-border/70 pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">
              {receivable.profiles?.full_name ?? "Karyawan"}
            </CardTitle>
            <StatusBadge
              status={receivable.status === "Lunas" ? "Lunas" : "Aktif"}
            />
          </div>
          <CardDescription className="mt-1">
            {receivable.profiles?.jabatan ?? "-"}
            {receivable.profiles?.branch
              ? ` · ${receivable.profiles.branch}`
              : ""}{" "}
            · {receivable.applications?.code ?? ""}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Pokok pinjaman"
            value={formatCurrency(receivable.principal)}
          />
          <Metric
            label="Admin provisi"
            value={formatCurrency(receivable.provisi_fee)}
          />
          <Metric
            label="Angsuran / bulan"
            value={formatCurrency(receivable.monthly_installment)}
          />
          <Metric
            label="Sisa piutang"
            value={formatCurrency(receivable.remaining)}
            highlight
          />
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-2xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}

        {installments.isPending ? (
          <LoadingBlock label="Memuat rincian angsuran…" />
        ) : installments.isError ? (
          <ErrorBlock error={installments.error} />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border/70">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bulan</TableHead>
                  <TableHead>Jatuh tempo</TableHead>
                  <TableHead>Nominal</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Dipotong</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {installments.data.map((row) => {
                  const isPaid = row.status === "Sudah Dipotong"
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium whitespace-nowrap">
                        Bulan {row.month_no}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(row.due_date)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatCurrency(row.amount)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            isPaid
                              ? "border-primary/20 bg-primary/5 text-primary"
                              : "text-muted-foreground"
                          }
                        >
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {row.paid_on ? formatDate(row.paid_on) : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={toggle.isPending}
                          onClick={() =>
                            toggle.mutate({
                              id: row.id,
                              status: isPaid
                                ? "Belum Dipotong"
                                : "Sudah Dipotong",
                            })
                          }
                        >
                          {isPaid ? "Batalkan" : "Tandai dipotong"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      <CardFooter className="border-t border-border/70 px-5 py-4 text-xs leading-relaxed text-muted-foreground">
        Kartu otomatis berubah ke “Lunas” — dan status pengajuan pemohon ikut —
        saat seluruh angsuran ditandai sudah dipotong.
      </CardFooter>
    </Card>
  )
}

const monthHeaderFmt = new Intl.DateTimeFormat("id-ID", {
  month: "short",
  year: "numeric",
})

const monthKeyOf = (dueDate: string) => dueDate.slice(0, 7)
const monthHeaderLabel = (key: string) =>
  monthHeaderFmt.format(new Date(`${key}-01T00:00:00`))

/**
 * Tampilan grid ala Excel: satu baris per karyawan, dikelompokkan per batch
 * pencairan (semua yang cair di tanggal sama = satu batch), dengan satu kolom
 * per bulan jatuh tempo. Klik sel bulan menandai angsuran "Sudah/Belum
 * Dipotong" — meniru kebiasaan mewarnai sel di Excel. Baris TOTAL dan Subtotal
 * per batch dihitung ulang otomatis.
 */
function ReceivablesGrid({
  receivables,
  totalCount,
  onNotify,
  onOpenCard,
}: {
  receivables: Receivable[]
  totalCount: number
  onNotify: (message: string) => void
  onOpenCard: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const [error, setError] = React.useState("")

  const ids = React.useMemo(
    () => receivables.map((item) => item.id).sort(),
    [receivables]
  )

  const installments = useQuery({
    queryKey: ["installments-grid", ids.join(",")],
    queryFn: () => fetchInstallmentsFor(ids),
    enabled: ids.length > 0,
  })

  const toggle = useMutation({
    mutationFn: setInstallmentStatus,
    onSuccess: async (row) => {
      setError("")
      await queryClient.invalidateQueries({ queryKey: ["installments-grid"] })
      await queryClient.invalidateQueries({ queryKey: ["installments"] })
      await queryClient.invalidateQueries({ queryKey: ["receivables"] })
      await queryClient.invalidateQueries({ queryKey: ["applications"] })
      await queryClient.invalidateQueries({ queryKey: ["stats"] })
      onNotify(`Angsuran bulan ${row.month_no} ditandai "${row.status}".`)
    },
    onError: (mutationError) =>
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : String(mutationError)
      ),
  })

  const rows = installments.data ?? []

  // receivable_id -> (monthKey -> installment), untuk lookup sel O(1).
  const byReceivable = React.useMemo(() => {
    const map = new Map<string, Map<string, Installment>>()
    for (const inst of rows) {
      let months = map.get(inst.receivable_id)
      if (!months) {
        months = new Map()
        map.set(inst.receivable_id, months)
      }
      months.set(monthKeyOf(inst.due_date), inst)
    }
    return map
  }, [rows])

  // Gabungan semua bulan jatuh tempo dari kartu yang tampil, jadi kolom bulan.
  const monthColumns = React.useMemo(() => {
    const set = new Set<string>()
    for (const inst of rows) set.add(monthKeyOf(inst.due_date))
    return [...set].sort()
  }, [rows])

  // Kelompokkan kartu per tanggal pencairan; itulah "batch" di Excel.
  const batches = React.useMemo(() => {
    const map = new Map<string, Receivable[]>()
    for (const item of receivables) {
      const group = map.get(item.disbursed_on) ?? []
      group.push(item)
      map.set(item.disbursed_on, group)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [receivables])

  const todayStr = toDateInput(new Date())

  const adm2Of = (item: Receivable) =>
    item.monthly_admin_fee * item.tenure_months
  const monthTotalOf = (list: Receivable[], key: string) =>
    list.reduce((total, item) => {
      const inst = byReceivable.get(item.id)?.get(key)
      return total + (inst ? inst.amount : 0)
    }, 0)
  const sumOf = (list: Receivable[], pick: (item: Receivable) => number) =>
    list.reduce((total, item) => total + pick(item), 0)
  // Sel uang pakai format Rp (konsisten dgn kartu detail & laporan).
  const num = (value: number) => formatCurrency(Math.round(value))

  // BATCH + NO + NAMA + 7 kolom finansial; dipakai untuk colSpan baris header.
  const FIXED_COLS = 10

  if (installments.isPending) {
    return <LoadingBlock label="Memuat grid piutang…" />
  }
  if (installments.isError) {
    return <ErrorBlock error={installments.error} />
  }
  if (receivables.length === 0) {
    return (
      <p className="rounded-2xl border border-border/70 p-8 text-center text-sm text-muted-foreground">
        Tidak ada kartu yang cocok dengan filter ini.
      </p>
    )
  }

  const headBase =
    "sticky top-0 z-20 overflow-hidden text-ellipsis whitespace-nowrap border-b border-border bg-muted px-3 py-2 text-[11px] font-semibold tracking-wide text-muted-foreground"
  // Baris grup (label "ANGSURAN") tidak sticky-top: dia menggulung, baris label
  // di bawahnya yang tetap menempel di atas.
  const groupHeadBase =
    "whitespace-nowrap border-b border-border bg-muted px-3 py-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground"
  const cellBase =
    "overflow-hidden text-ellipsis whitespace-nowrap border-b border-border/60 px-3 py-2 text-sm"
  const numCell = cn(cellBase, "text-right tabular-nums")

  // Lebar setiap kolom eksplisit + tabel `table-fixed` (lihat <colgroup>): kolom
  // persis selebar ini, jadi sel beku (sticky) tak pernah melebihi kolomnya atau
  // menutupi header sebelah, dan offset kiri NAMA pasti = batch + no.
  const COL_W = {
    batch: 64,
    no: 48,
    name: 264,
    tgl: 140,
    adm1: 116,
    adm2: 128,
    lama: 132,
    angs: 152,
    pinjaman: 140,
    sisa: 144,
    month: 138,
  }
  const fixedCols = [
    COL_W.batch,
    COL_W.no,
    COL_W.name,
    COL_W.tgl,
    COL_W.adm1,
    COL_W.adm2,
    COL_W.lama,
    COL_W.angs,
    COL_W.pinjaman,
    COL_W.sisa,
  ]
  const tableWidth =
    fixedCols.reduce((sum, w) => sum + w, 0) + monthColumns.length * COL_W.month

  // Freeze pane kiri (ala Excel): BATCH, NO, NAMA menempel saat scroll horizontal.
  const frozen: Record<"batch" | "no" | "name", { left: number }> = {
    batch: { left: 0 },
    no: { left: COL_W.batch },
    name: { left: COL_W.batch + COL_W.no },
  }
  const frozenStyle = (col: keyof typeof frozen): React.CSSProperties => ({
    left: frozen[col].left,
  })

  const FrozenCell = ({
    col,
    children,
    bg,
    align,
    className,
  }: {
    col: keyof typeof frozen
    children?: React.ReactNode
    bg: string
    align?: "left" | "right"
    className?: string
  }) => (
    <td
      className={cn(
        cellBase,
        "sticky z-10",
        align === "right" ? "text-right tabular-nums" : "text-left",
        bg,
        className
      )}
      style={frozenStyle(col)}
    >
      {children}
    </td>
  )

  const NameCell = ({
    children,
    bg,
    className,
  }: {
    children: React.ReactNode
    bg: string
    className?: string
  }) => (
    <FrozenCell col="name" bg={bg} className={className}>
      {children}
    </FrozenCell>
  )

  const renderMonthCell = (item: Receivable, key: string, rowBg: string) => {
    const inst = byReceivable.get(item.id)?.get(key)
    if (!inst) return <td key={key} className={cn(cellBase, rowBg)} />
    const paid = inst.status === "Sudah Dipotong"
    const overdue = !paid && inst.due_date <= todayStr
    return (
      <td key={key} className={cn("border-b border-border/60 p-0", rowBg)}>
        <button
          type="button"
          disabled={toggle.isPending}
          title={`Bulan ${inst.month_no} · ${formatDate(inst.due_date)} · ${inst.status}`}
          onClick={() =>
            toggle.mutate({
              id: inst.id,
              status: paid ? "Belum Dipotong" : "Sudah Dipotong",
            })
          }
          className={cn(
            "flex w-full items-center justify-end px-3 py-2 text-right text-sm tabular-nums transition-colors disabled:opacity-60",
            paid
              ? "bg-primary/15 font-medium text-primary hover:bg-primary/25"
              : overdue
                ? "bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 dark:text-amber-300"
                : "hover:bg-muted"
          )}
        >
          {num(inst.amount)}
        </button>
      </td>
    )
  }

  // Latar baris ringkasan: OPAK (lihat .kasbon-piutang-* di styles.css), supaya
  // sel beku BATCH/NO/NAMA tak tembus saat kolom di-scroll di belakangnya.
  const totalBg = "kasbon-piutang-total"
  const subtotalBg = "kasbon-piutang-subtotal"
  const batchBg = "kasbon-piutang-batch"

  return (
    <div className="space-y-3">
      {error ? (
        <p
          role="alert"
          className="rounded-2xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      <div className="overflow-auto rounded-2xl border border-border/70 bg-card">
        {/* table-fixed + width eksplisit: kolom tak melar/menciut ikut isi, jadi
            sel beku tetap pas dan kartu yang di-scroll (bukan halaman). */}
        <table
          className="table-fixed border-collapse text-sm"
          style={{ width: tableWidth, minWidth: "100%" }}
        >
          <colgroup>
            <col style={{ width: COL_W.batch }} />
            <col style={{ width: COL_W.no }} />
            <col style={{ width: COL_W.name }} />
            <col style={{ width: COL_W.tgl }} />
            <col style={{ width: COL_W.adm1 }} />
            <col style={{ width: COL_W.adm2 }} />
            <col style={{ width: COL_W.lama }} />
            <col style={{ width: COL_W.angs }} />
            <col style={{ width: COL_W.pinjaman }} />
            <col style={{ width: COL_W.sisa }} />
            {monthColumns.map((key) => (
              <col key={key} style={{ width: COL_W.month }} />
            ))}
          </colgroup>
          <thead>
            {/* Baris grup: "ANGSURAN" membentang di atas semua kolom bulan. */}
            <tr>
              <th className={cn(groupHeadBase, "text-left")} colSpan={FIXED_COLS} />
              <th
                className={cn(groupHeadBase, "text-center")}
                colSpan={monthColumns.length}
              >
                ANGSURAN
              </th>
            </tr>
            <tr>
              <th
                className={cn(headBase, "z-30 text-center")}
                style={frozenStyle("batch")}
              >
                BATCH
              </th>
              <th
                className={cn(headBase, "z-30 text-center")}
                style={frozenStyle("no")}
              >
                NO
              </th>
              <th
                className={cn(headBase, "z-30 text-left")}
                style={frozenStyle("name")}
              >
                NAMA
              </th>
              <th className={cn(headBase, "text-left")}>TGL PENCAIRAN</th>
              <th className={cn(headBase, "text-right")}>ADM 1</th>
              <th className={cn(headBase, "text-right")}>ADM 2</th>
              <th className={cn(headBase, "text-right")}>LAMA ANGSURAN</th>
              <th className={cn(headBase, "text-right")}>ANGSURAN/BULAN</th>
              <th className={cn(headBase, "text-right")}>PINJAMAN</th>
              <th className={cn(headBase, "text-right")}>SISA PINJAMAN</th>
              {monthColumns.map((key) => (
                <th key={key} className={cn(headBase, "text-right")}>
                  {monthHeaderLabel(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* TOTAL keseluruhan */}
            <tr className={cn("font-semibold", totalBg)}>
              <FrozenCell col="batch" bg={totalBg} />
              <FrozenCell col="no" bg={totalBg} />
              <NameCell bg={totalBg}>TOTAL</NameCell>
              <td className={cn(cellBase, totalBg)} />
              <td className={cn(numCell, totalBg)}>
                {num(sumOf(receivables, (r) => r.provisi_fee))}
              </td>
              <td className={cn(numCell, totalBg)}>
                {num(sumOf(receivables, adm2Of))}
              </td>
              <td className={cn(cellBase, totalBg)} />
              <td className={cn(numCell, totalBg)}>
                {num(sumOf(receivables, (r) => r.monthly_installment))}
              </td>
              <td className={cn(numCell, totalBg)}>
                {num(sumOf(receivables, (r) => r.principal))}
              </td>
              <td className={cn(numCell, totalBg)}>
                {num(sumOf(receivables, (r) => r.remaining))}
              </td>
              {monthColumns.map((key) => (
                <td key={key} className={cn(numCell, totalBg)}>
                  {num(monthTotalOf(receivables, key))}
                </td>
              ))}
            </tr>

            {batches.map(([disbursedOn, group], batchIdx) => {
              const batchNo = batchIdx + 1
              return (
              <React.Fragment key={disbursedOn}>
                {/* Header batch */}
                <tr className={batchBg}>
                  <td
                    className={cn(
                      cellBase,
                      batchBg,
                      "sticky left-0 z-10 font-semibold"
                    )}
                    colSpan={3}
                    style={{ left: 0 }}
                  >
                    Batch {batchNo} · {formatDate(disbursedOn)}
                  </td>
                  <td
                    className={cn(cellBase, batchBg, "text-muted-foreground")}
                    colSpan={FIXED_COLS - 3 + monthColumns.length}
                  >
                    {group.length} karyawan
                  </td>
                </tr>

                {group.map((item, index) => (
                  <tr key={item.id} className="hover:bg-muted/30">
                    <FrozenCell
                      col="batch"
                      bg="bg-card"
                      align="right"
                      className="text-muted-foreground"
                    >
                      {batchNo}
                    </FrozenCell>
                    <FrozenCell
                      col="no"
                      bg="bg-card"
                      align="right"
                      className="text-muted-foreground"
                    >
                      {index + 1}
                    </FrozenCell>
                    <NameCell bg="bg-card">
                      <button
                        type="button"
                        onClick={() => onOpenCard(item.id)}
                        className="text-left hover:underline"
                        title="Buka kartu detail"
                      >
                        <span className="font-medium">
                          {item.profiles?.full_name ?? "—"}
                        </span>
                      </button>
                    </NameCell>
                    <td className={cn(cellBase, "text-muted-foreground")}>
                      {formatDate(item.disbursed_on)}
                    </td>
                    <td className={numCell}>{num(item.provisi_fee)}</td>
                    <td className={numCell}>{num(adm2Of(item))}</td>
                    <td className={numCell}>{item.tenure_months}</td>
                    <td className={numCell}>{num(item.monthly_installment)}</td>
                    <td className={numCell}>{num(item.principal)}</td>
                    <td
                      className={cn(
                        numCell,
                        item.remaining > 0
                          ? "font-medium"
                          : "text-muted-foreground"
                      )}
                    >
                      {num(item.remaining)}
                    </td>
                    {monthColumns.map((key) =>
                      renderMonthCell(item, key, "bg-card")
                    )}
                  </tr>
                ))}

                {/* Subtotal batch */}
                <tr className={cn("font-medium", subtotalBg)}>
                  <FrozenCell col="batch" bg={subtotalBg} />
                  <FrozenCell col="no" bg={subtotalBg} />
                  <NameCell bg={subtotalBg}>Subtotal</NameCell>
                  <td className={cn(cellBase, subtotalBg)} />
                  <td className={cn(numCell, subtotalBg)}>
                    {num(sumOf(group, (r) => r.provisi_fee))}
                  </td>
                  <td className={cn(numCell, subtotalBg)}>
                    {num(sumOf(group, adm2Of))}
                  </td>
                  <td className={cn(cellBase, subtotalBg)} />
                  <td className={cn(numCell, subtotalBg)}>
                    {num(sumOf(group, (r) => r.monthly_installment))}
                  </td>
                  <td className={cn(numCell, subtotalBg)}>
                    {num(sumOf(group, (r) => r.principal))}
                  </td>
                  <td className={cn(numCell, subtotalBg)}>
                    {num(sumOf(group, (r) => r.remaining))}
                  </td>
                  {monthColumns.map((key) => (
                    <td key={key} className={cn(numCell, subtotalBg)}>
                      {num(monthTotalOf(group, key))}
                    </td>
                  ))}
                </tr>
              </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-xs text-muted-foreground">
        <span>
          {receivables.length} dari {totalCount} kartu · klik sel bulan untuk
          tandai potongan
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded bg-primary/20" /> Sudah dipotong
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded bg-amber-500/20" /> Jatuh tempo, belum
        </span>
      </div>
    </div>
  )
}

export function AdminReceivables({
  data,
  onNotify,
}: {
  data: AdminData
  onNotify: (message: string) => void
}) {
  const [view, setView] = React.useState<"grid" | "kartu">("grid")
  const [selectedId, setSelectedId] = React.useState<string>("")
  const [statusFilter, setStatusFilter] = React.useState<
    "all" | "Aktif" | "Lunas"
  >("all")
  const [query, setQuery] = React.useState("")

  if (data.isPending) return <LoadingBlock />
  if (data.error) return <ErrorBlock error={data.error} />

  const normalizedQuery = query.trim().toLowerCase()
  const cards = data.receivables.filter((item) => {
    const matchesStatus = statusFilter === "all" || item.status === statusFilter
    const matchesQuery =
      !normalizedQuery ||
      (item.profiles?.full_name ?? "")
        .toLowerCase()
        .includes(normalizedQuery) ||
      (item.profiles?.branch ?? "").toLowerCase().includes(normalizedQuery) ||
      (item.applications?.code ?? "").toLowerCase().includes(normalizedQuery)
    return matchesStatus && matchesQuery
  })

  // `.at(0)` rather than `[0]`: filtering can empty the list, and the detail
  // pane needs to know that.
  const selected = cards.find((item) => item.id === selectedId) ?? cards.at(0)

  const openCard = (id: string) => {
    setSelectedId(id)
    setView("kartu")
  }

  return (
    <div className="space-y-6">
      <PageIntro
        title="Kartu piutang"
        description="Kelola potongan gaji dan sisa piutang tiap karyawan. Tampilan grid meniru Excel — klik sel bulan untuk tandai dipotong."
      />

      {data.receivables.length === 0 ? (
        <EmptyState
          icon={WalletCards}
          title="Belum ada kartu piutang"
          description="Kartu piutang terbuat otomatis begitu sebuah pengajuan disetujui dan dananya dicairkan."
        />
      ) : (
        <>
          <Card className="border-border/80 shadow-none">
            <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex gap-1 rounded-2xl border border-border/70 p-0.5">
                <Button
                  size="sm"
                  variant={view === "grid" ? "secondary" : "ghost"}
                  className="rounded-[14px]"
                  onClick={() => setView("grid")}
                >
                  <FileSpreadsheet /> Grid
                </Button>
                <Button
                  size="sm"
                  variant={view === "kartu" ? "secondary" : "ghost"}
                  className="rounded-[14px]"
                  onClick={() => setView("kartu")}
                >
                  <WalletCards /> Kartu
                </Button>
              </div>
              <div className="relative w-full max-w-md">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Cari nama, cabang, atau kode"
                  className="h-10 rounded-2xl pl-9"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(["all", "Aktif", "Lunas"] as const).map((option) => (
                  <Button
                    key={option}
                    size="sm"
                    variant={statusFilter === option ? "secondary" : "ghost"}
                    onClick={() => setStatusFilter(option)}
                  >
                    {option === "all" ? "Semua" : option}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {view === "grid" ? (
            <ReceivablesGrid
              receivables={cards}
              totalCount={data.receivables.length}
              onNotify={onNotify}
              onOpenCard={openCard}
            />
          ) : (
            <div className="grid gap-4 xl:grid-cols-[0.72fr_1.28fr]">
              <Card className="border-border/80 shadow-none">
                <CardHeader className="border-b border-border/70 pb-4">
                  <CardTitle className="text-base">Daftar kartu</CardTitle>
                  <CardDescription className="mt-1">
                    {cards.length} dari {data.receivables.length} kartu
                    ditampilkan.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 p-3">
                  {cards.length === 0 ? (
                    <p className="p-6 text-center text-xs text-muted-foreground">
                      Tidak ada kartu yang cocok dengan filter ini.
                    </p>
                  ) : (
                    cards.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() => setSelectedId(item.id)}
                        className={cn(
                          "flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition-colors",
                          selected?.id === item.id
                            ? "border-primary/30 bg-primary/[0.05]"
                            : "border-transparent hover:bg-muted/70"
                        )}
                      >
                        <ApplicantAvatar name={item.profiles?.full_name} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium">
                              {item.profiles?.full_name ?? "—"}
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {formatCompactCurrency(item.principal)}
                            </span>
                          </span>
                          <span className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span className="truncate">
                              {item.profiles?.jabatan ?? "-"}
                            </span>
                            <span className="shrink-0">
                              {item.paid_months}/{item.tenure_months} bulan
                            </span>
                          </span>
                        </span>
                      </button>
                    ))
                  )}
                </CardContent>
              </Card>

              {selected ? (
                <ReceivableDetail receivable={selected} onNotify={onNotify} />
              ) : (
                <EmptyState
                  icon={WalletCards}
                  title="Pilih kartu piutang"
                  description="Pilih salah satu kartu di sebelah kiri untuk melihat rincian angsurannya."
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

const REPORTS: { type: ReportType; title: string; description: string }[] = [
  {
    type: "pengajuan",
    title: "Rekap pengajuan",
    description: "Semua pengajuan beserta status, nominal, dan tanggal proses.",
  },
  {
    type: "piutang",
    title: "Rekap kartu piutang",
    description: "Piutang aktif dan lunas per karyawan beserta sisa piutang.",
  },
  {
    type: "biaya-admin",
    title: "Biaya admin terkumpul",
    description: "Provisi 1,5% dan admin bulanan 1% dengan baris total.",
  },
]

export function AdminReports({
  data,
  onNotify,
}: {
  data: AdminData
  onNotify: (message: string) => void
}) {
  const [start, setStart] = React.useState<Date | undefined>(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [end, setEnd] = React.useState<Date | undefined>(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth() + 1, 0)
  })
  const [error, setError] = React.useState("")

  const exportReport = useMutation({
    mutationFn: (type: ReportType) =>
      downloadReport(
        type,
        toDateInput(start) || undefined,
        toDateInput(end) || undefined
      ),
    onSuccess: (rowCount, type) => {
      setError("")
      const label =
        REPORTS.find((report) => report.type === type)?.title ?? "Laporan"
      onNotify(`${label} berhasil diunduh (${rowCount} baris).`)
    },
    onError: (mutationError) =>
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : String(mutationError)
      ),
  })

  const stats = data.stats

  return (
    <div className="space-y-6">
      <PageIntro
        title="Laporan dan export"
        description="Siapkan rekap finance dari data kartu piutang dan pengajuan."
      />

      <Card className="border-border/80 shadow-none">
        <CardHeader className="border-b border-border/70 pb-4">
          <CardTitle className="text-base">Periode laporan</CardTitle>
          <CardDescription className="mt-1">
            Rentang ini difilter pada tanggal pengajuan (rekap pengajuan) atau
            tanggal pencairan (rekap piutang dan biaya admin).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="report-start">Mulai</Label>
            <DatePicker id="report-start" value={start} onChange={setStart} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="report-end">Sampai</Label>
            <DatePicker id="report-end" value={end} onChange={setEnd} />
          </div>
        </CardContent>
      </Card>

      {error ? (
        <p
          role="alert"
          className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-3">
        {REPORTS.map((report) => (
          <Card key={report.type} className="border-border/80 shadow-none">
            <CardContent className="flex h-full flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="grid size-10 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <FileSpreadsheet className="size-4.5" />
                </div>
                <Badge variant="outline">XLSX</Badge>
              </div>
              <p className="mt-5 font-medium">{report.title}</p>
              <p className="mt-1 flex-1 text-sm leading-relaxed text-muted-foreground">
                {report.description}
              </p>
              <Button
                className="mt-5 w-full"
                disabled={exportReport.isPending}
                onClick={() => exportReport.mutate(report.type)}
              >
                {exportReport.isPending &&
                exportReport.variables === report.type ? (
                  <Spinner />
                ) : (
                  <Download />
                )}
                Export XLSX
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border/80 shadow-none">
        <CardHeader className="border-b border-border/70 pb-4">
          <CardTitle className="text-base">Ringkasan keseluruhan</CardTitle>
          <CardDescription className="mt-1">
            Angka kumulatif dari seluruh data Kasbonku, tidak dibatasi periode.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Total pengajuan"
            value={`${stats?.applications_total ?? 0} pengajuan`}
          />
          <Metric
            label="Total dicairkan"
            value={formatCurrency(stats?.disbursed_total ?? 0)}
          />
          <Metric
            label="Piutang berjalan"
            value={formatCurrency(stats?.outstanding_total ?? 0)}
            highlight
          />
          <Metric
            label="Biaya admin terkumpul"
            value={formatCurrency(stats?.admin_fee_total ?? 0)}
          />
        </CardContent>
        <CardFooter className="flex items-center gap-2 border-t border-border/70 px-5 py-4 text-xs text-muted-foreground">
          <CalendarDays className="size-3.5" />
          {stats?.applications_settled ?? 0} kasbon sudah lunas ·{" "}
          {stats?.receivables_active ?? 0} kartu piutang masih aktif
        </CardFooter>
      </Card>
    </div>
  )
}
