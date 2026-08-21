/** Domain vocabulary shared by the dashboard, mirroring the database CHECKs. */

export type Role = "pemohon" | "admin"

export type Jabatan = "Staf/Pelaksana" | "Koordinator" | "SPV/Manager"

export type ApplicationStatus =
  | "Diajukan"
  | "Menunggu TTD"
  | "Menunggu Review"
  | "Ditolak"
  | "Disetujui / Cair"
  | "Lunas"

export type ReasonCategory =
  | "Kesehatan / Medis Darurat"
  | "Pendidikan / Sekolah"
  | "Kebutuhan Domestik Mendesak"
  | "Kebutuhan Keluarga / Persalinan"
  | "Kedukaan / Musibah"

export type DocumentKind =
  | "permohonan"
  | "persetujuan"
  | "penyerahan"
  | "ttd_pemohon"
  | "ttd_scan"
  | "ttd_digital"

export type InstallmentStatus = "Belum Dipotong" | "Sudah Dipotong"

export const JABATAN_OPTIONS: Jabatan[] = [
  "Staf/Pelaksana",
  "Koordinator",
  "SPV/Manager",
]

/** PRD 4.2 — ceiling per submission, not cumulative across submissions. */
export const POSITION_LIMITS: Record<Jabatan, number> = {
  "Staf/Pelaksana": 3_000_000,
  Koordinator: 4_000_000,
  "SPV/Manager": 6_000_000,
}

export const REASON_OPTIONS: { value: ReasonCategory; hint: string }[] = [
  {
    value: "Kesehatan / Medis Darurat",
    hint: "Biaya rumah sakit, obat resep, atau pengobatan darurat yang tidak dicover BPJS/asuransi.",
  },
  {
    value: "Pendidikan / Sekolah",
    hint: "Uang pangkal sekolah, SPP/UKT kuliah, atau buku dan seragam sekolah anak.",
  },
  {
    value: "Kebutuhan Domestik Mendesak",
    hint: "Perbaikan kendaraan utama untuk bekerja, atau sewa kontrakan/kos jatuh tempo.",
  },
  {
    value: "Kebutuhan Keluarga / Persalinan",
    hint: "Biaya melahirkan atau kebutuhan pokok bayi/anak yang mendesak.",
  },
  {
    value: "Kedukaan / Musibah",
    hint: "Pengurusan jenazah keluarga inti, atau perbaikan rumah akibat bencana.",
  },
]

export const MAX_TENURE_MONTHS = 6
export const PROVISI_RATE = 0.015
export const MONTHLY_ADMIN_RATE = 0.01

/** Statuses that block a new submission (PRD 4.5, mirrors the partial unique index). */
export const ACTIVE_STATUSES: ApplicationStatus[] = [
  "Diajukan",
  "Menunggu TTD",
  "Menunggu Review",
  "Disetujui / Cair",
]

export const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  permohonan: "Dokumen kasbon resmi",
  persetujuan: "Lembar Persetujuan",
  penyerahan: "Lembar Penyerahan",
  ttd_pemohon: "Scan dokumen bertanda tangan",
  ttd_scan: "Scan dokumen TTD lengkap",
  ttd_digital: "Tanda tangan digital",
}

export const OFFICIAL_SHEETS: DocumentKind[] = ["permohonan"]

export type Profile = {
  id: string
  email: string
  full_name: string
  avatar_url: string | null
  role: Role
  jabatan: Jabatan | null
  branch: string | null
  join_date: string | null
  contract_start: string | null
  contract_end: string | null
  phone: string | null
  family_phone: string | null
  bank_name: string | null
  bank_account: string | null
  created_at: string
  updated_at: string
}

