/*
 * Browser-Test: laedt die Seite in echtem Chromium und spielt die wichtigsten
 * Ablaeufe durch (Woerter-KI, Bild-KI, Zahlen-KI, Speichern, Abzeichen).
 *
 * Wichtig: Die Tests benutzen ABSICHTLICH lernbare Muster (siehe unten).
 * Der Grund steht in der Hilfe-Seite: Die Woerter-KI sieht nur Buchstaben,
 * keine Bedeutung. "Woerter mit SCH" lernt sie fast perfekt, "Obst gegen
 * Tiere" nicht. Der Test prueft also, was die KI wirklich leisten soll.
 *
 * Aufruf: node tests/browser-test.js
 */
const { chromium } = require("playwright-core");

const URL = process.env.TEST_URL || "http://localhost:12000/index.html";

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

  let passed = 0;
  let failed = 0;
  function check(name, cond, extra = "") {
    if (cond) {
      passed++;
      console.log(`  ✓ ${name}`);
    } else {
      failed++;
      console.log(`  ✗ ${name} ${extra}`);
    }
  }

  console.log("→ Seite laden:", URL);
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForTimeout(400);

  console.log("\n[1] Grundgerüst");
  check("Titel korrekt", (await page.title()).includes("KI-Werkstatt"));
  check("window.KI vorhanden", await page.evaluate(() => !!window.KI));
  check("NN-Engine geladen", await page.evaluate(() => !!window.NN && !!window.NN.NeuralNet));
  check("5 Tabs vorhanden", (await page.locator(".tab").count()) === 5);
  check("11 Abzeichen angezeigt", (await page.locator(".badge").count()) === 11);
  check("4 Muster-Knöpfe vorhanden", (await page.locator("[data-preset]").count()) === 4);

  console.log("\n[2] Navigation");
  await page.click('.tab[data-tab="text"]');
  await page.waitForTimeout(200);
  check("Text-Panel sichtbar", await page.locator("#panel-text").isVisible());
  await page.click('.tab[data-tab="howto"]');
  await page.waitForTimeout(200);
  check("Howto-Panel sichtbar", await page.locator("#panel-howto").isVisible());
  await page.click('.tab[data-tab="home"]');
  await page.waitForTimeout(150);
  check("Start-Panel sichtbar", await page.locator("#panel-home").isVisible());

  // ---------------------------------------------------------------------------
  console.log("\n[3] Wörter-KI mit lernbarem Muster (Wörter mit SCH)");
  await page.click('.tab[data-tab="text"]');
  await page.waitForTimeout(150);
  await page.click('[data-preset="sch"]');
  await page.waitForTimeout(150);
  check("2 Kategorien aus Muster", (await page.locator("#text-categories .chip").count()) === 2);
  check("28 Beispiele aus Muster", (await page.locator("#text-examples .example-item").count()) === 28);
  check("Abzeichen 'two_categories'", await page.evaluate(() =>
    JSON.parse(localStorage.getItem("kinderki:badges") || "[]").includes("two_categories")));

  await page.fill("#text-epochs", "400");
  await page.click("#text-train");
  await page.waitForFunction(
    () => document.getElementById("text-status").textContent.includes("Fertig"),
    { timeout: 90000 }
  );
  const textStatus = await page.textContent("#text-status");
  check("Training abgeschlossen", textStatus.includes("Fertig"), textStatus);

  const pred = async (word) => {
    await page.fill("#text-test-input", word);
    await page.click("#text-test-btn");
    await page.waitForTimeout(150);
    return page.textContent("#text-answer .answer-big");
  };
  // Neue Woerter, die NICHT im Muster waren - inkl. "sch" in der Mitte/am Ende
  const r1 = await pred("schmetterling"); // mit SCH (Anfang)
  const r2 = await pred("tischdecke");    // mit SCH (Mitte)
  const r3 = await pred("gartenhaus");    // ohne SCH
  const r4 = await pred("blume");         // ohne SCH
  console.log("    schmetterling ->", r1.trim());
  console.log("    tischdecke    ->", r2.trim());
  console.log("    gartenhaus    ->", r3.trim());
  console.log("    blume         ->", r4.trim());
  check("'schmetterling' -> mit SCH", r1.includes("mit SCH"), r1);
  check("'tischdecke' -> mit SCH (Mitte)", r2.includes("mit SCH"), r2);
  check("'gartenhaus' -> ohne SCH", r3.includes("ohne SCH"), r3);
  check("'blume' -> ohne SCH", r4.includes("ohne SCH"), r4);

  await page.click("#text-self-test");
  await page.waitForFunction(
    () => document.getElementById("text-answer").textContent.includes("Selbst-Test"),
    { timeout: 90000 }
  );
  const stText = await page.textContent("#text-answer .answer-big");
  const stPct = parseInt(stText.match(/(\d+)%/)?.[1] || "0", 10);
  console.log("   ", stText.trim());
  check("Selbst-Test >= 80%", stPct >= 80, stText);

  // ---------------------------------------------------------------------------
  console.log("\n[4] Zahlen-KI: Regel lernen (innerhalb des Bereichs)");
  await page.click('.tab[data-tab="number"]');
  await page.waitForTimeout(150);
  await page.click("#number-autofill");
  await page.waitForTimeout(100);
  check("11 Zahlen-Beispiele", (await page.locator("#number-examples .example-item").count()) === 11);

  await page.fill("#number-epochs", "1200");
  await page.click("#number-train");
  await page.waitForFunction(
    () => document.getElementById("number-status").textContent.includes("Fertig"),
    { timeout: 120000 }
  );
  const numTest = async (x) => {
    await page.fill("#number-test", String(x));
    await page.click("#number-test-btn");
    await page.waitForTimeout(150);
    const t = await page.textContent("#number-answer .answer-big");
    return parseFloat(t.split("→")[1]);
  };
  const v1 = await numTest(2.5);
  const v2 = await numTest(-3.5);
  const v3 = await numTest(0.5);
  console.log(`    2.5 -> ${v1} (will 6)   -3.5 -> ${v2} (will -6)   0.5 -> ${v3} (will 2)`);
  check("x=2.5  → ≈6", Math.abs(v1 - 6) < 0.5, "war " + v1);
  check("x=-3.5 → ≈-6", Math.abs(v2 - -6) < 0.5, "war " + v2);
  check("x=0.5  → ≈2", Math.abs(v3 - 2) < 0.5, "war " + v3);

  // ---------------------------------------------------------------------------
  console.log("\n[5] Bild-KI: Zeichnen + Training + Erkennung");
  await page.click('.tab[data-tab="image"]');
  await page.waitForTimeout(150);
  await page.fill("#image-category-input", "Kreis");
  await page.click("#image-add-category");
  await page.waitForTimeout(80);
  await page.fill("#image-category-input", "Strich");
  await page.click("#image-add-category");
  await page.waitForTimeout(80);
  check("2 Bild-Kategorien", (await page.locator("#image-categories .chip").count()) === 2);

  // Zaehlt die "Tinte" auf einer Leinwand (wie viele Kaestchen sind dunkel).
  const inkOn = (canvasSel) =>
    page.evaluate((sel) => {
      const canvas = document.querySelector(sel);
      if (!canvas) return 0;
      return Array.from(window.KI.image.canvasToVector(canvas)).filter((x) => x > 0.08).length;
    }, canvasSel);

  // Malt eine Form. Prueft danach, ob wirklich Tinte auf der Leinwand ist,
  // und wiederholt den Versuch einmal (Maus-Ereignisse koennen je nach
  // Scroll-Position danebengehen).
  const drawOn = async (canvasSel, kind, radius) => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      // Wichtig: Die Kopfleiste klebt oben. Wir schieben die Leinwand in die
      // Mitte des Bildschirms, sonst liegen die oberen Ecken darunter und
      // der Klick kommt nicht bei der Leinwand an.
      await page.locator(canvasSel).evaluate((el) =>
        el.scrollIntoView({ block: "center" })
      );
      await page.waitForTimeout(150);
      const box = await page.locator(canvasSel).boundingBox();
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      if (kind === "circle") {
        const r = radius;
        await page.mouse.move(cx + r, cy);
        await page.mouse.down();
        for (let a = 0; a <= 360; a += 10) {
          const rad = (a * Math.PI) / 180;
          await page.mouse.move(cx + r * Math.cos(rad), cy + r * Math.sin(rad));
        }
        await page.mouse.up();
      } else {
        const d = radius;
        await page.mouse.move(cx - d, cy - d);
        await page.mouse.down();
        for (let i = 0; i <= 10; i++) {
          await page.mouse.move(cx - d + (2 * d * i) / 10, cy - d + (2 * d * i) / 10);
        }
        await page.mouse.up();
      }
      await page.waitForTimeout(150);
      if ((await inkOn(canvasSel)) > 0) return true;
      console.log(`       (Versuch ${attempt} ohne Tinte - nochmal)`);
    }
    return false;
  };

  const sizes = [55, 62, 70, 78, 86, 94, 100, 108, 60, 74, 90, 104];
  for (const s of sizes) {
    await page.selectOption("#draw-category", "0");
    await drawOn("#draw-canvas", "circle", s);
    await page.click("#draw-save");
    await page.waitForTimeout(50);
  }
  for (const s of sizes) {
    await page.selectOption("#draw-category", "1");
    await drawOn("#draw-canvas", "line", s * 0.8);
    await page.click("#draw-save");
    await page.waitForTimeout(50);
  }
  const thumbCount = await page.locator("#image-thumbs .thumb").count();
  check("24 Zeichnungen gemerkt", thumbCount === 24, "gezählt: " + thumbCount);

  await page.fill("#image-epochs", "250");
  await page.click("#image-train");
  await page.waitForFunction(
    () => document.getElementById("image-status").textContent.includes("Fertig"),
    { timeout: 240000 }
  );
  const imgStatus = await page.textContent("#image-status");
  console.log("   ", imgStatus.trim());
  check("Bild-Training abgeschlossen", imgStatus.includes("Fertig"));

  // Hilfsfunktion: wartet auf eine Vorhersage und meldet, was passiert ist.
  const readPrediction = async (label) => {
    try {
      await page.waitForSelector("#image-answer .answer-big", { timeout: 8000 });
      const t = (await page.textContent("#image-answer .answer-big")).trim();
      console.log(`    ${label} -> ${t}`);
      return t;
    } catch (e) {
      const cells = await page.evaluate(() =>
        Array.from(window.KI.image.canvasToVector(document.getElementById("test-canvas")))
          .filter((x) => x > 0.08).length
      );
      const boxText = (await page.textContent("#image-answer")).trim().slice(0, 120);
      console.log(`    ${label} -> KEINE VORHERSAGE (aktive Zellen: ${cells})`);
      console.log(`       Antwort-Box: ${boxText}`);
      return "";
    }
  };

  await drawOn("#test-canvas", "circle", 78);
  const circleAns = await readPrediction("neuer Kreis ");
  check("neuer Kreis wird als Kreis erkannt", circleAns.includes("Kreis"), circleAns);

  await page.click("#test-clear");
  await page.waitForTimeout(250);
  await drawOn("#test-canvas", "line", 76);
  const lineAns = await readPrediction("neuer Strich");
  check("neuer Strich wird als Strich erkannt", lineAns.includes("Strich"), lineAns);

  // ---------------------------------------------------------------------------
  console.log("\n[6] Speichern (JSON-Export)");
  await page.click('.tab[data-tab="text"]');
  await page.waitForTimeout(150);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 20000 }),
    page.click("#text-save"),
  ]);
  check("Download gestartet", !!download, download ? download.suggestedFilename() : "");
  check("Dateiname korrekt", download && download.suggestedFilename() === "woerter-ki.json");

  // ---------------------------------------------------------------------------
  console.log("\n[7] Persistenz (Seite neu laden)");
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(600);
  await page.click('.tab[data-tab="text"]');
  await page.waitForTimeout(250);
  check("Kategorien erhalten", (await page.locator("#text-categories .chip").count()) === 2);
  check("Beispiele erhalten", (await page.locator("#text-examples .example-item").count()) === 28);
  await page.fill("#text-test-input", "schmetterling");
  await page.click("#text-test-btn");
  await page.waitForTimeout(200);
  const afterReload = await page.textContent("#text-answer .answer-big");
  console.log("    nach Neuladen: schmetterling ->", afterReload.trim());
  check("trainierte KI überlebt Neuladen", afterReload.includes("mit SCH"), afterReload);

  console.log("\n[8] Konsole sauber?");
  if (errors.length) {
    console.log("   Fehler gefunden:");
    errors.forEach((e) => console.log("   ! " + e));
  }
  check("Keine Konsolenfehler", errors.length === 0, errors.join(" | "));

  console.log(`\n=== Ergebnis: ${passed} bestanden, ${failed} fehlgeschlagen ===`);
  await page.screenshot({ path: "/tmp/ki-werkstatt.png", fullPage: false });
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
  console.error("Test-Absturz:", e);
  process.exit(2);
});
