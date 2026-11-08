/*
 * Cloud-Test: prueft den kompletten Weg in ein echtes GitHub-Repository.
 *
 * Ablauf:
 *   1. Seite laden, mit dem Repository verbinden (Token aus GITHUB_TOKEN).
 *   2. Eine Woerter-KI trainieren und ins Repository speichern.
 *   3. In einem FRISCHEN Browser (ohne lokalen Speicher) alles zurueckladen.
 *   4. Pruefen, dass die geladene KI sofort richtig antwortet.
 *   5. Am Ende die Testdateien aus dem Repository wieder entfernen.
 *
 * Aufruf:  GITHUB_TOKEN=... node tests/cloud-test.js
 * Wichtig: Der Test schreibt und loescht im angegebenen Repository!
 */

const { chromium } = require("playwright-core");

const URL = process.env.TEST_URL || "http://localhost:12000/index.html";
const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.TEST_REPO || "Dealwirth/ki-werkstatt";
const CHROMIUM = process.env.CHROMIUM_PATH || "/usr/bin/chromium";

let passed = 0;
let failed = 0;
function check(name, ok, extra) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`);
  }
}

async function api(path, options) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...(options && options.headers),
    },
  });
  return res;
}

/** Loescht alle Dateien unter ai-projects/ aus dem Repository. */
async function cleanCloud() {
  for (const mod of ["text", "image", "number"]) {
    const res = await api(`contents/ai-projects/${mod}`);
    if (res.status !== 200) continue;
    const files = await res.json();
    for (const f of files) {
      await api(`contents/${f.path}`, {
        method: "DELETE",
        body: JSON.stringify({
          message: "Testdaten entfernen",
          sha: f.sha,
          branch: "main",
        }),
      });
    }
  }
}

(async () => {
  if (!TOKEN) {
    console.error("Kein GITHUB_TOKEN gesetzt. Abbruch.");
    process.exit(2);
  }

  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  // -------------------------------------------------------------------------
  console.log("[1] Trainieren und in die Cloud speichern");
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForTimeout(600);
  await page.click('.tab[data-tab="text"]');
  await page.waitForTimeout(300);

  // Verbinden
  await page.click("#sync-status");
  await page.waitForTimeout(300);
  await page.fill("#cloud-repo", REPO);
  await page.fill("#cloud-token", TOKEN);
  await page.click("#cloud-connect");
  await page.waitForTimeout(4000);
  check(
    "Mit Repository verbunden",
    (await page.textContent("#cloud-status")).includes("✅")
  );

  // Dialog schliessen, damit die Seite dahinter bedienbar ist
  await page.click("#cloud-close");
  await page.waitForTimeout(300);

  // Trainieren
  await page.click('[data-preset="sch"]');
  await page.waitForTimeout(400);
  await page.fill("#text-epochs", "150");
  await page.click("#text-train");
  await page.waitForTimeout(30000);
  const examples = await page.evaluate(() => window.KI.text.state.examples.length);
  check("KI trainiert (28 Beispiele)", examples === 28, "gefunden: " + examples);

  // Dialog erneut oeffnen und speichern
  await page.click("#sync-status");
  await page.waitForTimeout(300);
  await page.click("#cloud-save-all");
  await page.waitForTimeout(9000);
  check(
    "Speichern gemeldet",
    (await page.textContent("#cloud-status")).includes("✅")
  );
  await page.close();

  // -------------------------------------------------------------------------
  console.log("[2] In frischem Browser zurueckladen");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const fresh = await ctx.newPage();
  await fresh.goto(URL, { waitUntil: "load" });
  await fresh.waitForTimeout(600);
  check(
    "Frischer Browser startet leer",
    (await fresh.evaluate(() => window.KI.text.state.examples.length)) === 0
  );

  await fresh.click("#sync-status");
  await fresh.waitForTimeout(300);
  await fresh.fill("#cloud-repo", REPO);
  await fresh.fill("#cloud-token", TOKEN);
  await fresh.click("#cloud-connect");
  await fresh.waitForTimeout(4000);
  await fresh.click("#cloud-load-all");
  await fresh.waitForTimeout(9000);

  const loadedEx = await fresh.evaluate(() => window.KI.text.state.examples.length);
  check("28 Woerter aus Cloud geladen", loadedEx === 28, "gefunden: " + loadedEx);
  check(
    "Netz ist trainiert",
    await fresh.evaluate(() => window.KI.text.state.trained)
  );

  // -------------------------------------------------------------------------
  console.log("[3] Geladene KI antwortet sofort richtig");
  await fresh.click("#cloud-close");
  await fresh.click('.tab[data-tab="text"]');
  await fresh.waitForTimeout(400);
  let right = 0;
  for (const w of ["schmetterling", "tischdecke", "blume", "gartenhaus"]) {
    await fresh.fill("#text-test-input", w);
    await fresh.click("#text-test-btn");
    await fresh.waitForTimeout(250);
    const ans = (await fresh.textContent("#text-answer .answer-big")).trim();
    const ok = w.includes("sch") === ans.includes("mit SCH");
    if (ok) right++;
    console.log(`     ${w} -> ${ans} ${ok ? "✓" : "✗"}`);
  }
  check("4/4 richtig ohne neu zu trainieren", right === 4, right + "/4");
  await fresh.close();
  await ctx.close();
  await browser.close();

  // -------------------------------------------------------------------------
  console.log("[4] Testdaten aufraeumen");
  await cleanCloud();
  const res = await api("contents/ai-projects");
  check("Repository ist wieder sauber", res.status === 404);

  console.log(`\n=== Cloud-Ergebnis: ${passed} bestanden, ${failed} fehlgeschlagen ===`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
  console.error("Cloud-Test-Absturz:", e);
  process.exit(2);
});
