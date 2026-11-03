import { q, type Queryable } from "./db";
import { todayISO } from "./format";
import { lobLabel } from "./ref";
import { createActivity } from "./work";

/** One "Notify carrier" task per other policy ticked on a new claim (UX-017), from the client's own policies. The main policy already has its task. */
export async function notifyOtherPolicies(claim: { id: number; number: string; clientId: number; policyId: number | null }, policyIds: number[], ownerId: number, user: { id: number; username: string }, c: Queryable): Promise<number> {
  const others = await q<{ id: number; policy_number: string; lob: string; carrier: string }>(
    "SELECT p.id, p.policy_number, p.lob, ca.name AS carrier FROM policies p JOIN carriers ca ON ca.id = p.carrier_id WHERE p.id = ANY($1::int[]) AND p.client_id = $2 AND p.id IS DISTINCT FROM $3 ORDER BY p.id",
    [policyIds.filter(Boolean), claim.clientId, claim.policyId], c);
  for (const p of others) {
    await createActivity({ code: "CLAIM-FU", subject: `Notify carrier: ${p.carrier} · ${p.policy_number} (${lobLabel(p.lob)}) of claim ${claim.number}`, priority: "high", ownerId, createdById: user.id, clientId: claim.clientId, policyId: p.id, claimId: claim.id,
      dueDate: todayISO(), source: "manual", actor: user.username }, c);
  }
  return others.length;
}
