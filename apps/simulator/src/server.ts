// Stands in for three operators' servers: serves their GBFS and MDS feeds over HTTP.

import { createServer } from "node:http";
import { handleSimRequest } from "@mm/simulator";

const port = Number(process.env.PORT ?? 4010);
const seed = process.env.SIM_SEED ?? "slc-demo";
const publicUrl = (process.env.SIMULATOR_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, "");

createServer((req, res) => {
  const url = new URL(req.url ?? "/", publicUrl);
  if (req.method !== "GET") {
    res.writeHead(405, { allow: "GET" }).end();
    return;
  }
  let response;
  try {
    response = handleSimRequest({
      path: url.pathname,
      query: url.searchParams,
      headers: { authorization: req.headers.authorization, accept: req.headers.accept },
      baseUrl: publicUrl,
      seed,
      now: Date.now(),
    });
  } catch (error) {
    console.error(error);
    res.writeHead(500).end();
    return;
  }
  setTimeout(() => {
    res.writeHead(response.status, { "content-type": response.contentType, "cache-control": "no-store" });
    res.end(response.body);
  }, response.delayMs);
}).listen(port, () => {
  console.log(`Simulated operator feeds on ${publicUrl} (seed "${seed}")`);
});
