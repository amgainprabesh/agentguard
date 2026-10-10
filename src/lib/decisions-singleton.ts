import { DecisionService } from "./decisions.ts";
import { Ledger } from "./ledger.ts";
import { MandateStore } from "./mandate.ts";
import { join } from "node:path";

// one shared instance so all routes see the same pending approvals and mandate
export const mandateStore = new MandateStore(join(process.cwd(), "data", "mandate.json"));

export const decisions = new DecisionService(
  new Ledger(join(process.cwd(), "data", "agentguard.db")),
  mandateStore.get(),
);
