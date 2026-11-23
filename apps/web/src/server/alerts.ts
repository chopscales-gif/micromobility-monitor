// A person's own alerts, and the outbox: every email the system would have sent.
// Nothing is ever sent in this demonstration; the outbox stands in for the mail server.

import type { Actor } from "@mm/core/access";
import { authorize } from "./guard";
import { sql, sqlNow } from "./db";

export type AlertRow = { id: string; kind: string; at: number; title: string; body: string; href: string; urgent: boolean; read: boolean; emailedAt: number | null };

/** How many alerts this person has not opened. Read on every page, for the bell. */
export async function unreadCount(actor: Actor): Promise<number> {
  const [row] = await sql`select count(*)::int as n from alerts where user_id = ${actor.userId} and read_at is null`;
  return row!.n;
}

/** A person's own alerts, newest first. They are theirs to read, so no permission is asked. */
export async function myAlerts(actor: Actor): Promise<AlertRow[]> {
  const rows = await sql`select id, kind, at, title, body, href, urgent, read_at, emailed_at from alerts where user_id = ${actor.userId} order by (read_at is null) desc, at desc limit 100`;
  return rows.map((a) => ({ id: a.id, kind: a.kind, at: a.at.getTime(), title: a.title, body: a.body, href: a.href, urgent: a.urgent, read: a.read_at !== null, emailedAt: a.emailed_at ? a.emailed_at.getTime() : null }));
}

/** Marks one of this person's alerts read and says where it leads. */
export async function openAlert(actor: Actor, id: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id) && !/^\d+$/.test(id)) return null;
  const [row] = await sql`update alerts set read_at = coalesce(read_at, ${sqlNow()}) where id = ${id} and user_id = ${actor.userId} returning href`;
  return row ? (row.href as string) : null;
}

export async function markAllRead(actor: Actor): Promise<void> {
  await sql`update alerts set read_at = ${sqlNow()} where user_id = ${actor.userId} and read_at is null`;
}

export type Mail = { id: string; at: number; toName: string; toEmail: string; kind: "alert" | "digest" | "report"; subject: string; body: string; attachment: { name: string; href: string } | null };

/** The emails this person would have received; or, with the permission, everyone's. */
export async function outbox(actor: Actor, everyone: boolean): Promise<Mail[]> {
  if (everyone) await authorize(actor, "outbox.view", { action: "read", resource: "outbox" });
  const rows = await sql`select id, at, to_name, to_email, kind, subject, body, attachment_name, attachment_href from outbox where ${everyone ? sql`true` : sql`to_user_id = ${actor.userId}`} order by at desc, id desc limit 150`;
  return rows.map((m) => ({ id: String(m.id), at: m.at.getTime(), toName: m.to_name, toEmail: m.to_email, kind: m.kind, subject: m.subject, body: m.body, attachment: m.attachment_name && m.attachment_href ? { name: m.attachment_name, href: m.attachment_href } : null }));
}
