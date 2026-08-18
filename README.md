# Kasbonku — ABS Group

Sistem permohonan & pengelolaan kasbon karyawan. Frontend TanStack Start +
React, backend InsForge (Postgres + RLS, Storage, Edge Functions, Schedules).

Spesifikasi lengkap ada di [`../prd.md`](../prd.md).

---

## Menjalankan lokal

```bash
npm install
cp .env.example .env   # isi dengan nilai project (lihat di bawah)
npm run dev            # http://localhost:3000
```

Nilai `.env`:

```bash
npx -y @insforge/cli current            # VITE_INSFORGE_URL
npx -y @insforge/cli secrets get ANON_KEY   # VITE_INSFORGE_ANON_KEY
```

Perintah lain: `npm run build`, `npm run typecheck`, `npm run lint`.

---

## Membuat akun Admin

Tidak ada pendaftaran admin lewat aplikasi — akun admin dibuat operator:

```bash
node scripts/create-admin.mjs admin@absgroup.biz.id "KataSandiKuat" "Nama Admin"
```

Script membuat akun, menandai emailnya terverifikasi, lalu memanggil
`public.promote_to_admin()`. Aman dijalankan ulang untuk email yang sudah ada.
Sistem mendukung banyak admin setara (PRD 3.1).

---

## Bagaimana karyawan masuk

Tidak ada pendaftaran manual dan tidak ada halaman "Lengkapi Profil" yang
berdiri sendiri. Siapa pun yang **Sign in with Google** langsung mendapat
profil `pemohon` lewat `ensure_profile()`, lalu diarahkan ke form **"Isi Data
Diri"** yang sekaligus menjadi pengajuan kasbon pertama: field profil (Nama,
Jabatan, Join Date, Masa Kontrak, No. Telp, No. Telp Keluarga) digabung dengan
field pengajuan (Nominal, Jangka Waktu, Alasan) dalam satu form. Submit ke RPC
`submit_application()` menulis profil + pengajuan dalam satu transaksi, lalu
sistem otomatis generate dokumen resmi dan mengirim email konfirmasi berisi
detail pengajuan + lampiran dokumen — tanpa menunggu aksi admin. Setelah itu
baru dashboard terbuka.

Pengajuan berikutnya tidak membuka form panjang lagi: data diri auto-terisi
dari profil (tetap bisa diedit, misal kontrak diperpanjang), pemohon cukup
mengisi ulang nominal, jangka waktu, dan alasan.

⚠️ **Jabatan diisi sendiri oleh pemohon, padahal jabatan menentukan limit
pinjaman** (Rp 3/4/6 juta, PRD 4.2). Seseorang bisa memilih "SPV/Manager" untuk
mendapat limit tertinggi. Kendalinya ada di tahap review: tidak ada kasbon yang
cair tanpa admin menyetujui, dan panel review menandai jabatan yang diklaim
dengan sorotan kuning berikut limit yang berlaku. **Admin wajib mencocokkannya
dengan data kepegawaian sebelum menyetujui.**

Angka nominalnya sendiri tetap tidak bisa dilewati — CHECK constraint menolak
pengajuan di atas limit jabatan yang tersimpan, dan
`applications_before_insert()` selalu mengambil jabatan dari profil sehingga
payload yang mengklaim jabatan lebih tinggi tetap dihitung dengan limit yang
benar.

---

## Struktur

```
src/
  lib/
    insforge.ts   klien SDK (browser)
    kasbon.ts     tipe domain + konstanta bisnis (limit, tarif, status)
    api.ts        semua query & mutation ke backend
    format.ts     format rupiah / tanggal Indonesia
  components/
    session-provider.tsx   auth state, ensure_profile, sign in/out
    kasbon-dashboard.tsx   orchestrator: login → Isi Data Diri (pengajuan pertama) → workspace
    kasbon/                seluruh layar & dialog
functions/        edge function (Deno) — di-deploy lewat InsForge CLI
migrations/       skema database, urut berdasarkan timestamp
scripts/          tooling operator
```

---

## Backend

### Tabel

| Tabel | Isi |
|---|---|
| `profiles` | data karyawan + `role` (`pemohon` \| `admin`) |
| `applications` | pengajuan kasbon; biaya admin & angsuran adalah *generated column* |
| `application_events` | riwayat perubahan status (append-only, ditulis trigger) |
| `documents` | metadata berkas di Storage |
| `receivables` | kartu piutang, dibuat otomatis saat pencairan |
| `installments` | rincian angsuran per bulan |
| `notifications` | outbox email + inbox in-app |

