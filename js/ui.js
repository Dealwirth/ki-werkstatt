/*
 * ui.js - Werkzeuge fuer die Oberflaeche.
 *
 * Alles, was huebsch aussieht (Konfetti, Diagramme, Meldungen), steckt hier.
 * So bleiben die Lern-Module uebersichtlich.
 */

const UI = (() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // Meldungen ("Toast")
  // ---------------------------------------------------------------------------

  let toastTimer = null;

  function toast(message, type = "info") {
    let box = document.getElementById("toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "toast";
      document.body.appendChild(box);
    }
    box.textContent = message;
    box.className = "toast show " + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      box.className = "toast " + type;
    }, 2600);
  }

  // ---------------------------------------------------------------------------
  // Konfetti - kleine Belohnung nach Erfolgen
  // ---------------------------------------------------------------------------

  function confetti(count = 60) {
    const colors = ["#ff6b6b", "#ffd93d", "#6bcB77", "#4d96ff", "#c780fa", "#ff9f45"];
    const container = document.createElement("div");
    container.className = "confetti-layer";
    document.body.appendChild(container);

    for (let i = 0; i < count; i++) {
      const piece = document.createElement("span");
      piece.className = "confetti-piece";
      piece.style.left = Math.random() * 100 + "vw";
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDelay = Math.random() * 0.4 + "s";
      piece.style.transform = `rotate(${Math.random() * 360}deg)`;
      if (Math.random() > 0.6) piece.style.borderRadius = "50%";
      container.appendChild(piece);
    }
    setTimeout(() => container.remove(), 2600);
  }

  // ---------------------------------------------------------------------------
  // Linien-Diagramm (Lernkurve)
  // ---------------------------------------------------------------------------

  /**
   * Zeichnet den "Fehler" ueber die Zeit. Faellt die Linie, lernt die KI.
   * @param {HTMLCanvasElement} canvas
   * @param {number[]} values
   */
  function drawLossChart(canvas, values, label = "Fehler") {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 300;
    const h = canvas.clientHeight || 120;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Hintergrund
    ctx.fillStyle = "#f6f7fb";
    roundRect(ctx, 0, 0, w, h, 12);
    ctx.fill();

    if (!values || values.length < 2) {
      ctx.fillStyle = "#9aa0b4";
      ctx.font = "13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Noch keine Lernkurve - starte das Training!", w / 2, h / 2);
      return;
    }

    const pad = 14;
    const maxV = Math.max(...values);
    const minV = Math.min(...values);
    const range = Math.max(maxV - minV, 1e-9);

    // Gitterlinien
    ctx.strokeStyle = "#e4e7f2";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad + ((h - 2 * pad) * i) / 4;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(w - pad, y);
      ctx.stroke();
    }

    // Linie
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = pad + ((w - 2 * pad) * i) / (values.length - 1);
      const y = pad + (h - 2 * pad) * (1 - (v - minV) / range);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#4d96ff";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.stroke();

    // Letzter Punkt
    const lastX = w - pad;
    const lastY = pad + (h - 2 * pad) * (1 - (values[values.length - 1] - minV) / range);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#4d96ff";
    ctx.fill();

    // Beschriftung
    ctx.fillStyle = "#6b7185";
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(label + " (kleiner = besser)", pad, pad - 3);
    ctx.textAlign = "right";
    ctx.fillText(values[values.length - 1].toFixed(3), w - pad, pad + 12);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------------------------------------------------------------------------
  // Balken fuer Wahrscheinlichkeiten
  // ---------------------------------------------------------------------------

  /**
   * @param {HTMLElement} container
   * @param {Array<{label:string, value:number, color?:string}>} rows
   *        value zwischen 0 und 1 (Wahrscheinlichkeit)
   */
  function renderProbabilities(container, rows) {
    if (!container) return;
    container.innerHTML = "";
    const sorted = rows.slice().sort((a, b) => b.value - a.value);
    sorted.forEach((row) => {
      const pct = Math.round(row.value * 100);
      const item = document.createElement("div");
      item.className = "prob-row" + (pct >= 50 ? " strong" : "");
      item.innerHTML = `
        <div class="prob-label">${escapeHtml(row.label)}</div>
        <div class="prob-track">
          <div class="prob-fill" style="width:${pct}%;background:${row.color || "#4d96ff"}"></div>
        </div>
        <div class="prob-value">${pct}%</div>
      `;
      container.appendChild(item);
    });
  }

  // ---------------------------------------------------------------------------
  // Speicher (LocalStorage) - der "Notizblock" des Browsers
  // ---------------------------------------------------------------------------

  const STORAGE_PREFIX = "kinderki:";

  function save(key, value) {
    try {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn("Speichern fehlgeschlagen:", e);
      return false;
    }
  }

  function load(key, fallback = null) {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      console.warn("Laden fehlgeschlagen:", e);
      return fallback;
    }
  }

  function remove(key) {
    try {
      localStorage.removeItem(STORAGE_PREFIX + key);
    } catch (e) {
      /* egal */
    }
  }

  // ---------------------------------------------------------------------------
  // Datei herunterladen (Modell als .json exportieren)
  // ---------------------------------------------------------------------------

  function downloadJSON(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ---------------------------------------------------------------------------
  // Kleine Zeit-Hilfe: "Training laeuft" Animation
  // ---------------------------------------------------------------------------

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  return {
    toast,
    confetti,
    drawLossChart,
    renderProbabilities,
    save,
    load,
    remove,
    downloadJSON,
    escapeHtml,
    sleep,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = UI;
}
