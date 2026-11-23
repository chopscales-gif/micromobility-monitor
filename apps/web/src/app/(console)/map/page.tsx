import type { Metadata } from "next";
import { can } from "@mm/core/access";
import { MapLoader } from "@/components/map/MapLoader";
import { Refusal } from "@/components/Refusal";
import { currentPerson } from "@/server/session";

export const metadata: Metadata = { title: "Live map" };

export default async function LiveMapPage() {
  const person = await currentPerson();
  // The data itself is fetched, checked and logged by the map's API routes.
  if (!can(person.role, "map.view")) return <Refusal person={person} permission="map.view" />;
  return (
    <main className="relative min-h-[34rem] flex-1">
      <h1 className="sr-only">Live map</h1>
      <MapLoader viewerOperator={person.operatorName} />
    </main>
  );
}
