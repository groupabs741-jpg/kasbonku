/**
 * Script untuk mengosongkan semua data pengajuan kasbon.
 * Jalankan: npx tsx scripts/clear-applications.ts
 *
 * Urutan hapus harus sesuai foreign key constraints:
 * installments → receivables → application_events → documents → notifications → applications
 */

import { createAdminClient } from "@insforge/sdk"
import "dotenv/config"

const client = createAdminClient({
  baseUrl: process.env.INSFORGE_BASE_URL!,
  apiKey: process.env.API_KEY!,
})

async function clearAll() {
  const tables = [
    "installments",
    "receivables",
    "application_events",
    "documents",
    "notifications",
    "applications",
  ]

  for (const table of tables) {
    console.log(`Menghapus data dari ${table}...`)
    const { error } = await client.database.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000")
    if (error) {
      console.error(`   Gagal: ${error.message}`)
    } else {
      console.log(`  ✅ Berhasil`)
    }
  }

  console.log("\nSelesai! Semua data pengajuan telah dikosongkan.")
}

clearAll().catch((err) => {
  console.error("Error:", err.message)
  process.exit(1)
})
