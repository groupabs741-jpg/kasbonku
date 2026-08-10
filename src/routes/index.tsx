import { createFileRoute } from "@tanstack/react-router"
import { KasbonDashboard } from "@/components/kasbon-dashboard"

export const Route = createFileRoute("/")({ component: App })

function App() {
  return <KasbonDashboard />
}
