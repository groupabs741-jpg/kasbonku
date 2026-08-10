import { insforge } from "@/lib/insforge"
import type {
  Application,
  ApplicationEvent,
  ApplicationStatus,
  DashboardStats,
  DocumentKind,
  Installment,
  Jabatan,
  KasbonDocument,
  Notification,
  Profile,
  ReasonCategory,
  Receivable,
} from "@/lib/kasbon"

/**
 * The SDK returns `{ data, error }` everywhere, typed loosely because the
 * PostgREST builder is generic over `any`. These three helpers turn that into
 * something TanStack Query can surface — an error becomes a throw instead of an
 * empty screen — and pin down nullability at the one place it is decided.
 */
type SdkResult = { data: unknown; error: { message: string } | null }

/** A read that may legitimately match nothing. */
function one<T>(result: SdkResult): T | null {
  if (result.error) throw new Error(result.error.message)
  return (result.data ?? null) as T | null
}

/** A list read. PostgREST can answer `null`; callers always get an array. */
function list<T>(result: SdkResult): T[] {
  if (result.error) throw new Error(result.error.message)
  return (result.data ?? []) as T[]
}

/** A write that must come back with its row. */
function required<T>(result: SdkResult, what: string): T {
  const row = one<T>(result)
  if (row === null) throw new Error(`${what} tidak ditemukan.`)
  return row
}

const APPLICATION_WITH_PROFILE =
  "*, profiles!applications_profile_fkey(full_name, email, branch, avatar_url)"

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/** Creates the profile row on first Google sign-in and returns it. */
export async function ensureProfile(): Promise<Profile> {
  const { data, error } = await insforge.database.rpc("ensure_profile")
  if (error) throw new Error(error.message)
  // A `RETURNS public.profiles` function comes back as a single object.
  const profile = (Array.isArray(data) ? data[0] : data) as Profile | null
  if (!profile) throw new Error("Gagal menyiapkan profil pengguna.")
  return profile
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  return one<Profile>(
    await insforge.database
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle()
  )
}

export type ProfileInput = {
  full_name: string
  jabatan: Jabatan
  branch: string | null
  join_date: string | null
  contract_start: string
  contract_end: string
  phone: string
  family_phone: string
}

export async function updateProfile(
  userId: string,
  input: Partial<ProfileInput>
) {
  return required<Profile>(
    await insforge.database
      .from("profiles")
      .update(input)
      .eq("id", userId)
      .select("*")
      .single(),
    "Profil"
  )
}

export async function fetchAdmins(): Promise<Profile[]> {
  return list(
    await insforge.database
      .from("profiles")
      .select("*")
      .eq("role", "admin")
      .order("full_name")
  )
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export async function fetchMyApplications(
  userId: string
): Promise<Application[]> {
  return list(
    await insforge.database
      .from("applications")
      .select("*")
      .eq("user_id", userId)
      .order("submitted_at", { ascending: false })
  )
}

export async function fetchAllApplications(): Promise<Application[]> {
  return list(
    await insforge.database
      .from("applications")
      .select(APPLICATION_WITH_PROFILE)
      .order("submitted_at", { ascending: false })
  )
}

export async function fetchApplication(
  id: string
): Promise<Application | null> {
  return one<Application>(
    await insforge.database
      .from("applications")
      .select(APPLICATION_WITH_PROFILE)
      .eq("id", id)
      .maybeSingle()
  )
}

export type NewApplicationInput = {
  user_id: string
  jabatan: Jabatan
  join_date: string | null
  contract_start: string
  contract_end: string
  amount: number
  tenure_months: number
  phone: string
  family_phone: string
  reason_category: ReasonCategory
  reason_detail: string | null
  revision_of?: string | null
}

/**
 * `code`, `submitted_at`, `remaining_contract_days`, the fee columns and the
 * initial status are all assigned server-side, so they are deliberately absent.
 */
export async function createApplication(
  input: NewApplicationInput
): Promise<Application> {
  return required<Application>(
    await insforge.database
      .from("applications")
      .insert([input])
      .select("*")
      .single(),
    "Pengajuan"
  )
}

export async function updateApplication(
  id: string,
  patch: Partial<
    Pick<
      Application,
      | "amount"
      | "tenure_months"
      | "phone"
      | "family_phone"
      | "reason_category"
      | "reason_detail"
      | "jabatan"
      | "contract_start"
      | "contract_end"
      | "join_date"
    >
  >
): Promise<Application> {
  return required<Application>(
    await insforge.database
      .from("applications")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single(),
    "Pengajuan"
  )
}

/**
 * Status moves are validated by a database trigger, so an illegal transition
 * fails loudly here rather than silently corrupting the flow.
 */
export async function setApplicationStatus(
  id: string,
  status: ApplicationStatus,
  adminNote?: string | null
): Promise<Application> {
  const patch: Record<string, unknown> = { status }
  if (adminNote !== undefined) patch.admin_note = adminNote
  return required<Application>(
    await insforge.database
      .from("applications")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single(),
    "Pengajuan"
  )
}

export async function fetchApplicationEvents(
  applicationId: string
): Promise<ApplicationEvent[]> {
  return list(
    await insforge.database
      .from("application_events")
      .select("id, application_id, from_status, to_status, note, created_at")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: true })
  )
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export async function fetchDocuments(
  applicationId: string
): Promise<KasbonDocument[]> {
  return list(
    await insforge.database
      .from("documents")
      .select("*")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: true })
  )
}

