// Who may do what. Every data query in the application names one of these
// permissions and is refused, and recorded as refused, if the role lacks it.
// Six seats, each with the least it needs: nobody holds every permission.

export const ROLES = ["program_manager", "analyst", "finance", "admin", "read_only", "operator"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  program_manager: "Program manager",
  analyst: "Compliance analyst",
  finance: "Finance",
  admin: "IT administrator",
  read_only: "Read-only",
  operator: "Operator portal",
};

/** What each seat is for, in a sentence. Shown where people choose a seat and on the access page. */
export const ROLE_PURPOSES: Record<Role, string> = {
  program_manager: "Owns the program: sets the rules, zones and fees, and decides anything that puts a permit at risk.",
  analyst: "Works the cases: checks the evidence, records notices, reads operators' replies and decides disputes.",
  finance: "Checks each month's invoice against the operator's own report and signs it off.",
  admin: "Keeps the system running: feeds, seats and the audit log. Sees no cases and no money.",
  read_only: "Looks, and nothing else. For a council office or a colleague in another department.",
  operator: "One operator's own view: its notices, its feeds and its invoices. Never another operator's.",
};

export const PERMISSIONS = [
  "map.view",
  "violations.view",
  "violations.change",
  "violations.escalate",
  "violations.reply",
  "zones.view",
  "zones.change",
  "rules.view",
  "rules.change",
  "health.view",
  "fees.view",
  "fees.change",
  "invoices.view",
  "invoices.export",
  "invoices.generate",
  "invoices.issue",
  "reports.view",
  "reports.export",
  "audit.view",
  "access.view",
  "outbox.view",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  "map.view": "See the live map",
  "violations.view": "See cases and their evidence",
  "violations.change": "Work cases: record notices, decide disputes, close",
  "violations.escalate": "Refer a permit for suspension review",
  "violations.reply": "Answer or dispute a notice, as the operator",
  "zones.view": "See the zones",
  "zones.change": "Draw, upload and retire zones",
  "rules.view": "See the rules and the escalation ladder",
  "rules.change": "Change a rule's settings",
  "health.view": "See feed health",
  "fees.view": "See the fee schedule",
  "fees.change": "Adopt a fee schedule",
  "invoices.view": "See invoices",
  "invoices.export": "Download invoices and trip ledgers",
  "invoices.generate": "Recalculate an invoice",
  "invoices.issue": "Sign off and issue an invoice",
  "reports.view": "See the monthly report",
  "reports.export": "Download the monthly report as a PDF",
  "audit.view": "Read the audit log",
  "access.view": "See who holds which seat",
  "outbox.view": "Read every message in the outbox, not only their own",
};

const GRANTS: Record<Role, readonly Permission[]> = {
  // Sets policy and takes the decisions with consequences. Does not issue invoices: the person who sets a fee does not also bill it.
  program_manager: [
    "map.view", "violations.view", "violations.change", "violations.escalate", "zones.view", "zones.change", "rules.view", "rules.change",
    "health.view", "fees.view", "fees.change", "invoices.view", "invoices.export", "reports.view", "reports.export", "audit.view", "access.view", "outbox.view",
  ],
  analyst: ["map.view", "violations.view", "violations.change", "zones.view", "rules.view", "health.view", "fees.view", "invoices.view", "invoices.export", "reports.view", "reports.export"],
  finance: ["health.view", "fees.view", "invoices.view", "invoices.export", "invoices.generate", "invoices.issue", "reports.view", "reports.export"],
  // Runs the system without seeing what is in it: no cases, no invoices.
  admin: ["map.view", "zones.view", "rules.view", "health.view", "audit.view", "access.view", "outbox.view"],
  read_only: ["map.view", "violations.view", "zones.view", "rules.view", "health.view", "fees.view", "invoices.view", "reports.view"],
  // An operator sees its own vehicles, feeds, notices and invoices, and nobody else's.
  operator: ["map.view", "violations.view", "violations.reply", "zones.view", "rules.view", "health.view", "fees.view", "invoices.view", "invoices.export"],
};

export type Actor = {
  userId: string;
  name: string;
  role: Role;
  /** Set for operator-portal users. */
  operatorId: string | null;
};

export const can = (role: Role, permission: Permission) => GRANTS[role].includes(permission);
export const grantsOf = (role: Role): readonly Permission[] => GRANTS[role];

/**
 * The operators an actor may see data for: null means all of them.
 * An operator-portal user is always confined to its own operator, whatever it asks for.
 */
export function operatorScope(actor: Actor): string | null {
  if (actor.role !== "operator") return null;
  if (!actor.operatorId) throw new Error("Operator-portal user has no operator");
  return actor.operatorId;
}

/** Whether an actor may see data belonging to a given operator. */
export function maySeeOperator(actor: Actor, operatorId: string): boolean {
  const scope = operatorScope(actor);
  return scope === null || scope === operatorId;
}
