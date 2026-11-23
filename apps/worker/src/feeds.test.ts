import { OPERATORS } from "@mm/simulator";
import { describe, expect, it } from "vitest";
import { feedFetcher, simulatorBase } from "./feeds";

const kestrel = OPERATORS.find((o) => o.slug === "kestrel")!;
/** Stands in for the one query feedFetcher makes: the first registered operator. */
const database = (gbfsUrl: string) => ((() => Promise.resolve([{ slug: "kestrel", gbfs_url: gbfsUrl }])) as never);

describe("the simulator's address", () => {
  it("is read back from a registered feed address", () => {
    expect(simulatorBase({ slug: "kestrel", gbfsUrl: "http://simulator:4010/kestrel/gbfs/3.0/gbfs.json" })).toBe("http://simulator:4010");
    expect(simulatorBase({ slug: "kestrel", gbfsUrl: "https://feeds.example/sim/kestrel/gbfs/3.0/gbfs.json" })).toBe("https://feeds.example/sim");
  });

  it("is not guessed from an address that is not the simulator's", () => {
    expect(simulatorBase({ slug: "kestrel", gbfsUrl: "https://api.operator.example/gbfs.json" })).toBeNull();
  });
});

describe("feeds read inside the worker", () => {
  it("answers at the addresses the seed registered, with no server listening", async () => {
    const { fetcher, inProcess } = await feedFetcher(database("http://simulator.invalid:4010/kestrel/gbfs/3.0/gbfs.json"), { SIMULATOR_INPROCESS: "1" });
    expect(inProcess).toBe("http://simulator.invalid:4010");
    const discovery = await fetcher("http://simulator.invalid:4010/kestrel/gbfs/3.0/gbfs.json", {});
    expect(discovery.status).toBe(200);
    expect(JSON.parse(discovery.body).data.feeds.length).toBeGreaterThan(0);
  });

  it("still asks for the operator's token", async () => {
    const { fetcher } = await feedFetcher(database("http://simulator.invalid:4010/kestrel/gbfs/3.0/gbfs.json"), { SIMULATOR_INPROCESS: "1" });
    const url = "http://simulator.invalid:4010/kestrel/mds/vehicles";
    expect((await fetcher(url, {})).status).toBe(401);
    expect((await fetcher(url, { authorization: `Bearer ${kestrel.token}` })).status).toBe(200);
  });

  it("is off unless asked for", async () => {
    const { inProcess } = await feedFetcher(database("http://simulator:4010/kestrel/gbfs/3.0/gbfs.json"), {});
    expect(inProcess).toBeNull();
  });
});