/** Private buckets need a signed URL; 10 minutes is plenty to open or print. */
export async function documentUrl(doc: KasbonDocument, expiresIn = 600) {
  const { data, error } = await insforge.storage
    .from(doc.bucket)
    .createSignedUrl(doc.object_key, expiresIn)
  if (error) throw new Error(error.message)
  return data?.signedUrl ?? null
}

export async function generateDocuments(applicationId: string) {
  const { data, error } = await insforge.functions.invoke(
    "generate-documents",
    {
      body: { application_id: applicationId },
    }
  )
  if (error) throw new Error(error.message)
  // An edge function can answer with an application-level error and still 200.
  const payload = data as { error?: string; detail?: string } | null
  if (payload?.error) throw new Error(payload.detail ?? payload.error)
  return payload
}

/** The empty slot a freshly generated document leaves for the applicant. */
const SIGNATURE_MARKER = "<!-- SIGNATURE:PEMOHON -->"
/** What a signed document carries instead — matched again so re-signing works. */
const SIGNATURE_SLOT = /<span class="signature-slot">[\s\S]*?<\/span>/g

/**
 * Inserts the drawn signature into the generated HTML document in place.
 *
 * The signature lands inside a `signature-slot` wrapper rather than replacing
 * the marker outright, so signing again — after admin sends the document back,
 * or after a wobbly first attempt — swaps the image instead of stacking a
 * second one next to it.
 */
export async function signGeneratedDocument(
  application: Application,
  signature: Blob
) {
  const documents = await fetchDocuments(application.id)
  const generated = documents.find(
    (document) =>
      document.kind === "permohonan" && document.mime_type === "text/html"
  )
  if (!generated) {
    throw new Error("Dokumen kasbon belum disiapkan admin.")
  }

  const { data: template, error: downloadError } = await insforge.storage
    .from(generated.bucket)
    .download(generated.object_key)
  if (downloadError) throw new Error(downloadError.message)
  if (!template) throw new Error("Dokumen kasbon tidak dapat dibuka.")

  const html = await template.text()
  const alreadySigned = html.includes('class="signature-slot"')
  if (!alreadySigned && !html.includes(SIGNATURE_MARKER)) {
    throw new Error("Area tanda tangan pada dokumen tidak ditemukan.")
  }

  const signatureDataUrl = await blobToDataUrl(signature)
  const slot =
    '<span class="signature-slot"><img class="signature-image" src="' +
    signatureDataUrl +
    '" alt="Tanda tangan pemohon" /></span>'
  const signedHtml = alreadySigned
    ? html.replace(SIGNATURE_SLOT, slot)
    : html.split(SIGNATURE_MARKER).join(slot)

  const fileName =
    generated.file_name ?? `dokumen-kasbon-${application.code}.html`
  const signedFile = new File([signedHtml], fileName, { type: "text/html" })

  const { error: uploadError } = await insforge.storage
    .from(generated.bucket)
    .upload(generated.object_key, signedFile)
  if (uploadError) throw new Error(uploadError.message)

  return generated
}

