import * as React from "react"
import { useMutation } from "@tanstack/react-query"
import { CircleAlert, LogOut, UserRoundCog } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { useSession } from "@/components/session-provider"
import { fieldClassName } from "@/components/kasbon/shared"
import { updateProfile } from "@/lib/api"
import { formatCurrency, toDateInput } from "@/lib/format"
import { JABATAN_OPTIONS, POSITION_LIMITS, remainingContract } from "@/lib/kasbon"
import type { Jabatan, Profile } from "@/lib/kasbon"

/**
 * Setiap akun Google langsung menjadi pemohon. Data kepegawaian diisi sendiri
 * di sini sebelum dashboard terbuka — jabatan menentukan limit pinjaman, dan
 * masa kontrak mengisi kolom sisa kontrak di dokumen resmi. Admin memeriksa
 * ulang keduanya saat me-review pengajuan.
 */
export function ProfileSetup({ profile }: { profile: Profile }) {
  const { refreshProfile, signOut } = useSession()

  const [fullName, setFullName] = React.useState(profile.full_name)
  const [jabatan, setJabatan] = React.useState<Jabatan | "">(profile.jabatan ?? "")
  const [joinDate, setJoinDate] = React.useState<Date | undefined>(
    profile.join_date ? new Date(`${profile.join_date}T00:00:00`) : undefined
  )
  const [contractStart, setContractStart] = React.useState<Date | undefined>(
    profile.contract_start ? new Date(`${profile.contract_start}T00:00:00`) : undefined
  )
  const [contractEnd, setContractEnd] = React.useState<Date | undefined>(
    profile.contract_end ? new Date(`${profile.contract_end}T00:00:00`) : undefined
  )
  const [phone, setPhone] = React.useState(profile.phone ?? "")
  const [familyPhone, setFamilyPhone] = React.useState(profile.family_phone ?? "")
  const [error, setError] = React.useState("")

  const sisaKontrak = remainingContract(toDateInput(contractEnd) || null)

  const save = useMutation({
    mutationFn: async () => {
      if (!fullName.trim()) throw new Error("Nama lengkap wajib diisi.")
      if (!jabatan) throw new Error("Jabatan wajib dipilih.")
      if (!contractStart || !contractEnd) {
        throw new Error("Tanggal mulai dan akhir kontrak wajib diisi.")
      }
      if (contractEnd < contractStart) {
        throw new Error("Tanggal akhir kontrak tidak boleh sebelum tanggal mulai.")
      }
      if (!phone.trim() || !familyPhone.trim()) {
        throw new Error("Kedua nomor telepon wajib diisi.")
      }
      return updateProfile(profile.id, {
        full_name: fullName.trim(),
        jabatan,
        join_date: toDateInput(joinDate) || null,
        contract_start: toDateInput(contractStart),
        contract_end: toDateInput(contractEnd),
        phone: phone.trim(),
        family_phone: familyPhone.trim(),
      })
    },
    onSuccess: async () => {
      setError("")
      await refreshProfile()
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError))
    },
  })

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-4 py-10 sm:p-8">
      <Card className="w-full max-w-2xl border-border/80 shadow-none">
        <CardHeader className="border-b border-border/70 pb-5">
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
              <UserRoundCog className="size-5" />
            </div>
            <div>
              <CardTitle className="text-lg">Lengkapi data karyawan</CardTitle>
              <CardDescription className="mt-1">
                Data ini dipakai untuk menghitung limit pengajuan, sisa kontrak,
                dan mengisi dokumen resmi. Isi sesuai data kepegawaian kamu —
                admin akan memeriksanya saat me-review pengajuan.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-5 sm:p-6">
          <form
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault()
              save.mutate()
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="setup-name">Nama lengkap</Label>
                <Input
                  id="setup-name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Nama sesuai data kepegawaian"
                  required
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="setup-email">Email</Label>
                <Input id="setup-email" value={profile.email} readOnly />
                <p className="text-xs text-muted-foreground">
                  Notifikasi Kasbonku dikirim ke alamat ini.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="setup-jabatan">Jabatan</Label>
                <Select
                  value={jabatan}
                  onValueChange={(value) => value && setJabatan(value)}
                >
                  <SelectTrigger id="setup-jabatan" className={fieldClassName}>
                    <SelectValue placeholder="Pilih jabatan" />
                  </SelectTrigger>
                  <SelectContent>
                    {JABATAN_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {jabatan ? (
                  <p className="text-xs text-muted-foreground">
                    Limit pengajuan: {formatCurrency(POSITION_LIMITS[jabatan])}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="setup-join">Tanggal bergabung</Label>
                <DatePicker id="setup-join" value={joinDate} onChange={setJoinDate} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="setup-contract-start">Kontrak mulai</Label>
                <DatePicker
                  id="setup-contract-start"
                  value={contractStart}
                  onChange={setContractStart}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="setup-contract-end">Kontrak berakhir</Label>
                <DatePicker
                  id="setup-contract-end"
                  value={contractEnd}
                  onChange={setContractEnd}
                />
              </div>
              <div className="rounded-2xl bg-muted/60 p-3 sm:col-span-2">
                <p className="text-xs text-muted-foreground">Sisa kontrak</p>
                <p className="mt-1 text-sm font-semibold">
                  {contractEnd ? sisaKontrak.label : "Isi tanggal akhir kontrak"}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="setup-phone">No. Telp / WhatsApp</Label>
                <Input
                  id="setup-phone"
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="08xx xxxx xxxx"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="setup-family-phone">No. Telp keluarga</Label>
                <Input
                  id="setup-family-phone"
                  type="tel"
                  value={familyPhone}
                  onChange={(event) => setFamilyPhone(event.target.value)}
                  placeholder="08xx xxxx xxxx"
                  required
                />
              </div>
            </div>

            {error ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-2xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
              >
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button type="button" variant="ghost" onClick={() => void signOut()}>
                <LogOut />
                Keluar
              </Button>
              <Button type="submit" size="lg" disabled={save.isPending}>
                {save.isPending ? <Spinner /> : null}
                Simpan dan lanjutkan
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
