import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Check,
  CircleAlert,
  FileCheck2,
  PenLine,
  Printer,
  UploadCloud,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { SignaturePad } from "@/components/kasbon/signature-pad"
import type { SignaturePadHandle } from "@/components/kasbon/signature-pad"
import { cn } from "@/lib/utils"
import {
  fetchOfficialDocumentHtml,
  flushNotifications,
  setApplicationStatus,
  signGeneratedDocument,
  uploadApplicantScan,
  writeHtmlToTab,
} from "@/lib/api"
import type { Application } from "@/lib/kasbon"

const SIGN_STEP = 0
const PRINT_STEP = 1
const UPLOAD_STEP = 2

const STEPS = [
  "Tanda tangan digital",
  "Cetak & TTD basah atasan langsung",
  "Unggah scan dokumen",
]

/**
 * Tiga langkah yang harus dilewati pemohon pada status "Menunggu TTD":
 * tanda tangan digital masuk ke dokumen resmi, dokumen itu dicetak dan
 * ditandatangani basah oleh atasan langsung, lalu hasil scannya diunggah.
 * Pengajuan baru pindah ke "Menunggu Review" setelah scan tersimpan — aturan
 * yang sama juga dijaga trigger database, bukan hanya oleh dialog ini.
 */
export function SignatureDialog({
  application,
  onClose,
  onSubmitted,
}: {
  application: Application | null
  onClose: () => void
  onSubmitted: (message: string) => void
}) {
  const queryClient = useQueryClient()
  const padRef = React.useRef<SignaturePadHandle>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [step, setStep] = React.useState(SIGN_STEP)
  const [hasSignature, setHasSignature] = React.useState(false)
  const [scan, setScan] = React.useState<File | null>(null)
  const [error, setError] = React.useState("")

  // Whether the official document already carries the applicant's digital
  // signature. The wet-signature round-trip takes real-world time, so the
  // dialog is often closed and reopened between signing and uploading; this
  // lets it resume at the print step instead of forcing a re-sign.
  const docState = useQuery({
    queryKey: ["official-document", application?.id],
    queryFn: () => fetchOfficialDocumentHtml(application!.id),
    enabled: Boolean(application),
    staleTime: 0,
  })

  // Pick the starting step once per opened application, the first time the
  // document state is known. After that the buttons drive `step`, so a refetch
  // (e.g. after signing) does not yank the user backwards.
  const initializedId = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!application) {
      initializedId.current = null
      return
    }
    if (docState.data && initializedId.current !== application.id) {
      initializedId.current = application.id
      setStep(docState.data.signed ? PRINT_STEP : SIGN_STEP)
      setHasSignature(false)
      setScan(null)
      setError("")
    }
  }, [application, docState.data])

  const sign = useMutation({
    mutationFn: async () => {
      if (!application) throw new Error("Pengajuan tidak ditemukan.")
      const blob = await padRef.current?.toBlob()
      if (!blob) throw new Error("Tanda tangan belum digambar.")
      return signGeneratedDocument(application, blob)
    },
    onSuccess: async () => {
      setError("")
      await queryClient.invalidateQueries({ queryKey: ["documents"] })
      if (application) {
        await queryClient.invalidateQueries({
          queryKey: ["official-document", application.id],
        })
      }
      setStep(PRINT_STEP)
    },
    onError: (signError) => setError(errorText(signError)),
  })

  /**
   * Tab-nya diklaim di dalam click, bukan setelah await: tab yang dibuka
   * belakangan diblokir browser sebagai popup. Isi dokumen ditulis langsung ke
   * tab, bukan diarahkan ke signed URL — storage menyajikan HTML sebagai
   * attachment, yang muncul sebagai halaman kosong lalu terunduh.
   */
  const openForPrint = useMutation({
    mutationFn: async () => {
      if (!application) throw new Error("Pengajuan tidak ditemukan.")
      const tab = window.open("about:blank", "_blank")
      try {
        const { html } = await fetchOfficialDocumentHtml(application.id)
        writeHtmlToTab(html, tab)
      } catch (openError) {
        tab?.close()
        throw openError
      }
    },
    onSuccess: () => setError(""),
    onError: (openError) => setError(errorText(openError)),
  })

  const submit = useMutation({
    mutationFn: async () => {
      if (!application) throw new Error("Pengajuan tidak ditemukan.")
      if (!scan) throw new Error("Scan dokumen belum dipilih.")
      await uploadApplicantScan(application, scan)
      return setApplicationStatus(application.id, "Menunggu Review")
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["applications"] })
      await queryClient.invalidateQueries({ queryKey: ["documents"] })
      await queryClient.invalidateQueries({ queryKey: ["stats"] })
      void flushNotifications()
      onClose()
      onSubmitted("Scan dokumen terkirim. Menunggu review admin.")
    },
    onError: (submitError) => setError(errorText(submitError)),
  })

  if (!application) return null

  const busy = sign.isPending || openForPrint.isPending || submit.isPending

  return (
    <Dialog
      open={Boolean(application)}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      {/* Popup dialog memakai `grid`, dan anak grid punya `min-width: auto`.
          Tanpa `min-w-0` di tiap anak, isi yang tidak bisa menyusut — stepper
          dan nama file scan — melebarkan kolom melewati `max-w-2xl`, dan panel
          putihnya jadi lebih sempit daripada isinya. */}
      <DialogContent className="max-w-2xl p-0">
        <DialogHeader className="min-w-0 border-b border-border/70 p-6 pr-12">
          <DialogTitle>Tanda tangani dokumen kasbon</DialogTitle>
          <DialogDescription className="mt-1">
            Dokumen resmi {application.code} perlu tanda tangan kamu dan tanda
            tangan basah atasan langsung sebelum direview admin.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-5 p-6">
          {docState.isPending ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Spinner /> Memuat dokumen…
            </div>
          ) : docState.isError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-2xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <span>{errorText(docState.error)}</span>
            </div>
          ) : (
            <>
              {/* Nama langkah ditulis satu baris di bawah, bukan di dalam tiap
              bulatan: label di dalam bulatan pasti kena elipsis pada dialog
              selebar 28rem, dan `sm:` mengikuti lebar layar, bukan lebar
              dialog yang sebenarnya menyempitkan. */}
              <div className="min-w-0 space-y-2">
                <ol className="flex items-center gap-2">
                  {STEPS.map((label, index) => {
                    const state =
                      index < step
                        ? "done"
                        : index === step
                          ? "current"
                          : "pending"
                    return (
                      <li
                        key={label}
                        className={cn(
                          "flex items-center gap-2",
                          index < STEPS.length - 1 && "flex-1"
                        )}
                      >
                        <span
                          className={cn(
                            "grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold",
                            state === "done" &&
                              "border-primary bg-primary text-primary-foreground",
                            state === "current" &&
                              "border-primary bg-primary/10 text-primary",
                            state === "pending" &&
                              "border-border bg-muted text-muted-foreground"
                          )}
                        >
                          {state === "done" ? (
                            <Check className="size-3.5" />
                          ) : (
                            index + 1
                          )}
                        </span>
                        {index < STEPS.length - 1 ? (
                          <span
                            className={cn(
                              "h-px flex-1",
                              index < step ? "bg-primary" : "bg-border"
                            )}
                          />
                        ) : null}
                      </li>
                    )
                  })}
                </ol>
                <p className="text-xs font-medium text-muted-foreground">
                  Langkah {step + 1} dari {STEPS.length} — {STEPS[step]}
                </p>
              </div>

              {step === SIGN_STEP ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 rounded-2xl bg-muted/60 p-4">
                    <FileCheck2 className="mt-0.5 size-4 shrink-0 text-primary" />
                    <div>
                      <p className="text-sm font-medium">Satu dokumen resmi</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        Dokumen ini berisi Lembar Permohonan, Persetujuan, dan
                        Penyerahan. Tanda tangan yang kamu gambar akan otomatis
                        muncul di bagian Pemohon pada dokumen yang sama.
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signature-pad">Tanda tangan pemohon</Label>
                    <SignaturePad
                      ref={padRef}
                      onStateChange={setHasSignature}
                    />
                    <p className="text-xs text-muted-foreground">
                      Dengan menandatangani, kamu menyatakan data pengajuan
                      sudah benar.
                    </p>
                  </div>
                </div>
              ) : null}

              {step === PRINT_STEP ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 rounded-2xl bg-muted/60 p-4">
                    <Printer className="mt-0.5 size-4 shrink-0 text-primary" />
                    <div>
                      <p className="text-sm font-medium">
                        Cetak dan minta tanda tangan atasan langsung
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        Tanda tangan kamu sudah menempel di dokumen. Buka
                        dokumen, tekan “Cetak / Simpan PDF”, lalu minta atasan
                        langsung membubuhkan tanda tangan basah pada kolom
                        “Mengetahui”. Kamu bisa menutup halaman ini sementara
                        dan melanjutkan ke unggah scan nanti — tanda tangan
                        digitalmu tetap tersimpan.
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => openForPrint.mutate()}
                    disabled={busy}
                  >
                    {openForPrint.isPending ? <Spinner /> : <Printer />}
                    Buka dokumen untuk dicetak
                  </Button>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Kolom Wakil Ketua, Ketua, Sekretaris, dan Bendahara
                    dibiarkan kosong — admin yang mengedarkannya setelah review.
                  </p>
                </div>
              ) : null}

              {step === UPLOAD_STEP ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 rounded-2xl bg-muted/60 p-4">
                    <UploadCloud className="mt-0.5 size-4 shrink-0 text-primary" />
                    <div>
                      <p className="text-sm font-medium">
                        Unggah scan dokumen bertanda tangan
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        Pindai atau foto seluruh halaman yang sudah
                        ditandatangani kamu dan atasan langsung. Format PDF atau
                        gambar, maksimal 50 MB.
                      </p>
                    </div>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      event.target.value = ""
                      if (file) {
                        setScan(file)
                        setError("")
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={busy}
                  >
                    <UploadCloud />
                    {scan ? "Ganti file scan" : "Pilih file scan"}
                  </Button>
                  {scan ? (
                    <p className="flex items-center gap-2 rounded-2xl border border-border/70 px-3 py-2.5 text-xs">
                      <FileCheck2 className="size-3.5 shrink-0 text-primary" />
                      <span className="min-w-0 truncate">{scan.name}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {(scan.size / 1024).toFixed(0)} KB
                      </span>
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>
          )}

          {error ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-2xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <DialogFooter className="min-w-0 border-t border-border/70 p-6">
          {!docState.data ? (
            <Button type="button" variant="outline" onClick={onClose}>
              Tutup
            </Button>
          ) : step === SIGN_STEP ? (
            <>
              <Button type="button" variant="outline" onClick={onClose}>
                Batal
              </Button>
              <Button
                type="button"
                onClick={() => sign.mutate()}
                disabled={!hasSignature || busy}
              >
                {sign.isPending ? <Spinner /> : <PenLine />}
                Bubuhkan ke dokumen
              </Button>
            </>
          ) : step === PRINT_STEP ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(SIGN_STEP)}
                disabled={busy}
              >
                Ulangi tanda tangan
              </Button>
              <Button
                type="button"
                onClick={() => setStep(UPLOAD_STEP)}
                disabled={busy}
              >
                <UploadCloud />
                Lanjut ke unggah scan
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(PRINT_STEP)}
                disabled={busy}
              >
                Kembali
              </Button>
              <Button
                type="button"
                onClick={() => submit.mutate()}
                disabled={!scan || busy}
              >
                {submit.isPending ? <Spinner /> : <Check />}
                Kirim untuk review
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
