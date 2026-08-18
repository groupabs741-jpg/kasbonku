#!/usr/bin/env npx tsx
/**
 * Seed test data untuk Kartu Piutang.
 *
 * Membuat 5 karyawan + pengajuan, lalu push ke "Disetujui / Cair"
 * agar trigger otomatis membuat receivable + installments.
 *
 * Jalankan: npx tsx scripts/seed-piutang.ts
 *
 * Membutuhkan env: INSFORGE_BASE_URL dan API_KEY.
 */

import { createAdminClient } from "@insforge/sdk"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import "dotenv/config"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

const client = createAdminClient({
  baseUrl: process.env.INSFORGE_BASE_URL!,
  apiKey: process.env.API_KEY!,
})

// Run SQL via InsForge CLI (bypasses RLS + can set kasbon.system_write)
function sql(statement: string): unknown {
  const raw = execFileSync(
    "npx",
    ["-y", "@insforge/cli", "db", "query", statement, "--json"],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  )
  return JSON.parse(raw)
}

function sqlRows<T = Record<string, unknown>>(statement: string): T[] {
  const result = sql(statement) as { rows?: T[] }
  return result.rows ?? []
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const TEST_USERS = [
  {
    email: "budi.santoso@abs.co.id",
    password: "Test1234!",
    full_name: "Budi Santoso",
    jabatan: "Staf/Pelaksana" as const,
    branch: "Cabang Jakarta",
    phone: "081234567890",
    family_phone: "081234567891",
    bank_name: "BCA",
    bank_account: "1234567890",
    contract_start: "2024-01-15",
    contract_end: "2027-01-14",
    amount: 3_000_000,
    tenure_months: 6,
    reason_category: "Kebutuhan Domestik Mendesak" as const,
    reason_detail: "Perbaikan motor untuk transportasi kerja",
    mark_paid: 2, // bulan yang ditandai sudah dipotong
  },
  {
    email: "siti.rahayu@abs.co.id",
    password: "Test1234!",
    full_name: "Siti Rahayu",
    jabatan: "Koordinator" as const,
    branch: "Cabang Surabaya",
    phone: "082345678901",
    family_phone: "082345678902",
    bank_name: "Mandiri",
    bank_account: "2345678901",
    contract_start: "2023-06-01",
    contract_end: "2026-05-31",
    amount: 4_000_000,
    tenure_months: 4,
    reason_category: "Pendidikan / Sekolah" as const,
    reason_detail: "Uang pangkal sekolah anak",
    mark_paid: 4, // lunas semua
  },
  {
    email: "ahmad.fauzi@abs.co.id",
    password: "Test1234!",
    full_name: "Ahmad Fauzi",
    jabatan: "SPV/Manager" as const,
    branch: "Cabang Bandung",
    phone: "083456789012",
    family_phone: "083456789013",
    bank_name: "BNI",
    bank_account: "3456789012",
    contract_start: "2022-03-01",
    contract_end: "2027-02-28",
    amount: 6_000_000,
    tenure_months: 6,
    reason_category: "Kesehatan / Medis Darurat" as const,
    reason_detail: "Biaya operasi keluarga",
    mark_paid: 0, // belum ada yang dibayar
  },
  {
    email: "dewi.lestari@abs.co.id",
    password: "Test1234!",
    full_name: "Dewi Lestari",
    jabatan: "Staf/Pelaksana" as const,
    branch: "Cabang Jakarta",
    phone: "084567890123",
    family_phone: "084567890124",
    bank_name: "BRI",
    bank_account: "4567890123",
    contract_start: "2025-01-01",
    contract_end: "2027-12-31",
    amount: 2_500_000,
    tenure_months: 3,
    reason_category: "Kebutuhan Keluarga / Persalinan" as const,
    reason_detail: "Biaya persalinan",
    mark_paid: 1,
  },
  {
    email: "rizki.pratama@abs.co.id",
    password: "Test1234!",
    full_name: "Rizki Pratama",
    jabatan: "Koordinator" as const,
    branch: "Cabang Medan",
    phone: "085678901234",
    family_phone: "085678901235",
    bank_name: "BCA",
    bank_account: "5678901234",
    contract_start: "2024-07-01",
    contract_end: "2026-06-30",
    amount: 3_500_000,
    tenure_months: 5,
    reason_category: "Kedukaan / Musibah" as const,
    reason_detail: "Pengurusan jenazah keluarga",
    mark_paid: 3,
  },
]

function esc(s: string) {
  return s.replace(/'/g, "''")
}

async function seed() {
  console.log("🌱 Seed Kartu Piutang — mulai\n")

  const createdUserIds: string[] = []

  // 1. Buat auth users
  console.log("👤 Membuat auth users...")
  for (const u of TEST_USERS) {
    const { error } = await client.auth.signUp({
      email: u.email,
      password: u.password,
      name: u.full_name,
    })
    if (error && !/exist/i.test(error.message ?? "")) {
      console.error(`  ✗ ${u.email}: ${error.message}`)
      continue
    }
    console.log(`  ✓ ${u.email}`)
  }

  // 2. Pastikan profile ada + update data lengkap via SQL
  console.log("\n📋 Setup profiles...")
  for (const u of TEST_USERS) {
    // ensure email_verified + get user_id
    const users = sqlRows<{ id: string }>(
      `SELECT id FROM auth.users WHERE LOWER(email) = LOWER('${esc(u.email)}')`
    )
    if (users.length === 0) {
      console.error(`  ✗ User ${u.email} tidak ditemukan di auth.users`)
      continue
    }
    const userId = users[0].id

    // Mark email verified (no SMTP in dev)
    sql(`UPDATE auth.users SET email_verified = true WHERE id = '${userId}'`)

    // Insert or update profile
    sql(`
      INSERT INTO public.profiles (id, email, full_name, role, jabatan, branch, phone, family_phone, bank_name, bank_account, contract_start, contract_end, join_date)
      VALUES ('${userId}', '${esc(u.email)}', '${esc(u.full_name)}', 'pemohon', '${esc(u.jabatan)}', '${esc(u.branch)}', '${esc(u.phone)}', '${esc(u.family_phone)}', '${esc(u.bank_name)}', '${esc(u.bank_account)}', '${u.contract_start}', '${u.contract_end}', '${u.contract_start}')
      ON CONFLICT (id) DO UPDATE SET
        full_name = '${esc(u.full_name)}',
        jabatan = '${esc(u.jabatan)}',
        branch = '${esc(u.branch)}',
        phone = '${esc(u.phone)}',
        family_phone = '${esc(u.family_phone)}',
        bank_name = '${esc(u.bank_name)}',
        bank_account = '${esc(u.bank_account)}',
        contract_start = '${u.contract_start}',
        contract_end = '${u.contract_end}',
        join_date = '${u.contract_start}'
    `)
    createdUserIds.push(userId)
    console.log(`  ✓ ${u.full_name} (${u.jabatan}, ${u.branch})`)
  }

  if (createdUserIds.length === 0) {
    console.error("\n Tidak ada user. Keluar.")
    process.exit(1)
  }

  // 3. Insert applications via SQL (trigger sets status='Diajukan' + generates code)
  console.log("\n📝 Insert applications...")
  const appRows: { id: string; code: string; user_idx: number }[] = []

  for (let i = 0; i < TEST_USERS.length; i++) {
    const u = TEST_USERS[i]
    const userId = createdUserIds[i]
    if (!userId) continue

    const rows = sqlRows<{ id: string; code: string }>(`
      INSERT INTO public.applications
        (user_id, jabatan, join_date, contract_start, contract_end,
         amount, tenure_months, phone, family_phone,
         reason_category, reason_detail, bank_name, bank_account)
      VALUES
        ('${userId}', '${esc(u.jabatan)}', '${u.contract_start}', '${u.contract_start}', '${u.contract_end}',
         ${u.amount}, ${u.tenure_months}, '${esc(u.phone)}', '${esc(u.family_phone)}',
         '${esc(u.reason_category)}', '${esc(u.reason_detail)}', '${esc(u.bank_name)}', '${esc(u.bank_account)}')
      RETURNING id, code
    `)

    if (rows.length === 0) {
      console.error(`  ✗ Gagal insert ${u.full_name}`)
      continue
    }

    appRows.push({ id: rows[0].id, code: rows[0].code, user_idx: i })
    console.log(`  ✓ ${rows[0].code} — ${u.full_name} Rp${u.amount.toLocaleString("id-ID")} / ${u.tenure_months} bln`)
  }

  if (appRows.length === 0) {
    console.error("\n✗ Tidak ada application. Keluar.")
    process.exit(1)
  }

  // 4. Push ke "Disetujui / Cair" via SQL + kasbon.system_write
  //    Trigger open_receivable_on_disbursement auto-create receivable + installments
  console.log("\n💰 Push ke Disetujui / Cair (trigger buat receivable + installments)...")
  for (const row of appRows) {
    const u = TEST_USERS[row.user_idx]
    sql(`
      SET LOCAL kasbon.system_write = 'on';
      UPDATE public.applications
      SET status = 'Disetujui / Cair',
          disbursed_at = NOW(),
          reviewed_at = NOW()
      WHERE id = '${row.id}';
    `)
    console.log(`  ✓ ${u.full_name} → Disetujui / Cair`)
  }

  // 5. Tandai angsuran "Sudah Dipotong" sesuai variasi
  console.log("\n✂️ Tandai angsuran sudah dipotong...")
  for (const row of appRows) {
    const u = TEST_USERS[row.user_idx]
    const markPaid = u.mark_paid

    if (markPaid === 0) {
      console.log(`  ○ ${u.full_name} — 0/${u.tenure_months} (belum ada)`)
      continue
    }

    sql(`
      SET LOCAL kasbon.system_write = 'on';
      UPDATE public.installments
      SET status = 'Sudah Dipotong', paid_on = NOW()
      WHERE receivable_id IN (
        SELECT id FROM public.receivables WHERE application_id = '${row.id}'
      )
      AND month_no <= ${markPaid};
    `)

    const label = markPaid >= u.tenure_months ? "LUNAS" : `${markPaid}/${u.tenure_months}`
    console.log(`  ✓ ${u.full_name} — ${label}`)
  }

  // 6. Summary
  console.log("\n" + "═".repeat(60))
  console.log("✅ SEED SELESAI")
  console.log("═".repeat(60))
  console.log(`  ${createdUserIds.length} users created`)
  console.log(`  ${appRows.length} applications → Disetujui / Cair`)
  console.log(`  Receivables + installments auto-created by trigger`)
  console.log(`  Installments marked paid per variasi`)
  console.log("\n  Buka http://localhost:3000 → Admin → Kartu Piutang")
  console.log("═".repeat(60))
}

seed().catch((err) => {
  console.error("Error:", err.message)
  process.exit(1)
})