/** Opens a stored document in a new tab through a short-lived signed URL. */
export async function openDocument(doc: KasbonDocument, tab?: Window | null) {
  const url = await documentUrl(doc)
  if (!url) throw new Error("URL dokumen tidak tersedia.")
  if (tab) tab.location.href = url
  else window.open(url, "_blank", "noopener,noreferrer")
  return url
}

/** The official document the applicant prints and signs on paper. */
export async function fetchOfficialDocument(applicationId: string) {
  const documents = await fetchDocuments(applicationId)
  const official = documents.find((document) => document.kind === "permohonan")
  if (!official) throw new Error("Dokumen kasbon belum disiapkan admin.")
  return official
}

/**
 * The official document's HTML plus whether the applicant already embedded
 * their digital signature. Downloading the file directly — instead of opening
 * the signed URL — sidesteps storage serving `text/html` as an attachment,
 * which renders as a blank tab and a download. It also lets the signing wizard
 * resume: a signed document means the applicant only has the paper round-trip
 * left, so the flow can skip straight to printing.
 */
export async function fetchOfficialDocumentHtml(
  applicationId: string
): Promise<{ official: KasbonDocument; html: string; signed: boolean }> {
  const official = await fetchOfficialDocument(applicationId)
  const { data, error } = await insforge.storage
    .from(official.bucket)
    .download(official.object_key)
  if (error) throw new Error(error.message)
  if (!data) throw new Error("Dokumen kasbon tidak dapat dibuka.")

  const html = await data.text()
  return { official, html, signed: html.includes('class="signature-slot"') }
}

/** Downloads a specific stored document's text so it can be rendered inline. */
export async function fetchDocumentHtml(doc: KasbonDocument): Promise<string> {
  const { data, error } = await insforge.storage
    .from(doc.bucket)
    .download(doc.object_key)
  if (error) throw new Error(error.message)
  if (!data) throw new Error("Dokumen tidak dapat dibuka.")
  return data.text()
}

/**
 * Renders HTML inline in a new tab. The tab is claimed synchronously by the
 * caller (a later `window.open` is blocked as a popup), then filled here. When
 * the popup was blocked, falls back to a blob URL — a text/html blob renders
 * inline where the stored file, served as an attachment, would not.
 */
export function writeHtmlToTab(html: string, tab: Window | null) {
  if (tab && !tab.closed) {
    tab.document.open()
    tab.document.write(html)
    tab.document.close()
    return
  }
  const blob = new Blob([html], { type: "text/html" })
  const url = URL.createObjectURL(blob)
  window.open(url, "_blank", "noopener,noreferrer")
  // The opened tab keeps its own reference; revoke once it has had time to load.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * Archives the printed document carrying the applicant's own signature plus the
 * wet signature of their direct supervisor. The database refuses "Menunggu
 * Review" until such a row exists, so this is the gate into admin review.
 */
export async function uploadApplicantScan(
  application: Application,
  file: File
) {
  return uploadScanDocument(application, file, "ttd_pemohon", "ttd-pemohon")
}

/**
 * Archives the printed document that came back with every wet signature on it.
 * The database refuses "Disetujui / Cair" until such a row exists, so this is
 * the gate between the paper round-trip and the money moving.
 */
export async function uploadSignedScan(application: Application, file: File) {
  return uploadScanDocument(application, file, "ttd_scan", "ttd-lengkap")
}

/** Shared upload path for both scans; only kind and file prefix differ. */
async function uploadScanDocument(
  application: Application,
  file: File,
  kind: DocumentKind,
  prefix: string
) {
  const bucket = "kasbon-documents"
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const extension = file.name.includes(".")
    ? file.name.slice(file.name.lastIndexOf("."))
    : ""
  const fileName = `${prefix}-${application.code}-${stamp}${extension}`
  const key = `${application.user_id}/${application.id}/${fileName}`

  const { data: uploaded, error: uploadError } = await insforge.storage
    .from(bucket)
    .upload(key, file)
  if (uploadError) throw new Error(uploadError.message)

  return required<KasbonDocument>(
    await insforge.database
      .from("documents")
      .insert([
        {
          application_id: application.id,
          user_id: application.user_id,
          kind,
          bucket,
          object_key: uploaded?.key ?? key,
          file_name: fileName,
          mime_type: file.type || "application/octet-stream",
          size_bytes: file.size,
        },
      ])
      .select("*")
      .single(),
    "Dokumen"
  )
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () =>
      reject(new Error("Tanda tangan tidak dapat diproses."))
    reader.readAsDataURL(blob)
  })
}

