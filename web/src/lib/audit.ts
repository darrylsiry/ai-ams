import { db, type Queryable } from "./db";
import { maskPii } from "./redact";

export type AuditEvent = {
  actor: string;
  action: string;          // e.g. client.created, policy.endorsed, activity.completed
  entityType: string;      // client | policy | activity | certificate | claim | email | invoice | receipt | user | ...
  entityId: string | number;
  summary: string;
  before?: unknown;
  after?: unknown;
  correlationId?: string;
  occurredAt?: Date;       // seeded history only
};

/** Append audit rows; pass a client to write inside its transaction. */
export async function audit(events: AuditEvent | AuditEvent[], on: Queryable = db): Promise<void> {
  const list = Array.isArray(events) ? events : [events];
  const correlationId = list[0]?.correlationId ?? crypto.randomUUID();
  for (const e of list) {
    await on.query(
      `INSERT INTO audit_events (actor, action, entity_type, entity_id, summary, before, after, correlation_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9, now()))`,
      [e.actor, e.action, e.entityType, String(e.entityId), e.summary,
        e.before === undefined ? null : JSON.stringify(maskPii(e.before)), e.after === undefined ? null : JSON.stringify(maskPii(e.after)),
        e.correlationId ?? correlationId, e.occurredAt ?? null]);
  }
}
