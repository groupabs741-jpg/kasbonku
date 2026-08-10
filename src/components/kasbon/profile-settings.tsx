import * as React from "react"
import { useMutation } from "@tanstack/react-query"
import { CircleAlert, LogOut } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
import { PageIntro, fieldClassName } from "@/components/kasbon/shared"
import { updateProfile } from "@/lib/api"
import { formatCurrency, toDateInput } from "@/lib/format"
import { JABATAN_OPTIONS, POSITION_LIMITS, remainingContract } from "@/lib/kasbon"
import type { Jabatan, Profile } from "@/lib/kasbon"

export function ProfileSettings({
  profile,
  onNotify,
}: {
  profile: Profile
  onNotify: (message: string) => void
}) {
  const { refreshProfile, signOut } = useSession()
  const isAdmin = profile.role === "admin"

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

      if (isAdmin) {
        return updateProfile(profile.id, { full_name: fullName.trim() })
      }

      if (!jabatan) throw new Error("Jabatan wajib dipilih.")
      if (!contractStart || !contractEnd) throw new Error("Masa kontrak wajib diisi.")
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
      onNotify("Data profil berhasil diperbarui.")
    },
    onError: (mutationError) =>
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError)),
  })

  return (
    <div className="space-y-6">
      <PageIntro
        title="Pengaturan profil"
        description={
          isAdmin
            ? "Data akun admin. Perubahan role hanya bisa dilakukan lewat pengelola sistem."
            : "Data ini dipakai untuk limit pengajuan, sisa kontrak, dan pengisian dokumen resmi."
        }
      />

      <Card className="max-w-3xl border-border/80 shadow-none">
        <CardHeader className="border-b border-border/70 pb-4">
          <CardTitle className="text-base">Data karyawan</CardTitle>
          <CardDescription className="mt-1">
            Email terhubung ke akun Google kamu dan tidak bisa diubah di sini.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-5">
          <form
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault()
              save.mutate()
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="settings-name">Nama lengkap</Label>
                <Input
                  id="settings-name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="settings-email">Email</Label>
                <Input id="settings-email" value={profile.email} readOnly />
              </div>

              {!isAdmin ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="settings-jabatan">Jabatan</Label>
                    <Select
                      value={jabatan}
                      onValueChange={(value) => value && setJabatan(value)}
                    >
                      <SelectTrigger id="settings-jabatan" className={fieldClassName}>
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
                    <Label htmlFor="settings-join">Tanggal bergabung</Label>
                    <DatePicker id="settings-join" value={joinDate} onChange={setJoinDate} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="settings-contract-start">Kontrak mulai</Label>
                    <DatePicker
                      id="settings-contract-start"
                      value={contractStart}
                      onChange={setContractStart}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="settings-contract-end">Kontrak berakhir</Label>
                    <DatePicker
                      id="settings-contract-end"
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
                    <Label htmlFor="settings-phone">No. Telp / WhatsApp</Label>
                    <Input
                      id="settings-phone"
                      type="tel"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="settings-family-phone">No. Telp keluarga</Label>
                    <Input
                      id="settings-family-phone"
                      type="tel"
                      value={familyPhone}
                      onChange={(event) => setFamilyPhone(event.target.value)}
                      required
                    />
                  </div>
                </>
              ) : null}
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

            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Spinner /> : null}
              Simpan perubahan
            </Button>
          </form>
        </CardContent>
        <CardFooter className="border-t border-border/70 px-5 py-4">
          <Button variant="ghost" onClick={() => void signOut()}>
            <LogOut />
            Keluar dari Kasbonku
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
