import type { Metadata } from "next";
import { CITY_NAME } from "@mm/core/city";
import { K_ANONYMITY_MIN, PUBLIC_COORD_DECIMALS, routeRetentionDays } from "@mm/core/privacy";
import { Columns } from "@/components/charts";
import { Operator } from "@/components/Mark";
import { PublicHexMapLoader } from "@/components/map/PublicHexMapLoader";
import { Choice, PageHead } from "@/components/PageHead";
import { count, dateTime, percent, plainDay, plainShort } from "@/lib/format";
import { FILES } from "@/lib/open-data";
import { hourLabel, hourSpan, knownType, rate, typeColumn } from "@/lib/report";
import { openData, publicMonths } from "@/server/open-data";

export const metadata: Metadata = { title: "Open data" };

const ROUTE_RETENTION_DAYS = routeRetentionDays(process.env.ROUTE_RETENTION_DAYS);
const WITHHELD = <span className="text-faint">withheld</span>;

function Sheet({ title, note, children, id }: { title: string; note?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="panel min-w-0 scroll-mt-4 px-5 pb-3 pt-4">
      <h2 className="heading">
        {title}
        {note && <small>{note}</small>}
      </h2>
      {children}
    </section>
  );
}

export default async function OpenDataPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const [months, search] = await Promise.all([publicMonths(), searchParams]);
  const chosen = months.find((m) => m.period === search.month) ?? months[0];
  const data = chosen ? await openData(chosen.period) : null;

  if (!data) {
    return (
      <main className="mx-auto w-full max-w-[72rem] space-y-6 px-4 py-8 lg:px-8">
        <PageHead title="Shared scooters and bikes">Figures are published here once a month has finished. No month has finished yet.</PageHead>
      </main>
    );
  }

  const ranked = data.daily.filter((d) => d.trips !== null).sort((a, b) => b.trips! - a.trips!);
  const hourMax = Math.max(...data.hours.map((h) => Math.max((h.weekday ?? 0) / data.weekdays, (h.weekend ?? 0) / data.weekendDays)));
  const peak = (key: "weekday" | "weekend") => data.hours.reduce((best, h) => ((h[key] ?? 0) > (best[key] ?? 0) ? h : best), data.hours[0]!);
  const hoursWithheld = data.hours.filter((h) => h.weekday === null || h.weekend === null).length;
  const figures: [label: string, value: string, note: string][] = [
    ["Rides", count(data.trips), `about ${count(Math.round(data.trips / data.daily.length))} a day`],
    ["Rides per vehicle per day", rate(data.perVehicleDay), `across ${count(data.vehicles)} scooters and bikes`],
    ["Typical ride", `${data.medianDistanceKm.toFixed(1)} km`, `and ${data.medianDurationMin} minutes; half were shorter`],
    ["Rides touching an equity zone", data.equityShare === null ? "Withheld" : percent(data.equityShare, 0), data.equityShare === null ? `one side of the split is fewer than ${K_ANONYMITY_MIN} rides` : "started, ended or passed through one"],
  ];

  const hours = (key: "weekday" | "weekend", name: string, days: number) => (
    <div>
      <p className="pb-1">
        <span className="font-semibold">{name}</span> <span className="text-[0.8125rem] text-dim">busiest {hourSpan(peak(key).hour)}</span>
      </p>
      <Columns
        height={84}
        scale={hourMax}
        ariaLabel={`Average rides started in each hour on ${name.toLowerCase()}. The counts are in the download below.`}
        columns={data.hours.map((h) => ({
          key: String(h.hour),
          title: h[key] === null ? `${hourSpan(h.hour)}: withheld, fewer than ${K_ANONYMITY_MIN} rides in the month` : `${hourSpan(h.hour)}: about ${count(Math.round(h[key]! / days))} rides a day`,
          tick: h.hour % 6 === 0 ? hourLabel(h.hour) : undefined,
          segments: [{ key: "n", value: (h[key] ?? 0) / days, color: "var(--color-control)" }],
        }))}
      />
    </div>
  );

  return (
    <main className="mx-auto w-full max-w-[72rem] space-y-6 px-4 py-8 lg:px-8">
      <PageHead
        above={`Open data · ${CITY_NAME}, simulated`}
        title={`Shared scooters and bikes, ${data.label}`}
        aside={months.length > 1 ? <Choice current={data.period} options={[...months].reverse().map((m) => ({ key: m.period, href: `/open-data?month=${m.period}`, label: m.label }))} /> : undefined}
      >
        How much the shared scooters and bikes were used, by day, by hour and by part of the city. These are counts only. <a href="#privacy" className="link">No single ride is published</a>, and anyone may open this page
        without signing in.
      </PageHead>

      <dl className="panel grid divide-line overflow-hidden max-sm:divide-y sm:grid-cols-2 lg:grid-cols-4 lg:divide-x">
        {figures.map(([label, value, note]) => (
          <div key={label} className="px-5 py-4">
            <dt className="label">{label}</dt>
            <dd className="figure mt-1 text-[1.75rem]">{value}</dd>
            <dd className="mt-1 text-[0.8125rem] text-dim">{note}</dd>
          </div>
        ))}
      </dl>

      <Sheet
        title="Rides per day"
        note={ranked.length > 1 ? `busiest ${plainDay(ranked[0]!.date)} with ${count(ranked[0]!.trips!)}, quietest ${plainDay(ranked.at(-1)!.date)} with ${count(ranked.at(-1)!.trips!)}` : undefined}
      >
        <div className="pt-4">
          <Columns
            ariaLabel={`Rides per day in ${data.label}. The counts are in the download below.`}
            columns={data.daily.map((d, i) => ({
              key: d.date,
              title: d.trips === null ? `${plainDay(d.date)}: withheld` : `${plainDay(d.date)}: ${count(d.trips)} rides`,
              tick: i % 7 === 0 ? plainShort(d.date) : undefined,
              segments: [{ key: "n", value: d.trips ?? 0, color: "var(--color-control)" }],
            }))}
          />
        </div>
      </Sheet>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Sheet title="By operator" note="rides in the month, three fictional companies">
          <div className="overflow-x-auto">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Operator</th>
                  {data.types.map((t) => (
                    <th key={t} className="r">
                      {typeColumn(t)}
                    </th>
                  ))}
                  <th className="r">All</th>
                  <th className="r">Vehicles</th>
                </tr>
              </thead>
              <tbody>
                {data.operators.map((o) => (
                  <tr key={o.slug}>
                    <td>
                      <Operator slug={o.slug} name={o.name} />
                    </td>
                    {o.byType.map((n, i) => (
                      <td key={data.types[i]} className="r">
                        {n === null ? WITHHELD : count(n)}
                      </td>
                    ))}
                    <td className="r font-semibold">{count(o.trips)}</td>
                    <td className="r">{o.vehicles === null ? WITHHELD : count(o.vehicles)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.operatorsWithheld > 0 && (
            <p className="pt-2 text-[0.8125rem] text-faint">
              {data.operatorsWithheld === 1 ? "One operator is" : `${data.operatorsWithheld} operators are`} left out: too few rides to publish, or too few to keep another's from being worked out.
            </p>
          )}
          {data.types.some((t) => !knownType(t)) && <p className="pt-2 text-[0.8125rem] text-faint">Other: rides on vehicles the operator had not listed with the city.</p>}
        </Sheet>

        <Sheet title="When people ride" note="rides started in each hour, on an average day">
          <div className="space-y-3 pt-4">
            {hours("weekday", "Weekdays", data.weekdays)}
            {hours("weekend", "Weekends", data.weekendDays)}
          </div>
          {hoursWithheld > 0 && (
            <p className="pt-1 text-[0.8125rem] text-faint">
              {hoursWithheld === 1 ? "One hour is" : `${hoursWithheld} hours are`} left blank: too few rides in the whole month to publish.
            </p>
          )}
        </Sheet>
      </div>

      <Sheet title="Where rides began and ended" note="each hexagon is about 900 metres across">
        <PublicHexMapLoader starts={data.starts.cells} ends={data.ends.cells} />
        <p className="pt-3 text-[0.8125rem] text-dim">
          {count(data.starts.cells.length)} areas are shown for where rides began and {count(data.ends.cells.length)} for where they ended. Areas with fewer than {K_ANONYMITY_MIN} rides in the month are left off the map:{" "}
          {count(data.starts.withheldCells)} for starts ({count(data.starts.withheldTrips)} rides) and {count(data.ends.withheldCells)} for ends ({count(data.ends.withheldTrips)} rides).
        </p>
      </Sheet>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Sheet id="privacy" title="How riders are protected">
          <ul>
            {[
              ["No ride is published.", "Where and when one person rode is never on this page or in its files. Only counts of many rides are."],
              [`Small counts are withheld.`, `Any count of fewer than ${K_ANONYMITY_MIN} rides is left out. Where a total would let you work a missing count out by subtraction, the next smallest is left out too. So parts may not add up to the total.`],
              ["Places are coarse.", `Rides are gathered into hexagons about 900 metres across, and each is named by a centre rounded to ${PUBLIC_COORD_DECIMALS} decimal places, about 100 metres.`],
              ["Lengths are summarised.", "Distance and time are given as one typical value for the whole month, rounded to a tenth of a kilometre and a whole minute."],
              ["Routes are deleted.", `The city keeps the path of a ride for ${ROUTE_RETENTION_DAYS} days to check it against the rules, then deletes it. What remains is the hexagon it began in, the hexagon it ended in, and how long and how far it went.`],
              ["Only finished months appear.", "A month is published after it closes, never while it is running."],
            ].map(([lead, rest]) => (
              <li key={lead} className="row last:border-b-0">
                <span>
                  <span className="font-semibold">{lead}</span> <span className="text-dim">{rest}</span>
                </span>
              </li>
            ))}
          </ul>
        </Sheet>

        <Sheet title="Download" note={data.label}>
          <ul>
            {FILES.map((f) => (
              <li key={f.file} className="row grid-cols-[minmax(0,1fr)_auto] last:border-b-0">
                <a className="link font-medium" href={`/open-data/${data.period}/${f.file}`}>
                  {f.label}
                </a>
                <span className="text-[0.8125rem] text-faint">{f.format}</span>
              </li>
            ))}
          </ul>
          <p className="pt-2 text-[0.8125rem] text-faint">Every file holds the same published counts as this page and says at the top that it is a demonstration. Worked out {dateTime(data.generatedAt)} Mountain Time.</p>
        </Sheet>
      </div>
    </main>
  );
}
