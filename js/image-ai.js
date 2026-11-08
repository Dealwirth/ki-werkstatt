/*
 * image-ai.js - Die Bild-KI.
 *
 * Aufgabe: Eine Zeichnung erkennen. Die KI sieht keine Katze - sie sieht ein
 * Raster aus 16x16 Kaestchen. Jedes Kaestchen sagt: "hier ist viel Farbe"
 * (1.0) oder "hier ist nichts" (0.0).
 *
 * Damit die KI nicht bloß auswendig lernt, machen wir zwei schlaue Dinge:
 *   1. Zentrieren: Wir schneiden die Zeichnung aus und legen sie in die Mitte.
 *      So ist es egal, ob du links oder rechts malst.
 *   2. Verwackeln (Augmentation): Beim Lernen verschieben und drehen wir jede
 *      Zeichnung ein bisschen. So lernt die KI, dass eine schiefe Katze auch
 *      eine Katze ist.
 */

const createImageAI = () => {
  "use strict";

  // Verwaltet mehrere Bild-KIs. Jede hat ihren eigenen Fortschritt.
  const projects = createProjects("image", {
    defaultName: "Meine erste Bild-KI",
    onSwitch: () => {
      if (el.projectBar) {
        renderProjects();
        applySnapshot(projects.loadActive());
      }
    },
  });

  const GRID = 16;              // 16x16 = 256 Eingabewerte
  const FEATURES = GRID * GRID;
  // Schoene, gut unterscheidbare Farben. Fuer sehr viele Kategorien
  // werden darueber hinaus weitere Farben per Regenbogen-Formel erzeugt.
  const COLORS = [
    "#4d96ff", "#6bcb77", "#ff9f45", "#c780fa",
    "#ff6b6b", "#00b8a9", "#f5b700", "#f6a6ff",
    "#7f5347", "#579bfc", "#fdab3d", "#9d50dd",
  ];
  function colorAt(i) {
    if (i < COLORS.length) return COLORS[i];
    const hue = (i * 137.508) % 360; // Goldener Winkel: nie zwei gleich nebeneinander
    return `hsl(${hue.toFixed(0)}, 70%, 58%)`;
  }

  const state = {
    categories: [],
    examples: [],     // [{label, data: Float64Array(256)}]
    net: null,
    trained: false,
    busy: false,
    lastAccuracy: null,
  };

  let el = {};
  let drawCtx = null;
  let testCtx = null;
  let drawing = false;
  let currentTarget = null; // 'draw' oder 'test'
  let lastPos = null;

  // ---------------------------------------------------------------------------
  // Zeichnung -> 16x16-Raster (der "Fingerabdruck" des Bildes)
  // ---------------------------------------------------------------------------

  /**
   * Liest die Leinwand, verkleinert sie auf 16x16, schneidet den Rand weg
   * und legt die Zeichnung in die Mitte.
   *
   * Wichtig: Wir messen, wie DUNKEL ein Kaestchen ist. Die Leinwand ist weiss,
   * die Striche sind dunkel. Wuerden wir stattdessen die Deckkraft (Alpha)
   * messen, waere alles gleich - denn weiss ist genauso deckend wie schwarz.
   */
  function canvasToVector(canvas) {
    const ctx = canvas.getContext("2d");
    const size = canvas.width;
    const img = ctx.getImageData(0, 0, size, size).data;

    const cell = size / GRID;
    const raw = new Float64Array(FEATURES);
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        let sum = 0;
        let count = 0;
        const x0 = Math.floor(gx * cell);
        const y0 = Math.floor(gy * cell);
        const x1 = Math.min(size, Math.floor((gx + 1) * cell));
        const y1 = Math.min(size, Math.floor((gy + 1) * cell));
        for (let y = y0; y < y1; y += 2) {
          for (let x = x0; x < x1; x += 2) {
            const i = (y * size + x) * 4;
            // Helligkeit: 255 (weiss) ... 0 (schwarz). "Tinte" ist das Gegenteil.
            const lum = (0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2]) / 255;
            sum += 1 - lum;
            count++;
          }
        }
        raw[gy * GRID + gx] = count ? sum / count : 0;
      }
    }

    return centerVector(raw);
  }

  /**
   * Findet den Bereich mit Inhalt, schneidet ihn aus und legt ihn mittig
   * in ein neues 16x16-Raster.
   */
  function centerVector(raw) {
    let minX = GRID, minY = GRID, maxX = -1, maxY = -1;
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (raw[y * GRID + x] > 0.08) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    // Leere Zeichnung -> alles null
    if (maxX < 0) return raw;

    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const out = new Float64Array(FEATURES);
    const offX = Math.round((GRID - w) / 2);
    const offY = Math.round((GRID - h) / 2);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const tx = x + offX;
        const ty = y + offY;
        if (tx < 0 || tx >= GRID || ty < 0 || ty >= GRID) continue;
        out[ty * GRID + tx] = raw[(y + minY) * GRID + (x + minX)];
      }
    }
    return out;
  }

  function vectorIsEmpty(vec) {
    for (let i = 0; i < vec.length; i++) if (vec[i] > 0.05) return false;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Verwackeln (Augmentation) - damit die KI nicht auswendig lernt
  // ---------------------------------------------------------------------------

  // Diese beiden Leinwaende werden immer wieder benutzt (schneller als
  // bei jedem Aufruf neue zu erzeugen).
  let augTarget = null;
  let augSource = null;
  let augTargetCtx = null;
  let augSourceCtx = null;
  let augImageData = null;

  function ensureAugCanvases() {
    if (augTarget) return;
    augTarget = document.createElement("canvas");
    augTarget.width = GRID;
    augTarget.height = GRID;
    augTargetCtx = augTarget.getContext("2d", { willReadFrequently: true });
    augSource = document.createElement("canvas");
    augSource.width = GRID;
    augSource.height = GRID;
    augSourceCtx = augSource.getContext("2d", { willReadFrequently: true });
    augImageData = augSourceCtx.createImageData(GRID, GRID);
  }

  /**
   * Verschiebt und dreht ein Raster leicht und gibt ein neues Raster zurueck.
   * So sieht die KI dieselbe Katze nie zweimal gleich.
   */
  function augment(vec, random) {
    ensureAugCanvases();

    // Altes Raster als Bild aufbauen
    const d = augImageData.data;
    for (let i = 0; i < FEATURES; i++) {
      const v = Math.max(0, Math.min(1, vec[i])) * 255;
      d[i * 4] = 255;
      d[i * 4 + 1] = 255;
      d[i * 4 + 2] = 255;
      d[i * 4 + 3] = v;
    }
    augSourceCtx.putImageData(augImageData, 0, 0);

    // Neu zeichnen mit zufaelliger Verschiebung und Drehung
    augTargetCtx.setTransform(1, 0, 0, 1, 0, 0);
    augTargetCtx.clearRect(0, 0, GRID, GRID);
    augTargetCtx.translate(GRID / 2, GRID / 2);
    augTargetCtx.rotate(((random() - 0.5) * 34 * Math.PI) / 180); // ±17 Grad
    const scale = 0.84 + random() * 0.32;                          // 0.84 .. 1.16
    augTargetCtx.scale(scale, scale);
    augTargetCtx.translate(
      -GRID / 2 + (random() - 0.5) * 4,
      -GRID / 2 + (random() - 0.5) * 4
    );
    augTargetCtx.drawImage(augSource, 0, 0);

    // Zurueck in Zahlen verwandeln
    const out = augTargetCtx.getImageData(0, 0, GRID, GRID).data;
    const result = new Float64Array(FEATURES);
    for (let i = 0; i < FEATURES; i++) {
      let v = out[i * 4 + 3] / 255;
      // Rauschen und leichte Helligkeitsschwankung: so bleibt die KI robust
      v = v * (0.85 + random() * 0.3) + (random() - 0.5) * 0.08;
      result[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Netz
  // ---------------------------------------------------------------------------

  /**
   * Baut das Netz. Die Groesse passt sich an: mehr Klassen und mehr
   * Beispiele -> mehr Neuronen. So lernt die KI schwere Aufgaben besser,
   * bleibt aber bei kleinen Aufgaben flott.
   */
  function buildNet(seed = 42) {
    const outSize = Math.max(state.categories.length, 2);
    const n = state.examples.length;
    const hidden1 = Math.min(192, Math.max(64, 32 + outSize * 16 + Math.floor(n / 2)));
    const hidden2 = Math.min(96, Math.max(24, Math.floor(hidden1 / 2)));
    state.net = new NN.NeuralNet(seed, [
      { size: FEATURES },
      { size: hidden1, act: "relu" },
      { size: hidden2, act: "relu" },
      { size: outSize, act: "softmax" },
    ]);
    state.trained = false;
    state.lastAccuracy = null;
  }

  // ---------------------------------------------------------------------------
  // Oberflaeche
  // ---------------------------------------------------------------------------

  function colorFor(i) {
    return colorAt(i);
  }

  function renderCategories() {
    el.categories.innerHTML = "";
    if (state.categories.length === 0) {
      el.categories.innerHTML =
        '<p class="empty-note">Noch keine Sache festgelegt. Was soll ich lernen?</p>';
    }
    state.categories.forEach((cat, i) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.style.background = cat.color;
      chip.innerHTML = `${UI.escapeHtml(cat.name)} <button title="Löschen" data-del="${i}">×</button>`;
      chip.querySelector("button").addEventListener("click", () => removeCategory(i));
      el.categories.appendChild(chip);
    });

    const options = state.categories
      .map((c, i) => `<option value="${i}">${UI.escapeHtml(c.name)}</option>`)
      .join("");
    el.drawCategory.innerHTML = options || '<option value="">– keine –</option>';
    el.drawCategory.disabled = state.categories.length === 0;
    el.drawSave.disabled = state.categories.length === 0;
    renderGenCategories();
  }

  function renderThumbs() {
    el.thumbs.innerHTML = "";
    if (state.examples.length === 0) {
      el.thumbs.innerHTML =
        '<p class="empty-note">Noch keine Zeichnungen. Male los!</p>';
      return;
    }
    state.examples
      .slice()
      .reverse()
      .forEach((ex) => {
        const cat = state.categories[ex.label];
        const wrap = document.createElement("div");
        wrap.className = "thumb";

        const cv = document.createElement("canvas");
        cv.width = GRID;
        cv.height = GRID;
        const ctx = cv.getContext("2d");
        const img = ctx.createImageData(GRID, GRID);
        for (let i = 0; i < FEATURES; i++) {
          const v = Math.max(0, Math.min(1, ex.data[i])) * 255;
          img.data[i * 4] = 38;
          img.data[i * 4 + 1] = 43;
          img.data[i * 4 + 2] = 61;
          img.data[i * 4 + 3] = v;
        }
        ctx.putImageData(img, 0, 0);

        const tag = document.createElement("div");
        tag.className = "thumb-tag";
        tag.style.background = cat ? cat.color : "#999";
        tag.textContent = cat ? cat.name : "?";

        const del = document.createElement("button");
        del.textContent = "×";
        del.title = "Entfernen";
        del.addEventListener("click", () => {
          const idx = state.examples.indexOf(ex);
          state.examples.splice(idx, 1);
          state.trained = false;
          renderThumbs();
          renderConsequence();
          updateStats();
          refreshGlobal();
          persist();
        });

        wrap.appendChild(cv);
        wrap.appendChild(tag);
        wrap.appendChild(del);
        el.thumbs.appendChild(wrap);
      });
  }

  function updateStats() {
    el.statExamples.textContent = state.examples.length;
    el.statRounds.textContent = state.net ? state.net.trainingSteps : 0;
    el.statAcc.textContent =
      state.lastAccuracy === null ? "–" : Math.round(state.lastAccuracy * 100) + "%";
  }

  function refreshGlobal() {
    if (window.KI && window.KI.refreshGlobalCount) window.KI.refreshGlobalCount();
  }

  function setStatus(t) {
    el.status.textContent = t;
  }

  function drawChart() {
    UI.drawLossChart(el.lossChart, state.net ? state.net.lossHistory : [], "Fehler");
  }

  // ---------------------------------------------------------------------------
  // Aktionen
  // ---------------------------------------------------------------------------

  function addCategory(name) {
    const trimmed = name.trim();
    if (!trimmed) {
      UI.toast("Bitte gib einen Namen ein.", "warn");
      return;
    }
    if (state.categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      UI.toast("Das gibt es schon.", "warn");
      return;
    }
    state.categories.push({ name: trimmed, color: colorFor(state.categories.length) });
    buildNet();
    renderCategories();
    persist();
    UI.toast(`„${trimmed}" hinzugefügt! Zeichne mir jetzt Beispiele.`, "success");
    if (state.categories.length === 2) window.KI?.unlockBadge("image_two");
  }

  function removeCategory(index) {
    state.categories.splice(index, 1);
    state.examples = state.examples
      .filter((ex) => ex.label !== index)
      .map((ex) => ({ ...ex, label: ex.label > index ? ex.label - 1 : ex.label }));
    buildNet();
    renderCategories();
    renderThumbs();
    renderConsequence();
    updateStats();
    drawChart();
    persist();
  }

  function saveDrawing() {
    const vec = canvasToVector(el.drawCanvas);
    if (vectorIsEmpty(vec)) {
      UI.toast("Die Leinwand ist leer. Male erst etwas!", "warn");
      return;
    }
    const label = parseInt(el.drawCategory.value, 10);
    if (isNaN(label) || !state.categories[label]) {
      UI.toast("Bitte wähle zuerst, was du gemalt hast.", "warn");
      return;
    }
    state.examples.push({ label, data: vec });
    state.trained = false;
    renderThumbs();
    renderConsequence();
    updateStats();
    refreshGlobal();
    persist();
    pushUndo("draw", el.drawCanvas);
    clearCanvas(el.drawCanvas);
    updatePreview();

    const count = state.examples.length;
    if (count === 20) window.KI?.unlockBadge("image_twenty");
    UI.toast(`Gemerkt als „${state.categories[label].name}"!`, "success");
  }

  async function train(epochs, onProgress) {
    if (state.categories.length < 2) {
      UI.toast("Ich brauche mindestens 2 Sachen zum Unterscheiden!", "warn");
      return false;
    }
    if (state.examples.length < 4) {
      UI.toast("Ich brauche mindestens 4 Zeichnungen zum Lernen.", "warn");
      return false;
    }
    const used = new Set(state.examples.map((e) => e.label));
    const empty = state.categories.filter((_, i) => !used.has(i));
    if (empty.length > 0) {
      UI.toast(`Für „${empty[0].name}" fehlen mir noch Zeichnungen!`, "warn");
      return false;
    }

    state.busy = true;
    el.trainBtn.disabled = true;
    const random = NN.makeRandom(2024);
    const nClasses = Math.max(state.categories.length, 2);

    let lastLoss = 0;
    let bestLoss = Infinity;
    let stale = 0;
    let rounds = 0;
    for (let i = 0; i < epochs; i++) {
      // Bei jeder Runde jedes Bild neu verwackeln -> unendlich viele Varianten
      const data = state.examples.map((ex) => ({
        input: augment(ex.data, random),
        target: NN.oneHot(ex.label, nClasses),
      }));
      // Am Anfang groessere Schritte, spaeter feinere: so geht es schnell
      // voran und wird trotzdem genau.
      const lr = 0.03 * (1 - 0.6 * (i / epochs));
      lastLoss = state.net.trainEpoch(data, {
        lr,
        batchSize: Math.min(8, data.length),
      });
      rounds = i + 1;

      // Fruehstopp: Wenn sich der Fehler lange nicht mehr verbessert,
      // hoeren wir auf. Das spart Zeit, ohne schlechter zu werden.
      if (lastLoss < bestLoss - 1e-4) {
        bestLoss = lastLoss;
        stale = 0;
      } else {
        stale++;
      }

      if (i % 3 === 0 || i === epochs - 1) {
        el.progress.style.width = (((i + 1) / epochs) * 100).toFixed(1) + "%";
        setStatus(`Runde ${i + 1}/${epochs} – Fehler: ${lastLoss.toFixed(3)}`);
        drawChart();
        if (onProgress) onProgress(i + 1, epochs);
        await UI.sleep(0);
      }
      if (stale > 60 && i > 40) break;
    }

    el.progress.style.width = "100%";
    state.trained = true;
    state.busy = false;
    el.trainBtn.disabled = false;

    // Trefferquote auf den eigenen Bildern bestimmen
    const own = state.examples.map((ex) => ({
      input: ex.data,
      target: NN.oneHot(ex.label, nClasses),
    }));
    state.lastAccuracy = state.net.evaluate(own);

    setStatus(
      `Fertig nach ${rounds} Runden! Fehler: ${lastLoss.toFixed(3)} · ` +
      `Treffer auf deinen Bildern: ${Math.round(state.lastAccuracy * 100)}%`
    );
    updateStats();
    renderConsequence();
    persist();

    if (lastLoss < 0.15 || state.lastAccuracy >= 0.95) {
      window.KI?.unlockBadge("image_low_loss");
      UI.confetti(70);
      UI.toast("Jetzt erkenne ich deine Zeichnungen! 🎉", "success");
    } else {
      UI.toast("Ich habe gelernt – teste mich und gib mir mehr Beispiele.", "info");
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Tipps und Folgen
  // ---------------------------------------------------------------------------

  function renderTips() {
    if (!el.tips) return;
    const rec = (Perf.last() && Perf.last().recommended) || { imagePerClass: 10 };
    const per = rec.imagePerClass;
    el.tips.innerHTML = `
      <div class="tip"><span class="tip-ico">💡</span><div>
        <strong>Zeichne gross und deutlich.</strong> Die KI sieht nur ein
        grobes Raster von 16×16 Punkten – kleine Schraffuren erkennt sie nicht.
      </div></div>
      <div class="tip"><span class="tip-ico">💡</span><div>
        <strong>Male jedes Bild anders</strong> (etwas grösser, schief, weiter
        links). Genau dadurch wird die KI sicher.
      </div></div>
      <div class="tip"><span class="tip-ico">💡</span><div>
        <strong>Etwa ${per}–${per + 4} Bilder pro Sache</strong> sind ein guter
        Start. Mehr schadet nie – ist aber nicht Pflicht.
      </div></div>
      <div class="tip"><span class="tip-ico">💡</span><div>
        <strong>Sachen müssen sich klar unterscheiden.</strong> „Kreis" und
        „Punkt" sind für die KI fast dasselbe. Nimm lieber „Kreis" und „Strich".
      </div></div>
    `;
  }

  function renderConsequence() {
    if (!el.consequence) return;
    const perClass = {};
    state.examples.forEach((ex) => {
      perClass[ex.label] = (perClass[ex.label] || 0) + 1;
    });
    const counts = Object.values(perClass);
    const minPer = counts.length ? Math.min(...counts) : 0;
    const res = Perf.consequence("image", {
      classes: state.categories.length,
      perClass: minPer,
      total: state.examples.length,
    });
    el.consequence.innerHTML = "";
    if (!res) {
      el.consequence.style.display = "none";
      return;
    }
    el.consequence.style.display = "block";
    const box = document.createElement("div");
    box.className = "consequence-box " + res.level;
    const icon = res.level === "warn" ? "⚠️" : res.level === "good" ? "✅" : "ℹ️";
    box.innerHTML = `<span class="tip-ico">${icon}</span><span>${UI.escapeHtml(res.text)}</span>`;
    el.consequence.appendChild(box);
  }

  // ---------------------------------------------------------------------------
  // Gegenprobe: Die KI malt selbst ein Bild
  // ---------------------------------------------------------------------------

  function renderGenerated(vec) {
    const canvas = el.genCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const size = canvas.width;
    const cell = size / GRID;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size, size);
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        const v = Math.max(0, Math.min(1, vec[gy * GRID + gx]));
        if (v <= 0.02) continue;
        const g = Math.round(255 - v * 220);
        ctx.fillStyle = `rgb(${g},${g},${g + 6})`;
        ctx.fillRect(gx * cell, gy * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }
  }

  async function generateImage() {
    if (!state.net || !state.trained) {
      UI.toast("Erst lernen lassen – dann kann ich malen!", "warn");
      return;
    }
    const idx = parseInt(el.genCategory.value, 10);
    if (isNaN(idx) || !state.categories[idx]) {
      UI.toast("Wähle eine Sache aus.", "warn");
      return;
    }
    const cat = state.categories[idx];
    el.genRun.disabled = true;
    el.genStatus.textContent = `Ich überlege, wie „${cat.name}" aussieht…`;

    const size = FEATURES;

    // Startpunkt: der Durchschnitt aller deiner Bilder dieser Sache.
    // Das ist eine gute Grundform - die KI kennt sie schon.
    const start = new Float64Array(size);
    const mine = state.examples.filter((ex) => ex.label === idx);
    if (mine.length) {
      for (const ex of mine) {
        for (let i = 0; i < size; i++) start[i] += ex.data[i];
      }
      for (let i = 0; i < size; i++) start[i] /= mine.length;
    } else {
      for (let i = 0; i < size; i++) start[i] = 0.15 + Math.random() * 0.1;
    }
    let startInk = 0;
    for (let i = 0; i < size; i++) startInk += start[i];

    // Jetzt verfeinern: Schritt fuer Schritt in Richtung "sicher" schieben.
    // Danach die Menge an "Tinte" wieder auf den Ausgangswert bringen - so
    // bleibt das Bild sauber, statt ganz schwarz zu werden.
    const img = Float64Array.from(start);
    const steps = 60;
    for (let s = 0; s < steps; s++) {
      const lr = 0.15 * (1 - 0.6 * (s / steps));
      const grad = state.net.inputGradient(img, idx);
      for (let i = 0; i < size; i++) {
        let v = img[i] - lr * grad[i];
        img[i] = v < 0 ? 0 : v > 1 ? 1 : v;
      }
      let ink = 0;
      for (let i = 0; i < size; i++) ink += img[i];
      if (startInk > 0 && ink > 0) {
        const f = startInk / ink;
        for (let i = 0; i < size; i++) img[i] = Math.min(1, img[i] * f);
      }
      if (s % 8 === 0) {
        renderGenerated(img);
        await UI.sleep(0);
      }
    }

    renderGenerated(img);
    const probs = state.net.predict(img);
    const conf = Math.round((probs[idx] || 0) * 100);
    el.genStatus.innerHTML =
      `Das ist meine Vorstellung von <strong>„${UI.escapeHtml(cat.name)}"</strong>. ` +
      `Wenn ich dieses Bild sehe, bin ich mir zu ${conf}% sicher.`;
    el.genRun.disabled = false;
    window.KI?.unlockBadge("image_generate");
    UI.toast("Fertig gemalt! 🎨", "success");
  }

  function renderGenCategories() {
    if (!el.genCategory) return;
    el.genCategory.innerHTML = state.categories
      .map((c, i) => `<option value="${i}">${UI.escapeHtml(c.name)}</option>`)
      .join("");
    el.genCategory.disabled = state.categories.length === 0;
    if (el.genRun) el.genRun.disabled = state.categories.length === 0;
  }

  // ---------------------------------------------------------------------------
  // Rechenleistung
  // ---------------------------------------------------------------------------

  function renderPerf(report) {
    if (!el.perfResult) return;
    if (!report) {
      const last = Perf.last();
      if (!last) {
        el.perfResult.innerHTML = '<p class="muted">Noch nicht gemessen.</p>';
        return;
      }
      report = last;
    }
    const tips = report.tips.map((t) => `<li>${UI.escapeHtml(t)}</li>`).join("");
    el.perfResult.innerHTML = `
      <p class="perf-title">${report.title}</p>
      <p class="muted">${UI.escapeHtml(report.summary)}</p>
      <p class="perf-num">${report.stepsPerSecond} Trainingsrunden pro Sekunde</p>
      <ul class="perf-tips">${tips}</ul>
    `;
  }

  async function runPerf() {
    el.perfBtn.disabled = true;
    el.perfResult.innerHTML = '<p class="muted">Ich messe kurz… (das dauert nur einen Moment)</p>';
    await UI.sleep(30);
    const report = await Perf.run();
    el.perfBtn.disabled = false;
    renderPerf(report);
    renderTips();
    window.KI?.unlockBadge("perf_measured");
    UI.toast(`Gemessen: ${report.stepsPerSecond} Runden/s`, "info");
  }



  function predict(vec) {
    if (!state.net || !state.trained) return null;
    const probs = state.net.predict(vec);
    const rows = state.categories.map((cat, i) => ({
      label: cat.name,
      value: probs[i] ?? 0,
      color: cat.color,
    }));
    const best = rows.reduce((a, b) => (b.value > a.value ? b : a));
    return { rows, best };
  }

  function showPrediction(vec) {
    if (vectorIsEmpty(vec)) {
      el.answer.className = "answer-box";
      el.answer.innerHTML = '<p class="muted">Zeichne los – ich verrate dir, was ich sehe.</p>';
      el.probs.innerHTML = "";
      return;
    }
    const result = predict(vec);
    if (!result) {
      el.answer.className = "answer-box";
      el.answer.innerHTML =
        '<p class="muted">Ich muss erst lernen! Klicke auf „Lernen lassen".</p>';
      el.probs.innerHTML = "";
      return;
    }
    const pct = Math.round(result.best.value * 100);
    let cls = "unsure";
    let comment = "Ich bin mir noch nicht sicher.";
    if (pct >= 70) {
      cls = "correct";
      comment = "Das sieht klar aus für mich!";
    } else if (pct < 40) {
      cls = "wrong";
      comment = "Ich rate eher. Zeichne mir mehr Beispiele!";
    }
    el.answer.className = "answer-box " + cls;
    el.answer.innerHTML = `
      <p class="answer-big">Ich sehe: ${UI.escapeHtml(result.best.label)}</p>
      <p class="answer-sub">${comment} (${pct}% sicher)</p>
    `;
    UI.renderProbabilities(el.probs, result.rows);
  }

  async function selfTest() {
    if (state.examples.length < 8) {
      UI.toast("Für einen Selbst-Test brauche ich mindestens 8 Zeichnungen.", "warn");
      return;
    }
    const random = NN.makeRandom(777);
    const { train: trainSet, test: testSet } = NN.trainTestSplit(
      state.examples,
      0.25,
      random
    );
    const used = new Set(trainSet.map((e) => e.label));
    if (used.size < state.categories.length) {
      UI.toast("Für einen fairen Test brauche ich mehr Zeichnungen pro Sache.", "warn");
      return;
    }

    el.selfTestBtn.disabled = true;
    UI.toast("Ich teste mich selbst…", "info");

    const savedNet = state.net;
    const savedTrained = state.trained;
    buildNet(555);
    for (let i = 0; i < 150; i++) {
      const data = trainSet.map((ex) => ({
        input: augment(ex.data, random),
        target: NN.oneHot(ex.label, Math.max(state.categories.length, 2)),
      }));
      state.net.trainEpoch(data, { lr: 0.02, batchSize: Math.min(8, data.length) });
      if (i % 20 === 0) await UI.sleep(0);
    }

    let correct = 0;
    for (const ex of testSet) {
      const probs = state.net.predict(ex.data);
      let bestIdx = 0;
      for (let i = 1; i < probs.length; i++) if (probs[i] > probs[bestIdx]) bestIdx = i;
      if (bestIdx === ex.label) correct++;
    }
    const accuracy = testSet.length ? correct / testSet.length : 0;

    state.net = savedNet;
    state.trained = savedTrained;
    el.selfTestBtn.disabled = false;
    state.lastAccuracy = accuracy;
    updateStats();
    persist();

    const pct = Math.round(accuracy * 100);
    UI.toast(
      `Selbst-Test: ${correct} von ${testSet.length} neuen Zeichnungen richtig (${pct}%).`,
      accuracy >= 0.7 ? "success" : "info"
    );
    el.answer.className = "answer-box " + (accuracy >= 0.7 ? "correct" : "unsure");
    el.answer.innerHTML = `
      <p class="answer-big">🧪 Selbst-Test: ${pct}%</p>
      <p class="answer-sub">
        ${correct} von ${testSet.length} Zeichnungen, die ich nie gesehen habe, waren richtig.
        ${accuracy >= 0.7 ? "Das ist echtes Erkennen!" : "Zeichne mir mehr Beispiele!"}
      </p>
    `;
    if (accuracy >= 0.7) window.KI?.unlockBadge("image_self_test");
  }

  // ---------------------------------------------------------------------------
  // Zeichnen auf der Leinwand
  // ---------------------------------------------------------------------------

  // Zustand fuer das Malen
  let brush = "pen";        // "pen" oder "eraser"
  const undoStacks = { draw: [], test: [] };
  const UNDO_MAX = 30;

  function pushUndo(which, canvas) {
    const stack = undoStacks[which];
    if (!stack) return;
    try {
      stack.push(canvas.toDataURL());
      if (stack.length > UNDO_MAX) stack.shift();
    } catch (e) {
      /* manche Browser verweigern toDataURL - dann eben kein Zurueck */
    }
  }

  function undo(which, canvas) {
    const stack = undoStacks[which];
    if (!stack || !stack.length) {
      UI.toast("Es gibt nichts zum Zurücknehmen.", "info");
      return;
    }
    const dataUrl = stack.pop();
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext("2d");
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      if (which === "draw") updatePreview();
    };
    img.src = dataUrl;
  }

  /**
   * Zeichnet einen glatten Strich zwischen zwei Punkten. Mehrere kleine
   * Teilstuecke sorgen fuer weiche Kurven (statt eckiger Linien).
   */
  function strokeSegment(ctx, from, to, size) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    const step = Math.max(1, size * 0.25);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = from.x + dx * t;
      const y = from.y + dy * t;
      const r = size / 2;
      if (brush === "eraser") {
        ctx.globalCompositeOperation = "destination-out";
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,1)";
        ctx.fill();
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = "#262b3d";
        ctx.fill();
      }
    }
  }

  function setupCanvas(canvas, which) {
    const ctx = canvas.getContext("2d");
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const pos = (e) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * canvas.width,
        y: ((e.clientY - rect.top) / rect.height) * canvas.height,
      };
    };

    const start = (e) => {
      e.preventDefault();
      pushUndo(which, canvas);
      drawing = true;
      currentTarget = which;
      lastPos = pos(e);
      // Der Finger "gehoert" jetzt der Leinwand. So bricht der Strich
      // nicht ab, wenn man beim Malen ueber den Rand hinauskommt.
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (err) {
        /* aeltere Browser - dann eben ohne */
      }
      strokeSegment(ctx, lastPos, lastPos, ctx.lineWidth);
      if (which === "draw") updatePreview();
    };

    const move = (e) => {
      if (!drawing || currentTarget !== which) return;
      e.preventDefault();
      const p = pos(e);
      strokeSegment(ctx, lastPos, p, ctx.lineWidth);
      lastPos = p;
      if (which === "draw") updatePreview();
    };

    const end = (e) => {
      if (!drawing || currentTarget !== which) return;
      e.preventDefault();
      drawing = false;
      currentTarget = null;
      lastPos = null;
      ctx.globalCompositeOperation = "source-over";
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (err) {
        /* egal */
      }
      if (which === "test") {
        showPrediction(canvasToVector(canvas));
      } else {
        updatePreview();
      }
    };

    canvas.addEventListener("pointerdown", start);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    return ctx;
  }

  function clearCanvas(canvas, keepUndo) {
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  /**
   * Zeigt klein an, was die KI tatsaechlich "sieht": das 16x16-Raster nach
   * dem Zentrieren. So verstehen Kinder, dass die KI keine Farben und keine
   * Feinheiten erkennt - sondern nur ein grobes Raster.
   */
  function updatePreview() {
    if (!el.drawPreview) return;
    const vec = canvasToVector(el.drawCanvas);
    const ctx = el.drawPreview.getContext("2d");
    const img = ctx.createImageData(GRID, GRID);
    for (let i = 0; i < FEATURES; i++) {
      const v = Math.max(0, Math.min(1, vec[i])) * 255;
      img.data[i * 4] = 38;
      img.data[i * 4 + 1] = 43;
      img.data[i * 4 + 2] = 61;
      img.data[i * 4 + 3] = v;
    }
    ctx.putImageData(img, 0, 0);
  }

  function setBrush(which) {
    brush = which;
    if (el.drawPen) el.drawPen.classList.toggle("active", which === "pen");
    if (el.drawEraser) el.drawEraser.classList.toggle("active", which === "eraser");
  }


  // ---------------------------------------------------------------------------
  // Speichern & Laden
  // ---------------------------------------------------------------------------

  function persist() {
    projects.saveActive(snapshot());
  }

  function snapshot() {
    return {
      categories: state.categories,
      examples: state.examples.map((ex) => ({
        label: ex.label,
        data: Array.from(ex.data),
      })),
      trained: state.trained,
      lastAccuracy: state.lastAccuracy,
      net: state.net && state.trained ? state.net.toCompact() : null,
    };
  }

  function applySnapshot(data) {
    state.categories = (data && data.categories) || [];
    state.examples = ((data && data.examples) || []).map((ex) => ({
      label: ex.label,
      data: Float64Array.from(ex.data),
    }));
    state.lastAccuracy = (data && data.lastAccuracy) ?? null;
    if (data && data.net) {
      try {
        state.net = NN.NeuralNet.fromCompact(data.net);
        state.trained = !!data.trained;
      } catch (e) {
        buildNet();
      }
    } else {
      buildNet();
    }
    renderCategories();
    renderThumbs();
    renderConsequence();
    updateStats();
    drawChart();
    refreshGlobal();
    if (state.trained && state.lastAccuracy !== null) {
      setStatus(`Trainiert! Sicherheit ${Math.round(state.lastAccuracy * 100)}%`);
    } else {
      setStatus("Noch nicht trainiert.");
    }
    el.answer.className = "answer-box";
    el.answer.innerHTML = '<p class="muted">Zeichne los – ich verrate dir, was ich sehe.</p>';
    el.probs.innerHTML = "";
  }

  function renderProjects() {
    UI.renderProjectBar(el.projectBar, {
      projects: projects.list(),
      activeId: projects.activeId(),
      limit: projects.limit,
      onSelect: (id) => {
        if (id === projects.activeId()) return;
        projects.switchTo(id);
      },
      onNew: () => {
        const name = prompt("Wie soll die neue Bild-KI heißen?", "Meine Bild-KI");
        if (name === null) return;
        const p = projects.create(name, true);
        if (p) UI.toast(`„${p.name}" ist fertig. Male ihr jetzt etwas vor!`, "success");
      },
      onRename: (id) => {
        const p = projects.list().find((x) => x.id === id);
        const name = prompt("Neuer Name:", p ? p.name : "");
        if (name === null) return;
        projects.rename(id, name);
        renderProjects();
      },
      onDelete: (id) => {
        const p = projects.list().find((x) => x.id === id);
        if (!confirm(`Die KI „${p ? p.name : ""}" wirklich löschen? Ihr ganzes Wissen geht verloren.`)) return;
        projects.remove(id);
        renderProjects();
        UI.toast("KI gelöscht. 🗑", "info");
      },
    });
  }

  function restore() {
    projects.init();
    renderProjects();
    applySnapshot(projects.loadActive());
  }

  function saveToFile() {
    if (!state.net) return;
    UI.downloadJSON("bild-ki.json", {
      art: "bild-ki",
      version: 1,
      categories: state.categories,
      examples: state.examples.map((ex) => ({
        label: ex.label,
        data: Array.from(ex.data),
      })),
      trained: state.trained,
      lastAccuracy: state.lastAccuracy,
      net: state.net.toCompact(),
    });
    UI.toast("Bild-KI gespeichert! 💾", "success");
    window.KI?.unlockBadge("saved");
  }

  function loadFromFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.art !== "bild-ki") throw new Error("Falsche Datei");
        state.categories = data.categories || [];
        state.examples = (data.examples || []).map((ex) => ({
          label: ex.label,
          data: Float64Array.from(ex.data),
        }));
        state.net = NN.NeuralNet.fromCompact(data.net);
        state.trained = !!data.trained;
        state.lastAccuracy = data.lastAccuracy ?? null;
        renderCategories();
        renderThumbs();
        updateStats();
        drawChart();
        refreshGlobal();
        persist();
        UI.toast("Bild-KI geladen! 📂", "success");
      } catch (e) {
        UI.toast("Diese Datei konnte ich nicht lesen.", "error");
      }
    };
    reader.readAsText(file);
  }

  function reset() {
    state.categories = [];
    state.examples = [];
    state.lastAccuracy = null;
    buildNet();
    renderCategories();
    renderThumbs();
    updateStats();
    drawChart();
    setStatus("Noch nicht trainiert.");
    el.progress.style.width = "0%";
    el.answer.className = "answer-box";
    el.answer.innerHTML = '<p class="muted">Zeichne los – ich verrate dir, was ich sehe.</p>';
    el.probs.innerHTML = "";
    clearCanvas(el.drawCanvas);
    clearCanvas(el.testCanvas);
    persist();
    refreshGlobal();
  }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------

  function init() {
    el = {
      projectBar: document.getElementById("image-projects"),
      categories: document.getElementById("image-categories"),
      categoryInput: document.getElementById("image-category-input"),
      addCategory: document.getElementById("image-add-category"),
      drawCanvas: document.getElementById("draw-canvas"),
      drawPreview: document.getElementById("draw-preview"),
      drawCategory: document.getElementById("draw-category"),
      drawSave: document.getElementById("draw-save"),
      drawClear: document.getElementById("draw-clear"),
      drawSize: document.getElementById("draw-size"),
      drawPen: document.getElementById("draw-pen"),
      drawEraser: document.getElementById("draw-eraser"),
      drawUndo: document.getElementById("draw-undo"),
      tips: document.getElementById("image-tips"),
      consequence: document.getElementById("image-consequence"),
      perfBtn: document.getElementById("perf-run"),
      perfResult: document.getElementById("perf-result"),
      genCategory: document.getElementById("gen-category"),
      genCanvas: document.getElementById("gen-canvas"),
      genRun: document.getElementById("gen-run"),
      genStatus: document.getElementById("gen-status"),
      thumbs: document.getElementById("image-thumbs"),
      trainBtn: document.getElementById("image-train"),
      epochs: document.getElementById("image-epochs"),
      progress: document.getElementById("image-progress"),
      status: document.getElementById("image-status"),
      lossChart: document.getElementById("image-loss-chart"),
      testCanvas: document.getElementById("test-canvas"),
      testClear: document.getElementById("test-clear"),
      testSize: document.getElementById("test-size"),
      answer: document.getElementById("image-answer"),
      probs: document.getElementById("image-probs"),
      statExamples: document.getElementById("image-stat-examples"),
      statRounds: document.getElementById("image-stat-rounds"),
      statAcc: document.getElementById("image-stat-acc"),
      selfTestBtn: document.getElementById("image-self-test"),
      saveBtn: document.getElementById("image-save"),
      loadBtn: document.getElementById("image-load"),
      loadFile: document.getElementById("image-load-file"),
    };

    restore();
    renderCategories();
    renderThumbs();
    renderGenCategories();
    renderTips();
    renderConsequence();
    renderPerf();
    updateStats();
    drawChart();

    drawCtx = setupCanvas(el.drawCanvas, "draw");
    testCtx = setupCanvas(el.testCanvas, "test");
    clearCanvas(el.drawCanvas);
    clearCanvas(el.testCanvas);
    drawCtx.lineWidth = parseInt(el.drawSize.value, 10);
    testCtx.lineWidth = parseInt(el.testSize.value, 10);
    updatePreview();

    el.addCategory.addEventListener("click", () => {
      addCategory(el.categoryInput.value);
      el.categoryInput.value = "";
      el.categoryInput.focus();
    });
    el.categoryInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") el.addCategory.click();
    });

    el.drawSave.addEventListener("click", saveDrawing);
    el.drawClear.addEventListener("click", () => {
      pushUndo("draw", el.drawCanvas);
      clearCanvas(el.drawCanvas);
      updatePreview();
    });
    el.drawSize.addEventListener("input", () => {
      drawCtx.lineWidth = parseInt(el.drawSize.value, 10);
    });
    el.drawPen.addEventListener("click", () => setBrush("pen"));
    el.drawEraser.addEventListener("click", () => setBrush("eraser"));
    el.drawUndo.addEventListener("click", () => undo("draw", el.drawCanvas));
    el.perfBtn.addEventListener("click", runPerf);
    el.genRun.addEventListener("click", generateImage);

    el.testClear.addEventListener("click", () => {
      pushUndo("test", el.testCanvas);
      clearCanvas(el.testCanvas);
      el.answer.className = "answer-box";
      el.answer.innerHTML = '<p class="muted">Zeichne los – ich verrate dir, was ich sehe.</p>';
      el.probs.innerHTML = "";
    });
    el.testSize.addEventListener("input", () => {
      testCtx.lineWidth = parseInt(el.testSize.value, 10);
    });

    el.trainBtn.addEventListener("click", () => {
      const epochs = Math.max(1, parseInt(el.epochs.value, 10) || 120);
      el.epochs.value = epochs;
      el.progress.style.width = "0%";
      train(epochs);
    });

    el.selfTestBtn.addEventListener("click", selfTest);
    el.saveBtn.addEventListener("click", saveToFile);
    el.loadBtn.addEventListener("click", () => el.loadFile.click());
    el.loadFile.addEventListener("change", (e) => {
      if (e.target.files[0]) loadFromFile(e.target.files[0]);
      e.target.value = "";
    });

    window.addEventListener("resize", drawChart);
  }

  return {
    init,
    reset,
    predict,
    canvasToVector,
    augment,
    generateImage,
    renderGenerated,
    renderTips,
    renderConsequence,
    renderProjects,
    projects,
    get net() { return state.net; },
    get state() { return state; },
  };
};
