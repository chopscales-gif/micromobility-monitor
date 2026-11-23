import Link from "next/link";
import { ROLE_LABELS, type Permission } from "@mm/core/access";
import type { Person } from "@/server/session";

const WHAT: Record<Permission, string> = {
  "map.view": "see the live map",
  "violations.view": "see compliance cases",
  "violations.change": "act on a case",
  "violations.escalate": "send a permit-review notice",
  "violations.reply": "reply to a notice on an operator's behalf",
  "zones.view": "see the policy zones",
  "zones.change": "change the policy zones",
  "rules.view": "see the rules",
  "rules.change": "change the rules",
  "health.view": "see operators' data health",
  "fees.view": "see the fee schedule",
  "fees.change": "change the fee schedule",
  "invoices.view": "see invoices",
  "invoices.export": "export invoices",
  "invoices.generate": "recalculate invoices",
  "invoices.issue": "sign off and issue invoices",
  "reports.view": "see the monthly report",
  "reports.export": "download the monthly report",
  "access.view": "see who holds which seat",
  "outbox.view": "read everyone's outgoing mail",
  "audit.view": "read the audit log",
};

/** Shown in place of a page the signed-in person may not see. The attempt has already been written to the audit log. */
export function Refusal({ person, permission }: { person: Person; permission: Permission }) {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-16">
      <div className="panel p-7">
        <p className="status text-poor">Access refused</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          {person.name} may not {WHAT[permission]}.
        </h1>
        <p className="mt-3 leading-relaxed text-dim">
          This is the <strong className="text-text">{ROLE_LABELS[person.role]}</strong> seat
          {person.operatorName ? ` for ${person.operatorName}, and can only see that operator's own data` : ""}. The attempt has been recorded in the audit log, where the
          program manager and the IT administrator can see it.
        </p>
        <p className="mt-5">
          <Link href="/" className="btn">
            Back to home
          </Link>
        </p>
        <p className="mt-5 border-t border-line pt-4 text-[0.8125rem] text-faint">Demonstration: use the seat picker at the top of the page to sit in another seat and see what it allows.</p>
      </div>
    </main>
  );
}
