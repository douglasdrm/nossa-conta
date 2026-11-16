import { Pool } from "pg";
import {
  restrictedProductionInboxAdapter,
  type CommittedSqlExecutor,
} from "./production-inbox-adapter";

const loginRole = "nc_production_webhook";
const executorRole = "nc_production_inbox_executor";

type InboxClient = {
  query(sql: string, parameters?: string[]): Promise<{
    command: string;
    rows: { outcome: unknown }[];
  }>;
  release(destroy?: boolean): void;
};

/** Use one leased PostgreSQL connection until the transaction is settled. */
export function committedProductionInboxExecutor(
  connect: () => Promise<InboxClient>,
): CommittedSqlExecutor {
  return async (sql, parameters) => {
    const client = await connect();
    let destroy = false;
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${executorRole}`);
      const { rows } = await client.query(sql, [...parameters]);
      const { command } = await client.query("COMMIT");
      if (command !== "COMMIT") throw new Error("Inbox transaction did not commit");
      return rows;
    } catch (error) {
      // A failed COMMIT may leave the connection or transaction outcome uncertain.
      destroy = true;
      try {
        await client.query("ROLLBACK");
      } catch {
        // Discard the connection without masking the original failure.
      }
      throw error;
    } finally {
      client.release(destroy);
    }
  };
}

type InboxConnectionOptions = {
  host: string;
  projectRef: string;
  password: string;
  ca?: string;
};

/** Server-side factory. The caller owns the pool and decides when to create it. */
export function createProductionInboxConnection({
  host, projectRef, password, ca,
}: InboxConnectionOptions) {
  if (!/^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host) ||
      !/^[a-z0-9]{20}$/.test(projectRef) || !password) {
    throw new Error("Invalid Supabase inbox connection settings");
  }

  const pool = new Pool({
    host,
    port: 5432,
    database: "postgres",
    user: `${loginRole}.${projectRef}`,
    password,
    ssl: { ca, rejectUnauthorized: true },
    max: 2,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    query_timeout: 8_000,
    allowExitOnIdle: true,
  });
  pool.on("error", () => {
    // pg removes failed idle clients. Pending deliveries handle their own errors.
  });

  return {
    persist: restrictedProductionInboxAdapter(
      committedProductionInboxExecutor(() => pool.connect()),
    ),
    close: () => pool.end(),
  };
}
