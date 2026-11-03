import type { Client, PoolClient } from "pg";
export function runMigrations(connection: Client | PoolClient, dir: string): Promise<string[]>;
