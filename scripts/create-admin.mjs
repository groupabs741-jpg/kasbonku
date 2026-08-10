#!/usr/bin/env node
/**
 * Provisions an Admin account for Kasbonku.
 *
 * There is deliberately no self-service admin signup in the app, so admins are
 * created here by an operator. The script:
 *   1. creates the auth user (email + password),
 *   2. marks the email verified — Kasbonku has no SMTP for the built-in
 *      verification mail, and the operator is vouching for the address,
 *   3. promotes the profile to role = 'admin' via public.promote_to_admin().
 *
 * Re-running for an existing email is safe: it skips creation and just
 * (re-)promotes.
 *
 * Usage:
 *   node scripts/create-admin.mjs <email> <password> ["Nama Lengkap"]
 */

import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

import { createAdminClient } from "@insforge/sdk"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

const [email, password, ...nameParts] = process.argv.slice(2)
const fullName = nameParts.join(" ").trim()

if (!email || !password) {
  console.error('Usage: node scripts/create-admin.mjs <email> <password> ["Nama Lengkap"]')
  process.exit(1)
}
if (password.length < 8) {
  console.error("Password minimal 8 karakter (sesuai kebijakan auth project).")
  process.exit(1)
}

let project
try {
  project = JSON.parse(readFileSync(join(root, ".insforge/project.json"), "utf8"))
} catch {
  console.error("Project belum ter-link. Jalankan: npx -y @insforge/cli link --project-id <id>")
  process.exit(1)
}

const sql = (statement) =>
  execFileSync(
    "npx",
    ["-y", "@insforge/cli", "db", "query", statement, "--json"],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  )

const client = createAdminClient({
  baseUrl: project.oss_host,
  apiKey: project.api_key,
})

const { error } = await client.auth.signUp({
  email,
  password,
  name: fullName || email.split("@")[0],
})

if (error && !/exist/i.test(error.message ?? "")) {
  console.error(`Gagal membuat akun: ${error.message}`)
  process.exit(1)
}
console.log(error ? `• Akun ${email} sudah ada — melanjutkan ke promosi.` : `• Akun ${email} dibuat.`)

// The operator vouches for this address; there is no SMTP to deliver an OTP.
sql(`UPDATE auth.users SET email_verified = true WHERE LOWER(email) = LOWER('${email.replace(/'/g, "''")}')`)
console.log("• Email ditandai terverifikasi.")

const promoted = JSON.parse(
  sql(`SELECT id, email, full_name, role FROM public.promote_to_admin('${email.replace(/'/g, "''")}')`)
)
const row = promoted.rows?.[0]

if (row?.role !== "admin") {
  console.error("Promosi ke admin gagal:", JSON.stringify(promoted))
  process.exit(1)
}

if (fullName) {
  sql(
    `UPDATE public.profiles SET full_name = '${fullName.replace(/'/g, "''")}' WHERE id = '${row.id}'`
  )
}

console.log(`\n✓ Admin siap: ${row.email} (${fullName || row.full_name})`)
console.log("  Masuk lewat tab \"Admin\" di halaman login Kasbonku.")