### Aturan yang dijaga database, bukan hanya UI

- **Limit per jabatan** (Rp 3/4/6 juta) — CHECK constraint via `kasbon_limit()`.
- **Maksimal 1 kasbon aktif per karyawan** — partial unique index.
- **Jangka waktu 1–6 bulan** — CHECK constraint.
- **Biaya provisi 1,5% & admin bulanan 1%** — generated column, tidak bisa
  dikirim dari klien.
- **Alur status** — trigger `applications_guard_update()`. Pemohon hanya boleh
  `Menunggu TTD → Menunggu Review`, itu pun setelah scan `ttd_pemohon` yang
  lebih baru dari `document_sent_at` masuk; sisanya milik admin.
- **Bukti tanda tangan** — `guard_document_insert()`: pemohon hanya boleh
  mengunggah `ttd_pemohon` (scan dokumen bertanda tangan pemohon + atasan
  langsung) dan hanya saat status `Menunggu TTD`. Kolom manajemen (Wakil
  Ketua/Ketua/Sekretaris/Bendahara) dibubuhkan di luar sistem sebagai formalitas
  dokumen, jadi tidak ada lagi gerbang `ttd_scan` sebelum pencairan.
- **Lunas** — dihitung dari baris angsuran, tidak pernah diketik. Menandai
  seluruh angsuran otomatis mengubah kartu piutang **dan** status pengajuan;
  membatalkan satu baris membukanya kembali.
- **Jabatan konsisten** — `applications_before_insert()` selalu menyalin
  jabatan dan masa kontrak dari profil, jadi payload yang mengklaim jabatan
  lebih tinggi tetap diperiksa dengan limit yang tersimpan. Yang tidak dijaga
  database: kebenaran jabatan itu sendiri — itu tugas review admin.
- **Role tidak bisa dinaikkan sendiri** — `guard_profile_fields()` menolak
  pemohon yang mencoba mengubah `role` miliknya menjadi `admin`.
- **Isolasi data** — RLS: pemohon hanya melihat datanya sendiri, admin melihat
  semua. Sudah diverifikasi lintas-akun.

### Storage

Dua bucket privat, kunci objek `<user_id>/<application_id>/<berkas>`:

- `kasbon-documents` — satu dokumen resmi gabungan + arsip dokumen lama
- `kasbon-signatures` — tidak dipakai untuk alur baru; tanda tangan digital
  ditempatkan langsung ke dokumen resmi gabungan

Akses lewat signed URL berumur pendek. Pemohon tidak bisa menghapus dokumen
yang sudah dikirim.

### Edge Functions

| Slug | Fungsi |
|---|---|
| `generate-documents` | membuat satu dokumen gabungan Permohonan / Persetujuan / Penyerahan — dipanggil otomatis saat pemohon submit (pemilik aplikasi); admin boleh generate ulang sebagai fallback |
| `export-report` | export XLSX: rekap pengajuan, kartu piutang, biaya admin (admin) |
| `notifications-dispatch` | mengirim antrean notifikasi via Resend |
| `installment-reminders` | menjadwalkan reminder angsuran H-3 |

Deploy ulang setelah mengubah kode:

```bash
npx -y @insforge/cli functions deploy <slug> --file ./functions/<slug>.ts
```

### Schedules

| Jadwal | Cron |
|---|---|
| Kirim notifikasi email | `*/5 * * * *` |
| Reminder angsuran H-3 | `0 0 * * *` |

### Migrations

```bash
npx -y @insforge/cli db migrations new <nama-migrasi>
npx -y @insforge/cli db migrations up --all
```

---

## Dokumen resmi

Satu dokumen gabungan dihasilkan sebagai **HTML siap cetak A4**, bukan PDF:
formatnya mengikuti formulir kertas ABS Group yang sudah ada, memuat bagian
Permohonan, Persetujuan, dan Penyerahan, serta bisa disimpan sebagai PDF dari
browser mana pun (tombol "Cetak / Simpan PDF" ada di dokumennya).

**Tidak ada tanda tangan digital di sistem.** Dokumen dikirim ke pemohon lewat
email (lampiran) begitu pengajuan disubmit; pemohon mencetaknya, membubuhkan
semua tanda tangan secara manual (Pemohon + Atasan Langsung), lalu mengunggah
hasil scan-nya (`ttd_pemohon`) sebelum admin mereview.

