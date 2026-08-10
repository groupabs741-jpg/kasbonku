// Builds one combined official ABS Group document for an application.
//
// Permohonan, Persetujuan, and Penyerahan sit on a single print-ready A4 page,
// separated by the dashed cut lines of the paper form. The applicant signature
// is inserted into the same file by the client; the applicant then prints that
// file, collects their supervisor's wet signature on the "Mengetahui" column,
// and uploads the scan before the application moves to review.
//
// POST { application_id: string } — admin only.

import { createClient } from "npm:@insforge/sdk"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

const BUCKET = "kasbon-documents"
const GENERATED_KIND = "permohonan"

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  })
}

function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function rupiah(value: number | string | null | undefined) {
  const n = Number(value ?? 0)
  return "Rp " + n.toLocaleString("id-ID", { maximumFractionDigits: 0 })
}

const MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
]

function tanggal(value: string | null | undefined) {
  if (!value) return "-"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "-"
  return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear()
}

function tanggalKoma(value: string | null | undefined) {
  if (!value) return "____, __, ______"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "____, __, ______"
  return d.getDate() + ", " + (d.getMonth() + 1) + ", " + d.getFullYear()
}

function sisaKontrak(days: number) {
  if (days <= 0) return "Kontrak berakhir"
  const months = Math.floor(days / 30)
  const rest = days % 30
  if (months === 0) return rest + " Hari"
  if (rest === 0) return months + " Bulan"
  return months + " Bulan " + rest + " Hari"
}

const NUMBER_WORDS = [
  "nol",
  "satu",
  "dua",
  "tiga",
  "empat",
  "lima",
  "enam",
  "tujuh",
  "delapan",
  "sembilan",
  "sepuluh",
  "sebelas",
]

function terbilangNumber(value: number): string {
  if (value < 12) return NUMBER_WORDS[value]
  if (value < 20) return terbilangNumber(value - 10) + " belas"
  if (value < 100) {
    return (
      terbilangNumber(Math.floor(value / 10)) +
      " puluh" +
      (value % 10 ? " " + terbilangNumber(value % 10) : "")
    )
  }
  if (value < 200) {
    return "seratus" + (value % 100 ? " " + terbilangNumber(value % 100) : "")
  }
  if (value < 1000) {
    return (
      terbilangNumber(Math.floor(value / 100)) +
      " ratus" +
      (value % 100 ? " " + terbilangNumber(value % 100) : "")
    )
  }
  if (value < 2000) {
    return "seribu" + (value % 1000 ? " " + terbilangNumber(value % 1000) : "")
  }
  if (value < 1_000_000) {
    return (
      terbilangNumber(Math.floor(value / 1000)) +
      " ribu" +
      (value % 1000 ? " " + terbilangNumber(value % 1000) : "")
    )
  }
  if (value < 2_000_000) {
    return (
      "satu juta" +
      (value % 1_000_000 ? " " + terbilangNumber(value % 1_000_000) : "")
    )
  }
  if (value < 1_000_000_000) {
    return (
      terbilangNumber(Math.floor(value / 1_000_000)) +
      " juta" +
      (value % 1_000_000 ? " " + terbilangNumber(value % 1_000_000) : "")
    )
  }
  return rupiah(value)
}

function terbilang(value: number | string | null | undefined) {
  const amount = Math.max(0, Math.floor(Number(value ?? 0)))
  const words = terbilangNumber(amount)
  return words.charAt(0).toUpperCase() + words.slice(1) + " rupiah"
}

function multiline(value: unknown) {
  return esc(value).replace(/\r?\n/g, "<br />")
}

