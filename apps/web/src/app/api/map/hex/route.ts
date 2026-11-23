import { tripHexes } from "@/server/map";
import { respond } from "@/server/respond";
import { currentPerson } from "@/server/session";

export const GET = async (request: Request) => {
  const q = new URL(request.url).searchParams;
  const operators = (q.get("operators") ?? "").split(",").filter((slug) => /^[a-z0-9-]{1,40}$/.test(slug));
  const type = q.get("type");
  return respond(async () =>
    tripHexes(await currentPerson(), {
      end: q.get("kind") === "destinations" ? "destinations" : "origins",
      days: Number(q.get("days")) || 7,
      operators: operators.length > 0 ? operators : null,
      type: type === "scooter" || type === "bicycle" ? type : null,
    }),
  );
};