export type Application = {
  id: string
  code: string
  user_id: string
  jabatan: Jabatan
  join_date: string | null
  contract_start: string
  contract_end: string
  remaining_contract_days: number
  amount: number
  tenure_months: number
  phone: string
  family_phone: string
  bank_name: string
  bank_account: string
  reason_category: ReasonCategory
  reason_detail: string | null
  status: ApplicationStatus
  admin_note: string | null
  revision_of: string | null
  submitted_at: string
  processed_at: string | null
  document_sent_at: string | null
  signed_at: string | null
  wet_signature_at: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  disbursed_at: string | null
  provisi_fee: number
  monthly_installment: number
  monthly_admin_fee: number
  net_disbursement: number
  created_at: string
  updated_at: string
  profiles?: Pick<
    Profile,
    "full_name" | "email" | "branch" | "avatar_url"
  > | null
}

export type ApplicationEvent = {
  id: string
  application_id: string
  from_status: ApplicationStatus | null
  to_status: ApplicationStatus
  note: string | null
  created_at: string
}

export type KasbonDocument = {
  id: string
  application_id: string
  user_id: string
  kind: DocumentKind
  bucket: string
  object_key: string
  file_name: string | null
  mime_type: string | null
  size_bytes: number | null
  created_at: string
}

export type Receivable = {
  id: string
  application_id: string
  user_id: string
  principal: number
  provisi_fee: number
  monthly_admin_fee: number
  monthly_installment: number
  tenure_months: number
  disbursed_on: string
  status: "Aktif" | "Lunas"
  paid_months: number
  settled_at: string | null
  remaining: number
  applications?: Pick<Application, "code" | "jabatan"> | null
  profiles?: Pick<Profile, "full_name" | "email" | "branch" | "jabatan"> | null
}

export type Installment = {
  id: string
  receivable_id: string
  user_id: string
  month_no: number
  due_date: string
  amount: number
  status: InstallmentStatus
  paid_on: string | null
  note: string | null
  updated_at: string
}

/**
 * Baris buku kas manual (sheet "Pencatatan") — suntikan modal, pembayaran fee,
 * dan koreksi. Baris KASBON/ADM/KLAIM tidak disimpan di sini; keduanya dihitung
 * realtime dari receivables + installments saat merangkai buku kas.
 */
export type CashEntryKind = "modal" | "fee" | "klaim" | "koreksi"
export type CashDirection = "masuk" | "keluar"

