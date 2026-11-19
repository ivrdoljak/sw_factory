import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "./schema";

// The database types a domain module takes as its first parameter. Types only,
// so client code may import modules that use them (unlike ~/db, which opens
// the connection).

/** The app's database. */
export type Db = BetterSQLite3Database<typeof schema>;

/** A transaction on it, as handed to `db.transaction`'s callback. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Anything a query can run on: the database, or a transaction on it. */
export type Queryable = Db | Tx;
