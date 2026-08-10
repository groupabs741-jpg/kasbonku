#!/usr/bin/env node
/**
 * Kirim satu email uji lewat jalur produksi yang sebenarnya:
 * antre di public.notifications -> notifications-dispatch -> Resend.
 *
 * Ini menguji rantai yang sama dengan notifikasi asli, jadi kalau lolos di sini
 * berarti pengajuan/review/reminder juga akan terkirim. Baris uji dihapus lagi
 * setelah selesai.
 *
 * Pakai:
 *   node scripts/test-email.mjs tujuan@absgroup.biz.id
 */

import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const target = process.argv[2]

if (!target || !target.includes("@")) {
  console.error("Pakai: node scripts/test-email.mjs tujuan@absgroup.biz.id")
  process.exit(1)
}

let project
try {
  project = JSON.parse(readFileSync(join(root, ".insforge/project.json"), "utf8"))
} catch {
  console.error("Project belum ter-link. Jalankan: npx -y @insforge/cli link --project-id <id>")
  process.exit(1)
}

const cli = (args, quiet = false) =>
  execFileSync("npx", ["-y", "@insforge/cli", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", quiet ? "pipe" : "inherit"],
  })

const sql = (statement) => JSON.parse(cli(["db", "query", statement, "--json"], true))

const secret = (key) => {
  try {
    return cli(["secrets", "get", key], true).split("=").slice(1).join("=").trim()
  } catch {
    return ""
  }
}

// --- 1. Cek konfigurasi ------------------------------------------------------
const apiKey = secret("RESEND_API_KEY")
const fromEmail = secret("RESEND_FROM_EMAIL")
const cronSecret = secret("KASBON_CRON_SECRET")

console.log("Konfigurasi:")
console.log(`  RESEND_API_KEY    ${apiKey ? "terisi (" + apiKey.slice(0, 6) + "…)" : "KOSONG"}`)
console.log(`  RESEND_FROM_EMAIL ${fromEmail || "KOSONG"}`)
console.log(`  KASBON_CRON_SECRET ${cronSecret ? "terisi" : "KOSONG"}`)

if (!apiKey || !fromEmail) {
  console.error("\nRESEND_API_KEY dan RESEND_FROM_EMAIL wajib diisi dulu. Lihat README.")
  process.exit(1)
}
if (!cronSecret) {
  console.error("\nKASBON_CRON_SECRET hilang — tidak bisa memanggil notifications-dispatch.")
  process.exit(1)
}

// --- 2. Antre satu notifikasi uji --------------------------------------------
const escaped = target.replace(/'/g, "''")
const inserted = sql(`
  INSERT INTO public.notifications (user_id, type, title, body, email_to)
  SELECT p.id, 'pengajuan_baru',
         'Tes kiriman email Kasbonku',
         'Kalau email ini sampai, pengaturan Resend untuk Kasbonku sudah benar. Abaikan pesan ini.',
         '${escaped}'
  FROM public.profiles p
  WHERE p.role = 'admin'
  ORDER BY p.created_at
  LIMIT 1
  RETURNING id
`)

const id = inserted.rows?.[0]?.id
if (!id) {
  console.error("\nBelum ada akun admin. Buat dulu: node scripts/create-admin.mjs <email> <password>")
  process.exit(1)
}
console.log(`\nNotifikasi uji diantrekan (${id}). Mengirim…`)

// --- 3. Jalankan dispatch ----------------------------------------------------
const response = await fetch(`${project.oss_host}/functions/notifications-dispatch`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-kasbon-cron-secret": cronSecret },
  body: "{}",
})
const result = await response.json().catch(() => null)
console.log("Hasil dispatch:", JSON.stringify(result))

// --- 4. Baca status baris uji, lalu bersihkan --------------------------------
const after = sql(`SELECT email_status, email_error, sent_at FROM public.notifications WHERE id = '${id}'`)
const row = after.rows?.[0]
sql(`DELETE FROM public.notifications WHERE id = '${id}'`)

console.log("")
if (row?.email_status === "sent") {
  console.log(`✓ Terkirim ke ${target}. Cek inbox (dan folder spam).`)
  console.log("  Notifikasi Kasbonku sekarang aktif.")
  process.exit(0)
}

console.error(`✗ Gagal. Status: ${row?.email_status ?? "tidak diketahui"}`)
if (row?.email_error) console.error(`  Pesan Resend: ${row.email_error}`)
console.error("\nPenyebab tersering:")
console.error("  403 / 'domain is not verified'")
console.error(`    -> domain pada ${fromEmail} belum diverifikasi di Resend (Domains -> Add Domain).`)
console.error("       Untuk uji cepat pakai onboarding@resend.dev — tapi hanya bisa mengirim")
console.error("       ke alamat email pemilik akun Resend.")
console.error("  401 / 'API key is invalid'")
console.error("    -> RESEND_API_KEY salah atau sudah dicabut.")
console.error("  422 / 'You can only send testing emails to your own email address'")
console.error("    -> masih memakai onboarding@resend.dev; verifikasi domain dulu.")
process.exit(1)
