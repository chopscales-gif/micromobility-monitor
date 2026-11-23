import { playback } from "@/server/map";
import { respond } from "@/server/respond";
import { currentPerson } from "@/server/session";

export const GET = async () => respond(async () => playback(await currentPerson()));
