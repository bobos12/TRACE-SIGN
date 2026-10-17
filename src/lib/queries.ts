// Read models for the dashboard: document lists by folder, counts, contacts.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, t } from "./db";

export const VIEWS = ["all", "drafts", "waiting_others", "waiting_me", "completed", "declined", "expired"] as const;
export type View = (typeof VIEWS)[number];

export const VIEW_LABEL: Record<View, string> = {
  all: "All documents",
  drafts: "Drafts",
  waiting_others: "Waiting for others",
  waiting_me: "Waiting for me",
  completed: "Completed",
  declined: "Declined",
  expired: "Expired",
};

export interface DocRow {
  id: string;
  title: string;
  status: string;
  createdAt: Date;
  sentAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date | null;
  lastActivityAt: Date;
  signingOrder: string;
  pageCount: number | null;
  hasSigned: boolean;
  recipients: { id: string; name: string; email: string; status: string; color: string; order: number }[];
  signed: number;
  total: number;
  waitingOnMe: boolean;
}

export async function listDocumentRows(orgId: string, me: string): Promise<DocRow[]> {
  const docs = await db
    .select({
      id: t.documents.id,
      title: t.documents.title,
      status: t.documents.status,
      createdAt: t.documents.createdAt,
      sentAt: t.documents.sentAt,
      completedAt: t.documents.completedAt,
      expiresAt: t.documents.expiresAt,
      lastActivityAt: t.documents.lastActivityAt,
      signingOrder: t.documents.signingOrder,
      pageCount: t.documents.pageCount,
      hasSigned: sql<boolean>`${t.documents.completedSha256} is not null`,
    })
    .from(t.documents)
    .where(eq(t.documents.orgId, orgId))
    .orderBy(desc(t.documents.lastActivityAt))
    .limit(2000);
  if (!docs.length) return [];
  const recs = await db
    .select({
      id: t.recipients.id,
      documentId: t.recipients.documentId,
      name: t.recipients.name,
      email: t.recipients.email,
      status: t.recipients.status,
      color: t.recipients.color,
      order: t.recipients.routingOrder,
    })
    .from(t.recipients)
    .where(inArray(t.recipients.documentId, docs.map((d) => d.id)))
    .orderBy(t.recipients.routingOrder, t.recipients.createdAt);
  const by = new Map<string, DocRow["recipients"]>();
  for (const r of recs) {
    const list = by.get(r.documentId) ?? [];
    list.push(r);
    by.set(r.documentId, list);
  }
  const mine = me.toLowerCase();
  return docs.map((d) => {
    const rs = by.get(d.id) ?? [];
    return {
      ...d,
      recipients: rs,
      signed: rs.filter((r) => r.status === "signed").length,
      total: rs.length,
      waitingOnMe: d.status === "sent" && rs.some((r) => r.email === mine && (r.status === "sent" || r.status === "opened")),
    };
  });
}

export function inView(d: DocRow, v: View): boolean {
  switch (v) {
    case "all":
      return true;
    case "drafts":
      return d.status === "draft";
    case "waiting_me":
      return d.waitingOnMe;
    case "waiting_others":
      return d.status === "sent" && !d.waitingOnMe;
    case "completed":
      return d.status === "completed";
    case "declined":
      return d.status === "declined" || d.status === "voided";
    case "expired":
      return d.status === "expired";
  }
}

export function viewCounts(rows: DocRow[]): Record<View, number> {
  return Object.fromEntries(VIEWS.map((v) => [v, rows.filter((d) => inView(d, v)).length])) as Record<View, number>;
}

export async function listContacts(orgId: string) {
  return db
    .select({
      email: t.recipients.email,
      name: sql<string>`(array_agg(${t.recipients.name} order by ${t.recipients.createdAt} desc))[1]`,
      documents: sql<number>`count(distinct ${t.recipients.documentId})::int`,
      signed: sql<number>`count(*) filter (where ${t.recipients.status} = 'signed')::int`,
      pending: sql<number>`count(*) filter (where ${t.recipients.status} in ('sent','opened') and ${t.documents.status} = 'sent')::int`,
      lastAt: sql<Date>`max(${t.recipients.createdAt})`,
    })
    .from(t.recipients)
    .innerJoin(t.documents, eq(t.recipients.documentId, t.documents.id))
    .where(and(eq(t.documents.orgId, orgId), sql`${t.recipients.email} <> ''`))
    .groupBy(t.recipients.email)
    .orderBy(sql`max(${t.recipients.createdAt}) desc`)
    .limit(1000);
}

/** Plain JSON for client components. */
export function serializeRows(rows: DocRow[]) {
  const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
  return rows.map((r) => ({
    ...r,
    createdAt: iso(r.createdAt)!,
    sentAt: iso(r.sentAt),
    completedAt: iso(r.completedAt),
    expiresAt: iso(r.expiresAt),
    lastActivityAt: iso(r.lastActivityAt)!,
  }));
}
