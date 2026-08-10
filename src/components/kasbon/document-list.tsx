import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Download, ExternalLink, FileText, ImageIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  documentUrl,
  fetchDocumentHtml,
  fetchDocuments,
  writeHtmlToTab,
} from "@/lib/api"
import { formatDateTime } from "@/lib/format"
import { DOCUMENT_LABELS } from "@/lib/kasbon"
import type { KasbonDocument } from "@/lib/kasbon"

/**
 * Buckets are private, so every open mints a short-lived signed URL on click
 * rather than embedding one that would go stale in the rendered list.
 *
 * The generated document is HTML, and storage serves it as an attachment — a
 * signed URL there gives a blank tab and a download. So HTML is written into
 * the tab instead; PDFs and images still open by URL, which they render inline.
 */
function OpenDocumentButton({ doc }: { doc: KasbonDocument }) {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState("")

  const isHtml = doc.mime_type === "text/html"

  const open = async () => {
    setPending(true)
    setError("")
    // Claim the tab inside the click; a later window.open is blocked as a popup.
    const tab = isHtml ? window.open("about:blank", "_blank") : null
    try {
      if (isHtml) {
        const html = await fetchDocumentHtml(doc)
        writeHtmlToTab(html, tab)
      } else {
        const url = await documentUrl(doc)
        if (!url) throw new Error("URL dokumen tidak tersedia.")
        window.open(url, "_blank", "noopener,noreferrer")
      }
    } catch (openError) {
      tab?.close()
      setError(
        openError instanceof Error ? openError.message : String(openError)
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" onClick={open} disabled={pending}>
        {pending ? (
          <Spinner />
        ) : doc.mime_type === "text/html" ? (
          <ExternalLink />
        ) : (
          <Download />
        )}
        {doc.mime_type === "text/html" ? "Buka" : "Unduh"}
      </Button>
      {error ? (
        <span className="text-[11px] text-destructive">{error}</span>
      ) : null}
    </div>
  )
}

export function DocumentList({
  applicationId,
  emptyLabel = "Belum ada dokumen untuk pengajuan ini.",
}: {
  applicationId: string
  emptyLabel?: string
}) {
  const documents = useQuery({
    queryKey: ["documents", applicationId],
    queryFn: () => fetchDocuments(applicationId),
  })

  if (documents.isPending) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-dashed border-border/70 p-4 text-xs text-muted-foreground">
        <Spinner className="size-3.5" />
        Memuat dokumen…
      </div>
    )
  }

  if (documents.isError) {
    return (
      <p className="rounded-2xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
        Gagal memuat dokumen: {documents.error.message}
      </p>
    )
  }

  const items = documents.data
  if (items.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border/70 p-4 text-xs text-muted-foreground">
        {emptyLabel}
      </p>
    )
  }

  return (
    <ul className="space-y-2">
      {items.map((doc) => {
        const isSignature =
          doc.kind === "ttd_digital" ||
          doc.kind === "ttd_scan" ||
          doc.kind === "ttd_pemohon"
        const Icon = isSignature ? ImageIcon : FileText
        return (
          <li
            key={doc.id}
            className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 p-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Icon className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {DOCUMENT_LABELS[doc.kind]}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {formatDateTime(doc.created_at)}
                  {doc.size_bytes
                    ? ` · ${(doc.size_bytes / 1024).toFixed(0)} KB`
                    : ""}
                </p>
              </div>
            </div>
            <OpenDocumentButton doc={doc} />
          </li>
        )
      })}
    </ul>
  )
}