function shell(title: string, code: string, body: string) {
  return [
    "<!doctype html>",
    '<html lang="id">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    "<title>",
    esc(title),
    " - ",
    esc(code),
    "</title>",
    "<style>",
    "@page { size: A4; margin: 0; }",
    "* { box-sizing: border-box; }",
    "html { background: #202522; }",
    "body { margin: 0; background: #202522; color: #111; font-family: 'Times New Roman', Times, serif; font-size: 10pt; line-height: 1.12; }",
    ".toolbar { position: fixed; top: 14px; right: 14px; z-index: 10; }",
    ".toolbar button { border: 0; border-radius: 999px; background: #087f68; color: #fff; cursor: pointer; font-family: system-ui, sans-serif; font-size: 13px; padding: 9px 16px; }",
    ".document { width: 210mm; margin: 16px auto; background: #fff; box-shadow: 0 1px 10px rgba(0, 0, 0, .24); }",
    // Every sheet shares one A4 page, so the page itself never breaks.
    ".form-page { position: relative; height: 297mm; padding: 6mm 9mm; page-break-after: auto; }",
    ".sheet { page-break-inside: avoid; }",
    ".sheet + .divider { margin: 2.6mm 0; border-top: 1.2px dashed #111; }",
    ".top-meta { display: grid; grid-template-columns: 1fr 1fr; align-items: end; min-height: 7mm; font-size: 10.5pt; font-style: italic; font-weight: 700; }",
    ".top-meta .right { text-align: right; font-style: normal; }",
    ".filler { font-size: 7.5pt; font-style: italic; font-weight: 700; }",
    ".form-title { border: 1.5px solid #111; background: #b8d9ef; padding: 2px 6px; text-align: center; font-size: 12.5pt; font-weight: 700; line-height: 1.1; }",
    "table { width: 100%; border-collapse: collapse; }",
    ".info-table { margin-top: 0; }",
    ".info-table td { border: 1.5px solid #111; padding: 0.6mm 8px; vertical-align: middle; }",
    ".info-table .label { width: 35%; }",
    ".info-table .value { width: 65%; }",
    ".intro { border: 1.5px solid #111; border-bottom: 0; padding: 0.8mm 8px; font-size: 10pt; font-style: italic; }",
    ".loan-table td { border-left: 1.5px solid #111; border-right: 1.5px solid #111; padding: 0.6mm 8px; vertical-align: top; }",
    ".loan-table tr:first-child td { border-top: 1.5px solid #111; }",
    ".loan-table tr:last-child td { border-bottom: 1.5px solid #111; }",
    ".loan-table .label { width: 35%; }",
    ".loan-table .value { width: 65%; }",
    ".loan-table .tall { height: 9mm; }",
    // Long "Keperluan" text shrinks instead of pushing the sheet onto page two.
    ".loan-table .shrink { font-size: 8.5pt; line-height: 1.05; }",
    ".loan-table .shrink-2 { font-size: 7.5pt; line-height: 1.02; }",
    ".declaration { border: 1.5px solid #111; border-top: 0; padding: 1mm 8px; font-size: 9pt; font-style: italic; font-weight: 700; text-align: justify; }",
    ".signature-table { margin-top: 0; table-layout: fixed; }",
    ".signature-table td { border: 1.5px solid #111; padding: 1mm 4px; text-align: center; vertical-align: top; }",
    ".sig-cell { display: flex; height: 24mm; flex-direction: column; overflow: hidden; }",
    ".signature-heading { flex: 0 0 auto; font-size: 11pt; }",
    ".signature-space { display: flex; flex: 1 1 auto; min-height: 0; align-items: center; justify-content: center; }",
    // The applicant's signature is wrapped in this slot so signing again swaps
    // the image instead of adding a second one beside it.
    ".signature-slot { display: contents; }",
    ".signature-image { display: block; width: 32mm; max-height: 13mm; object-fit: contain; }",
    ".signature-name { flex: 0 0 auto; font-size: 10pt; text-decoration: underline; }",
    ".signature-name.long { font-size: 8.5pt; }",
    ".signature-role { flex: 0 0 auto; font-size: 9.5pt; }",
    ".notes { margin: 1px 0 0; font-size: 7.5pt; line-height: 1.15; }",
    ".notes p { margin: 0.5px 0; }",
    ".approval-table td, .handover-table td { border: 1.5px solid #111; padding: 0.7mm 8px; vertical-align: top; }",
    ".approval-table .label { width: 35%; }",
    ".approval-table .value { width: 65%; }",
    ".approval-table .service { padding-left: 18px; }",
    ".handover-table .label { width: 25%; }",
    ".handover-table .value { width: 75%; }",
    ".handover-table .tall { height: 8mm; }",
    "@media print { html, body { background: #fff; } .toolbar { display: none; } .document { width: auto; margin: 0; box-shadow: none; } }",
    "</style>",
    "</head>",
    "<body>",
    '<div class="toolbar"><button onclick="window.print()">Cetak / Simpan PDF</button></div>',
    '<main class="document">',
    body,
    "</main>",
    "</body>",
    "</html>",
  ].join("")
}

