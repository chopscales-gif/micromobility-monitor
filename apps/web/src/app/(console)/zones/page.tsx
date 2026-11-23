import type { Metadata } from "next";
import { can } from "@mm/core/access";
import { ZONE_EFFECTS, ZONE_LABELS, ZONE_TYPES } from "@mm/core/zones";
import { ZoneEditorLoader } from "@/components/map/ZoneEditorLoader";
import { PageHead } from "@/components/PageHead";
import { Refusal } from "@/components/Refusal";
import { count, dateOnly } from "@/lib/format";
import { ZONE_STYLES } from "@/lib/meaning";
import { attempt } from "@/server/attempt";
import { Refused } from "@/server/guard";
import { currentPerson } from "@/server/session";
import { zoneList, type Zone } from "@/server/zones";
import { adopt, retire } from "./actions";

export const metadata: Metadata = { title: "Zones" };

type Props = { searchParams: Promise<{ adopted?: string; retired?: string; problem?: string; refused?: string }> };

const SOURCES: Record<Zone["source"], string> = { seed: "In the permit rules", drawn: "Drawn on the map", upload: "Uploaded as GeoJSON" };

const area = (km2: number) => (km2 >= 0.1 ? `${km2.toFixed(km2 >= 10 ? 0 : 2)} km²` : `${count(Math.round((km2 * 1e6) / 100) * 100)} m²`);

export default async function ZonesPage({ searchParams }: Props) {
  const [person, flash] = await Promise.all([currentPerson(), searchParams]);
  const zones = await attempt(() => zoneList(person));
  if (zones instanceof Refused) return <Refusal person={person} permission={zones.permission} />;
  const mayChange = can(person.role, "zones.change");
  const inForce = zones.filter((z) => z.retiredAt === null);
  const retired = zones.filter((z) => z.retiredAt !== null);

  const features: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: inForce.map((z) => ({ type: "Feature", geometry: z.shape, properties: { name: z.name, type: z.type } })),
  };

  return (
    <main className="mx-auto w-full max-w-[84rem] space-y-8 px-4 py-8 lg:px-8 lg:py-11">
      <PageHead title="Policy zones">
        The places where the city&rsquo;s rules change: where vehicles may operate, where they may not be ridden or left, where they must slow down, and where the equity minimum is counted.{" "}
        {mayChange ? "Draw a new zone on the map or upload one as GeoJSON." : "Only the program manager can add or retire zones."}
      </PageHead>

      {flash.adopted && (
        <p className="flash text-good">
          <span>“{flash.adopted}” adopted. It is in force from now.</span>
        </p>
      )}
      {flash.retired && (
        <p className="flash text-good">
          <span>Zone retired. Findings already made against it stay on record.</span>
        </p>
      )}
      {flash.problem && (
        <p className="flash text-poor">
          <span>{flash.problem}</span>
        </p>
      )}
      {flash.refused && (
        <p className="flash text-poor">
          <span>This seat may not change the zones. The attempt has been recorded in the audit log.</span>
        </p>
      )}

      <ZoneEditorLoader zones={features} canEdit={mayChange} adopt={adopt} />

      {ZONE_TYPES.map((type) => {
        const group = inForce.filter((z) => z.type === type);
        const color = ZONE_STYLES[type]?.color ?? "var(--color-dim)";
        return (
          <section key={type} className="panel px-6 pb-3 pt-5" aria-labelledby={`zones-${type}`}>
            <h2 id={`zones-${type}`} className="heading">
              <span className="inline-flex items-center gap-2">
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} />
                {ZONE_LABELS[type]}
              </span>
              <small>{group.length === 0 ? "none adopted" : `${group.length} in force`}</small>
            </h2>
            <p className="border-b border-line py-2.5 text-[0.8125rem] text-dim">{ZONE_EFFECTS[type]}</p>
            {group.length === 0 ? (
              <p className="py-3 text-dim">None adopted.</p>
            ) : (
              <ul>
                {group.map((z) => (
                  <li key={z.id} className="border-b border-line py-3 last:border-b-0">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-[minmax(0,1fr)_7rem_7rem_8.5rem_11rem]">
                      <div className="min-w-0 max-md:col-span-2">
                        <h3 className="font-medium">{z.name}</h3>
                        {z.createdBy && <p className="text-[0.8125rem] text-faint">Adopted by {z.createdBy}</p>}
                      </div>
                      <dl className="contents">
                        <div>
                          <dt className="label">Area</dt>
                          <dd className="font-semibold">{area(z.areaKm2)}</dd>
                        </div>
                        {z.speedLimitKph !== null && (
                          <div>
                            <dt className="label">Speed limit</dt>
                            <dd className="font-semibold">{z.speedLimitKph} km/h</dd>
                          </div>
                        )}
                        <div>
                          <dt className="label">In force since</dt>
                          <dd className="font-semibold">{dateOnly(z.effectiveFrom)}</dd>
                        </div>
                        <div>
                          <dt className="label">Source</dt>
                          <dd className="font-semibold">{SOURCES[z.source]}</dd>
                        </div>
                      </dl>
                    </div>
                    {mayChange && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[0.8125rem] text-dim hover:text-text">Retire this zone</summary>
                        <form action={retire} className="mt-2 max-w-xl space-y-3">
                          <input type="hidden" name="id" value={z.id} />
                          <p className="text-[0.8125rem] text-dim">It stops applying from now. Its shape and the findings made against it stay on record. This cannot be undone here; adopt the zone again if it is needed.</p>
                          <button type="submit" className="btn text-poor">
                            Retire “{z.name}”
                          </button>
                        </form>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {retired.length > 0 && (
        <section className="panel px-6 pb-3 pt-5">
          <h2 className="heading">Retired zones</h2>
          <p className="mt-2.5 text-[0.8125rem] text-dim">No longer applied. Kept because earlier findings were judged against them.</p>
          <div className="mt-1 overflow-x-auto">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Zone</th>
                  <th>Kind</th>
                  <th>In force</th>
                  <th>Adopted by</th>
                </tr>
              </thead>
              <tbody>
                {retired.map((z) => (
                  <tr key={z.id}>
                    <td className="font-medium">{z.name}</td>
                    <td>
                      <span className="inline-flex items-center gap-2 whitespace-nowrap">
                        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: ZONE_STYLES[z.type]?.color ?? "var(--color-dim)" }} />
                        {ZONE_LABELS[z.type]}
                      </span>
                    </td>
                    <td className="whitespace-nowrap">
                      {dateOnly(z.effectiveFrom)} to {dateOnly(z.retiredAt!)}
                    </td>
                    <td>{z.createdBy ?? "not recorded"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
