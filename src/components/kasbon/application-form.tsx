import { CircleDollarSign } from "lucide-react"

import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Metric, fieldClassName } from "@/components/kasbon/shared"
import type { SubmitApplicationInput } from "@/lib/api"
import { formatCurrency, formatCurrencyInput, toDateInput } from "@/lib/format"
import {
  JABATAN_OPTIONS,
  MAX_TENURE_MONTHS,
  POSITION_LIMITS,
  REASON_OPTIONS,
  calculateFees,
  remainingContract,
} from "@/lib/kasbon"
import type {
  Application,
  Jabatan,
  Profile,
  ReasonCategory,
} from "@/lib/kasbon"

/**
 * Bentuk nilai form pengajuan — dipakai bersama oleh form gabungan pertama
 * (halaman "Isi Data Diri") dan dialog pengajuan berikutnya. Data diri dan data
 * transaksi hidup di satu objek supaya keduanya bisa disubmit dalam satu RPC.
 */
export type ApplicationFormValues = {
  fullName: string
  jabatan: Jabatan | ""
  joinDate: Date | undefined
  contractStart: Date | undefined
  contractEnd: Date | undefined
  phone: string
  familyPhone: string
  bankName: string
  bankAccount: string
  amount: string
  tenure: string
  reason: ReasonCategory
  reasonDetail: string
}

function toDate(value: string | null | undefined) {
  return value ? new Date(`${value}T00:00:00`) : undefined
}

/**
 * Data diri selalu diambil dari profil (auto-terisi, tetap bisa diedit); data
 * transaksi dari pengajuan yang direvisi bila ada, atau kosong untuk pengajuan
 * baru.
 */
export function initialApplicationValues(
  profile: Profile,
  revisionOf?: Application | null
): ApplicationFormValues {
  return {
    fullName: profile.full_name,
    jabatan: profile.jabatan ?? "",
    joinDate: toDate(profile.join_date),
    contractStart: toDate(profile.contract_start),
    contractEnd: toDate(profile.contract_end),
    phone: revisionOf?.phone ?? profile.phone ?? "",
    familyPhone: revisionOf?.family_phone ?? profile.family_phone ?? "",
    bankName: profile.bank_name ?? "",
    bankAccount: profile.bank_account ?? "",
    amount: revisionOf ? String(revisionOf.amount) : "",
    tenure: String(revisionOf?.tenure_months ?? 6),
    reason: revisionOf?.reason_category ?? "Kesehatan / Medis Darurat",
    reasonDetail: revisionOf?.reason_detail ?? "",
  }
}

/** Batas nominal untuk jabatan yang sedang dipilih (0 jika belum dipilih). */
export function limitForValues(values: ApplicationFormValues) {
  return values.jabatan ? POSITION_LIMITS[values.jabatan] : 0
}

/** Validasi bersama; mengembalikan pesan error pertama atau null bila lolos. */
export function validateApplicationValues(
  values: ApplicationFormValues
): string | null {
  if (!values.fullName.trim()) return "Nama lengkap wajib diisi."
  if (!values.jabatan) return "Jabatan wajib dipilih."
  if (!values.contractStart || !values.contractEnd) {
    return "Tanggal mulai dan akhir kontrak wajib diisi."
  }
  if (values.contractEnd < values.contractStart) {
    return "Tanggal akhir kontrak tidak boleh sebelum tanggal mulai."
  }
  if (!values.phone.trim() || !values.familyPhone.trim()) {
    return "Nomor telepon pemohon dan keluarga wajib diisi."
  }
  if (!values.bankName.trim() || !values.bankAccount.trim()) {
    return "Nama Bank dan Nomor Rekening wajib diisi."
  }
  const amount = Number(values.amount) || 0
  if (!amount) return "Nominal pengajuan wajib diisi."
  if (amount > limitForValues(values)) {
    return `Nominal maksimal untuk ${values.jabatan} adalah ${formatCurrency(limitForValues(values))}.`
  }
  const tenure = Number(values.tenure) || 0
  if (tenure < 1 || tenure > MAX_TENURE_MONTHS) {
    return `Jangka waktu angsuran harus antara 1 dan ${MAX_TENURE_MONTHS} bulan.`
  }
  return null
}

/** Menyusun payload RPC dari nilai form yang sudah divalidasi. */
export function toSubmitInput(
  values: ApplicationFormValues,
  profile: Profile,
  revisionOf?: Application | null
): SubmitApplicationInput {
  return {
    full_name: values.fullName.trim(),
    jabatan: values.jabatan as Jabatan,
    branch: profile.branch ?? null,
    join_date: toDateInput(values.joinDate) || null,
    contract_start: toDateInput(values.contractStart),
    contract_end: toDateInput(values.contractEnd),
    phone: values.phone.trim(),
    family_phone: values.familyPhone.trim(),
    bank_name: values.bankName.trim(),
    bank_account: values.bankAccount.trim(),
    amount: Number(values.amount) || 0,
    tenure_months: Number(values.tenure) || 0,
    reason_category: values.reason,
    reason_detail: values.reasonDetail.trim() || null,
    revision_of: revisionOf?.id ?? null,
  }
}

/**
 * Semua field pengajuan (data diri + transaksi + estimasi pencairan). Stateless:
 * nilai dan setter datang dari pemanggil lewat `values` / `onChange`, jadi form
 * gabungan dan dialog memakai UI field yang sama.
 */