Kolom Wakil Ketua, Ketua, Sekretaris, dan Bendahara tetap ada di cetakan
dokumen sesuai formulir resmi ABS Group, tapi dibubuhkan secara manual/offline
oleh admin sebagai formalitas dokumen — tidak ada lagi tahap `Menunggu TTD
Basah` di dalam sistem.

---

## Konfigurasi

### 1. Email — Resend ✅ aktif

Domain `absgroup.biz.id` sudah *Verified*, pengirim `kasbon@absgroup.biz.id`,
dan uji kirim berhasil. Notifikasi berjalan otomatis. Langkah di bawah hanya
diperlukan kalau domain, API key, atau alamat pengirimnya berganti.

Kalau kredensialnya hilang, setiap notifikasi ditandai `skipped` — tidak ada
yang hilang, hanya tidak dikirim. Cek kapan pun dengan
`node scripts/test-email.mjs <email>`.

**Langkah 1 — verifikasi domain pengirim.** Di dashboard Resend: Domains → Add
Domain → `absgroup.biz.id`, lalu pasang record DNS yang diberikan (MX + TXT
untuk SPF, dan TXT untuk DKIM). Setelah statusnya *Verified*, alamat apa pun
`@absgroup.biz.id` bisa dipakai sebagai pengirim.

> Belum bisa akses DNS? Resend menyediakan `onboarding@resend.dev` untuk uji
> coba, tapi **hanya bisa mengirim ke alamat email pemilik akun Resend**. Cukup
> untuk memastikan pipeline jalan, tidak cukup untuk produksi.

**Langkah 2 — buat API key.** API Keys → Create API Key, permission
**Sending access**. Salin key-nya (`re_…`); Resend hanya menampilkannya sekali.

**Langkah 3 — simpan sebagai secret.** Jalankan sendiri di terminal supaya
API key tidak tersimpan di riwayat chat atau file mana pun:

```bash
npx -y @insforge/cli secrets add RESEND_API_KEY "re_xxxxx"
```

```bash
npx -y @insforge/cli secrets add RESEND_FROM_EMAIL "kasbon@absgroup.biz.id"
```

```bash
npx -y @insforge/cli secrets add RESEND_FROM_NAME "Kasbonku ABS Group"
```

`RESEND_FROM_EMAIL` **harus** berada di domain yang sudah *Verified* pada
Langkah 1 — kalau tidak, Resend menolak dengan 403 "domain is not verified".
Boleh juga diisi lengkap seperti `Kasbonku <kasbon@absgroup.biz.id>`; kalau
hanya alamatnya, `RESEND_FROM_NAME` dipakai sebagai nama tampilan.

**Langkah 4 — uji.** Script ini mengirim satu email lewat jalur produksi yang
sama dengan notifikasi asli, lalu menghapus baris ujinya:

```bash
node scripts/test-email.mjs nama.kamu@absgroup.biz.id
```

**Langkah 5 — kirim ulang yang sempat ter-skip** (opsional, kalau sudah ada
notifikasi yang tertahan sebelum Resend aktif):

```bash
npx -y @insforge/cli db query "UPDATE public.notifications SET email_status='pending', attempts=0 WHERE email_status='skipped'"
```

Sisanya berjalan sendiri: jadwal `notifications-dispatch` mengirim antrean tiap
5 menit, dan dashboard memicunya langsung setelah aksi admin.

### 2. URL produksi

Setelah dideploy, tambahkan origin produksi ke `allowed_redirect_urls` di
`insforge.toml` lalu `npx -y @insforge/cli config apply`, dan perbarui
`KASBON_APP_URL` agar tautan di email mengarah ke sana:

```bash
npx -y @insforge/cli secrets update KASBON_APP_URL --value "https://kasbon.absgroup.biz.id"
```

### 3. Catatan operasional

- **Pendaftaran terbuka.** Siapa pun dengan akun Google bisa masuk sebagai
  pemohon. Pengajuan dari orang tak dikenal tetap masuk antrean admin dan bisa
  ditolak, tapi tidak ada penyaringan di depan. Ini keputusan sadar pemilik
  sistem — lihat "Bagaimana karyawan masuk" di atas.
- **Jabatan perlu dicek admin** setiap kali me-review, karena menentukan limit.
- Menghapus akun karyawan menghapus seluruh baris terkait di database, tapi
  **berkas di Storage tidak ikut terhapus** — bersihkan manual bila diperlukan.
