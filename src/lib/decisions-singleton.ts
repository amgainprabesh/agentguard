import { DecisionService } from "./decisions.ts";
import { Ledger } from "./ledger.ts";
import { MandateStore } from "./mandate.ts";
import { join } from "node:path";

// one shared instance so all routes see the same pending approvals and mandate
//
// Data location: `npm run dev` / `npm start` always set the cwd to the project
// root, so `process.cwd()/data` is right for the normal path. The
// AGENTGUARD_DATA_DIR override exists for non-npm launches (`next start` run by
// hand from elsewhere) — without it a different cwd would silently fork a
// SECOND, empty audit ledger instead of the real one.
const dataDir = process.env.AGENTGUARD_DATA_DIR ?? join(process.cwd(), "data");

// Lazy singletons: `next build` imports every route module while collecting page
// data. Eager init would open the SQLite ledger at BUILD time — a transient file
// lock (OneDrive) then fails the whole build with "Failed to collect page data".
// Only a handler call may touch the disk.
let mandateStore: MandateStore | undefined;
let service: DecisionService | undefined;

export function getMandateStore(): MandateStore {
  mandateStore ??= new MandateStore(join(dataDir, "mandate.json"));
  return mandateStore;
}

export function getDecisions(): DecisionService {
  service ??= new DecisionService(new Ledger(join(dataDir, "agentguard.db")), getMandateStore().get());
  return service;
}
