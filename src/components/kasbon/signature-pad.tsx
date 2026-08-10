import * as React from "react"

import { Button } from "@/components/ui/button"

export type SignaturePadHandle = {
  /** Null when nothing has been drawn yet. */
  toBlob: () => Promise<Blob | null>
  clear: () => void
}

/**
 * PRD 10.4 — tanda tangan digital is drawn on screen, not uploaded as a
 * ready-made image. The canvas is backed at devicePixelRatio so the exported
 * PNG stays crisp when the document is printed.
 */
export const SignaturePad = React.forwardRef<
  SignaturePadHandle,
  { onStateChange: (hasSignature: boolean) => void }
>(function SignaturePad({ onStateChange }, ref) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const isDrawingRef = React.useRef(false)
  const hasStrokeRef = React.useRef(false)

  const resizeCanvas = React.useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const ratio = window.devicePixelRatio || 1
    // Resizing clears the bitmap, so re-drawing state is reset with it.
    canvas.width = Math.max(1, rect.width * ratio)
    canvas.height = 180 * ratio
    const context = canvas.getContext("2d")
    if (!context) return
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.lineWidth = 2
    context.lineCap = "round"
    context.lineJoin = "round"
    context.strokeStyle = "#0f172a"
  }, [])

  React.useEffect(() => {
    resizeCanvas()
    window.addEventListener("resize", resizeCanvas)
    return () => window.removeEventListener("resize", resizeCanvas)
  }, [resizeCanvas])

  const clear = React.useCallback(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext("2d")
    if (!canvas || !context) return
    context.save()
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.restore()
    hasStrokeRef.current = false
    onStateChange(false)
  }, [onStateChange])

  React.useImperativeHandle(
    ref,
    () => ({
      clear,
      toBlob: () =>
        new Promise<Blob | null>((resolve) => {
          const canvas = canvasRef.current
          if (!canvas || !hasStrokeRef.current) {
            resolve(null)
            return
          }
          // Flatten onto white so the PNG reads correctly on a printed page.
          const output = document.createElement("canvas")
          output.width = canvas.width
          output.height = canvas.height
          const context = output.getContext("2d")
          if (!context) {
            resolve(null)
            return
          }
          context.fillStyle = "#ffffff"
          context.fillRect(0, 0, output.width, output.height)
          context.drawImage(canvas, 0, 0)
          output.toBlob((blob) => resolve(blob), "image/png")
        }),
    }),
    [clear]
  )

  const pointOf = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-dashed border-primary/30 bg-primary/[0.03]">
      <canvas
        id="signature-pad"
        ref={canvasRef}
        className="h-[180px] w-full cursor-crosshair touch-none"
        aria-label="Area tanda tangan digital"
        onPointerDown={(event) => {
          const context = event.currentTarget.getContext("2d")
          if (!context) return
          const point = pointOf(event)
          event.currentTarget.setPointerCapture(event.pointerId)
          context.beginPath()
          context.moveTo(point.x, point.y)
          isDrawingRef.current = true
          hasStrokeRef.current = true
          onStateChange(true)
        }}
        onPointerMove={(event) => {
          if (!isDrawingRef.current) return
          const context = event.currentTarget.getContext("2d")
          if (!context) return
          const point = pointOf(event)
          context.lineTo(point.x, point.y)
          context.stroke()
        }}
        onPointerUp={(event) => {
          isDrawingRef.current = false
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }}
        onPointerCancel={() => {
          isDrawingRef.current = false
        }}
      />
      <div className="flex items-center justify-between border-t border-dashed border-primary/20 px-3 py-2">
        <span className="text-xs text-muted-foreground">
          Gambar tanda tangan di area ini
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={clear}>
          Bersihkan
        </Button>
      </div>
    </div>
  )
})