export type CashEntry = {
  id: string
  entry_date: string
  description: string
  kind: CashEntryKind
  direction: CashDirection
  amount: number
  note: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type Notification = {
  id: string
  application_id: string | null
  type: string
  title: string
  body: string
  email_status: "pending" | "sent" | "failed" | "skipped"
  read_at: string | null
  created_at: string
}

export type DashboardStats = {
  applications_total: number
  applications_pending: number
  applications_review: number
  applications_active: number
  applications_settled: number
  receivables_active: number
  outstanding_total: number
  disbursed_total: number
  admin_fee_total: number
  unread_notifications: number
}

/**
 * Client-side preview of the fees the database computes as generated columns.
 * Kept in one place so the form and the server can never drift apart.
 */
export function calculateFees(amount: number, tenureMonths: number) {
  const safeTenure = tenureMonths > 0 ? tenureMonths : 1
  const provisi = Math.round(amount * PROVISI_RATE * 100) / 100
  const monthlyInstallment = Math.round((amount / safeTenure) * 100) / 100
  // Admin bulanan = 1% dari pokok pinjaman, ditagih tiap bulan angsuran.
  // Total admin = monthlyAdmin * tenure = 1% * pinjaman * lama angsuran.
  const monthlyAdmin = Math.round(amount * MONTHLY_ADMIN_RATE * 100) / 100
  const netDisbursement = Math.max(
    0,
    Math.round((amount - provisi - monthlyAdmin * safeTenure) * 100) / 100
  )
  return { provisi, monthlyInstallment, monthlyAdmin, netDisbursement }
}

/** PRD 4.1 field 5 — sisa kontrak dari tanggal pengajuan ke akhir kontrak. */
export function remainingContract(contractEnd: string | null | undefined) {
  if (!contractEnd) return { days: 0, label: "-" }
  const end = new Date(`${contractEnd}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.max(
    0,
    Math.round((end.getTime() - today.getTime()) / 86_400_000)
  )
  if (days === 0) return { days, label: "Kontrak berakhir" }
  const months = Math.floor(days / 30)
  const rest = days % 30
  if (months === 0) return { days, label: `${rest} hari` }
  if (rest === 0) return { days, label: `${months} bulan` }
  return { days, label: `${months} bulan ${rest} hari` }
}

/**
 * Empat tahap kanonik yang dipakai stepper "Progress Pengajuan" di dashboard
 * pemohon maupun ringkasan admin — keduanya membaca urutan yang sama. "Ditolak"
 * berada di luar jalur ini dan ditangani terpisah oleh pemanggil.
 */
export type ProgressStep = {
  key: string
  label: string
  description: string
  statuses: ApplicationStatus[]
}

export const PROGRESS_STEPS: ProgressStep[] = [
  {
    key: "diajukan",
    label: "Diajukan",
    description: "Pengajuan masuk, dokumen resmi otomatis dibuat",
    statuses: ["Diajukan"],
  },
  {
    key: "ttd",
    label: "Menunggu TTD",
    description: "Cetak, tanda tangan manual, lalu unggah scan",
    statuses: ["Menunggu TTD"],
  },
  {
    key: "review",
    label: "Menunggu Review",
    description: "Admin memeriksa dokumen bertanda tangan",
    statuses: ["Menunggu Review"],
  },
  {
    key: "selesai",
    label: "Disetujui / Cair",
    description: "Dana dicairkan, angsuran mulai berjalan",
    statuses: ["Disetujui / Cair", "Lunas"],
  },
]

/** Indeks tahap aktif pada PROGRESS_STEPS; "Ditolak" jatuh ke tahap Review. */
export function progressStepIndex(status: ApplicationStatus): number {
  if (status === "Ditolak") {
    return PROGRESS_STEPS.findIndex((step) =>
      step.statuses.includes("Menunggu Review")
    )
  }
  const index = PROGRESS_STEPS.findIndex((step) =>
    step.statuses.includes(status)
  )
  return index === -1 ? 0 : index
}

/** Position of a status on the applicant-facing progress bar (percentage). */
export function statusProgress(status: ApplicationStatus) {
  switch (status) {
    case "Diajukan":
      return 15
    case "Menunggu TTD":
      return 45
    case "Menunggu Review":
      return 72
    case "Disetujui / Cair":
      return 95
    case "Lunas":
      return 100
    case "Ditolak":
      return 100
    default:
      return 0
  }
}

/** Penjelasan satu kalimat untuk pemohon: apa yang sedang terjadi sekarang. */
export function statusNarrative(status: ApplicationStatus) {
  switch (status) {
    case "Diajukan":
      return "Pengajuan sudah masuk. Dokumen resmi otomatis dibuat dan dikirim ke email kamu."
    case "Menunggu TTD":
      return "Cetak dokumen yang sudah dikirim ke email, tandatangani secara manual, lalu unggah scan-nya ke dashboard."
    case "Menunggu Review":
      return "Scan dokumen bertanda tangan kamu sedang diperiksa admin."
    case "Disetujui / Cair":
      return "Dana sudah dicairkan dan angsuran mulai dipotong dari gaji."
    case "Lunas":
      return "Seluruh angsuran sudah selesai dipotong."
    case "Ditolak":
      return "Pengajuan ditolak — revisi datanya lalu ajukan ulang."
    default:
      return ""
  }
}

/**
 * Pemohon mengisi sendiri data kepegawaiannya sebelum bisa mengajukan —
 * jabatan menentukan limit, masa kontrak menentukan sisa kontrak di dokumen.
 */
export function isProfileComplete(profile: Profile | null | undefined) {
  if (!profile) return false
  return Boolean(
    profile.full_name &&
    profile.jabatan &&
    profile.contract_start &&
    profile.contract_end &&
    profile.phone &&
    profile.family_phone &&
    profile.bank_name &&
    profile.bank_account
  )
}
