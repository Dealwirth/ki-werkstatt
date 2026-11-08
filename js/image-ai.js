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

  const GRID = 16;              // 16x16 = 256 Eingabewerte
  const FEATURES = GRID * GRID;
  const COLORS = [
    "#4d96ff", "#6bcb77", "#ff9f45", "#c780fa",
    "#ff6b6b", "#00b8a9", "#f5b700", "#f6a6ff",
  ];

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
    augTargetCtx.rotate(((random() - 0.5) * 24 * Math.PI) / 180); // ±12 Grad
    const scale = 0.88 + random() * 0.24;                          // 0.88 .. 1.12
    augTargetCtx.scale(scale, scale);
    augTargetCtx.translate(
      -GRID / 2 + (random() - 0.5) * 3,
      -GRID / 2 + (random() - 0.5) * 3
    );
    augTargetCtx.drawImage(augSource, 0, 0);

    // Zurueck in Zahlen verwandeln
    const out = augTargetCtx.getImageData(0, 0, GRID, GRID).data;
    const result = new Float64Array(FEATURES);
    for (let i = 0; i < FEATURES; i++) {
      let v = out[i * 4 + 3] / 255;
      // Ein bisschen Rauschen, damit die KI robust bleibt
      v += (random() - 0.5) * 0.06;
      result[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Netz
  // ---------------------------------------------------------------------------

  function buildNet(seed = 42) {
    const outSize = Math.max(state.categories.length, 2);
    state.net = new NN.NeuralNet(seed, [
      { size: FEATURES },
      { size: 64, act: "relu" },
      { size: 32, act: "relu" },
      { size: outSize, act: "softmax" },
    ]);
    state.trained = false;
    state.lastAccuracy = null;
  }

  // ---------------------------------------------------------------------------
  // Oberflaeche
  // ---------------------------------------------------------------------------

  function colorFor(i) {
    return COLORS[i % COLORS.length];
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
    if (state.categories.length >= 4) {
      UI.toast("Bleib bei höchstens 4 Sachen – sonst wird's zu schwer.", "warn");
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
    updateStats();
    refreshGlobal();
    persist();
    clearCanvas(el.drawCanvas);

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

    let lastLoss = 0;
    for (let i = 0; i < epochs; i++) {
      // Bei jeder Runde jedes Bild neu verwackeln -> unendlich viele Varianten
      const data = state.examples.map((ex) => ({
        input: augment(ex.data, random),
        target: NN.oneHot(ex.label, Math.max(state.categories.length, 2)),
      }));
      lastLoss = state.net.trainEpoch(data, {
        lr: 0.02,
        batchSize: Math.min(8, data.length),
      });

      if (i % 3 === 0 || i === epochs - 1) {
        el.progress.style.width = (((i + 1) / epochs) * 100).toFixed(1) + "%";
        setStatus(`Runde ${i + 1}/${epochs} – Fehler: ${lastLoss.toFixed(3)}`);
        drawChart();
        if (onProgress) onProgress(i + 1, epochs);
        await UI.sleep(0);
      }
    }

    el.progress.style.width = "100%";
    state.trained = true;
    state.busy = false;
    el.trainBtn.disabled = false;
    setStatus(`Fertig! Fehler am Ende: ${lastLoss.toFixed(3)}.`);
    updateStats();
    persist();

    if (lastLoss < 0.15) {
      window.KI?.unlockBadge("image_low_loss");
      UI.confetti(70);
      UI.toast("Jetzt erkenne ich deine Zeichnungen! 🎉", "success");
    } else {
      UI.toast("Ich habe gelernt – teste mich und gib mir mehr Beispiele.", "info");
    }
    return true;
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

  function setupCanvas(canvas, which) {
    const ctx = canvas.getContext("2d");
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#262b3d";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const pos = (e) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * canvas.width,
        y: ((e.clientY - rect.top) / rect.height) * canvas.height,
      };
    };

    const start = (e) => {
      e.preventDefault();
      drawing = true;
      currentTarget = which;
      lastPos = pos(e);
      // Wichtig: Der Finger "gehoert" jetzt der Leinwand. So bricht der Strich
      // nicht ab, wenn man beim Malen ueber den Rand hinauskommt.
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (err) {
        /* aeltere Browser - dann eben ohne */
      }
      // Ein einzelner Punkt soll auch sichtbar sein
      ctx.beginPath();
      ctx.arc(lastPos.x, lastPos.y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = "#262b3d";
      ctx.fill();
    };

    const move = (e) => {
      if (!drawing || currentTarget !== which) return;
      e.preventDefault();
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(lastPos.x, lastPos.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      lastPos = p;
    };

    const end = (e) => {
      if (!drawing || currentTarget !== which) return;
      e.preventDefault();
      drawing = false;
      currentTarget = null;
      lastPos = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (err) {
        /* egal */
      }
      if (which === "test") {
        showPrediction(canvasToVector(canvas));
      }
    };

    canvas.addEventListener("pointerdown", start);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    return ctx;
  }

  function clearCanvas(canvas) {
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // ---------------------------------------------------------------------------
  // Speichern & Laden
  // ---------------------------------------------------------------------------

  function persist() {
    UI.save("image", {
      categories: state.categories,
      examples: state.examples.map((ex) => ({
        label: ex.label,
        data: Array.from(ex.data),
      })),
      trained: state.trained,
      lastAccuracy: state.lastAccuracy,
      net: state.net && state.trained ? state.net.toCompact() : null,
    });
  }

  function restore() {
    const data = UI.load("image");
    if (!data) {
      buildNet();
      return;
    }
    state.categories = data.categories || [];
    state.examples = (data.examples || []).map((ex) => ({
      label: ex.label,
      data: Float64Array.from(ex.data),
    }));
    state.lastAccuracy = data.lastAccuracy ?? null;
    if (data.net) {
      try {
        state.net = NN.NeuralNet.fromCompact(data.net);
        state.trained = !!data.trained;
      } catch (e) {
        buildNet();
      }
    } else {
      buildNet();
    }
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
    UI.remove("image");
  }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------

  function init() {
    el = {
      categories: document.getElementById("image-categories"),
      categoryInput: document.getElementById("image-category-input"),
      addCategory: document.getElementById("image-add-category"),
      drawCanvas: document.getElementById("draw-canvas"),
      drawCategory: document.getElementById("draw-category"),
      drawSave: document.getElementById("draw-save"),
      drawClear: document.getElementById("draw-clear"),
      drawSize: document.getElementById("draw-size"),
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
    updateStats();
    drawChart();

    drawCtx = setupCanvas(el.drawCanvas, "draw");
    testCtx = setupCanvas(el.testCanvas, "test");
    clearCanvas(el.drawCanvas);
    clearCanvas(el.testCanvas);
    drawCtx.lineWidth = parseInt(el.drawSize.value, 10);
    testCtx.lineWidth = parseInt(el.testSize.value, 10);

    el.addCategory.addEventListener("click", () => {
      addCategory(el.categoryInput.value);
      el.categoryInput.value = "";
      el.categoryInput.focus();
    });
    el.categoryInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") el.addCategory.click();
    });

    el.drawSave.addEventListener("click", saveDrawing);
    el.drawClear.addEventListener("click", () => clearCanvas(el.drawCanvas));
    el.drawSize.addEventListener("input", () => {
      drawCtx.lineWidth = parseInt(el.drawSize.value, 10);
    });

    el.testClear.addEventListener("click", () => {
      clearCanvas(el.testCanvas);
      el.answer.className = "answer-box";
      el.answer.innerHTML = '<p class="muted">Zeichne los – ich verrate dir, was ich sehe.</p>';
      el.probs.innerHTML = "";
    });
    el.testSize.addEventListener("input", () => {
      testCtx.lineWidth = parseInt(el.testSize.value, 10);
    });

    el.trainBtn.addEventListener("click", () => {
      const epochs = Math.max(10, Math.min(3000, parseInt(el.epochs.value, 10) || 120));
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
    get net() { return state.net; },
    get state() { return state; },
  };
};
