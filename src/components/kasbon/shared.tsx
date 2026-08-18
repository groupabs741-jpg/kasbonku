import * as React from "react"
import {
  Check,
  CheckCircle2,
  CircleCheck,
  CircleDollarSign,
  CircleX,
  Clock3,
  FileCheck2,
  FilePlus2,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { initialsOf } from "@/lib/format"
import { cn } from "@/lib/utils"
import { PROGRESS_STEPS, progressStepIndex } from "@/lib/kasbon"
import type { ApplicationStatus } from "@/lib/kasbon"

export const fieldClassName =
  "h-10 w-full rounded-2xl border border-border/70 bg-input/35 px-3 text-sm outline-none transition-[border-color,box-shadow,background-color] duration-150 ease-out focus:border-ring focus:bg-background focus:ring-3 focus:ring-ring/20 dark:bg-input/25 dark:focus:bg-background"

type BadgeStatus = ApplicationStatus | "Aktif"

const STATUS_CONFIG: Record<
  BadgeStatus,
  { icon: LucideIcon; className: string }
> = {
  Diajukan: {
    icon: FilePlus2,
    className:
      "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300",
  },
  "Menunggu TTD": {
    icon: FileCheck2,
    className:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  },
  "Menunggu Review": {
    icon: Clock3,
    className:
      "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300",
  },
  Ditolak: {
    icon: CircleX,
    className:
      "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  },
  "Disetujui / Cair": {
    icon: CircleCheck,
    className:
      "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300",
  },
  Lunas: {
    icon: CheckCircle2,
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  Aktif: {
    icon: CircleDollarSign,
    className:
      "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300",
  },
}

export function StatusBadge({ status }: { status: BadgeStatus }) {
  const config = STATUS_CONFIG[status]
  const Icon = config.icon
  return (
    <Badge variant="outline" className={cn("gap-1.5", config.className)}>
      <Icon className="size-3.5" />
      {status}
    </Badge>
  )
}

export function ApplicantAvatar({
  name,
  size = "default",
  className,
}: {
  name: string | null | undefined
  size?: "default" | "sm" | "lg"
  className?: string
}) {
  return (
    <Avatar
      size={size}
      className={cn(
        "rounded-2xl border border-primary/20 bg-primary/[0.08] shadow-sm shadow-primary/10 after:rounded-2xl",
        className
      )}
    >
      <AvatarFallback className="rounded-2xl border border-primary/10 bg-primary/[0.08] text-xs font-bold tracking-tight text-primary">
        {initialsOf(name)}
      </AvatarFallback>
    </Avatar>
  )
}

export function PageIntro({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {title}
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  loading,
}: {
  label: string
  value: string
  detail: string
  icon: LucideIcon
  loading?: boolean
}) {
  return (
    <Card className="border-border/80 bg-card/90 shadow-none">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="mt-2 truncate text-xl font-semibold tracking-tight sm:text-2xl">
              {loading ? <Spinner className="size-5" /> : value}
            </p>
          </div>
          <div className="grid size-9 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Icon className="size-4" />
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  )
}

export function Metric({
  label,
  value,
  highlight = false,
  className,
  valueClassName,
}: {
  label: string
  value: string
  highlight?: boolean
  className?: string
  valueClassName?: string
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-2xl border border-border/70 p-3",
        highlight && "border-primary/20 bg-primary/[0.05]",
        className
      )}
    >
      <p className="text-xs leading-tight text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-sm leading-tight font-semibold tracking-tight tabular-nums",
          highlight && "text-primary",
          valueClassName
        )}
      >
        {value}
      </p>
    </div>
  )
}

// The vertical case-file timeline maps one entry per canonical progress step,
// but spells out what happens inside the signing step for the applicant.
const TIMELINE_STEPS: {
  label: string
  description: string
  statuses: ApplicationStatus[]
}[] = [
  {
    label: "Pengajuan diterima",
    description: "Form terkirim, dokumen resmi otomatis dibuat",
    statuses: ["Diajukan"],
  },
  {
    label: "Menunggu tanda tangan",
    description: "Admin kirim dokumen; pemohon TTD, cetak, minta TTD basah atasan langsung, unggah scan",
    statuses: ["Menunggu TTD"],
  },
  {
    label: "Review dokumen TTD",
    description: "Admin memeriksa scan yang diunggah pemohon",
    statuses: ["Menunggu Review"],
  },
  {
    label: "Dana dicairkan",
    description: "Kasbon disetujui dan masuk tracking angsuran",
    statuses: ["Disetujui / Cair", "Lunas"],
  },
]

/**
 * Horizontal stepper untuk kartu "Progress Pengajuan" (pemohon) dan ringkasan
 * admin — dua sisi membaca PROGRESS_STEPS yang sama supaya alurnya konsisten.
 */
