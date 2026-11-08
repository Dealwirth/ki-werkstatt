/*
 * text-ai.js - Die Woerter-KI.
 *
 * Aufgabe: Ein Wort soll in die richtige "Schublade" (Kategorie) gelegt werden.
 *
 * Wie "sieht" die KI ein Wort? Sie kann nicht lesen wie wir. Sie hat kein
 * Woerterbuch und weiss nicht, dass ein Apfel eine Frucht ist. Sie sieht nur
 * Buchstaben! Deshalb verwandeln wir jedes Wort in einen "Fingerabdruck" aus
 * Zahlen. Wir schauen uns an:
 *   - Welche einzelnen Buchstaben kommen vor?     ("apfel" -> a, p, f, e, l)
 *   - Welche Buchstabenpaare?                     ("ap", "pf", "fe", "el")
 *   - Welche Buchstabendrillinge?                 ("apf", "pfe", "fel")
 *   - Welche Vierergruppen?                       ("apfe", "pfel")
 *   - Anfang, Ende und Laenge des Wortes
 *
 * WICHTIG fuer Lehrerinnen und Lehrer: Diese KI lernt Muster in Buchstaben,
 * keine Bedeutungen. "Woerter mit SCH" kann sie perfekt lernen (fast 100%).
 * "Obst gegen Tiere" kann sie NICHT gut lernen, weil Apfel und Birne sich als
 * Buchstabenfolge nicht aehnlicher sind als Apfel und Hund. Das ist eine
 * ehrliche und wertvolle Lektion darueber, was eine KI wirklich "sieht".
 */