function signatureSlot() {
  return '<div class="signature-space"><!-- SIGNATURE:PEMOHON --></div>'
}

function signatureCell(
  heading: string,
  name: string,
  role: string,
  applicant = false
) {
  return [
    "<td>",
    // Fixed-height wrapper: a long name eats into the signing space instead of
    // growing the cell and pushing the sheet off the page.
    '<div class="sig-cell">',
    '<div class="signature-heading">',
    esc(heading),
    "</div>",
    applicant ? signatureSlot() : '<div class="signature-space"></div>',
    '<div class="signature-name',
    name.length > 26 ? " long" : "",
    '">',
    esc(name),
    "</div>",
    '<div class="signature-role">',
    esc(role),
    "</div>",
    "</div>",
    "</td>",
  ].join("")
}

function namaPemohon(profile: any) {
  return profile?.full_name || profile?.email || "-"
}

function identityTable(app: any, profile: any) {
  const nama = namaPemohon(profile)
  return [
    '<table class="info-table">',
    '<tr><td class="label">Nama Karyawan</td><td class="value">: ',
    esc(nama),
    "</td></tr>",
    '<tr><td class="label">Jabatan</td><td class="value">: ',
    esc(app.jabatan),
    "</td></tr>",
    '<tr><td class="label">Join Date</td><td class="value">: ',
    esc(tanggal(app.join_date)),
    "</td></tr>",
    '<tr><td class="label">Masa Kontrak</td><td class="value">: ',
    esc(tanggal(app.contract_start)),
    " Sampai ",
    esc(tanggal(app.contract_end)),
    "</td></tr>",
    '<tr><td class="label">Sisa Kontrak</td><td class="value">: ',
    esc(sisaKontrak(Number(app.remaining_contract_days))),
    "</td></tr>",
    '<tr><td class="label">No. Telepon</td><td class="value">: ',
    esc(app.phone),
    "</td></tr>",
    '<tr><td class="label">No. Telepon Keluarga</td><td class="value">: ',
    esc(app.family_phone),
    "</td></tr>",
    "</table>",
  ].join("")
}

