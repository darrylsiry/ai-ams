"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { runDailyAutomation } from "@/lib/automation";
import { db, nextNumber, one } from "@/lib/db";
import { DEFAULTS } from "@/lib/settings";
import { currentUser, requirePerm } from "@/lib/user";

const go = (path: string, key: "msg" | "error", text: string): never => { revalidatePath(path); redirect(`${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(text)}`); };
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim() || null;

/** Sign someone out everywhere without turning the login off (SEC-029). */
export async function endSessionsAction(f: FormData) {
  const me = await requirePerm("admin");
  const id = Number(f.get("id"));
  const u = await one<{ username: string }>("UPDATE users SET session_version = session_version + 1 WHERE id = $1 RETURNING username", [id]);
  if (u) await audit({ actor: me.username, action: "user.sessions_ended", entityType: "user", entityId: id, summary: `Ended all sessions for ${u.username}` });
  go(`/admin/users/${id}`, "msg", "All sessions ended");
}

export async function saveUserAction(f: FormData) {
  const me = await currentUser();
  const id = Number(f.get("id")) || null;
  // Admins edit anyone; a user may edit their own name, phone and title only.
  const isAdmin = me.role === "admin";
  if (!isAdmin && id !== me.id) await requirePerm("admin");
  const username = (s(f, "username") ?? "").toLowerCase();
  if (!id && !/^[a-z0-9._-]{2,30}$/.test(username)) go("/admin/users/new", "error", "User ID: 2–30 letters, digits, . _ -");
  const before = id ? await one<{ active: boolean; session_version: number }>("SELECT * FROM users WHERE id = $1", [id]) : null;
  try {
    if (id && !isAdmin) {
      await db.query("UPDATE users SET full_name = $2, phone = $3, title = $4 WHERE id = $1", [id, s(f, "full_name"), s(f, "phone"), s(f, "title")]);
    } else if (id) {
      if (id === me.id && f.get("role") !== "admin") go(`/admin/users/${id}`, "error", "You can't remove your own administrator role.");
      await db.query(`UPDATE users SET full_name=$2, email=$3, title=$4, role=$5, branch_id=$6, phone=$7, inbox_alias=$8, can_view_pii=$9, commission_new_pct=$10, commission_renewal_pct=$11, active=$12, color=$13 WHERE id = $1`,
        [id, s(f, "full_name"), s(f, "email"), s(f, "title"), s(f, "role"), Number(f.get("branch_id")) || null, s(f, "phone"), (s(f, "inbox_alias") ?? "").toLowerCase(), f.get("can_view_pii") === "on",
          Number(f.get("commission_new_pct")) || 0, Number(f.get("commission_renewal_pct")) || 0, f.get("active") === "on", s(f, "color") ?? "#6366f1"]);
    } else {
      const row = await one<{ id: number }>(`INSERT INTO users (username, full_name, email, title, role, branch_id, phone, inbox_alias, can_view_pii, commission_new_pct, commission_renewal_pct, color)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [username, s(f, "full_name"), s(f, "email"), s(f, "title"), s(f, "role"), Number(f.get("branch_id")) || null, s(f, "phone"), (s(f, "inbox_alias") ?? username).toLowerCase(), f.get("can_view_pii") === "on",
          Number(f.get("commission_new_pct")) || 0, Number(f.get("commission_renewal_pct")) || 0, s(f, "color") ?? "#6366f1"]);
      await audit({ actor: me.username, action: "user.created", entityType: "user", entityId: row!.id, summary: `Created ${username} (${s(f, "role")})` });
      go(`/admin/users/${row!.id}`, "msg", `Profile created. Issue a password: scripts/fly-users.sh ${username}`);
    }
  } catch (err) {
    if ((err as Error).message?.startsWith("NEXT_REDIRECT")) throw err;
    const m = (err as Error).message;
    go(id ? `/admin/users/${id}` : "/admin/users/new", "error", m.includes("unique") ? "That user ID, email or inbox alias is already taken." : m);
  }
  await audit({ actor: me.username, action: "user.updated", entityType: "user", entityId: id!, summary: `Updated ${s(f, "full_name")}`, before, after: Object.fromEntries([...f.entries()].filter(([k]) => !k.startsWith("$"))) });
  // Deactivating ends every session they hold right away (SEC-003), and says what is left behind (CR-014).
  if (isAdmin && before?.active && f.get("active") !== "on") {
    await db.query("UPDATE users SET session_version = session_version + 1 WHERE id = $1", [id]);
    const open = await one<{ n: number }>("SELECT count(*)::int AS n FROM activities WHERE owner_id = $1 AND status IN ('open','waiting')", [id]);
    go(`/admin/users/${id}`, "msg", open!.n ? `Saved and deactivated. ${open!.n} open task(s) are still theirs, flagged in Team priorities: reassign them there.` : "Saved and deactivated");
  }
  go(`/admin/users/${id}`, "msg", "Saved");
}

export async function addLicenseAction(f: FormData) {
  const me = await requirePerm("admin");
  const id = Number(f.get("id"));
  await db.query("INSERT INTO licenses (user_id, state, license_number, lines, expires_on) VALUES ($1,$2,$3,$4,$5)", [id, s(f, "state"), s(f, "license_number"), s(f, "lines") ?? "Property & Casualty", s(f, "expires_on")]);
  await audit({ actor: me.username, action: "license.added", entityType: "user", entityId: id, summary: `${s(f, "state")} license ${s(f, "license_number")}` });
  go(`/admin/users/${id}`, "msg", "License added; renewal reminders are automatic");
}

export async function settingsAction(f: FormData) {
  const me = await requirePerm("admin");
  const agency = { name: s(f, "agency_name"), address: s(f, "agency_address"), phone: s(f, "agency_phone"), license: s(f, "agency_license") };
  const lead = { personal: Number(f.get("lead_personal")) || 45, commercial_small: Number(f.get("lead_commercial")) || 90, commercial_large: Number(f.get("lead_large")) || 120, large_premium: Number(f.get("large_premium")) || 25000 };
  const num = (k: string, fallback: number) => { const v = Number(f.get(k)); return f.get(k) !== null && f.get(k) !== "" && Number.isFinite(v) && v >= 0 ? v : fallback; };
  const d = DEFAULTS;
  const tuning = {
    email_auto_action_confidence: Math.min(1, num("email_confidence", d.email_auto_action_confidence)),
    commission_variance: { dollars: num("variance_dollars", d.commission_variance.dollars), pct: num("variance_pct", d.commission_variance.pct) },
    automation_windows: { binder_days: num("binder_days", d.automation_windows.binder_days), pending_cancel_days: num("pending_cancel_days", d.automation_windows.pending_cancel_days),
      invoice_past_due_days: num("invoice_past_due_days", d.automation_windows.invoice_past_due_days), claim_stale_days: num("claim_stale_days", d.automation_windows.claim_stale_days) },
    waiting_followup_days: { client: num("wait_client", 3), carrier: num("wait_carrier", 5), internal: num("wait_internal", 2), other: num("wait_other", 3) },
    ai_assists: { email: f.get("ai_email") === "on", policy_check: f.get("ai_policy_check") === "on", statement: f.get("ai_statement") === "on", account_qa: f.get("ai_account_qa") === "on", assistant: f.get("ai_assistant") === "on" },
  };
  for (const [k, v] of [["agency", agency], ["renewal_lead_days", lead], ["remarket_threshold_pct", Number(f.get("remarket")) || 10], ...Object.entries(tuning)] as [string, unknown][]) {
    await db.query("INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [k, JSON.stringify(v)]);
  }
  await audit({ actor: me.username, action: "settings.updated", entityType: "settings", entityId: "agency", summary: "Agency settings updated", after: { agency, lead, ...tuning } });
  go("/admin/settings", "msg", "Settings saved");
}

export async function codeAction(f: FormData) {
  const me = await requirePerm("admin");
  const code = String(f.get("code"));
  await db.query("UPDATE activity_codes SET default_priority = $2, default_due_days = $3, sla_hours = $4, active = $5 WHERE code = $1",
    [code, String(f.get("default_priority")), Number(f.get("default_due_days")) || 0, Number(f.get("sla_hours")) || null, f.get("active") === "on"]);
  await audit({ actor: me.username, action: "activity_code.updated", entityType: "settings", entityId: code, summary: `Updated ${code}` });
  go("/admin/settings", "msg", `${code} updated`);
}

export async function runAutomationAction() {
  const me = await requirePerm("admin");
  const r = await runDailyAutomation();
  await audit({ actor: me.username, action: "automation.manual_run", entityType: "system", entityId: r.ranOn, summary: "Ran daily automation by hand", after: r });
  go("/admin/settings", "msg", `Automation ran: ${Object.entries(r.created).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(", ") || "nothing new"}`);
}

export async function carrierAction(f: FormData) {
  const me = await requirePerm("admin");
  const id = Number(f.get("id")) || null;
  const vals = [s(f, "name"), s(f, "kind") ?? "carrier", s(f, "naic"), s(f, "am_best"), f.get("admitted") === "on", s(f, "bill_modes") ?? "direct", String(f.get("lines") ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean),
    s(f, "phone"), s(f, "email"), s(f, "underwriting_email"), s(f, "portal_url"), Number(f.get("commission_new_pct")) || 0, Number(f.get("commission_renewal_pct")) || 0, f.get("active") === "on"];
  if (id) await db.query(`UPDATE carriers SET name=$2, kind=$3, naic=$4, am_best=$5, admitted=$6, bill_modes=$7, lines=$8, phone=$9, email=$10, underwriting_email=$11, portal_url=$12, commission_new_pct=$13, commission_renewal_pct=$14, active=$15 WHERE id = $1`, [id, ...vals]);
  else await db.query(`INSERT INTO carriers (code, name, kind, naic, am_best, admitted, bill_modes, lines, phone, email, underwriting_email, portal_url, commission_new_pct, commission_renewal_pct, active)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [await nextNumber(String(vals[0]).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4) || "CAR"), ...vals]);
  await audit({ actor: me.username, action: id ? "carrier.updated" : "carrier.created", entityType: "carrier", entityId: id ?? String(vals[0]), summary: `${vals[0]}` });
  go("/admin/carriers", "msg", "Carrier saved");
}
