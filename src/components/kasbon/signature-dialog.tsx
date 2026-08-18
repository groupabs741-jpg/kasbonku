import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Check,
  CircleAlert,
  ExternalLink,
  FileCheck2,
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
import { Spinner } from "@/components/ui/spinner"
import {
  fetchOfficialDocumentHtml,
  flushNotifications,
  setApplicationStatus,
  uploadApplicantScan,
  writeHtmlToTab,
} from "@/lib/api"
import type { Application } from "@/lib/kasbon"

/**
 * Status "Menunggu TTD" kini tidak memakai tanda tangan digital di sistem:
 * pemohon membuka dokumen resmi yang sudah terkirim, mencetaknya, membubuhkan
 * semua tanda tangan secara manual (Pemohon + Atasan Langsung), lalu mengunggah
 * hasil scan-nya. Pengajuan baru pindah ke "Menunggu Review" setelah scan
 * tersimpan — aturan yang sama juga dijaga trigger database.
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
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [scan, setScan] = React.useState<File | null>(null)
  const [error, setError] = React.useState("")

  // Whether the official document for this application already exists.
  const docState = useQuery({
    queryKey: ["official-document", application?.id],
    queryFn: () => fetchOfficialDocumentHtml(application!.id),
    enabled: Boolean(application),
    staleTime: 0,
  })

  React.useEffect(() => {
    setScan(null)
    setError("")
  }, [application?.id])

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
      onSubmitted("Scan dokumen bertanda tangan terkirim. Menunggu review admin.")
    },
    onError: (submitError) => setError(errorText(submitError)),
  })

  if (!application) return null

  const busy = openForPrint.isPending || submit.isPending

  return (
    <Dialog
      open={Boolean(application)}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-w-2xl p-0">
        <DialogHeader className="min-w-0 border-b border-border/70 p-6 pr-12">
          <DialogTitle>Unggah dokumen bertanda tangan</DialogTitle>
          <DialogDescription className="mt-1">
            Dokumen resmi {application.code} sudah dikirim ke email kamu. Cetak,
            tanda tangani secara manual, lalu unggah hasil scan-nya di sini.
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
              <div className="space-y-4">
                <div className="flex items-start gap-3 rounded-2xl bg-muted/60 p-4">
                  <Printer className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div>
                    <p className="text-sm font-medium">
                      Cetak, tanda tangani manual, lalu scan
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Buka dokumen, tekan “Cetak / Simpan PDF”, lalu bubuhkan
                      tanda tangan basah pada kolom Pemohon dan kolom
                      “Mengetahui” (Atasan Langsung). Kolom Wakil Ketua, Ketua,
                      Sekretaris, dan Bendahara diisi admin setelah review
                      selesai.
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
                  {openForPrint.isPending ? <Spinner /> : <ExternalLink />}
                  Buka dokumen untuk dicetak
                </Button>
              </div>

              <div className="space-y-4">
                <div className="flex items-start gap-3 rounded-2xl bg-muted/60 p-4">
                  <UploadCloud className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div>
                    <p className="text-sm font-medium">
                      Unggah scan dokumen bertanda tangan
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Pindai atau foto seluruh halaman yang sudah ditandatangani.
                      Format PDF atau gambar, maksimal 50 MB.
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
          <Button type="button" variant="outline" onClick={onClose}>
            Tutup
          </Button>
          <Button
            type="button"
            onClick={() => submit.mutate()}
            disabled={!scan || busy}
          >
            {submit.isPending ? <Spinner /> : <Check />}
            Kirim untuk review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}