import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

export const pool = new Pool({ connectionString });

export async function query(text, params) {
  return pool.query(text, params);
}
