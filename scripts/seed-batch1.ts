#!/usr/bin/env npx tsx
/**
 * Seed Kartu Piutang — Batch 1 asli (15 karyawan, cair 8 Agustus 2026).
 *
 * Semua lewat InsForge CLI (`db query`), tanpa SDK/env tambahan: CLI sudah
 * terhubung ke project dan jalan dengan konteks admin, jadi bisa insert user,
 * memicu trigger pencairan, dan menandai angsuran.
 *
 * Angka finansial (ADM 1, ADM 2, ANGSURAN/BULAN, SISA) TIDAK diketik manual —
 * kolom generated dari `amount` + `tenure_months`, trigger pencairan yang
 * menghitung. Cukup isi pokok pinjaman + lama angsuran.
 *
 *   ADM 1  = provisi_fee        = amount * 1,5%
 *   ADM 2  = monthly_admin_fee * tenure = (amount * 1%) * tenure
 *   ANGS   = monthly_installment = amount / tenure
 *   SISA   = principal - monthly_installment * paid_months  (paid_months = 1)
 *
 * Bulan-1 ditandai "Sudah Dipotong" agar SISA cocok Excel (pokok - 1 angsuran).
 *
 * Idempoten: pengajuan lama untuk email yang sama dihapus dulu tiap run.
 * Jalankan: npx tsx scripts/seed-batch1.ts
 */

import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

// Tanggal pencairan batch (siang WITA → tanggal 8 Agustus 2026 di Asia/Makassar).
const DISBURSED_AT = "2026-08-08 12:00:00+08"

// Kartu contoh lama yang ikut dibersihkan (hanya pengajuannya — akun tetap ada).
// kocengnk@gmail.com = Ari Setiawan (admin login); cukup kartunya yang hilang.
const REMOVE_EMAILS = [
  "kocengnk@gmail.com",
  "budi.santoso@abs.co.id",
  "siti.rahayu@abs.co.id",
  "ahmad.fauzi@abs.co.id",
  "dewi.lestari@abs.co.id",
  "rizki.pratama@abs.co.id",
]

type Jabatan = "Staf/Pelaksana" | "Koordinator" | "SPV/Manager"

// jabatan dipilih agar amount <= plafon (Staf 3jt, Koordinator 4jt, SPV 6jt).
const BATCH1: {
  full_name: string
  amount: number
  tenure_months: number
  jabatan: Jabatan
}[] = [
  { full_name: "Iksan Saputra Amir", amount: 3_000_000, tenure_months: 6, jabatan: "Staf/Pelaksana" },
  { full_name: "Muhammad Fauzi Haikal", amount: 4_000_000, tenure_months: 6, jabatan: "Koordinator" },
  { full_name: "Muhammad Yuslan Yasid", amount: 3_000_000, tenure_months: 6, jabatan: "Staf/Pelaksana" },
  { full_name: "Muhammad Afinnas", amount: 3_000_000, tenure_months: 5, jabatan: "Staf/Pelaksana" },
  { full_name: "Muhammad Navaro Surya Bahari", amount: 3_000_000, tenure_months: 2, jabatan: "Staf/Pelaksana" },
  { full_name: "Asrida", amount: 4_000_000, tenure_months: 6, jabatan: "Koordinator" },
  { full_name: "Noldyansyah", amount: 3_000_000, tenure_months: 6, jabatan: "Staf/Pelaksana" },
  { full_name: "Rini Indriani", amount: 4_000_000, tenure_months: 6, jabatan: "Koordinator" },
  { full_name: "Febri Armando", amount: 3_000_000, tenure_months: 3, jabatan: "Staf/Pelaksana" },
  { full_name: "Israjab Ischak", amount: 2_000_000, tenure_months: 2, jabatan: "Staf/Pelaksana" },
  { full_name: "Achmad Dahlan", amount: 4_000_000, tenure_months: 6, jabatan: "Koordinator" },
  { full_name: "Abdillah Muharam Saputra", amount: 2_000_000, tenure_months: 2, jabatan: "Staf/Pelaksana" },
  { full_name: "Yuyut Novianus", amount: 3_000_000, tenure_months: 5, jabatan: "Staf/Pelaksana" },
  { full_name: "Zul Muzhahir", amount: 3_000_000, tenure_months: 6, jabatan: "Staf/Pelaksana" },
  { full_name: "Elvira Amalia", amount: 3_000_000, tenure_months: 2, jabatan: "Staf/Pelaksana" },
]

// Detail non-finansial seragam — tidak ada di Excel, hanya memenuhi NOT NULL.
const BRANCH = "Cabang Makassar"
const REASON_CATEGORY = "Kebutuhan Domestik Mendesak"
const REASON_DETAIL = "Kebutuhan keluarga mendesak"
const CONTRACT_START = "2024-01-01"
const CONTRACT_END = "2027-12-31"

function slugEmail(name: string, idx: number) {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
  return `${slug}${idx + 1}@abs.co.id`
}

function phone(idx: number) {
  return `08130000${String(idx + 1).padStart(4, "0")}`
}

