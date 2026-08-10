import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { CheckCircle2 } from "lucide-react"

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Spinner } from "@/components/ui/spinner"
import { useSession } from "@/components/session-provider"
import { AppHeader, AppSidebar } from "@/components/kasbon/app-shell"
import type { SectionKey } from "@/components/kasbon/app-shell"
import { LoginScreen } from "@/components/kasbon/login-screen"
import { ProfileSetup } from "@/components/kasbon/profile-setup"
import { ProfileSettings } from "@/components/kasbon/profile-settings"
import {
  ApplicantApplications,
  ApplicantDocuments,
  ApplicantInstallments,
  ApplicantOverview,
} from "@/components/kasbon/applicant-sections"
import {
  AdminApplications,
  AdminOverview,
  AdminReceivables,
  AdminReports,
} from "@/components/kasbon/admin-sections"
import { AdminApplicationSheet } from "@/components/kasbon/admin-application-sheet"
import { ApplicationDetailDialog } from "@/components/kasbon/application-detail-dialog"
import { NewApplicationDialog } from "@/components/kasbon/new-application-dialog"
import { SignatureDialog } from "@/components/kasbon/signature-dialog"
import {
  fetchAllApplications,
  fetchAllReceivables,
  fetchDashboardStats,
  fetchMyApplications,
  fetchMyReceivables,
} from "@/lib/api"
import { isProfileComplete } from "@/lib/kasbon"
import type { Application, Profile } from "@/lib/kasbon"

function FullScreenSpinner() {
  return (
    <div className="grid min-h-svh place-items-center bg-muted/30">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Memuat Kasbonku…
      </div>
    </div>
  )
}

export function KasbonDashboard() {
  const { status, profile } = useSession()

  if (status === "loading") return <FullScreenSpinner />
  if (status === "anonymous" || !profile) return <LoginScreen />

  // Setiap akun Google langsung menjadi pemohon; data kepegawaiannya dilengkapi
  // sendiri di sini sebelum dashboard terbuka.
  if (profile.role === "pemohon" && !isProfileComplete(profile)) {
    return <ProfileSetup profile={profile} />
  }

  return <Workspace profile={profile} />
}

