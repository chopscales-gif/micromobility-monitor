// Takes the README screenshots, or a full set of every screen for a design check, by driving a
// headless Chrome over its debugging protocol. No dependencies: Node 22 and an installed Chrome.
//
//   node scripts/screenshots.mjs                      README set, into docs/screenshots
//   node scripts/screenshots.mjs --audit <folder>     every screen, each seat, both widths and themes
//   ... --only <text>                                 just the shots whose file name contains the text
//
// BASE_URL (default http://localhost:3000) is the running console. CHROME overrides the browser path.

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9300 + Math.floor(Math.random() * 500);
const auditAt = process.argv.indexOf("--audit");
const AUDIT = auditAt > 0 ? resolve(process.argv[auditAt + 1] ?? "audit") : null;
const OUT = AUDIT ?? resolve(import.meta.dirname, "../docs/screenshots");

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

/** The README set. `seat` is matched against the seat picker's labels; null is the public page. */
const README = [
  { file: "open-data", seat: null, url: "/open-data" },
  { file: "open-data-map", seat: null, url: "/open-data", scrollTo: "Where rides began and ended", settle: 4000 },
  { file: "operator-compliance", seat: "Kestrel Mobility", url: "/compliance" },
  { file: "operator-home-phone", seat: "Kestrel Mobility", url: "/", ...PHONE },
  { file: "home", seat: "Program manager", url: "/" },
  { file: "map", seat: "Compliance analyst", url: "/map", settle: 5000 },
  { file: "zones", seat: "Program manager", url: "/zones", settle: 4000 },
  { file: "cases", seat: "Compliance analyst", url: "/cases" },
  { file: "case", seat: "Compliance analyst", url: "/cases/43" },
  { file: "invoice", seat: "Finance", url: "/invoices/MM-2026-10-PRO" },
  { file: "health", seat: "Program manager", url: "/health" },
  { file: "report", seat: "Program manager", url: "/reports" },
  { file: "audit", seat: "Program manager", url: "/audit" },
  { file: "home-dark", seat: "Program manager", url: "/", theme: "dark" },
];

const STAFF_PAGES = ["/", "/alerts", "/cases", "/cases/43", "/cases/57", "/map", "/zones", "/rules", "/health", "/invoices", "/invoices/MM-2026-10-PRO", "/fees", "/reports", "/audit", "/access", "/outbox"];
const OPERATOR_PAGES = ["/", "/alerts", "/cases", "/cases/7", "/compliance", "/map", "/health", "/invoices", "/invoices/MM-2026-10-KES", "/outbox"];
const slug = (s) => s.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "home";

