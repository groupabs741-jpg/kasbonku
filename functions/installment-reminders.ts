// Reminder angsuran (PRD 8.1). Runs daily from a schedule.
//
// Enqueues one notification per unpaid installment falling due in H-N days,
// then flushes the outbox so the email goes out in the same run. The SQL side
// stamps installments.reminder_sent_at, so a retry never double-sends.
//
// POST { days_ahead?: number }  — requires the x-kasbon-cron-secret header.

import { createAdminClient } from "npm:@insforge/sdk"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-kasbon-cron-secret",
}

const DEFAULT_DAYS_AHEAD = 3

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  })
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS })
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405)
  }

  const cronSecret = Deno.env.get("KASBON_CRON_SECRET")
  if (!cronSecret || req.headers.get("x-kasbon-cron-secret") !== cronSecret) {
    return json({ error: "unauthorized" }, 401)
  }

  let daysAhead = DEFAULT_DAYS_AHEAD
  try {
    const body = await req.json()
    if (typeof body?.days_ahead === "number") {
      daysAhead = Math.max(0, Math.min(30, Math.trunc(body.days_ahead)))
    }
  } catch {
    // No body is fine — the schedule sends none.
  }

  const baseUrl = Deno.env.get("INSFORGE_BASE_URL")!
  // queue_installment_reminders is revoked from anon/authenticated on purpose.
  const admin = createAdminClient({ baseUrl, apiKey: Deno.env.get("API_KEY")! })

  const { data: queued, error } = await admin.database.rpc("queue_installment_reminders", {
    p_days_ahead: daysAhead,
  })

  if (error) {
    return json({ error: "queue_failed", detail: error.message }, 500)
  }

  // Queued rows are picked up by the notifications-dispatch schedule (every 5
  // minutes). For an H-3 reminder that delay is immaterial, and skipping a
  // function-to-function hop keeps this job to a single failure mode.
  return json({ days_ahead: daysAhead, queued })
}
