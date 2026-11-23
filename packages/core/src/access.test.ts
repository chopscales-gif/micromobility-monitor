import { describe, expect, it } from "vitest";
import { can, maySeeOperator, operatorScope, PERMISSIONS, ROLES, type Actor } from "./access";

const actor = (role: Actor["role"], operatorId: string | null = null): Actor => ({ userId: "u", name: "Test", role, operatorId });

describe("roles", () => {
  it("only the program manager sets policy: rules, zones and fees", () => {
    for (const role of ROLES) {
      for (const p of ["rules.change", "zones.change", "fees.change", "violations.escalate"] as const) expect(can(role, p)).toBe(role === "program_manager");
    }
  });

  it("nobody holds every permission", () => {
    for (const role of ROLES) expect(PERMISSIONS.every((p) => can(role, p))).toBe(false);
  });

  it("the person who sets the fee does not issue the invoice", () => {
    expect(can("program_manager", "fees.change")).toBe(true);
    expect(can("program_manager", "invoices.issue")).toBe(false);
    expect(can("finance", "invoices.issue")).toBe(true);
    expect(can("finance", "fees.change")).toBe(false);
    for (const role of ROLES) expect(can(role, "invoices.issue")).toBe(role === "finance");
  });

  it("the IT administrator runs the system without seeing cases or money", () => {
    for (const p of ["violations.view", "invoices.view", "fees.view"] as const) expect(can("admin", p)).toBe(false);
    for (const p of ["audit.view", "access.view", "health.view"] as const) expect(can("admin", p)).toBe(true);
  });

  it("finance sees the money and not the cases", () => {
    expect(can("finance", "violations.view")).toBe(false);
    expect(can("finance", "map.view")).toBe(false);
  });

  it("only an operator may answer a notice, and only staff may work a case", () => {
    for (const role of ROLES) {
      expect(can(role, "violations.reply")).toBe(role === "operator");
      expect(can(role, "violations.change")).toBe(role === "analyst" || role === "program_manager");
    }
  });

  it("every permission is held by somebody", () => {
    for (const p of PERMISSIONS) expect(ROLES.some((role) => can(role, p))).toBe(true);
  });

  it("a read-only user can look but not export or generate", () => {
    expect(can("read_only", "invoices.view")).toBe(true);
    expect(can("read_only", "invoices.export")).toBe(false);
    expect(can("read_only", "invoices.generate")).toBe(false);
    expect(can("read_only", "reports.view")).toBe(true);
    expect(can("read_only", "reports.export")).toBe(false);
  });

  it("the monthly report goes to the people who run the program, not to IT or an operator", () => {
    for (const role of ROLES) expect(can(role, "reports.export")).toBe(role === "program_manager" || role === "analyst" || role === "finance");
    expect(can("admin", "reports.view")).toBe(false);
    expect(can("operator", "reports.view")).toBe(false);
  });

  it("an operator is confined to its own data", () => {
    const kestrel = actor("operator", "op-kestrel");
    expect(operatorScope(kestrel)).toBe("op-kestrel");
    expect(maySeeOperator(kestrel, "op-kestrel")).toBe(true);
    expect(maySeeOperator(kestrel, "op-pronghorn")).toBe(false);
  });

  it("city staff see every operator", () => {
    expect(operatorScope(actor("analyst"))).toBeNull();
    expect(maySeeOperator(actor("read_only"), "op-pronghorn")).toBe(true);
  });

  it("refuses an operator user that is tied to no operator, rather than showing it everything", () => {
    expect(() => operatorScope(actor("operator", null))).toThrow();
  });
});
