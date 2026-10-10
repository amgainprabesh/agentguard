import { Escrow } from "./escrow.ts";
import { Ledger } from "./ledger.ts";
import { join } from "node:path";

// one shared instance so all API routes see the same deals
// shortcut: in-memory map dies on restart; upgrade to DB-backed deals when Sprint 2 needs restart survival
export const escrow = new Escrow(new Ledger(join(process.cwd(), "data", "agentguard.db")));
