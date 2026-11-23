import { describe, expect, it } from "vitest";
import { healthScore, type HealthCounts } from "./health";

const perfect: HealthCounts = { polls: 1000, failedPolls: 0, slowPolls: 0, realtimePolls: 600, stalePolls: 0, records: 50_000, invalidRecords: 0, incompleteRecords: 0 };
const part = (c: HealthCounts, key: string) => healthScore(c).components.find((x) => x.key === key)!;

describe("data health score", () => {
  it("scores a faultless feed 100", () => {
    expect(healthScore(perfect)).toMatchObject({ score: 100, grade: "good" });
  });

  it("has no score before any request has been made", () => {
    const none = healthScore({ polls: 0, failedPolls: 0, slowPolls: 0, realtimePolls: 0, stalePolls: 0, records: 0, invalidRecords: 0, incompleteRecords: 0 });
    expect(none).toMatchObject({ score: null, grade: "no_data" });
  });

  it("takes uptime to zero at 95 percent, so a feed that is down one hour in twenty cannot hide", () => {
    expect(part({ ...perfect, failedPolls: 50 }, "uptime").score).toBe(0);
    expect(part({ ...perfect, failedPolls: 25 }, "uptime").score).toBe(50);
  });

  it("counts invalid and incomplete records together", () => {
    const c = { ...perfect, invalidRecords: 1500, incompleteRecords: 1000 }; // 95 percent good
    expect(part(c, "records")).toMatchObject({ rate: 0.95, score: 50 });
  });

  it("judges response time only on requests that were answered", () => {
    const c = { ...perfect, failedPolls: 500, slowPolls: 50 }; // 450 of 500 answered quickly
    expect(part(c, "latency").rate).toBe(0.9);
  });

  it("leaves freshness out, and reweights, for an operator with no live feeds polled", () => {
    const c = { ...perfect, realtimePolls: 0 };
    expect(part(c, "freshness").score).toBeNull();
    expect(healthScore(c).score).toBe(100);
  });

  it("grades a careless feed as poor", () => {
    const c = { ...perfect, failedPolls: 20, stalePolls: 30, invalidRecords: 1300, incompleteRecords: 2000 };
    const h = healthScore(c);
    expect(h.grade).toBe("poor");
    expect(h.score).toBeLessThan(70);
  });

  it("weights add to 100", () => {
    expect(healthScore(perfect).components.reduce((n, x) => n + x.weight, 0)).toBe(100);
  });
});
