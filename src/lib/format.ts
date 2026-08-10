const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
})

const compactCurrencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  notation: "compact",
  maximumFractionDigits: 1,
})

const dateFormatter = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "long",
  year: "numeric",
})

const dateTimeFormatter = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

export const formatCurrency = (value: number | string | null | undefined) =>
  currencyFormatter.format(Number(value ?? 0))

/** Formats an editable whole-number input while keeping an empty value empty. */
export const formatCurrencyInput = (
  value: number | string | null | undefined
) => {
  if (value === null || value === undefined || value === "") return ""
  const numericValue = Number(value)
  if (Number.isFinite(numericValue))
    return currencyFormatter.format(numericValue)

  const digits = String(value).replace(/\D/g, "")
  return digits ? currencyFormatter.format(Number(digits)) : ""
}

export const formatCompactCurrency = (
  value: number | string | null | undefined
) => compactCurrencyFormatter.format(Number(value ?? 0))

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "-"
  // Date-only columns arrive as `YYYY-MM-DD`; anchoring to local midnight keeps
  // them from shifting a day backwards in UTC+8.
  const date =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00`)
      : new Date(value)
  return Number.isNaN(date.getTime()) ? "-" : dateFormatter.format(date)
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "-"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "-" : dateTimeFormatter.format(date)
}

/** `2026-08-08` in local time — the shape date inputs and date columns expect. */
export function toDateInput(value: Date | string | null | undefined) {
  if (!value) return ""
  const date = typeof value === "string" ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return ""
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

export function initialsOf(name: string | null | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function relativeTime(value: string | null | undefined) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return "Baru saja"
  if (minutes < 60) return `${minutes} menit lalu`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} jam lalu`
  const days = Math.round(hours / 24)
  if (days === 1) return "Kemarin"
  if (days < 30) return `${days} hari lalu`
  return formatDate(value)
}
