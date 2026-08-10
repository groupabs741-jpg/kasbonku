// Laporan & Export for finance (PRD 7.2). Admin only.
//
// POST { type: "pengajuan" | "piutang" | "biaya-admin", start?: ISO date, end?: ISO date }
// Returns { filename, mime, base64 } so the browser can build the Blob itself —
// invoke() parses JSON, so raw bytes cannot travel in the body.
//
// Reads go through the reporting views, which are security_invoker: the caller
// still sees exactly what RLS allows them to see.

import { createClient } from "npm:@insforge/sdk"
import * as XLSX from "npm:xlsx@0.18.5"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

type ReportType = "pengajuan" | "piutang" | "biaya-admin"

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  })
}

function toBase64(bytes: Uint8Array) {
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function dateOnly(value: string | null | undefined) {
  if (!value) return ""
  return String(value).slice(0, 10)
}

function num(value: unknown) {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function autoWidth(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return []
  return Object.keys(rows[0]).map((key) => {
    const longest = rows.reduce(
      (max, row) => Math.max(max, String(row[key] ?? "").length),
      key.length,
    )
    return { wch: Math.min(Math.max(longest + 2, 10), 42) }
  })
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS })
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405)
  }

  const authHeader = req.headers.get("Authorization")
  if (!authHeader) return json({ error: "unauthorized" }, 401)

  const client = createClient({
    baseUrl: Deno.env.get("INSFORGE_BASE_URL"),
    accessToken: authHeader.replace("Bearer ", ""),
  })

  const { data: userData } = await client.auth.getCurrentUser()
  const callerId = userData?.user?.id
  if (!callerId) return json({ error: "unauthorized" }, 401)

  const { data: caller } = await client.database
    .from("profiles")
    .select("role")
    .eq("id", callerId)
    .maybeSingle()

  if (caller?.role !== "admin") {
    return json({ error: "forbidden", detail: "hanya admin yang dapat export laporan" }, 403)
  }

  let body: { type?: ReportType; start?: string; end?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: "invalid_json" }, 400)
  }

  const type = body.type ?? "pengajuan"
  const start = body.start ? `${dateOnly(body.start)}T00:00:00.000Z` : null
  const end = body.end ? `${dateOnly(body.end)}T23:59:59.999Z` : null

  const workbook = XLSX.utils.book_new()
  let rows: Record<string, unknown>[] = []
  let sheetName = "Laporan"
  let filename = "laporan-kasbon"

  if (type === "pengajuan") {
    let query = client.database
      .from("application_report")
      .select("*")
      .order("submitted_at", { ascending: false })
    if (start) query = query.gte("submitted_at", start)
    if (end) query = query.lte("submitted_at", end)

    const { data, error } = await query
    if (error) return json({ error: "read_failed", detail: error.message }, 500)

    rows = (data ?? []).map((r: Record<string, unknown>) => ({
      "Kode Pengajuan": r.code,
      "Nama Karyawan": r.full_name,
      Email: r.email,
      Cabang: r.branch,
      Jabatan: r.jabatan,
      "Nominal Pengajuan": num(r.amount),
      "Jangka Waktu (bulan)": num(r.tenure_months),
      "Angsuran / Bulan": num(r.monthly_installment),
      "Provisi 1,5%": num(r.provisi_fee),
      "Admin Bulanan 1%": num(r.monthly_admin_fee),
      "Dana Cair": num(r.net_disbursement),
      Alasan: r.reason_category,
      Status: r.status,
      "Catatan Admin": r.admin_note ?? "",
      "Tanggal Pengajuan": dateOnly(r.submitted_at as string),
      "Tanggal Review": dateOnly(r.reviewed_at as string),
      "Tanggal Pencairan": dateOnly(r.disbursed_at as string),
    }))
    sheetName = "Rekap Pengajuan"
    filename = "rekap-pengajuan"
  } else if (type === "piutang") {
    let query = client.database
      .from("receivable_report")
      .select("*")
      .order("disbursed_on", { ascending: false })
    if (start) query = query.gte("disbursed_on", dateOnly(body.start))
    if (end) query = query.lte("disbursed_on", dateOnly(body.end))

    const { data, error } = await query
    if (error) return json({ error: "read_failed", detail: error.message }, 500)

    rows = (data ?? []).map((r: Record<string, unknown>) => ({
      "Kode Pengajuan": r.code,
      "Nama Karyawan": r.full_name,
      Cabang: r.branch,
      Jabatan: r.jabatan,
      "Pokok Pinjaman": num(r.principal),
      "Angsuran / Bulan": num(r.monthly_installment),
      "Jangka Waktu (bulan)": num(r.tenure_months),
      "Sudah Dipotong (bulan)": num(r.paid_months),
      "Sisa Piutang": num(r.remaining),
      Status: r.status,
      "Tanggal Pencairan": dateOnly(r.disbursed_on as string),
      "Jatuh Tempo Berikutnya": dateOnly(r.next_due_date as string),
      "Tanggal Lunas": dateOnly(r.settled_at as string),
    }))
    sheetName = "Kartu Piutang"
    filename = "rekap-kartu-piutang"
  } else if (type === "biaya-admin") {
    let query = client.database
      .from("receivable_report")
      .select("*")
      .order("disbursed_on", { ascending: false })
    if (start) query = query.gte("disbursed_on", dateOnly(body.start))
    if (end) query = query.lte("disbursed_on", dateOnly(body.end))

    const { data, error } = await query
    if (error) return json({ error: "read_failed", detail: error.message }, 500)

    rows = (data ?? []).map((r: Record<string, unknown>) => ({
      "Kode Pengajuan": r.code,
      "Nama Karyawan": r.full_name,
      Cabang: r.branch,
      "Pokok Pinjaman": num(r.principal),
      "Provisi 1,5%": num(r.provisi_fee),
      "Admin Bulanan 1%": num(r.monthly_admin_fee),
      "Jangka Waktu (bulan)": num(r.tenure_months),
      "Total Admin Bulanan": num(r.total_monthly_admin_fee),
      "Total Biaya Admin": num(r.total_admin_fee),
      "Tanggal Pencairan": dateOnly(r.disbursed_on as string),
    }))

    if (rows.length > 0) {
      rows.push({
        "Kode Pengajuan": "TOTAL",
        "Nama Karyawan": "",
        Cabang: "",
        "Pokok Pinjaman": rows.reduce((s, r) => s + num(r["Pokok Pinjaman"]), 0),
        "Provisi 1,5%": rows.reduce((s, r) => s + num(r["Provisi 1,5%"]), 0),
        "Admin Bulanan 1%": "",
        "Jangka Waktu (bulan)": "",
        "Total Admin Bulanan": rows.reduce((s, r) => s + num(r["Total Admin Bulanan"]), 0),
        "Total Biaya Admin": rows.reduce((s, r) => s + num(r["Total Biaya Admin"]), 0),
        "Tanggal Pencairan": "",
      })
    }
    sheetName = "Biaya Admin"
    filename = "rekap-biaya-admin"
  } else {
    return json({ error: "unknown_report_type", detail: type }, 400)
  }

  if (rows.length === 0) {
    rows = [{ Keterangan: "Tidak ada data pada periode yang dipilih" }]
  }

  const worksheet = XLSX.utils.json_to_sheet(rows)
  worksheet["!cols"] = autoWidth(rows)
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)

  const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer
  const periode = body.start && body.end
    ? `-${dateOnly(body.start)}_${dateOnly(body.end)}`
    : ""

  return json({
    filename: `${filename}${periode}.xlsx`,
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    base64: toBase64(new Uint8Array(buffer)),
    row_count: rows.length,
  })
}
