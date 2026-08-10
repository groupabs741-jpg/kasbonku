// Drains the public.notifications outbox and sends each row as an email.
//
// The database triggers only enqueue; delivery happens here so a Resend outage
// never rolls back a status change. Runs on a schedule and is also invoked by
// the app right after an admin action for near-instant delivery.
//
// Secrets:
//   RESEND_API_KEY    required to actually send; without it rows are parked
//   RESEND_FROM_EMAIL sender address on a domain verified in Resend
//   RESEND_FROM_NAME  optional display name
//   KASBON_CRON_SECRET  shared secret for the scheduled invocation
//   KASBON_APP_URL      link back into the dashboard from the email body

import { createAdminClient, createClient } from "npm:@insforge/sdk"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-kasbon-cron-secret",
}

const BATCH_SIZE = 50
const MAX_ATTEMPTS = 3

type Notification = {
  id: string
  type: string
  title: string
  body: string
  email_to: string
  attempts: number
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  })
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function renderEmail(notification: Notification, appUrl: string) {
  const ctaLabel = notification.type === "pengajuan_baru" || notification.type === "ttd_diterima"
    ? "Buka dashboard admin"
    : "Buka dashboard Kasbonku"

  return `<!doctype html>
<html lang="id">
  <body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;">
      <tr>
        <td style="padding:24px 28px 8px;">
          <p style="margin:0;font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#167c6e;">Kasbonku &middot; ABS Group</p>
          <h1 style="margin:12px 0 0;font-size:19px;line-height:1.4;font-weight:600;">${escapeHtml(notification.title)}</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:12px 28px 20px;">
          <p style="margin:0;font-size:15px;line-height:1.65;color:#374151;">${escapeHtml(notification.body)}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px 28px;">
          <a href="${escapeHtml(appUrl)}" style="display:inline-block;background:#167c6e;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 20px;border-radius:999px;">${ctaLabel}</a>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 28px 24px;border-top:1px solid #f3f4f6;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;">Email otomatis dari sistem Kasbonku. Mohon tidak membalas email ini.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

async function sendViaResend(
  apiKey: string,
  from: string,
  notification: Notification,
  appUrl: string,
) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // The notification id is stable across retries, so a row that already
      // went out cannot be delivered twice if this run is repeated.
      "Idempotency-Key": notification.id,
    },
    body: JSON.stringify({
      from,
      to: [notification.email_to],
      subject: notification.title,
      text: `${notification.title}\n\n${notification.body}\n\n${appUrl}`,
      html: renderEmail(notification, appUrl),
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Resend ${response.status}: ${detail.slice(0, 400)}`)
  }
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS })
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405)
  }

  const cronSecret = Deno.env.get("KASBON_CRON_SECRET")
  const presentedSecret = req.headers.get("x-kasbon-cron-secret")
  const authHeader = req.headers.get("Authorization")

  const isCron = Boolean(cronSecret) && presentedSecret === cronSecret
  if (!isCron && !authHeader) {
    return json({ error: "unauthorized" }, 401)
  }

  // Admin client: the outbox rows belong to other users, so a user-scoped
  // client cannot read or settle them.
  const admin = createAdminClient({
    baseUrl: Deno.env.get("INSFORGE_BASE_URL")!,
    apiKey: Deno.env.get("API_KEY")!,
  })

  // An authenticated caller may only flush the queue, never author it — the
  // rows were written by database triggers, so no payload is trusted here.
  if (!isCron) {
    const asUser = createClient({
      baseUrl: Deno.env.get("INSFORGE_BASE_URL"),
      accessToken: authHeader!.replace("Bearer ", ""),
    })
    const { data: userData } = await asUser.auth.getCurrentUser()
    if (!userData?.user?.id) {
      return json({ error: "unauthorized" }, 401)
    }
  }

  const { data: pending, error: readError } = await admin.database
    .from("notifications")
    .select("id, type, title, body, email_to, attempts")
    .eq("email_status", "pending")
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE)

  if (readError) {
    return json({ error: "read_failed", detail: readError.message }, 500)
  }

  const queue = (pending ?? []) as Notification[]
  if (queue.length === 0) {
    return json({ processed: 0, sent: 0, failed: 0, skipped: 0 })
  }

  const apiKey = Deno.env.get("RESEND_API_KEY")
  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL")
  const appUrl = Deno.env.get("KASBON_APP_URL") ?? "http://localhost:3000"

  // Not configured yet: park the rows as `skipped` rather than burning attempts
  // or, worse, losing the notification. They stay visible in the in-app inbox.
  if (!apiKey || !fromEmail) {
    await admin.database
      .from("notifications")
      .update({
        email_status: "skipped",
        email_error: "RESEND_API_KEY / RESEND_FROM_EMAIL belum dikonfigurasi",
      })
      .in("id", queue.map((n) => n.id))

    return json({
      processed: queue.length,
      sent: 0,
      failed: 0,
      skipped: queue.length,
      warning: "resend_not_configured",
    })
  }

  // Resend takes the sender as one string: "Nama <alamat@domain>".
  const fromName = Deno.env.get("RESEND_FROM_NAME") ?? "Kasbonku ABS Group"
  const from = fromEmail.includes("<") ? fromEmail : `${fromName} <${fromEmail}>`

  let sent = 0
  let failed = 0

  for (const notification of queue) {
    try {
      await sendViaResend(apiKey, from, notification, appUrl)
      await admin.database
        .from("notifications")
        .update({
          email_status: "sent",
          sent_at: new Date().toISOString(),
          attempts: notification.attempts + 1,
          email_error: null,
        })
        .eq("id", notification.id)
      sent += 1
    } catch (error) {
      const attempts = notification.attempts + 1
      const message = error instanceof Error ? error.message : String(error)
      await admin.database
        .from("notifications")
        .update({
          // Stay `pending` until the last attempt so the next run retries.
          email_status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
          attempts,
          email_error: message.slice(0, 500),
        })
        .eq("id", notification.id)
      failed += 1
    }
  }

  return json({ processed: queue.length, sent, failed, skipped: 0 })
}
