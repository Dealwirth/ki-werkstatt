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
  check("15 Abzeichen angezeigt", (await page.locator(".badge").count()) === 15);
  check("4 Muster-Knöpfe vorhanden", (await page.locator("[data-preset]").count()) === 4);
  check("Perf-Modul geladen", await page.evaluate(() => !!window.Perf && typeof window.Perf.run === "function"));
  check("Engine hat evaluate()", await page.evaluate(() => typeof window.NN.NeuralNet.prototype.evaluate === "function"));
  check("Engine hat inputGradient()", await page.evaluate(() => typeof window.NN.NeuralNet.prototype.inputGradient === "function"));
  check("Engine hat generateFor()", await page.evaluate(() => typeof window.NN.NeuralNet.prototype.generateFor === "function"));

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
  check("Wörter-Training nennt Trefferquote", /Treffer/.test(textStatus), textStatus.slice(0, 90));

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
  console.log("\n[5b] Zeichenwerkzeuge, Tipps und Rechenleistung");
  check("Live-Vorschau vorhanden", (await page.locator("#draw-preview").count()) === 1);
  check("Drei Zeichenwerkzeuge", (await page.locator(".tool-row .tool").count()) === 3);
  check("Tipps werden angezeigt", (await page.locator("#image-tips .tip").count()) >= 3);

  // Stift/Radierer umschalten
  await page.click("#draw-eraser");
  await page.waitForTimeout(100);
  check("Radierer ist aktiv", await page.evaluate(() =>
    document.getElementById("draw-eraser").classList.contains("active")));
  await page.click("#draw-pen");
  await page.waitForTimeout(100);
  check("Stift ist wieder aktiv", await page.evaluate(() =>
    document.getElementById("draw-pen").classList.contains("active")));

  // Live-Vorschau: nach dem Zeichnen muss sie Inhalt zeigen
  await drawOn("#draw-canvas", "circle", 70);
  await page.waitForTimeout(300);
  const previewInk = await page.evaluate(() => {
    const c = document.getElementById("draw-preview");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++;
    return n;
  });
  check("Live-Vorschau zeigt die Zeichnung", previewInk > 0, "Pixel: " + previewInk);

  // Zuruecknehmen
  const beforeUndo = await inkOn("#draw-canvas");
  await page.click("#draw-undo");
  await page.waitForTimeout(300);
  const afterUndo = await inkOn("#draw-canvas");
  check("Zurücknehmen verändert die Leinwand", afterUndo !== beforeUndo,
    `${beforeUndo} -> ${afterUndo}`);
  await page.click("#draw-clear");
  await page.waitForTimeout(150);

  // Rechenleistung testen (Pflicht-Knopf ist da, Empfehlung erscheint)
  await page.click("#perf-run");
  await page.waitForFunction(
    () => /Trainingsrunden pro Sekunde/.test(document.getElementById("perf-result").textContent),
    { timeout: 20000 }
  );
  const perfText = await page.textContent("#perf-result");
  check("Rechenleistung gemessen", /\d+\s*Trainingsrunden pro Sekunde/.test(perfText));
  check("Empfehlungen werden angezeigt", (await page.locator("#perf-result .perf-tips li").count()) >= 3);
  check("Empfehlung ist überspringbar (kein Zwang)", await page.evaluate(() =>
    !document.getElementById("perf-run").disabled));

  // ---------------------------------------------------------------------------
  console.log("\n[5c] Gegenprobe: Die KI malt selbst");
  check("Malen-Bereich vorhanden", (await page.locator("#gen-canvas").count()) === 1);
  await page.selectOption("#gen-category", "0");
  await page.click("#gen-run");
  await page.waitForFunction(
    () => /Vorstellung/.test(document.getElementById("gen-status").textContent),
    { timeout: 25000 }
  );
  const genText = await page.textContent("#gen-status");
  console.log("    " + genText.replace(/\s+/g, " ").trim().slice(0, 120));
  check("KI hat ein Bild gemalt", /Vorstellung von/.test(genText));
  const genInk = await page.evaluate(() => {
    const c = document.getElementById("gen-canvas");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 200) dark++;
    return dark;
  });
  check("Gemaltes Bild hat sichtbare Form", genInk > 200, "dunkle Pixel: " + genInk);

  // Gegenprobe: Das gemalte Bild wird auch erkannt (Erwartung == gewaehlte Sache)
  const genCheck = await page.evaluate(() => {
    const I = window.KI.image;
    const c = document.getElementById("gen-canvas");
    // Aus dem gemalten Canvas einen Vektor machen und vorhersagen
    const vec = I.canvasToVector(c);
    const r = I.predict(vec);
    return r ? { best: r.best.label, conf: r.best.value } : null;
  });
  check("Gegenprobe: gemaltes Bild wird richtig erkannt",
    genCheck && genCheck.best === "Kreis",
    genCheck ? `${genCheck.best} (${Math.round(genCheck.conf * 100)}%)` : "keine Vorhersage");

  // Folgen-Anzeige: nach dem Training mit genug Beispielen -> gute Meldung
  const consText = await page.textContent("#image-consequence");
  check("Folgen werden angezeigt", consText.trim().length > 0, consText.slice(0, 60));

  // ---------------------------------------------------------------------------
  console.log("\n[5d] Keine Beschränkungen mehr");
  // Viele Kategorien anlegen (frueher bei 4 gesperrt)
  for (const name of ["Dreieck", "Welle", "Punkt", "Kreuz", "Herz"]) {
    await page.fill("#image-category-input", name);
    await page.click("#image-add-category");
    await page.waitForTimeout(60);
  }
  const catCount = await page.locator("#image-categories .chip").count();
  check("Mehr als 4 Bild-Kategorien möglich", catCount === 7, "gezählt: " + catCount);

  // Viele Schubladen bei den Woertern (frueher bei 8 gesperrt).
  // Wichtig: Das machen wir in einer FRISCHEN Woerter-KI, damit die
  // trainierte KI aus Abschnitt [3] unberuehrt bleibt.
  await page.click('.tab[data-tab="text"]');
  await page.waitForTimeout(150);
  const trainedTextId = await page.evaluate(() => window.KI.text.projects.activeId());
  await page.evaluate(() => window.KI.text.projects.create("Viele-Schubladen-KI"));
  await page.waitForTimeout(300);
  for (let i = 1; i <= 9; i++) {
    await page.fill("#text-category-input", "Schublade" + i);
    await page.click("#text-add-category");
    await page.waitForTimeout(40);
  }
  const textCats = await page.locator("#text-categories .chip").count();
  check("Mehr als 8 Wort-Schubladen möglich", textCats >= 9, "gezählt: " + textCats);
  // Zurueck zur trainierten Woerter-KI
  await page.evaluate((id) => window.KI.text.projects.switchTo(id), trainedTextId);
  await page.waitForTimeout(300);
  const backTextCats = await page.locator("#text-categories .chip").count();
  check("Zurück zur trainierten Wörter-KI", backTextCats === 2, "Schubladen: " + backTextCats);

  // Viele KIs anlegen (frueher bei 12 gesperrt)
  await page.click('.tab[data-tab="image"]');
  await page.waitForTimeout(150);
  const trainedId = await page.evaluate(() => window.KI.image.projects.activeId());
  for (let i = 0; i < 13; i++) {
    page.once("dialog", (d) => d.accept("Extra-KI " + i));
    await page.click("#image-projects .btn-primary");
    await page.waitForTimeout(120);
  }
  const projCount = await page.locator("#image-projects .project-chip").count();
  check("Mehr als 12 KIs möglich", projCount > 12, "gezählt: " + projCount);

  // Zurueck auf die trainierte KI wechseln, damit spaetere Tests weiterlaufen
  await page.evaluate((id) => window.KI.image.projects.switchTo(id), trainedId);
  await page.waitForTimeout(400);
  const backEx = await page.evaluate(() => window.KI.image.state.examples.length);
  check("Zurück zur trainierten KI", backEx > 0, "Beispiele: " + backEx);


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


  // -------------------------------------------------------------------------
  console.log("\n[9] Mehrere KIs verwalten");
  await page.click('.tab[data-tab="text"]');
  await page.waitForTimeout(300);
  const startCount = await page.evaluate(() => window.KI.text.projects.list().length);
  check("Mindestens 1 KI vorhanden", startCount >= 1, "gefunden: " + startCount);

  // Neue KI ueber den Knopf anlegen
  page.once("dialog", async (d) => { await d.accept("Zweit-KI"); });
  const newBtnVisible = await page.locator("#text-projects .btn-primary").isVisible();
  check("Knopf 'Neue KI' sichtbar", newBtnVisible);
  if (newBtnVisible) {
    await page.click("#text-projects .btn-primary");
    await page.waitForTimeout(500);
  }
  const afterCreate = await page.evaluate(() => window.KI.text.projects.list().length);
  check("KI wurde angelegt", afterCreate === startCount + 1, "gefunden: " + afterCreate);
  const newActive = await page.evaluate(() => { const p = window.KI.text.projects.active(); return p ? p.name : null; });
  check("Neue KI ist aktiv", newActive === "Zweit-KI", "aktiv: " + newActive);
  check("Projekt-Chips angezeigt", (await page.locator("#text-projects .project-chip").count()) === afterCreate);

  // Fortschritt ist getrennt
  const emptyCats = await page.evaluate(() => window.KI.text.state.categories.length);
  check("Neue KI startet leer", emptyCats === 0, "gefunden: " + emptyCats);
  const firstId = await page.evaluate(() => window.KI.text.projects.list()[0].id);
  await page.evaluate((id) => window.KI.text.projects.switchTo(id), firstId);
  await page.waitForTimeout(500);
  const firstCats = await page.evaluate(() => window.KI.text.state.categories.length);
  check("Erste KI behaelt ihren Fortschritt", firstCats === 2, "gefunden: " + firstCats);

  // Loeschen ueber den echten Papierkorb-Knopf der zweiten KI
  page.once("dialog", async (d) => { await d.accept(); });
  await page.locator("#text-projects .project-chip").nth(1).locator(".project-icon.danger").click();
  await page.waitForTimeout(500);
  const afterDelete = await page.evaluate(() => window.KI.text.projects.list().length);
  check("KI geloescht", afterDelete === startCount, "gefunden: " + afterDelete);
  check("Leiste zeigt richtige Anzahl", (await page.locator("#text-projects .project-chip").count()) === startCount);

  // -------------------------------------------------------------------------
  console.log("\n[10] Cloud-Speicher-Oberflaeche");
  check("Sync-Anzeige vorhanden", await page.evaluate(() => !!document.getElementById("sync-status")));
  check("Speicher-Modul geladen", await page.evaluate(() => !!window.Storage));
  check("Ohne Schluessel: lokaler Modus", await page.evaluate(() => !window.Storage.isCloudEnabled()));
  await page.click("#sync-status");
  await page.waitForTimeout(400);
  check("Dialog oeffnet sich", await page.evaluate(() => document.getElementById("cloud-overlay").classList.contains("open")));
  const repoPrefill = await page.inputValue("#cloud-repo");
  check("Repository ist vorbelegt", repoPrefill.includes("/"), repoPrefill);
  // Ein ungueltiger Schluessel darf nicht abstuerzen
  await page.fill("#cloud-token", "ungueltig123");
  await page.click("#cloud-connect");
  await page.waitForTimeout(3000);
  const cloudMsg = await page.textContent("#cloud-status");
  check("Ungueltiger Schluessel wird sauber gemeldet", cloudMsg.includes("❌") || cloudMsg.includes("ungültig") || cloudMsg.includes("Keine Verbindung"), cloudMsg.trim());
  await page.click("#cloud-forget");
  await page.waitForTimeout(300);
  check("Schluessel wieder vergessen", (await page.inputValue("#cloud-token")) === "");
  await page.click("#cloud-close");
  await page.waitForTimeout(300);
  check("Dialog schliesst wieder", !(await page.evaluate(() => document.getElementById("cloud-overlay").classList.contains("open"))));

  console.log("\n[11] Konsole sauber?");
  if (errors.length) {
    console.log("   Fehler gefunden:");
    errors.forEach((e) => console.log("   ! " + e));
  }
  // Der absichtliche Falsch-Schluessel-Test oben erzeugt bei GitHub einen
  // 401-Fehler. Den zaehlen wir nicht als Fehler der Seite.
  const realErrors = errors.filter(
    (e) => !/401|Failed to load resource/i.test(e)
  );
  check("Keine Konsolenfehler", realErrors.length === 0, realErrors.join(" | "));

  console.log(`\n=== Ergebnis: ${passed} bestanden, ${failed} fehlgeschlagen ===`);
  await page.screenshot({ path: "/tmp/ki-werkstatt.png", fullPage: false });
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
  console.error("Test-Absturz:", e);
  process.exit(2);
});
