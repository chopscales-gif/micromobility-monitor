import { describe, expect, it } from "vitest";
import { ACTIONS, actionsFor, caseWeek, deadline, dueDate, dueState, ladderStep, restingStatus, workingDaysAfter } from "./cases";
import { startOfLocalDay } from "./city";

const noon = (date: string) => startOfLocalDay(date) + 12 * 3_600_000;

describe("case weeks", () => {
  it("puts a finding in the week, Monday to Sunday, its period began in", () => {
    expect(caseWeek(noon("2026-11-16"))).toBe("2026-11-16");
    expect(caseWeek(noon("2026-11-22"))).toBe("2026-11-16");
    expect(caseWeek(noon("2026-11-23"))).toBe("2026-11-23");
  });
  it("uses the city's calendar, not UTC", () => {
    // 11 pm on Sunday in Salt Lake City is already Monday in UTC.
    expect(caseWeek(startOfLocalDay("2026-11-22") + 23 * 3_600_000)).toBe("2026-11-16");
  });
});

describe("deadlines", () => {
  it("counts working days and skips the weekend", () => {
    expect(workingDaysAfter(noon("2026-11-16"), 5)).toBe("2026-11-23"); // Monday to the next Monday
    expect(workingDaysAfter(noon("2026-11-19"), 5)).toBe("2026-11-26"); // Thursday to the next Thursday
    expect(workingDaysAfter(noon("2026-11-21"), 1)).toBe("2026-11-23"); // Saturday to Monday
  });
  it("falls at the end of the due day", () => {
    const due = deadline(noon("2026-11-16"), 5);
    expect(dueDate(due)).toBe("2026-11-23");
    expect(due).toBe(startOfLocalDay("2026-11-24"));
  });
  it("is near two days out and overdue once the day is over", () => {
    const due = deadline(noon("2026-11-16"), 5);
    expect(dueState(due, noon("2026-11-18"))).toBe("ahead");
    expect(dueState(due, noon("2026-11-22"))).toBe("soon");
    expect(dueState(due, noon("2026-11-23"))).toBe("soon");
    expect(dueState(due, due)).toBe("overdue");
    expect(dueState(null, due)).toBe("none");
  });
});

describe("the escalation ladder", () => {
  it("starts with a warning and rises with each earlier notice", () => {
    expect(ladderStep(0)).toMatchObject({ step: 1, key: "warning", fineCents: 0 });
    expect(ladderStep(1)).toMatchObject({ step: 2, fineCents: 25_000 });
    expect(ladderStep(2)).toMatchObject({ step: 3, fineCents: 50_000 });
    expect(ladderStep(3)).toMatchObject({ step: 4, key: "review" });
  });
  it("stays on the last rung however many notices came before", () => {
    expect(ladderStep(9).step).toBe(4);
  });
  it("leaves only the permit review to the program manager", () => {
    expect([0, 1, 2, 3].map((n) => ladderStep(n).needsProgramManager)).toEqual([false, false, false, true]);
  });
});

describe("what can happen to a case", () => {
  it("lets only the operator reply or dispute, and only on a live notice", () => {
    expect(actionsFor("notified", "operator")).toEqual(["reply", "dispute"]);
    for (const status of ["held", "open", "disputed", "resolved"] as const) expect(actionsFor(status, "operator")).toEqual([]);
  });
  it("gives the city a decision to make on a dispute, and nothing else", () => {
    expect(actionsFor("disputed", "staff")).toEqual(["uphold", "withdraw"]);
  });
  it("cannot resolve a case as corrected before a notice", () => {
    expect(actionsFor("open", "staff")).toEqual(["notice", "close"]);
    expect(ACTIONS.close.outcome).toBe("closed");
    expect(ACTIONS.resolve.outcome).toBe("corrected");
  });
  it("needs a note for every step, so the record explains itself", () => {
    expect(Object.values(ACTIONS).every((a) => a.needsNote)).toBe(true);
  });
});

describe("the held pile", () => {
  it("holds a case with nothing firm in it", () => {
    expect(restingStatus(0, 3)).toBe("held");
    expect(restingStatus(1, 3)).toBe("open");
    expect(restingStatus(0, 0)).toBe("open");
  });
});