// ---------------------------------------------------------------------------
// Receivables & installments
// ---------------------------------------------------------------------------

const RECEIVABLE_SELECT =
  "*, applications!receivables_application_id_fkey(code, jabatan), profiles!receivables_profile_fkey(full_name, email, branch, jabatan)"

export async function fetchMyReceivables(
  userId: string
): Promise<Receivable[]> {
  return list(
    await insforge.database
      .from("receivables")
      .select(RECEIVABLE_SELECT)
      .eq("user_id", userId)
      .order("disbursed_on", { ascending: false })
  )
}

export async function fetchAllReceivables(): Promise<Receivable[]> {
  return list(
    await insforge.database
      .from("receivables")
      .select(RECEIVABLE_SELECT)
      .order("disbursed_on", { ascending: false })
  )
}

export async function fetchInstallments(
  receivableId: string
): Promise<Installment[]> {
  return list(
    await insforge.database
      .from("installments")
      .select("*")
      .eq("receivable_id", receivableId)
      .order("month_no", { ascending: true })
  )
}

/**
 * Marking a row drives `paid_months`, the card status and — once every month is
 * marked — the application's "Lunas" status, all from database triggers.
 */
export async function setInstallmentStatus(options: {
  id: string
  status: "Belum Dipotong" | "Sudah Dipotong"
  note?: string | null
}) {
  const patch: Record<string, unknown> = { status: options.status }
  if (options.note !== undefined) patch.note = options.note
  return required<Installment>(
    await insforge.database
      .from("installments")
      .update(patch)
      .eq("id", options.id)
      .select("*")
      .single(),
    "Angsuran"
  )
}

// ---------------------------------------------------------------------------
// Notifications, stats, reports
// ---------------------------------------------------------------------------

export async function fetchNotifications(limit = 20): Promise<Notification[]> {
  return list(
    await insforge.database
      .from("notifications")
      .select(
        "id, application_id, type, title, body, email_status, read_at, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(limit)
  )
}

export async function markNotificationRead(id: string) {
  return required<{ id: string }>(
    await insforge.database
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .select("id")
      .single(),
    "Notifikasi"
  )
}

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const { data, error } = await insforge.database.rpc("dashboard_stats")
  if (error) throw new Error(error.message)
  return data as DashboardStats
}

/**
 * Nudges the outbox so an email goes out immediately instead of waiting for the
 * 5-minute schedule. Failure here is cosmetic — the schedule still delivers.
 */
export async function flushNotifications() {
  try {
    await insforge.functions.invoke("notifications-dispatch", { body: {} })
  } catch {
    // Intentionally ignored: the scheduled run is the source of truth.
  }
}

export type ReportType = "pengajuan" | "piutang" | "biaya-admin"

export async function downloadReport(
  type: ReportType,
  start?: string,
  end?: string
) {
  const { data, error } = await insforge.functions.invoke("export-report", {
    body: { type, start, end },
  })
  if (error) throw new Error(error.message)

  const payload = data as {
    filename?: string
    mime?: string
    base64?: string
    error?: string
    detail?: string
    row_count?: number
  } | null
  if (payload?.error) throw new Error(payload.detail ?? payload.error)
  if (!payload?.base64) throw new Error("Export gagal: file kosong.")

  const binary = atob(payload.base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)

  const blob = new Blob([bytes], { type: payload.mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = payload.filename ?? "laporan.xlsx"
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)

  return payload.row_count ?? 0
}