const createTextAI = () => {
  "use strict";

  // Verwaltet mehrere Woerter-KIs. Jede hat ihren eigenen Fortschritt.
  const projects = createProjects("text", {
    defaultName: "Meine erste Wörter-KI",
    onSwitch: () => {
      if (el.projectBar) {
        renderProjects();
        applySnapshot(projects.loadActive());
      }
    },
  });

  // Der Fingerabdruck hat 1024 Zahlen. Je groesser, desto weniger
  // Buchstabenkombinationen "kollidieren" (sich denselben Platz teilen).
  const FEATURES = 1024;
  const COLORS = [
    "#4d96ff", "#6bcb77", "#ff9f45", "#c780fa",
    "#ff6b6b", "#00b8a9", "#f6a6ff", "#f5b700",
  ];

  const state = {
    categories: [],
    examples: [],     // [{word, catIndex}]
    net: null,
    trained: false,
    busy: false,
    lastAccuracy: null,
  };

  let el = {};

  // ---------------------------------------------------------------------------
  // Wort -> Fingerabdruck (Zahlenvektor)
  // ---------------------------------------------------------------------------

  function wordToVector(word) {
    const clean = word.toLowerCase().replace(/[^a-zäöüß]/g, "");
    const vec = new Float64Array(FEATURES);

    // Jede Buchstabenfolge bekommt einen festen Platz im Fingerabdruck.
    const add = (token, weight) => {
      const idx = NN.hashString(token) % FEATURES;
      vec[idx] += weight;
    };

    for (const ch of clean) add("1:" + ch, 1);
    for (let i = 0; i < clean.length - 1; i++) add("2:" + clean.slice(i, i + 2), 1.5);
    for (let i = 0; i < clean.length - 2; i++) add("3:" + clean.slice(i, i + 3), 2);
    for (let i = 0; i < clean.length - 3; i++) add("4:" + clean.slice(i, i + 4), 1.5);

    // Anfang und Ende sind besonders wichtig
    add("start2:" + clean.slice(0, 2), 2);
    add("start3:" + clean.slice(0, 3), 2);
    add("end2:" + clean.slice(-2), 3);
    add("end3:" + clean.slice(-3), 2);

    // Laenge in drei Stufen
    const len = clean.length;
    add("len:" + (len <= 4 ? "kurz" : len <= 8 ? "mittel" : "lang"), 2);

    // Auf Laenge 1 bringen, damit lange Woerter nicht alles uebertoenen.
    let norm = 0;
    for (let i = 0; i < FEATURES; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < FEATURES; i++) vec[i] /= norm;

    return vec;
  }

  // ---------------------------------------------------------------------------
  // Netz aufbauen
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

  function datasetFrom(examples) {
    return examples.map((ex) => ({
      input: wordToVector(ex.word),
      target: NN.oneHot(ex.catIndex, Math.max(state.categories.length, 2)),
    }));
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
        '<p class="empty-note">Noch keine Schublade. Baue zuerst eine!</p>';
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
    el.wordCategory.innerHTML = options || '<option value="">– keine –</option>';
    el.wordCategory.disabled = state.categories.length === 0;
    el.addExample.disabled = state.categories.length === 0;
  }

  function renderExamples() {
    el.examples.innerHTML = "";
    if (state.examples.length === 0) {
      el.examples.innerHTML =
        '<p class="empty-note">Noch keine Beispiele. Zeige mir Wörter!</p>';
      return;
    }
    state.examples
      .slice()
      .reverse()
      .forEach((ex) => {
        const cat = state.categories[ex.catIndex];
        const item = document.createElement("div");
        item.className = "example-item";
        item.innerHTML = `
          <span class="ex-word">${UI.escapeHtml(ex.word)}</span>
          <span class="ex-tag" style="background:${cat ? cat.color : "#999"}">
            ${UI.escapeHtml(cat ? cat.name : "?")}
          </span>
          <button title="Entfernen">🗑</button>
        `;
        item.querySelector("button").addEventListener("click", () => {
          state.examples.splice(state.examples.indexOf(ex), 1);
          state.trained = false;
          renderExamples();
          updateStats();
          updateGlobalSamples();
          persist();
        });
        el.examples.appendChild(item);
      });
  }

  function updateStats() {
    el.statExamples.textContent = state.examples.length;
    el.statRounds.textContent = state.net ? state.net.trainingSteps : 0;
    el.statAcc.textContent =
      state.lastAccuracy === null ? "–" : Math.round(state.lastAccuracy * 100) + "%";
  }

  function updateGlobalSamples() {
    if (window.KI && window.KI.refreshGlobalCount) window.KI.refreshGlobalCount();
  }

  function setStatus(text) {
    el.status.textContent = text;
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
    if (state.categories.length >= 8) {
      UI.toast("Mehr als 8 Schubladen werden zu verwirrend.", "warn");
      return;
    }
    if (state.categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      UI.toast("Diese Schublade gibt es schon.", "warn");
      return;
    }
    state.categories.push({ name: trimmed, color: colorFor(state.categories.length) });
    buildNet();
    renderCategories();
    persist();
    UI.toast(`Schublade „${trimmed}" gebaut!`, "success");
    if (state.categories.length === 2) window.KI?.unlockBadge("two_categories");
  }

  function removeCategory(index) {
    state.categories.splice(index, 1);
    state.examples = state.examples
      .filter((ex) => ex.catIndex !== index)
      .map((ex) => ({
        ...ex,
        catIndex: ex.catIndex > index ? ex.catIndex - 1 : ex.catIndex,
      }));
    buildNet();
    renderCategories();
    renderExamples();
    updateStats();
    drawChart();
    persist();
  }

  function addExample() {
    const word = el.wordInput.value.trim();
    if (!word) {
      UI.toast("Bitte schreibe ein Wort.", "warn");
      return;
    }
    const catIndex = parseInt(el.wordCategory.value, 10);
    if (isNaN(catIndex) || !state.categories[catIndex]) {
      UI.toast("Bitte wähle eine Schublade.", "warn");
      return;
    }

    const existing = state.examples.find(
      (ex) => ex.word.toLowerCase() === word.toLowerCase()
    );
    if (existing && existing.catIndex !== catIndex) {
      UI.toast(
        `„${word}" liegt schon in „${state.categories[existing.catIndex].name}". ` +
          "Ein Wort kann nur in einer Schublade sein.",
        "warn"
      );
      return;
    }
    if (existing) {
      UI.toast(`„${word}" kenne ich schon.`, "warn");
      return;
    }

    state.examples.push({ word, catIndex });
    state.trained = false;
    el.wordInput.value = "";
    el.wordInput.focus();
    renderExamples();
    updateStats();
    updateGlobalSamples();
    persist();

    if (state.examples.length === 10) window.KI?.unlockBadge("ten_examples");
    UI.toast(`„${word}" gelernt!`, "success");
  }

  // Fertige, gut lernbare Beispiele. Die KI sieht nur Buchstaben - deshalb
  // funktionieren Muster viel besser als Bedeutungen.
  const PRESETS = {
    sch: {
      label: "mit SCH",
      label2: "ohne SCH",
      // Wichtig: "sch" steht an verschiedenen Stellen (Anfang, Mitte, Ende).
      // So lernt die KI "enthält sch" und nicht nur "beginnt mit sch".
      a: ["schule", "schuh", "schaf", "fisch", "tisch", "wäsche", "tasche", "flasche", "wunsch", "frosch", "schlüssel", "schwester", "schiff", "dusche"],
      b: ["haus", "baum", "buch", "hand", "sonne", "mond", "regen", "blume", "katze", "hund", "garten", "blatt", "wolke", "stern"],
    },
    ei: {
      label: "Wörter mit IE",
      label2: "Wörter mit EI",
      a: ["bier", "sieb", "lieb", "spiel", "ziel", "miete", "biene", "dieb", "fliege", "sieg", "kiefer", "wiese", "brief", "hier"],
      b: ["eis", "bein", "wein", "stein", "klein", "zeit", "seife", "reise", "meile", "geist", "heizung", "leiter", "brei", "peil"],
    },
    kurz: {
      label: "kurze Wörter",
      label2: "lange Wörter",
      a: ["hund", "haus", "baum", "buch", "maus", "hand", "ball", "tür", "bett", "fuß", "eis", "arm", "ohr", "tag"],
      b: ["sonnenblume", "wasserflasche", "regenschirm", "schmetterling", "krankenhaus", "freundschaft", "kühlschrank", "bibliothek", "taschenlampe", "schokolade", "himmelblau", "sportverein", "erdbeermarmelade", "waldspaziergang"],
    },
    er: {
      label: "endet auf -ER",
      label2: "endet auf -EN",
      a: ["teller", "fenster", "zimmer", "wasser", "vater", "butter", "zucker", "feder", "leiter", "keller", "hammer", "bäcker", "koffer", "tiger"],
      b: ["garten", "blumen", "malen", "laufen", "singen", "kochen", "lesen", "fahren", "bäume", "steine", "binden", "sagen", "hören", "spielen"],
    },
  };

  /** Fuellt ein gut lernbares Beispiel-Paar ein. */
  function fillExample(presetKey) {
    const p = PRESETS[presetKey] || PRESETS.sch;
    state.categories = [
      { name: p.label, color: colorFor(0) },
      { name: p.label2 || "andere", color: colorFor(1) },
    ];
    state.examples = [
      ...p.a.map((w) => ({ word: w, catIndex: 0 })),
      ...p.b.map((w) => ({ word: w, catIndex: 1 })),
    ];
    state.trained = false;
    buildNet();
    renderCategories();
    renderExamples();
    updateStats();
    updateGlobalSamples();
    drawChart();
    persist();
    if (state.examples.length >= 10) window.KI?.unlockBadge("ten_examples");
    window.KI?.unlockBadge("two_categories");
    UI.toast(`Beispiel eingefüllt: ${p.label}. Jetzt „Lernen lassen" klicken!`, "info");
  }

  async function train(epochs, onProgress) {
    if (state.categories.length < 2) {
      UI.toast("Ich brauche mindestens 2 Schubladen!", "warn");
      return false;
    }
    if (state.examples.length < 4) {
      UI.toast("Ich brauche mindestens 4 Beispiele zum Lernen.", "warn");
      return false;
    }
    const used = new Set(state.examples.map((e) => e.catIndex));
    const empty = state.categories.filter((_, i) => !used.has(i));
    if (empty.length > 0) {
      UI.toast(
        `Die Schublade „${empty[0].name}" ist noch leer. Zeige mir Beispiele dafür!`,
        "warn"
      );
      return false;
    }

    state.busy = true;
    el.trainBtn.disabled = true;
    const data = datasetFrom(state.examples);
    const lr = 0.01;
    const batchSize = Math.min(8, data.length);

    let lastLoss = 0;
    for (let i = 0; i < epochs; i++) {
      lastLoss = state.net.trainEpoch(data, { lr, batchSize });
      if (i % 5 === 0 || i === epochs - 1) {
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
    setStatus(`Fertig! Fehler am Ende: ${lastLoss.toFixed(3)} (kleiner = besser).`);
    updateStats();
    persist();

    if (lastLoss < 0.1) {
      window.KI?.unlockBadge("low_loss");
      UI.confetti(70);
      UI.toast("Super! Ich habe das Muster gefunden! 🎉", "success");
    } else {
      UI.toast("Ich habe gelernt – aber ich bin noch nicht sicher.", "info");
    }
    return true;
  }

  function predict(word) {
    if (!state.net || !state.trained) return null;
    const probs = state.net.predict(wordToVector(word));
    const rows = state.categories.map((cat, i) => ({
      label: cat.name,
      value: probs[i] ?? 0,
      color: cat.color,
    }));
    const best = rows.reduce((a, b) => (b.value > a.value ? b : a));
    return { rows, best, raw: probs };
  }

  function showPrediction(word) {
    const result = predict(word);
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
      comment = "Da bin ich mir ziemlich sicher!";
    } else if (pct < 40) {
      cls = "wrong";
      comment = "Hmm, ich rate eher. Zeig mir mehr Beispiele!";
    }

    el.answer.className = "answer-box " + cls;
    el.answer.innerHTML = `
      <p class="answer-big">„${UI.escapeHtml(word)}" → ${UI.escapeHtml(result.best.label)}</p>
      <p class="answer-sub">${comment} (${pct}% sicher)</p>
    `;
    UI.renderProbabilities(el.probs, result.rows);
  }

  async function selfTest() {
    if (state.examples.length < 8) {
      UI.toast("Für einen Selbst-Test brauche ich mindestens 8 Beispiele.", "warn");
      return;
    }
    const random = NN.makeRandom(1234);
    const { train: trainSet, test: testSet } = NN.trainTestSplit(state.examples, 0.25, random);

    const used = new Set(trainSet.map((e) => e.catIndex));
    if (used.size < state.categories.length) {
      UI.toast("Für einen fairen Test brauche ich mehr Beispiele pro Schublade.", "warn");
      return;
    }

    el.selfTestBtn.disabled = true;
    UI.toast("Ich teste mich selbst…", "info");

    const savedNet = state.net;
    const savedTrained = state.trained;
    buildNet(999);
    const data = datasetFrom(trainSet);
    for (let i = 0; i < 600; i++) {
      state.net.trainEpoch(data, { lr: 0.01, batchSize: Math.min(8, data.length) });
      if (i % 40 === 0) await UI.sleep(0);
    }

    let correct = 0;
    for (const ex of testSet) {
      const probs = state.net.predict(wordToVector(ex.word));
      let bestIdx = 0;
      for (let i = 1; i < probs.length; i++) if (probs[i] > probs[bestIdx]) bestIdx = i;
      if (bestIdx === ex.catIndex) correct++;
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
      `Selbst-Test: ${correct} von ${testSet.length} neuen Wörtern richtig (${pct}%).`,
      accuracy >= 0.7 ? "success" : "info"
    );

    el.answer.className = "answer-box " + (accuracy >= 0.7 ? "correct" : "unsure");
    el.answer.innerHTML = `
      <p class="answer-big">🧪 Selbst-Test: ${pct}%</p>
      <p class="answer-sub">
        Ich habe ${testSet.length} Wörter nie gesehen und ${correct} davon richtig sortiert.
        ${accuracy >= 0.7 ? "Das ist echtes Gelerntes, kein Auswendiglernen!" : "Gib mir mehr Beispiele!"}
      </p>
    `;

    if (accuracy >= 0.7) window.KI?.unlockBadge("self_test");
  }

  // ---------------------------------------------------------------------------
  // Speichern & Laden
  // ---------------------------------------------------------------------------

  function persist() {
    // Erst in die Projektliste, dann in den Projekt-Speicher
    projects.saveActive(snapshot());
  }

  /** Alles, was zum Fortschritt dieser KI gehoert. */
  function snapshot() {
    return {
      categories: state.categories,
      examples: state.examples,
      trained: state.trained,
      lastAccuracy: state.lastAccuracy,
      net: state.net && state.trained ? state.net.toCompact() : null,
    };
  }

  function applySnapshot(data) {
    state.categories = (data && data.categories) || [];
    state.examples = (data && data.examples) || [];
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
    renderExamples();
    updateStats();
    updateGlobalSamples();
    drawChart();
    if (state.trained && state.lastAccuracy !== null) {
      setStatus(`Trainiert! Sicherheit ${Math.round(state.lastAccuracy * 100)}%`);
    } else {
      setStatus("Noch nicht trainiert.");
    }
    el.answer.className = "answer-box";
    el.answer.innerHTML = '<p class="muted">Noch keine Antwort. Stell mir eine Frage!</p>';
    el.probs.innerHTML = "";
  }

  /** Baut die Projekt-Leiste neu auf. */
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
        const name = prompt("Wie soll die neue Wörter-KI heißen?", "Meine Wörter-KI");
        if (name === null) return;
        const p = projects.create(name, true);
        if (p) UI.toast(`„${p.name}" ist fertig. Bring ihr jetzt Wörter bei!`, "success");
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
    UI.downloadJSON("woerter-ki.json", {
      art: "woerter-ki",
      version: 1,
      categories: state.categories,
      examples: state.examples,
      trained: state.trained,
      lastAccuracy: state.lastAccuracy,
      net: state.net.toCompact(),
    });
    UI.toast("KI gespeichert! Du kannst die Datei weitergeben. 💾", "success");
    window.KI?.unlockBadge("saved");
  }

  function loadFromFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.art !== "woerter-ki") throw new Error("Falsche Datei");
        state.categories = data.categories || [];
        state.examples = data.examples || [];
        state.net = NN.NeuralNet.fromCompact(data.net);
        state.trained = !!data.trained;
        state.lastAccuracy = data.lastAccuracy ?? null;
        renderCategories();
        renderExamples();
        updateStats();
        drawChart();
        updateGlobalSamples();
        persist();
        UI.toast("KI geladen! Sie erinnert sich an alles. 📂", "success");
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
    renderExamples();
    updateStats();
    drawChart();
    setStatus("Noch nicht trainiert.");
    el.progress.style.width = "0%";
    el.answer.className = "answer-box";
    el.answer.innerHTML = '<p class="muted">Noch keine Antwort. Stell mir eine Frage!</p>';
    el.probs.innerHTML = "";
    persist();
    updateGlobalSamples();
  }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------

  function init() {
    el = {
      projectBar: document.getElementById("text-projects"),
      categories: document.getElementById("text-categories"),
      categoryInput: document.getElementById("text-category-input"),
      addCategory: document.getElementById("text-add-category"),
      wordInput: document.getElementById("text-word-input"),
      wordCategory: document.getElementById("text-word-category"),
      addExample: document.getElementById("text-add-example"),
      examples: document.getElementById("text-examples"),
      trainBtn: document.getElementById("text-train"),
      epochs: document.getElementById("text-epochs"),
      progress: document.getElementById("text-progress"),
      status: document.getElementById("text-status"),
      lossChart: document.getElementById("text-loss-chart"),
      testInput: document.getElementById("text-test-input"),
      testBtn: document.getElementById("text-test-btn"),
      answer: document.getElementById("text-answer"),
      probs: document.getElementById("text-probs"),
      statExamples: document.getElementById("text-stat-examples"),
      statRounds: document.getElementById("text-stat-rounds"),
      statAcc: document.getElementById("text-stat-acc"),
      selfTestBtn: document.getElementById("text-self-test"),
      saveBtn: document.getElementById("text-save"),
      loadBtn: document.getElementById("text-load"),
      loadFile: document.getElementById("text-load-file"),
    };

    restore();
    renderCategories();
    renderExamples();
    updateStats();
    drawChart();

    el.addCategory.addEventListener("click", () => {
      addCategory(el.categoryInput.value);
      el.categoryInput.value = "";
      el.categoryInput.focus();
    });
    el.categoryInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") el.addCategory.click();
    });

    el.addExample.addEventListener("click", addExample);
    el.wordInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addExample();
    });

    document.querySelectorAll("[data-preset]").forEach((btn) => {
      btn.addEventListener("click", () => fillExample(btn.dataset.preset));
    });

    el.trainBtn.addEventListener("click", () => {
      const epochs = Math.max(10, Math.min(5000, parseInt(el.epochs.value, 10) || 600));
      el.epochs.value = epochs;
      el.progress.style.width = "0%";
      train(epochs);
    });

    el.testBtn.addEventListener("click", () => {
      const word = el.testInput.value.trim();
      if (!word) {
        UI.toast("Schreibe ein Wort zum Testen.", "warn");
        return;
      }
      showPrediction(word);
    });
    el.testInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") el.testBtn.click();
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
    renderProjects,
    projects,
    get net() { return state.net; },
    get state() { return state; },
  };
};