function Workspace({ profile }: { profile: Profile }) {
  const isAdmin = profile.role === "admin"
  const [activeSection, setActiveSection] = React.useState<SectionKey>("overview")
  const [notice, setNotice] = React.useState("")
  const noticeTimer = React.useRef<number | null>(null)

  const [newApplicationOpen, setNewApplicationOpen] = React.useState(false)
  const [revisionOf, setRevisionOf] = React.useState<Application | null>(null)
  const [detailApplication, setDetailApplication] = React.useState<Application | null>(null)
  const [signatureApplication, setSignatureApplication] = React.useState<Application | null>(
    null
  )
  const [adminApplication, setAdminApplication] = React.useState<Application | null>(null)

  const showNotice = React.useCallback((message: string) => {
    setNotice(message)
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(""), 6000)
  }, [])

  React.useEffect(
    () => () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    },
    []
  )

  const applications = useQuery({
    queryKey: ["applications", isAdmin ? "all" : profile.id],
    queryFn: () => (isAdmin ? fetchAllApplications() : fetchMyApplications(profile.id)),
  })

  const receivables = useQuery({
    queryKey: ["receivables", isAdmin ? "all" : profile.id],
    queryFn: () => (isAdmin ? fetchAllReceivables() : fetchMyReceivables(profile.id)),
  })

  const stats = useQuery({
    queryKey: ["stats", profile.id],
    queryFn: fetchDashboardStats,
  })

  // The open sheet/dialog holds a snapshot; re-read it from the refetched list
  // so an approval or rejection is reflected without closing and reopening.
  const applicationList = React.useMemo(() => applications.data ?? [], [applications.data])
  const liveAdminApplication = adminApplication
    ? (applicationList.find((item) => item.id === adminApplication.id) ?? adminApplication)
    : null
  const liveDetailApplication = detailApplication
    ? (applicationList.find((item) => item.id === detailApplication.id) ?? detailApplication)
    : null

  const sharedData = {
    applications: applicationList,
    receivables: receivables.data ?? [],
    isPending: applications.isPending || receivables.isPending,
    error: applications.error ?? receivables.error,
  }

  const pendingCount = isAdmin
    ? applicationList.filter((item) =>
        ["Diajukan", "Diproses Admin", "Menunggu Review"].includes(item.status)
      ).length
    : applicationList.filter(
        (item) => item.status === "Menunggu TTD" || item.status === "Ditolak"
      ).length

  const applicantActions = {
    onNewApplication: () => {
      setRevisionOf(null)
      setNewApplicationOpen(true)
    },
    onOpenApplication: setDetailApplication,
    onUploadSignature: setSignatureApplication,
    onRevise: (application: Application) => {
      setRevisionOf(application)
      setNewApplicationOpen(true)
    },
  }

  const renderSection = () => {
    if (activeSection === "pengaturan") {
      return <ProfileSettings profile={profile} onNotify={showNotice} />
    }

    if (isAdmin) {
      const adminData = { ...sharedData, stats: stats.data }
      switch (activeSection) {
        case "pengajuan":
          return (
            <AdminApplications data={adminData} onOpenApplication={setAdminApplication} />
          )
        case "piutang":
          return <AdminReceivables data={adminData} onNotify={showNotice} />
        case "laporan":
          return <AdminReports data={adminData} onNotify={showNotice} />
        default:
          return (
            <AdminOverview
              data={adminData}
              onOpenApplication={setAdminApplication}
              onOpenSection={setActiveSection}
            />
          )
      }
    }

    switch (activeSection) {
      case "pengajuan":
        return <ApplicantApplications data={sharedData} actions={applicantActions} />
      case "angsuran":
        return <ApplicantInstallments data={sharedData} />
      case "dokumen":
        return <ApplicantDocuments data={sharedData} />
      default:
        return (
          <ApplicantOverview
            data={sharedData}
            actions={applicantActions}
            firstName={profile.full_name.split(" ")[0] || "kamu"}
          />
        )
    }
  }

  return (
    <SidebarProvider defaultOpen className="kasbon-app">
      <AppSidebar
        role={profile.role}
        activeSection={activeSection}
        onSectionChange={(section) => {
          setActiveSection(section)
          setNotice("")
        }}
        pendingCount={pendingCount}
      />
      <SidebarInset className="min-h-svh bg-muted/30">
        <AppHeader role={profile.role} />
        <main className="mx-auto flex w-full max-w-[1540px] flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
          {notice ? (
            <div
              role="status"
              className="flex items-start gap-2 rounded-2xl border border-primary/20 bg-primary/[0.06] px-4 py-3 text-sm text-primary"
            >
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              {notice}
            </div>
          ) : null}
          {renderSection()}
        </main>
      </SidebarInset>

      {!isAdmin ? (
        <>
          <NewApplicationDialog
            open={newApplicationOpen}
            onOpenChange={(open) => {
              setNewApplicationOpen(open)
              if (!open) setRevisionOf(null)
            }}
            profile={profile}
            revisionOf={revisionOf}
            onSubmitted={showNotice}
          />
          <ApplicationDetailDialog
            application={liveDetailApplication}
            onClose={() => setDetailApplication(null)}
            onUploadSignature={setSignatureApplication}
            onRevise={applicantActions.onRevise}
          />
          <SignatureDialog
            application={signatureApplication}
            onClose={() => setSignatureApplication(null)}
            onSubmitted={showNotice}
          />
        </>
      ) : (
        <AdminApplicationSheet
          application={liveAdminApplication}
          onClose={() => setAdminApplication(null)}
          onNotify={showNotice}
        />
      )}
    </SidebarProvider>
  )
}
