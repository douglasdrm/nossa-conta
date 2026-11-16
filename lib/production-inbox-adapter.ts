import type { DurableEvent, InboxCommit, InboxPersistResult } from "./production-durable-delivery";

/**
 * SQL boundary ONLY for a future server-side database owner connection.
 *
 * Supabase authenticated/anon/service_role do NOT have permission to invoke
 * the private function. This module does not open a DB connection, create a
 * credential, grant a role, or expose any HTTP route.
 *
 * The executor MUST run the parameterized SQL against the database owner role
 * and resolve only after the statement's transaction COMMIT. Never substitute
 * a client-side Supabase session or a write-behind/uncommitted executor.
 */
export type CommittedSqlExecutor = (
  sql: string,
  parameters: readonly [string, string, string],
) => Promise<readonly { outcome: unknown }[]>;

const enqueueSql = `select nossa_conta_private.enqueue_production_event_internal(
  $1::text,$2::text,$3::text
) as outcome`;

const outcomes: readonly InboxPersistResult[] = [
  "queued", "duplicate", "event_id_conflict",
  "production_inbox_disabled", "invalid",
] as const;

/**
 * The SQL RPC checks the disabled control and verifies duplicates atomically.
 * An unexpected result, missing row or database error propagates and is
 * translated to 503 by prepareDurableProductionDelivery.
 *
 * Never treat an arbitrary SQL output as a successful durable commit.
 */
export function productionInboxAdapter(executeCommitted: CommittedSqlExecutor): InboxCommit {
  return async (event: DurableEvent): Promise<InboxPersistResult> => {
    const rows = await executeCommitted(enqueueSql, [
      event.id, event.type, event.paymentId,
    ]);
    if (rows.length !== 1 || !outcomes.includes(rows[0]?.outcome as InboxPersistResult))
      throw new Error("Unexpected production inbox result");
    return rows[0].outcome as InboxPersistResult;
  };
}
