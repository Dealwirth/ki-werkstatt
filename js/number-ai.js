/*
 * number-ai.js - Die Zahlen-KI.
 *
 * Aufgabe: Eine geheime Regel finden. Du zeigst Paare wie "3 -> 7" und "5 -> 11".
 * Die KI weiss nicht, dass die Regel "x mal 2 plus 1" heisst. Sie probiert einfach
 * so lange herum, bis ihre Vorhersagen zu deinen Beispielen passen.
 *
 * Damit das gut funktioniert, rechnen wir alle Zahlen auf einen kleinen Bereich
 * zwischen -1 und 1 um. Grosse Zahlen wuerden das Lernen sonst durcheinanderbringen.
 */

const createNumberAI = () => {
  "use strict";

  // Verwaltet mehrere Zahlen-KIs. Jede hat ihren eigenen Fortschritt.
  const projects = createProjects("number", {
    defaultName: "Meine erste Zahlen-KI",
    onSwitch: () => {
      if (el.projectBar) {
        renderProjects();
        applySnapshot(projects.loadActive());
      }
    },
  });

  const state = {
    examples: [],     // [{x, y}]
    net: null,
    trained: false,
    busy: false,
    // Bereich, auf den wir die Zahlen umrechnen
    xMin: -1, xMax: 1,
    yMin: -1, yMax: 1,
  };

  let el = {};

  // ---------------------------------------------------------------------------
  // Zahlen umrechnen (Normalisierung)
  // ---------------------------------------------------------------------------

  function computeRanges() {
    if (state.examples.length === 0) {
      state.xMin = -1; state.xMax = 1;
      state.yMin = -1; state.yMax = 1;
      return;
    }
    const xs = state.examples.map((e) => e.x);
    const ys = state.examples.map((e) => e.y);
    state.xMin = Math.min(...xs);
    state.xMax = Math.max(...xs);
    state.yMin = Math.min(...ys);
    state.yMax = Math.max(...ys);
    // Etwas Luft lassen, damit neue Zahlen nicht "ausserhalb" liegen.
    if (state.xMax - state.xMin < 1e-6) { state.xMin -= 1; state.xMax += 1; }
    if (state.yMax - state.yMin < 1e-6) { state.yMin -= 1; state.yMax += 1; }
  }

  function normX(x) {
    const span = state.xMax - state.xMin || 1;
    return ((x - state.xMin) / span) * 2 - 1;
  }

  function normY(y) {
    const span = state.yMax - state.yMin || 1;
    return ((y - state.yMin) / span) * 2 - 1;
  }

  function denormY(v) {
    const span = state.yMax - state.yMin || 1;
    return ((v + 1) / 2) * span + state.yMin;
  }

  // ---------------------------------------------------------------------------
  // Netz
  // ---------------------------------------------------------------------------

  function buildNet(seed = 42) {
    state.net = new NN.NeuralNet(seed, [
      { size: 1 },
      { size: 24, act: "tanh" },
      { size: 24, act: "tanh" },
      { size: 1, act: "linear" },
    ]);
    state.trained = false;
  }

  function dataset() {
    return state.examples.map((e) => ({
      input: [normX(e.x)],
      target: [normY(e.y)],
    }));
  }

  // ---------------------------------------------------------------------------
  // Oberflaeche
  // ---------------------------------------------------------------------------

  function renderExamples() {
    el.examples.innerHTML = "";
    if (state.examples.length === 0) {
      el.examples.innerHTML =
        '<p class="empty-note">Noch keine Beispiele. Zeige mir Zahlen!</p>';
      return;
    }
    state.examples
      .slice()
      .reverse()
      .forEach((ex) => {
        const item = document.createElement("div");
        item.className = "example-item";
        item.innerHTML = `
          <span class="ex-word">${ex.x} → ${ex.y}</span>
          <span class="ex-tag" style="background:#4d96ff">Beispiel</span>
          <button title="Entfernen">🗑</button>
        `;
        item.querySelector("button").addEventListener("click", () => {
          const idx = state.examples.indexOf(ex);
          state.examples.splice(idx, 1);
          state.trained = false;
          computeRanges();
          renderExamples();
          updateStats();
          refreshGlobal();
          drawPlot();
          persist();
        });
        el.examples.appendChild(item);
      });
  }

  function updateStats() {
    el.statExamples.textContent = state.examples.length;
    el.statRounds.textContent = state.net ? state.net.trainingSteps : 0;

    if (!state.trained || state.examples.length === 0) {
      el.statErr.textContent = "–";
      return;
    }
    let err = 0;
    for (const ex of state.examples) {
      const p = denormY(state.net.predict([normX(ex.x)])[0]);
      err += Math.abs(p - ex.y);
    }
    el.statErr.textContent = (err / state.examples.length).toFixed(2);
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

  /** Zeichnet die Beispiele (blau) und die gelernte Regel (rot) als Kurve. */
  function drawPlot() {
    const canvas = el.plot;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 300;
    const h = canvas.clientHeight || 220;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = "#f6f7fb";
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(0, 0, w, h, 12) : ctx.rect(0, 0, w, h);
    ctx.fill();

    const pad = 30;
    const toPx = (x, y) => {
      const spanX = state.xMax - state.xMin || 1;
      const spanY = state.yMax - state.yMin || 1;
      return [
        pad + ((x - state.xMin) / spanX) * (w - 2 * pad),
        h - pad - ((y - state.yMin) / spanY) * (h - 2 * pad),
      ];
    };

    // Achsen
    ctx.strokeStyle = "#dfe3f0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, h - pad);
    ctx.lineTo(w - pad, h - pad);
    ctx.moveTo(pad, pad);
    ctx.lineTo(pad, h - pad);
    ctx.stroke();

    if (state.examples.length === 0) {
      ctx.fillStyle = "#9aa0b4";
      ctx.font = "13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Zeige mir Beispiele, dann sehe ich hier die Regel.", w / 2, h / 2);
      return;
    }

    // Gelernte Regel als Kurve
    if (state.trained && state.net) {
      ctx.beginPath();
      const steps = 80;
      for (let i = 0; i <= steps; i++) {
        const x = state.xMin + ((state.xMax - state.xMin) * i) / steps;
        const y = denormY(state.net.predict([normX(x)])[0]);
        const [px, py] = toPx(x, y);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.strokeStyle = "#ff6b6b";
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Beispiele als Punkte
    ctx.fillStyle = "#4d96ff";
    for (const ex of state.examples) {
      const [px, py] = toPx(ex.x, ex.y);
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // ---------------------------------------------------------------------------
  // Aktionen
  // ---------------------------------------------------------------------------

  function addExample(xStr, yStr) {
    const x = parseFloat(xStr);
    const y = parseFloat(yStr);
    if (isNaN(x) || isNaN(y)) {
      UI.toast("Bitte gib zwei Zahlen ein.", "warn");
      return;
    }
    if (state.examples.some((e) => Math.abs(e.x - x) < 1e-9)) {
      UI.toast(`Für ${x} habe ich schon ein Beispiel.`, "warn");
      return;
    }
    state.examples.push({ x, y });
    state.trained = false;
    computeRanges();
    renderExamples();
    updateStats();
    refreshGlobal();
    drawPlot();
    persist();

    const count = state.examples.length;
    if (count === 10) window.KI?.unlockBadge("number_ten");
    UI.toast(`Gemerkt: ${x} → ${y}`, "success");
  }

  function autofill() {
    // Fuer den schnellen Start: die Regel x mal 2 plus 1.
    // Wir nehmen einen breiten Bereich, damit man viele Zahlen testen kann.
    const vals = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
    state.examples = vals.map((x) => ({ x, y: x * 2 + 1 }));
    state.trained = false;
    computeRanges();
    renderExamples();
    updateStats();
    refreshGlobal();
    drawPlot();
    persist();
    UI.toast("Beispiel-Regel eingefüllt: x → x·2+1", "info");
  }

  async function train(epochs, onProgress) {
    if (state.examples.length < 3) {
      UI.toast("Ich brauche mindestens 3 Beispiele.", "warn");
      return false;
    }
    state.busy = true;
    el.trainBtn.disabled = true;
    const data = dataset();
    const lr = 0.01;
    const batchSize = Math.min(16, data.length);

    let lastLoss = 0;
    for (let i = 0; i < epochs; i++) {
      lastLoss = state.net.trainEpoch(data, { lr, batchSize });
      if (i % 10 === 0 || i === epochs - 1) {
        el.progress.style.width = (((i + 1) / epochs) * 100).toFixed(1) + "%";
        setStatus(`Runde ${i + 1}/${epochs} – Fehler: ${lastLoss.toFixed(5)}`);
        drawChart();
        if (onProgress) onProgress(i + 1, epochs);
        await UI.sleep(0);
      }
    }

    el.progress.style.width = "100%";
    state.trained = true;
    state.busy = false;
    el.trainBtn.disabled = false;
    setStatus(`Fertig! Fehler am Ende: ${lastLoss.toFixed(5)} (kleiner = besser).`);
    updateStats();
    drawPlot();
    persist();

    if (lastLoss < 0.002) {
      window.KI?.unlockBadge("number_low_loss");
      UI.confetti(70);
      UI.toast("Ich habe deine Regel gefunden! 🎉", "success");
    } else {
      UI.toast("Ich habe gelernt – gib mir mehr Beispiele für Genauigkeit.", "info");
    }
    return true;
  }

  function showPrediction(xStr) {
    const x = parseFloat(xStr);
    if (isNaN(x)) {
      UI.toast("Bitte gib eine Zahl ein.", "warn");
      return;
    }
    if (!state.net || !state.trained) {
      el.answer.className = "answer-box";
      el.answer.innerHTML =
        '<p class="muted">Ich muss erst lernen! Klicke auf „Lernen lassen".</p>';
      return;
    }
    const y = denormY(state.net.predict([normX(x)])[0]);

    // Wie sicher ist die KI? Wir pruefen, ob sie im bekannten Bereich liegt.
    const inside = x >= state.xMin - 0.5 && x <= state.xMax + 0.5;
    el.answer.className = "answer-box " + (inside ? "correct" : "unsure");
    el.answer.innerHTML = `
      <p class="answer-big">${x} → ${y.toFixed(2)}</p>
      <p class="answer-sub">
        ${
          inside
            ? "Diese Zahl kenne ich aus meinen Beispielen."
            : "Achtung: Diese Zahl liegt außerhalb meiner Beispiele. Da bin ich unsicher!"
        }
      </p>
    `;
  }

  // ---------------------------------------------------------------------------
  // Speichern & Laden
  // ---------------------------------------------------------------------------

  function persist() {
    projects.saveActive(snapshot());
  }

  function snapshot() {
    return {
      examples: state.examples,
      trained: state.trained,
      ranges: {
        xMin: state.xMin, xMax: state.xMax,
        yMin: state.yMin, yMax: state.yMax,
      },
      net: state.net && state.trained ? state.net.toCompact() : null,
    };
  }

  function applySnapshot(data) {
    state.examples = (data && data.examples) || [];
    if (data && data.ranges) {
      state.xMin = data.ranges.xMin;
      state.xMax = data.ranges.xMax;
      state.yMin = data.ranges.yMin;
      state.yMax = data.ranges.yMax;
    } else {
      computeRanges();
    }
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
    renderExamples();
    updateStats();
    drawChart();
    drawPlot();
    refreshGlobal();
    if (state.trained) setStatus("Trainiert! Frag mich nach einer Zahl.");
    else setStatus("Noch nicht trainiert.");
    el.answer.className = "answer-box";
    el.answer.innerHTML = '<p class="muted">Noch keine Vorhersage.</p>';
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
        const name = prompt("Wie soll die neue Zahlen-KI heißen?", "Meine Zahlen-KI");
        if (name === null) return;
        const p = projects.create(name, true);
        if (p) UI.toast(`„${p.name}" ist fertig. Zeig ihr jetzt Zahlen!`, "success");
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
    UI.downloadJSON("zahlen-ki.json", {
      art: "zahlen-ki",
      version: 1,
      examples: state.examples,
      trained: state.trained,
      ranges: { xMin: state.xMin, xMax: state.xMax, yMin: state.yMin, yMax: state.yMax },
      net: state.net.toCompact(),
    });
    UI.toast("Zahlen-KI gespeichert! 💾", "success");
    window.KI?.unlockBadge("saved");
  }

  function loadFromFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.art !== "zahlen-ki") throw new Error("Falsche Datei");
        state.examples = data.examples || [];
        if (data.ranges) {
          state.xMin = data.ranges.xMin;
          state.xMax = data.ranges.xMax;
          state.yMin = data.ranges.yMin;
          state.yMax = data.ranges.yMax;
        }
        state.net = NN.NeuralNet.fromCompact(data.net);
        state.trained = !!data.trained;
        renderExamples();
        updateStats();
        drawChart();
        drawPlot();
        refreshGlobal();
        persist();
        UI.toast("Zahlen-KI geladen! 📂", "success");
      } catch (e) {
        UI.toast("Diese Datei konnte ich nicht lesen.", "error");
      }
    };
    reader.readAsText(file);
  }

  function reset() {
    state.examples = [];
    state.trained = false;
    buildNet();
    computeRanges();
    renderExamples();
    updateStats();
    drawChart();
    drawPlot();
    setStatus("Noch nicht trainiert.");
    el.progress.style.width = "0%";
    el.answer.className = "answer-box";
    el.answer.innerHTML = '<p class="muted">Noch keine Vorhersage.</p>';
    persist();
    refreshGlobal();
  }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------

  function init() {
    el = {
      projectBar: document.getElementById("number-projects"),
      in: document.getElementById("number-in"),
      out: document.getElementById("number-out"),
      add: document.getElementById("number-add"),
      autofill: document.getElementById("number-autofill"),
      examples: document.getElementById("number-examples"),
      trainBtn: document.getElementById("number-train"),
      epochs: document.getElementById("number-epochs"),
      progress: document.getElementById("number-progress"),
      status: document.getElementById("number-status"),
      lossChart: document.getElementById("number-loss-chart"),
      test: document.getElementById("number-test"),
      testBtn: document.getElementById("number-test-btn"),
      answer: document.getElementById("number-answer"),
      plot: document.getElementById("number-plot"),
      statExamples: document.getElementById("number-stat-examples"),
      statRounds: document.getElementById("number-stat-rounds"),
      statErr: document.getElementById("number-stat-err"),
      saveBtn: document.getElementById("number-save"),
      loadBtn: document.getElementById("number-load"),
      loadFile: document.getElementById("number-load-file"),
    };

    restore();
    renderExamples();
    updateStats();
    drawChart();
    drawPlot();

    el.add.addEventListener("click", () => {
      addExample(el.in.value, el.out.value);
      el.in.value = "";
      el.out.value = "";
      el.in.focus();
    });
    const enterHandler = (e) => { if (e.key === "Enter") el.add.click(); };
    el.in.addEventListener("keydown", enterHandler);
    el.out.addEventListener("keydown", enterHandler);

    el.autofill.addEventListener("click", autofill);

    el.trainBtn.addEventListener("click", () => {
      const epochs = Math.max(10, Math.min(10000, parseInt(el.epochs.value, 10) || 800));
      el.epochs.value = epochs;
      el.progress.style.width = "0%";
      train(epochs);
    });

    el.testBtn.addEventListener("click", () => showPrediction(el.test.value));
    el.test.addEventListener("keydown", (e) => {
      if (e.key === "Enter") el.testBtn.click();
    });

    el.saveBtn.addEventListener("click", saveToFile);
    el.loadBtn.addEventListener("click", () => el.loadFile.click());
    el.loadFile.addEventListener("change", (e) => {
      if (e.target.files[0]) loadFromFile(e.target.files[0]);
      e.target.value = "";
    });

    window.addEventListener("resize", () => {
      drawChart();
      drawPlot();
    });
  }

  return {
    init,
    reset,
    renderProjects,
    projects,
    get net() { return state.net; },
    get state() { return state; },
  };
};
