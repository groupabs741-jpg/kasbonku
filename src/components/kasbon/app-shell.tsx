import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Bell,
  ClipboardCheck,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  LogOut,
  Moon,
  NotebookPen,
  ReceiptText,
  Settings2,
  Sun,
  WalletCards,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { useSession } from "@/components/session-provider"
import { fetchNotifications, markNotificationRead } from "@/lib/api"
import { initialsOf, relativeTime } from "@/lib/format"
import type { Role } from "@/lib/kasbon"
import { cn } from "@/lib/utils"

export type SectionKey =
  | "overview"
  | "pengajuan"
  | "angsuran"
  | "dokumen"
  | "piutang"
  | "pencatatan"
  | "laporan"
  | "pengaturan"

const APPLICANT_NAV: { label: string; section: SectionKey; icon: LucideIcon }[] = [
  { label: "Ringkasan", section: "overview", icon: LayoutDashboard },
  { label: "Riwayat pengajuan", section: "pengajuan", icon: FileText },
  { label: "Angsuran & piutang", section: "angsuran", icon: ReceiptText },
  { label: "Dokumen", section: "dokumen", icon: FileCheck2 },
]

const ADMIN_NAV: { label: string; section: SectionKey; icon: LucideIcon }[] = [
  { label: "Ringkasan", section: "overview", icon: LayoutDashboard },
  { label: "Semua pengajuan", section: "pengajuan", icon: ClipboardCheck },
  { label: "Kartu piutang", section: "piutang", icon: WalletCards },
  { label: "Pencatatan", section: "pencatatan", icon: NotebookPen },
  { label: "Laporan", section: "laporan", icon: FileSpreadsheet },
]

export function AppSidebar({
  role,
  activeSection,
  onSectionChange,
  pendingCount,
}: {
  role: Role
  activeSection: SectionKey
  onSectionChange: (section: SectionKey) => void
  pendingCount: number
}) {
  const { profile, signOut } = useSession()
  const navigation = role === "pemohon" ? APPLICANT_NAV : ADMIN_NAV
  const badgedSection: SectionKey = "pengajuan"

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader className="px-3 pt-4 pb-4">
        <div className="flex items-center gap-3 px-2">
          <div className="grid size-9 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <WalletCards className="size-4.5" />
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-semibold tracking-tight">Kasbonku</p>
            <p className="truncate text-xs text-sidebar-foreground/60">ABS Group</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>
            {role === "pemohon" ? "Workspace karyawan" : "Workspace admin"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item) => {
                const Icon = item.icon
                const showBadge = item.section === badgedSection && pendingCount > 0
                return (
                  <SidebarMenuItem key={item.section}>
                    <SidebarMenuButton
                      type="button"
                      isActive={activeSection === item.section}
                      onClick={() => onSectionChange(item.section)}
                      tooltip={item.label}
                    >
                      <Icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                    {showBadge ? (
                      <SidebarMenuBadge>{pendingCount}</SidebarMenuBadge>
                    ) : null}
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="mt-auto">
          <SidebarGroupLabel>Akun</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  type="button"
                  tooltip="Pengaturan profil"
                  isActive={activeSection === "pengaturan"}
                  onClick={() => onSectionChange("pengaturan")}
                >
                  <Settings2 />
                  <span>Pengaturan profil</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  type="button"
                  tooltip="Keluar"
                  onClick={() => void signOut()}
                >
                  <LogOut />
                  <span>Keluar</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="gap-3 p-3">
        <div className="flex items-center gap-2 rounded-2xl bg-sidebar-accent/50 p-2.5">
          <Avatar size="sm">
            {profile?.avatar_url ? <AvatarImage src={profile.avatar_url} alt="" /> : null}
            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
              {initialsOf(profile?.full_name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-xs font-medium">{profile?.full_name || "—"}</p>
            <p className="truncate text-[11px] text-sidebar-foreground/60">
              {role === "admin" ? "Admin · akses penuh" : profile?.jabatan || profile?.email}
            </p>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

function ThemeToggle() {
  const [isDark, setIsDark] = React.useState(false)

  React.useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"))
  }, [])

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => {
        const next = !isDark
        document.documentElement.classList.toggle("dark", next)
        setIsDark(next)
      }}
      aria-label="Ganti tema"
    >
      {isDark ? <Sun /> : <Moon />}
    </Button>
  )
}

function NotificationBell() {
  const queryClient = useQueryClient()
  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: () => fetchNotifications(20),
    refetchInterval: 60_000,
  })

  const markRead = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  })

  const items = notifications.data ?? []
  const unread = items.filter((item) => !item.read_at).length

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Notifikasi" className="relative" />
        }
      >
        <Bell />
        {unread > 0 ? (
          <span className="absolute top-1.5 right-1.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
          <p className="text-sm font-medium">Notifikasi</p>
          {unread > 0 ? (
            <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary">
              {unread} baru
            </Badge>
          ) : null}
        </div>
        <ScrollArea className="max-h-80">
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">
              Belum ada notifikasi.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!item.read_at) markRead.mutate(item.id)
                    }}
                    className={cn(
                      "w-full px-4 py-3 text-left transition-colors hover:bg-muted/60",
                      !item.read_at && "bg-primary/[0.04]"
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {!item.read_at ? (
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                      ) : (
                        <span className="mt-1.5 size-1.5 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-medium">{item.title}</p>
                        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                          {item.body}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground/80">
                          {relativeTime(item.created_at)}
                        </p>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}

export function AppHeader({ role }: { role: Role }) {
  const { profile } = useSession()

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border/70 bg-background/90 px-4 backdrop-blur sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <SidebarTrigger className="-ml-1" aria-label="Buka menu navigasi" />
        <Separator orientation="vertical" className="hidden h-5 sm:block" />
        <div className="hidden min-w-0 sm:block">
          <p className="truncate text-sm font-medium">Kasbonku</p>
          <p className="truncate text-xs text-muted-foreground">
            {role === "pemohon" ? "Ruang kerja karyawan" : "Ruang kerja admin"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 sm:gap-2">
        {role === "admin" ? (
          <Badge
            variant="outline"
            className="hidden border-primary/20 bg-primary/5 text-primary sm:inline-flex"
          >
            Admin
          </Badge>
        ) : null}
        <NotificationBell />
        <ThemeToggle />
        <Avatar className="ml-1 hidden sm:flex">
          {profile?.avatar_url ? <AvatarImage src={profile.avatar_url} alt="" /> : null}
          <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
            {initialsOf(profile?.full_name)}
          </AvatarFallback>
        </Avatar>
      </div>
    </header>
  )
}