function auditSet() {
  const shots = [];
  const add = (seat, name, url) => {
    for (const [tag, size, theme] of [["d-light", DESKTOP, "light"], ["d-dark", DESKTOP, "dark"], ["p-light", PHONE, "light"], ["p-dark", PHONE, "dark"]])
      shots.push({ file: `${name}.${slug(url)}.${tag}`, seat, url, theme, ...size, full: true, settle: /map|zones|open-data/.test(url) ? 4000 : 900 });
  };
  for (const url of STAFF_PAGES) add("Program manager", "manager", url);
  for (const url of OPERATOR_PAGES) add("Kestrel Mobility", "operator", url);
  for (const [seat, name] of [["Compliance analyst", "analyst"], ["Finance", "finance"], ["IT administrator", "admin"], ["Read-only", "readonly"]]) add(seat, name, "/");
  add("Finance", "finance", "/cases");
  add(null, "public", "/open-data");
  return shots;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(OUT, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), "mm-shots-"));
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--hide-scrollbars", "--no-first-run", "--disable-gpu-vsync", "about:blank"], { stdio: "ignore" });
  try {
    let version;
    for (let i = 0; i < 50 && !version; i++) {
      await sleep(200);
      version = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()).catch(() => null);
    }
    if (!version) throw new Error(`Chrome did not start (${CHROME})`);
    const cdp = await connect(version.webSocketDebuggerUrl);
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const page = { send: (m, p) => cdp.send(m, p, sessionId), on: cdp.on };
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    const errors = [];
    let current = "";
    cdp.on("Runtime.exceptionThrown", (e) => errors.push(`${current}: ${e.exceptionDetails.exception?.description ?? e.exceptionDetails.text}`));
    cdp.on("Runtime.consoleAPICalled", (e) => e.type === "error" && errors.push(`${current}: console.error ${e.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300)}`));

    const goto = async (url, settle = 900) => {
      const loaded = cdp.once("Page.loadEventFired");
      await page.send("Page.navigate", { url: BASE + url });
      await loaded;
      await sleep(settle);
    };
    const evaluate = async (expression) => (await page.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
    const cookie = (name, value) => page.send("Network.setCookie", { name, value, url: BASE });

    await page.send("Emulation.setDeviceMetricsOverride", { ...DESKTOP, deviceScaleFactor: 1, mobile: false });
    await goto("/");
    const seats = await evaluate(`[...document.querySelectorAll('select[name=person] option')].map(o => [o.textContent, o.value])`);
    const seatId = (label) => {
      const hit = seats.find(([text]) => text.includes(label));
      if (!hit) throw new Error(`No seat matching "${label}"`);
      return hit[1];
    };

    const problems = [];
    const only = process.argv.indexOf("--only");
    const wanted = (shot) => only < 0 || shot.file.includes(process.argv[only + 1]);
    for (const shot of (AUDIT ? auditSet() : README).filter(wanted)) {
      current = shot.file;
      const width = shot.width ?? DESKTOP.width;
      const height = shot.height ?? DESKTOP.height;
      const phone = width < 600;
      await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: AUDIT ? 1 : 2, mobile: phone });
      if (shot.seat) await cookie("mm_view_as", seatId(shot.seat));
      await cookie("mm_theme", shot.theme ?? "light");
      await goto(shot.url, shot.settle);
      // The development badge is not part of the product.
      await evaluate(`document.querySelectorAll('nextjs-portal').forEach(n => n.remove())`);
      if (shot.scrollTo) {
        // Start the shot at the section's top edge, clear of the strip pinned to the top of the page,
        // so nothing above it is cut in half.
        await evaluate(`(() => {
          const heading = [...document.querySelectorAll('h1,h2,h3')].find(h => h.textContent.includes(${JSON.stringify(shot.scrollTo)}));
          const el = heading?.closest('section,.panel') ?? heading;
          if (!el) return;
          const scroller = document.querySelector('.frame-main') ?? window;
          scroller.scrollBy(0, el.getBoundingClientRect().top - 108);
        })()`);
        await sleep(600);
      }
      const measure = await evaluate(`(() => {
        const main = document.querySelector('.frame-main');
        const wide = [...document.querySelectorAll('body *')].filter(el => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.right <= innerWidth + 1) return false;
          for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return false; }
          return true;
        }).slice(0, 3).map(el => el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 60) + ' "' + el.textContent.trim().slice(0, 40) + '"');
        return { doc: document.documentElement.scrollWidth, view: innerWidth, framed: Boolean(main), inner: main ? main.scrollHeight - main.clientHeight : 0, tall: document.documentElement.scrollHeight, wide, title: document.title, status: document.querySelector('h1')?.textContent ?? '' };
      })()`);
      if (measure.doc > measure.view + 1 || measure.wide.length) problems.push(`${shot.file}: wider than the screen (${measure.doc} of ${measure.view}) ${measure.wide.join(" | ")}`);
      let clip;
      if (shot.full) {
        // The console scrolls inside its frame on a wide screen, and the whole document on a phone.
        const tall = Math.min(phone || !measure.framed ? measure.tall : height + measure.inner, 6000);
        if (!phone && measure.inner > 0) {
          await page.send("Emulation.setDeviceMetricsOverride", { width, height: tall, deviceScaleFactor: 1, mobile: false });
          await sleep(500);
        }
        clip = { x: 0, y: 0, width, height: tall, scale: 1 };
      }
      const { data } = await page.send("Page.captureScreenshot", AUDIT ? { format: "jpeg", quality: 70, clip, captureBeyondViewport: Boolean(clip) } : { format: "png" });
      writeFileSync(join(OUT, `${shot.file}.${AUDIT ? "jpg" : "png"}`), Buffer.from(data, "base64"));
      console.log(`${shot.file}  ${measure.title}`);
    }
    if (problems.length || errors.length) {
      console.log(`\n${problems.length} layout problem(s), ${errors.length} page error(s)`);
      for (const line of [...problems, ...new Set(errors)]) console.log("  " + line);
      process.exitCode = AUDIT ? 0 : 1;
    } else console.log("\nNo layout problems and no page errors.");
    cdp.close();
  } finally {
    chrome.kill();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  }
}

/** A minimal client for the Chrome DevTools Protocol. */
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = () => fail(new Error("Could not connect to Chrome")); });
  let next = 0;
  const waiting = new Map();
  const listeners = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      const { ok, fail } = waiting.get(message.id);
      waiting.delete(message.id);
      message.error ? fail(new Error(message.error.message)) : ok(message.result);
    } else for (const fn of [...(listeners.get(message.method) ?? [])]) fn(message.params);
  };
  const on = (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn]);
  return {
    send: (method, params = {}, sessionId) => new Promise((ok, fail) => { const id = ++next; waiting.set(id, { ok, fail }); ws.send(JSON.stringify({ id, method, params, sessionId })); }),
    on,
    once: (method) => new Promise((ok) => { const fn = (p) => { listeners.set(method, listeners.get(method).filter((f) => f !== fn)); ok(p); }; on(method, fn); }),
    close: () => ws.close(),
  };
}

await main();