function renderPermohonan(app: any, profile: any, today: string) {
  const keperluan = app.reason_detail
    ? app.reason_category + " - " + app.reason_detail
    : app.reason_category
  const keperluanClass =
    keperluan.length > 260
      ? " shrink-2"
      : keperluan.length > 130
        ? " shrink"
        : ""

  return [
    '<section class="sheet">',
    '<div class="filler">*Diisi Karyawan Pemohon</div>',
    '<div class="top-meta"><span>Tanggal Pengajuan : ',
    esc(tanggalKoma(today)),
    '</span><span class="right">Nomor Pengajuan: ',
    esc(app.code),
    "</span></div>",
    '<div class="form-title">LEMBAR PERMOHONAN</div>',
    identityTable(app, profile),
    '<div class="intro">Dengan ini mengajukan permohonan peminjaman uang kepada Perusahaan sebagai berikut :</div>',
    '<table class="loan-table">',
    '<tr><td class="label">Nominal Pengajuan Pinjaman</td><td class="value">: ',
    esc(rupiah(app.amount)),
    "</td></tr>",
    '<tr><td class="label">Terbilang</td><td class="value">: ',
    esc(terbilang(app.amount)),
    "</td></tr>",
    '<tr><td class="label tall">Keperluan</td><td class="value tall',
    keperluanClass,
    '">: ',
    multiline(keperluan),
    "</td></tr>",
    '<tr><td class="label">Angsuran Pelunasan</td><td class="value">: ',
    esc(rupiah(app.monthly_installment)),
    " x ",
    esc(app.tenure_months),
    " Bulan</td></tr>",
    '<tr><td class="label">Jaminan</td><td class="value">: Tidak ada</td></tr>',
    "</table>",
    '<div class="declaration">Demikian Permohonan ini saya buat saya menyatakan bahwa data yang saya cantumkan adalah benar adanya dan saya bersedia melunasi pinjaman saya apabila hubungan kerja dengan Perusahaan berakhir seketika, serta saya siap untuk dilaporkan dipihak yang berwajib jika saya melanggar kebijakan pelunasan dana yang telah saya pinjam.</div>',
    '<table class="signature-table">',
    "<tr>",
    signatureCell("Pemohon", "(" + namaPemohon(profile) + ")", "", true),
    signatureCell(
      "Mengetahui",
      "(________________________)",
      "Atasan Langsung"
    ),
    signatureCell("Diperiksa", "(Yunanto Adi Bowo L)", "Wakil Ketua"),
    signatureCell("Disetujui", "(Hesty Febriana Leroux)", "Ketua"),
    "</tr>",
    "</table>",
    '<div class="notes"><p><strong>Noted</strong> &nbsp;&nbsp;&nbsp;: 1. Masa Kontrak adalah masa kontrak yang sedang berjalan yaitu tanggal dimulainya kontrak sampai tanggal kontrak berakhir</p><p>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Misal : 21 Juni 2026 Sampai 20 September 2026 (Masa Kontrak 3 Bulan)</p><p>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;2. Sisa Kontrak adalah tanggal kontrak berakhir dikurangi tanggal pengajuan kasbon</p><p>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Misal : karyawan mengajukan kasbon di tanggal 31 Juli 2026 dengan Masa Kontrak No.1 maka terhitung 1 Bulan 19 Hari</p></div>',
    "</section>",
  ].join("")
}

function renderPersetujuan(app: any, profile: any) {
  const totalAdmin = Number(app.monthly_admin_fee) * Number(app.tenure_months)
  return [
    '<section class="sheet">',
    '<div class="filler">*Diisi Sekretaris</div>',
    '<div class="form-title">LEMBAR PERSETUJUAN</div>',
    '<table class="approval-table">',
    '<tr><td class="label">Nominal Pinjaman</td><td class="value">: <em>',
    esc(rupiah(app.amount)),
    "</em></td></tr>",
    '<tr><td class="label">Biaya Layanan</td><td class="value"></td></tr>',
    '<tr><td class="label service">▪&nbsp; Biaya Administrasi 1</td><td class="value">: <em>',
    esc(rupiah(app.provisi_fee)),
    "</em></td></tr>",
    '<tr><td class="label service">▪&nbsp; Biaya Administrasi 2/bulan</td><td class="value">: <em>',
    esc(rupiah(app.monthly_admin_fee)),
    " x ",
    esc(app.tenure_months),
    " Bulan = ",
    esc(rupiah(totalAdmin)),
    "</em></td></tr>",
    '<tr><td class="label">Nominal Bersih Diterima</td><td class="value">: <strong><em>',
    esc(rupiah(app.net_disbursement)),
    "</em></strong></td></tr>",
    "</table>",
    '<table class="signature-table">',
    "<tr>",
    signatureCell("Pemohon", "(" + namaPemohon(profile) + ")", "", true),
    signatureCell("Diperiksa", "(Kurniati Yanas)", "Sekertaris"),
    signatureCell("Disetuji", "(Hesty Febriana Leroux)", "Ketua"),
    "</tr>",
    "</table>",
    "</section>",
  ].join("")
}