export function ProgressStepper({ status }: { status: ApplicationStatus }) {
  const activeIndex = progressStepIndex(status)
  const isRejected = status === "Ditolak"
  const isSettled = status === "Lunas"

  return (
    <ol className="flex items-start">
      {PROGRESS_STEPS.map((step, index) => {
        const state =
          isSettled || index < activeIndex || (status === "Disetujui / Cair" && index === activeIndex)
            ? "done"
            : index === activeIndex
              ? isRejected
                ? "rejected"
                : "current"
              : "pending"
        const isLast = index === PROGRESS_STEPS.length - 1

        return (
          <li key={step.key} className="flex min-w-0 flex-1 flex-col items-center">
            <div className="flex w-full items-center">
              <span
                className={cn(
                  "h-0.5 flex-1",
                  index === 0
                    ? "bg-transparent"
                    : index <= activeIndex && !isRejected
                      ? "bg-primary"
                      : "bg-border"
                )}
              />
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold",
                  state === "done" &&
                    "border-primary bg-primary text-primary-foreground",
                  state === "current" &&
                    "border-primary bg-primary/10 text-primary",
                  state === "pending" &&
                    "border-border bg-muted text-muted-foreground",
                  state === "rejected" &&
                    "border-red-300 bg-red-50 text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                )}
              >
                {state === "done" ? (
                  <Check className="size-3.5" />
                ) : state === "rejected" ? (
                  <CircleX className="size-3.5" />
                ) : (
                  index + 1
                )}
              </span>
              <span
                className={cn(
                  "h-0.5 flex-1",
                  isLast
                    ? "bg-transparent"
                    : index < activeIndex && !isRejected
                      ? "bg-primary"
                      : "bg-border"
                )}
              />
            </div>
            <span
              className={cn(
                "mt-2 px-1 text-center text-[11px] leading-tight font-medium",
                state === "pending" ? "text-muted-foreground" : "text-foreground",
                state === "rejected" && "text-red-600 dark:text-red-300"
              )}
            >
              {isRejected && index === activeIndex ? "Ditolak" : step.label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export function StatusTimeline({ status }: { status: ApplicationStatus }) {
  // "Ditolak" is off the happy path: show the flow stalled at review.
  const activeIndex =
    status === "Ditolak"
      ? TIMELINE_STEPS.findIndex((step) =>
          step.statuses.includes("Menunggu Review")
        )
      : TIMELINE_STEPS.findIndex((step) => step.statuses.includes(status))
  const resolvedIndex = activeIndex === -1 ? 0 : activeIndex
  const isSettled = status === "Lunas"

  return (
    <div className="space-y-4">
      {TIMELINE_STEPS.map((step, index) => {
        const state =
          isSettled || index < resolvedIndex || (status === "Disetujui / Cair" && index === resolvedIndex)
            ? "done"
            : index === resolvedIndex
              ? "current"
              : "pending"
        const isRejected = status === "Ditolak" && index === resolvedIndex

        return (
          <div key={step.label} className="relative flex gap-3">
            {index < TIMELINE_STEPS.length - 1 ? (
              <div className="absolute top-7 left-3.5 h-8 w-px bg-border" />
            ) : null}
            <div
              className={cn(
                "relative z-10 grid size-7 shrink-0 place-items-center rounded-full border",
                state === "done" &&
                  "border-primary bg-primary text-primary-foreground",
                state === "current" &&
                  "border-primary/30 bg-primary/10 text-primary",
                state === "pending" &&
                  "border-border bg-muted text-muted-foreground",
                isRejected &&
                  "border-red-300 bg-red-50 text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
              )}
            >
              {state === "done" && !isRejected ? (
                <Check className="size-3.5" />
              ) : isRejected ? (
                <CircleX className="size-3.5" />
              ) : (
                <span className="size-1.5 rounded-full bg-current" />
              )}
            </div>
            <div className="min-w-0 pt-0.5">
              <p
                className={cn(
                  "text-sm font-medium",
                  state === "pending" && "text-muted-foreground"
                )}
              >
                {step.label}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {isRejected
                  ? "Ditolak — perlu revisi pemohon"
                  : step.description}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <Card className="border-dashed shadow-none">
      <CardContent className="flex flex-col items-center justify-center gap-2 p-10 text-center">
        <Icon className="size-5 text-muted-foreground" />
        <p className="text-sm font-medium">{title}</p>
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
        {action ? <div className="mt-2">{action}</div> : null}
      </CardContent>
    </Card>
  )
}

export function LoadingBlock({ label = "Memuat data…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border/70 p-10 text-sm text-muted-foreground">
      <Spinner />
      {label}
    </div>
  )
}

export function ErrorBlock({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    <div
      role="alert"
      className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
    >
      Gagal memuat data: {message}
    </div>
  )
}