export function ApplicationFormFields({
  values,
  onChange,
  email,
  idPrefix = "app",
}: {
  values: ApplicationFormValues
  onChange: (patch: Partial<ApplicationFormValues>) => void
  email: string
  idPrefix?: string
}) {
  const limit = limitForValues(values)
  const amount = Number(values.amount) || 0
  const tenure = Number(values.tenure) || 0
  const overLimit = amount > limit
  const fees = calculateFees(amount, tenure)
  const sisaKontrak = remainingContract(toDateInput(values.contractEnd) || null)

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={`${idPrefix}-name`}>Nama lengkap</Label>
          <Input
            id={`${idPrefix}-name`}
            value={values.fullName}
            onChange={(event) => onChange({ fullName: event.target.value })}
            placeholder="Nama sesuai data kepegawaian"
            required
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={`${idPrefix}-email`}>Email</Label>
          <Input id={`${idPrefix}-email`} value={email} readOnly />
          <p className="text-xs text-muted-foreground">
            Notifikasi Kasbonku dikirim ke alamat ini.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-jabatan`}>Jabatan</Label>
          <Select
            value={values.jabatan}
            onValueChange={(value) =>
              value && onChange({ jabatan: value })
            }
          >
            <SelectTrigger id={`${idPrefix}-jabatan`} className={fieldClassName}>
              <SelectValue placeholder="Pilih jabatan" />
            </SelectTrigger>
            <SelectContent>
              {JABATAN_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {values.jabatan ? (
            <p className="text-xs text-muted-foreground">
              Limit pengajuan: {formatCurrency(limit)}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-join`}>Tanggal bergabung</Label>
          <DatePicker
            id={`${idPrefix}-join`}
            value={values.joinDate}
            onChange={(date) => onChange({ joinDate: date })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-contract-start`}>Kontrak mulai</Label>
          <DatePicker
            id={`${idPrefix}-contract-start`}
            value={values.contractStart}
            onChange={(date) => onChange({ contractStart: date })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-contract-end`}>Kontrak berakhir</Label>
          <DatePicker
            id={`${idPrefix}-contract-end`}
            value={values.contractEnd}
            onChange={(date) => onChange({ contractEnd: date })}
          />
        </div>
        <div className="rounded-2xl bg-muted/60 p-3 sm:col-span-2">
          <p className="text-xs text-muted-foreground">
            Sisa kontrak (otomatis, dihitung dari tanggal hari ini)
          </p>
          <p className="mt-1 text-sm font-semibold">
            {values.contractEnd ? sisaKontrak.label : "Isi tanggal akhir kontrak"}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-phone`}>No. Telp / WhatsApp</Label>
          <Input
            id={`${idPrefix}-phone`}
            type="tel"
            value={values.phone}
            onChange={(event) => onChange({ phone: event.target.value })}
            placeholder="08xx xxxx xxxx"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-family-phone`}>No. Telp keluarga</Label>
          <Input
            id={`${idPrefix}-family-phone`}
            type="tel"
            value={values.familyPhone}
            onChange={(event) => onChange({ familyPhone: event.target.value })}
            placeholder="08xx xxxx xxxx"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-bank-name`}>Nama Bank</Label>
          <Input
            id={`${idPrefix}-bank-name`}
            type="text"
            value={values.bankName}
            onChange={(event) => onChange({ bankName: event.target.value })}
            placeholder="Contoh: BCA, Mandiri"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-bank-account`}>No. Rekening</Label>
          <Input
            id={`${idPrefix}-bank-account`}
            type="text"
            value={values.bankAccount}
            onChange={(event) => onChange({ bankAccount: event.target.value })}
            placeholder="Nomor rekening"
            required
          />
        </div>
      </div>

      <div className="grid gap-4 border-t border-border/70 pt-6 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-amount`}>Nominal pengajuan</Label>
          <Input
            id={`${idPrefix}-amount`}
            type="text"
            inputMode="numeric"
            value={formatCurrencyInput(values.amount)}
            onChange={(event) =>
              onChange({ amount: event.target.value.replace(/\D/g, "") })
            }
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
            Limit {values.jabatan || "jabatan"}: {formatCurrency(limit)}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-tenure`}>Jangka waktu angsuran</Label>
          <Input
            id={`${idPrefix}-tenure`}
            type="number"
            min="1"
            max={MAX_TENURE_MONTHS}
            value={values.tenure}
            onChange={(event) => onChange({ tenure: event.target.value })}
            required
          />
          <p className="text-xs text-muted-foreground">
            Maksimal {MAX_TENURE_MONTHS} bulan.
          </p>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={`${idPrefix}-reason`}>Alasan permohonan</Label>
          <Select
            value={values.reason}
            onValueChange={(value) =>
              value && onChange({ reason: value })
            }
          >
            <SelectTrigger id={`${idPrefix}-reason`} className={fieldClassName}>
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
            {REASON_OPTIONS.find((option) => option.value === values.reason)?.hint}
          </p>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={`${idPrefix}-reason-detail`}>
            Keterangan tambahan{" "}
            <span className="font-normal text-muted-foreground">(opsional)</span>
          </Label>
          <Textarea
            id={`${idPrefix}-reason-detail`}
            value={values.reasonDetail}
            onChange={(event) => onChange({ reasonDetail: event.target.value })}
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
    </div>
  )
}