function renderPenyerahan(app: any, profile: any) {
  return [
    '<section class="sheet">',
    '<div class="filler">*Diisi Bendahara</div>',
    '<div class="form-title">LEMBAR PENYERAHAN</div>',
    '<table class="handover-table">',
    '<tr><td class="label">Jumlah</td><td class="value"><em>',
    esc(rupiah(app.net_disbursement)),
    "</em></td></tr>",
    '<tr><td class="label tall">Terbilang</td><td class="value tall"><em>',
    esc(terbilang(app.net_disbursement)),
    "</em></td></tr>",
    "</table>",
    '<table class="signature-table">',
    "<tr>",
    signatureCell("Diterima Oleh", "(" + namaPemohon(profile) + ")", "", true),
    signatureCell("Diserahkan Oleh", "(Rita Sardiani)", "Bendahara"),
    "</tr>",
    "</table>",
    "</section>",
  ].join("")
}

// One A4 page holds all three sheets, split by the dashed cut lines.
// deno-lint-ignore no-explicit-any
function renderDocument(app: any, profile: any, today: string) {
  return shell(
    "Dokumen Kasbon",
    app.code,
    '<div class="form-page">' +
      renderPermohonan(app, profile, today) +
      '<div class="divider"></div>' +
      renderPersetujuan(app, profile) +
      '<div class="divider"></div>' +
      renderPenyerahan(app, profile) +
      "</div>"
  )
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
    return json(
      {
        error: "forbidden",
        detail: "hanya admin yang dapat generate dokumen",
      },
      403
    )
  }

  let body: { application_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: "invalid_json" }, 400)
  }
  if (!body.application_id) {
    return json({ error: "application_id_required" }, 400)
  }

  const { data: app, error: appError } = await client.database
    .from("applications")
    .select("*")
    .eq("id", body.application_id)
    .maybeSingle()

  if (appError)
    return json({ error: "read_failed", detail: appError.message }, 500)
  if (!app) return json({ error: "application_not_found" }, 404)

  const { data: profile } = await client.database
    .from("profiles")
    .select("full_name, email, branch")
    .eq("id", app.user_id)
    .maybeSingle()

  const today = new Date().toISOString()
  const oldKinds = [
    "permohonan",
    "persetujuan",
    "penyerahan",
    "ttd_pemohon",
    "ttd_scan",
    "ttd_digital",
  ]

  // Regeneration replaces the whole previous set, including legacy signature
  // artefacts, so the applicant sees exactly one current document.
  const { error: deleteError } = await client.database
    .from("documents")
    .delete()
    .eq("application_id", app.id)
    .in("kind", oldKinds)

  if (deleteError) {
    return json(
      { error: "document_cleanup_failed", detail: deleteError.message },
      500
    )
  }

  const html = renderDocument(app, profile, today)
  const key =
    app.user_id + "/" + app.id + "/dokumen-kasbon-" + app.code + ".html"
  const fileName = "dokumen-kasbon-" + app.code + ".html"
  const file = new File([html], fileName, { type: "text/html" })

  const { data: uploaded, error: uploadError } = await client.storage
    .from(BUCKET)
    .upload(key, file)

  if (uploadError) {
    return json({ error: "upload_failed", detail: uploadError.message }, 500)
  }

  const { error: insertError } = await client.database
    .from("documents")
    .insert([
      {
        application_id: app.id,
        user_id: app.user_id,
        kind: GENERATED_KIND,
        bucket: BUCKET,
        object_key: uploaded?.key ?? key,
        file_name: fileName,
        mime_type: "text/html",
        size_bytes: html.length,
      },
    ])

  if (insertError) {
    return json(
      { error: "document_record_failed", detail: insertError.message },
      500
    )
  }

  if (app.status === "Diajukan") {
    await client.database
      .from("applications")
      .update({ status: "Diproses Admin" })
      .eq("id", app.id)
  }

  return json({
    application_id: app.id,
    code: app.code,
    documents: [
      {
        kind: GENERATED_KIND,
        key: uploaded?.key ?? key,
        url: uploaded?.url ?? null,
      },
    ],
  })
}
