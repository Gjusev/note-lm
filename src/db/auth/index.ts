import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!_db) {
    _db = drizzle(process.env.AUTH_DATABASE_URL!, { schema });
  }
  return _db;
}