function esc(s: string) {
  return s.replace(/'/g, "''")
}

function sql(statement: string): unknown {
  const raw = execFileSync(
    "npx",
    ["-y", "@insforge/cli", "db", "query", statement, "--json", "--yes"],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  )
  return JSON.parse(raw)
}

function sqlRows<T = Record<string, unknown>>(statement: string): T[] {
  const result = sql(statement) as { rows?: T[] }
  return result.rows ?? []
}

function seed() {
  console.log("🌱 Seed Kartu Piutang — Batch 1 (15 karyawan)\n")

  const users = BATCH1.map((u, i) => ({
    ...u,
    email: slugEmail(u.full_name, i),
    phone: phone(i),
    family_phone: phone(i + 100),
  }))

  // 0. Bersihkan pengajuan lama untuk email contoh + Batch 1 (idempoten).
  console.log("🧹 Hapus pengajuan lama (kartu contoh + rerun Batch 1)...")
  const wipe = [...REMOVE_EMAILS, ...users.map((u) => u.email)]
    .map((e) => `'${esc(e.toLowerCase())}'`)
    .join(", ")
  sql(`
    SET LOCAL kasbon.system_write = 'on';
    DELETE FROM public.applications a
    USING auth.users u
    WHERE a.user_id = u.id AND LOWER(u.email) IN (${wipe});
  `)
  console.log("  ✓ selesai")

  // 1. User + profile + application + pencairan, per karyawan.
  console.log("\n💰 Buat & cairkan 15 kartu (8 Agustus 2026)...")
  let ok = 0
  for (let i = 0; i < users.length; i++) {
    const u = users[i]
    const bankAcct = `0001${String(i + 1).padStart(6, "0")}`

    // auth user (buat kalau belum ada; password null — akun ini tak perlu login)
    let found = sqlRows<{ id: string }>(
      `SELECT id FROM auth.users WHERE LOWER(email) = LOWER('${esc(u.email)}')`
    )
    if (found.length === 0) {
      found = sqlRows<{ id: string }>(`
        INSERT INTO auth.users (email, email_verified)
        VALUES ('${esc(u.email)}', true)
        RETURNING id
      `)
    }
    const userId = found[0]?.id
    if (!userId) {
      console.error(`  ✗ ${u.full_name}: gagal buat user`)
      continue
    }
    sql(`UPDATE auth.users SET email_verified = true WHERE id = '${userId}'`)

    // profile
    sql(`
      INSERT INTO public.profiles (id, email, full_name, role, jabatan, branch, phone, family_phone, bank_name, bank_account, contract_start, contract_end, join_date)
      VALUES ('${userId}', '${esc(u.email)}', '${esc(u.full_name)}', 'pemohon', '${esc(u.jabatan)}', '${esc(BRANCH)}', '${u.phone}', '${u.family_phone}', 'BRI', '${bankAcct}', '${CONTRACT_START}', '${CONTRACT_END}', '${CONTRACT_START}')
      ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        jabatan   = EXCLUDED.jabatan,
        branch    = EXCLUDED.branch,
        bank_account = EXCLUDED.bank_account
    `)

    // application
    const appRows = sqlRows<{ id: string; code: string }>(`
      INSERT INTO public.applications
        (user_id, jabatan, join_date, contract_start, contract_end,
         amount, tenure_months, phone, family_phone,
         reason_category, reason_detail, bank_name, bank_account)
      VALUES
        ('${userId}', '${esc(u.jabatan)}', '${CONTRACT_START}', '${CONTRACT_START}', '${CONTRACT_END}',
         ${u.amount}, ${u.tenure_months}, '${u.phone}', '${u.family_phone}',
         '${esc(REASON_CATEGORY)}', '${esc(REASON_DETAIL)}', 'BRI', '${bankAcct}')
      RETURNING id, code
    `)
    const appId = appRows[0]?.id
    if (!appId) {
      console.error(`  ✗ ${u.full_name}: gagal buat pengajuan`)
      continue
    }

    // cairkan → trigger buat receivable + installments
    sql(`
      SET LOCAL kasbon.system_write = 'on';
      UPDATE public.applications
      SET status = 'Disetujui / Cair',
          disbursed_at = '${DISBURSED_AT}',
          reviewed_at = '${DISBURSED_AT}'
      WHERE id = '${appId}';
    `)

    // tandai angsuran bulan-1 sudah dipotong (SISA = pokok - 1 angsuran)
    sql(`
      SET LOCAL kasbon.system_write = 'on';
      UPDATE public.installments
      SET status = 'Sudah Dipotong', paid_on = '2026-08-08'
      WHERE receivable_id IN (
        SELECT id FROM public.receivables WHERE application_id = '${appId}'
      )
      AND month_no = 1;
    `)

    ok++
    console.log(`  ✓ ${appRows[0].code} — ${u.full_name} Rp${u.amount.toLocaleString("id-ID")} / ${u.tenure_months} bln`)
  }

  console.log("\n" + "═".repeat(60))
  console.log(`✅ SEED BATCH 1 SELESAI — ${ok}/${users.length} kartu`)
  console.log("  Buka Admin → Kartu Piutang")
  console.log("═".repeat(60))
}

try {
  seed()
} catch (err) {
  console.error("Error:", err instanceof Error ? err.message : String(err))
  process.exit(1)
}
