/*
 * perf.js - Wie schnell ist dieser Computer?
 *
 * Kinder sollen wissen: Die KI rechnet wirklich, und wie schnell das geht,
 * haengt vom Geraet ab. Deshalb messen wir einmal kurz die Rechenleistung
 * und geben daraus EMPFEHLUNGEN.
 *
 * Ganz wichtig: Nichts davon ist Pflicht! Die Empfehlungen sind nur ein
 * Vorschlag. Man kann sie jederzeit uebergehen und trotzdem trainieren.
 */

const Perf = (() => {
  "use strict";

  const STORAGE_KEY = "perf:last";

  function nowMs() {
    return typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  }

  /**
   * Laesst ein kleines Netz (aehnlich dem Bild-Netz) so lange rechnen, wie
   * es in das Zeitfenster passt. So messen wir echte Arbeit, nicht Theorie.
   */
  function measureSync(budgetMs) {
    const net = new NN.NeuralNet(1, [
      { size: 256 },
      { size: 48, act: "relu" },
      { size: 3, act: "softmax" },
    ]);

    const data = [];
    for (let i = 0; i < 20; i++) {
      const input = new Float64Array(256);
      for (let j = 0; j < 256; j++) input[j] = Math.random();
      data.push({ input, target: NN.oneHot(i % 3, 3) });
    }

    // Aufwaermen (der erste Durchlauf ist immer langsamer)
    for (let i = 0; i < 3; i++) net.trainEpoch(data, { lr: 0.01, batchSize: 8 });

    const t0 = nowMs();
    let steps = 0;
    while (nowMs() - t0 < budgetMs && steps < 5000) {
      net.trainEpoch(data, { lr: 0.01, batchSize: 8 });
      steps++;
    }
    const ms = Math.max(nowMs() - t0, 1);
    return { stepsPerSecond: steps / (ms / 1000), steps, ms };
  }

  /**
   * Fuehrt den Test in kleinen Stuecken aus, damit die Seite nicht einfriert.
   * @param {(anteil:number)=>void} [onProgress] 0 .. 1
   */
  async function run(onProgress) {
    const result = measureSync(400);
    if (onProgress) onProgress(1);
    const report = report_(result.stepsPerSecond);
    try {
      save(report);
    } catch (e) {
      /* Speichern ist nicht wichtig */
    }
    return report;
  }

  /** Ordnet die Messung ein und leitet Empfehlungen ab. */
  function report_(sps) {
    let tier, title, summary;
    if (sps < 25) {
      tier = "ruhig";
      title = "Dein Gerät rechnet gemütlich 🐢";
      summary =
        "Alles funktioniert – es dauert nur etwas länger. Kleiner Tipp: nutze weniger Wiederholungen.";
    } else if (sps < 90) {
      tier = "normal";
      title = "Dein Gerät ist gut dabei 🙂";
      summary =
        "Die Standard-Einstellungen passen gut. Du kannst gerne mehr Wiederholungen ausprobieren.";
    } else {
      tier = "schnell";
      title = "Dein Gerät ist richtig flott 🚀";
      summary =
        "Du darfst es ruhig fordern: mehr Wiederholungen und mehr Zeichnungen pro Sache bringen hier viel.";
    }

    // Empfehlungen je nach Leistung. Alles nur Vorschlaege!
    const rec = {
      imageEpochs: tier === "ruhig" ? 60 : tier === "normal" ? 120 : 200,
      imagePerClass: tier === "ruhig" ? 6 : tier === "normal" ? 10 : 14,
      textEpochs: tier === "ruhig" ? 200 : tier === "normal" ? 300 : 500,
      numberEpochs: tier === "ruhig" ? 500 : tier === "normal" ? 800 : 1500,
    };

    const tips = [
      `Zeichne etwa ${rec.imagePerClass}–${rec.imagePerClass + 4} Bilder pro Sache – dann erkennt die Bild-KI gut.`,
      `Für die Bild-KI sind etwa ${rec.imageEpochs} Wiederholungen ein guter Start.`,
      "Zeichne jedes Bild ein kleines bisschen anders – das macht die KI robust.",
      "Nichts davon ist Pflicht: Du kannst jederzeit mehr oder weniger nehmen.",
    ];

    return {
      stepsPerSecond: Math.round(sps),
      tier,
      title,
      summary,
      tips,
      recommended: rec,
      measuredAt: new Date().toISOString(),
    };
  }

  function save(report) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(report));
  }

  function last() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  /** Kurze Zeile fuer die Anzeige, z. B. "Flott · 140 Runden/s". */
  function shortLabel() {
    const r = last();
    if (!r) return "noch nicht gemessen";
    return `${r.stepsPerSecond} Runden/s`;
  }

  /**
   * Konkrete Folgen eines Zustands - ehrlich, ohne zu schimpfen.
   * @returns {{level:string, text:string}|null}
   */
  function consequence(kind, info) {
    if (kind === "image") {
      const classes = info.classes || 0;
      const perClass = info.perClass || 0;
      const total = info.total || 0;
      if (classes === 0) return null;
      if (classes < 2) {
        return {
          level: "warn",
          text: "Mit nur einer Sache kann die KI nichts unterscheiden. Lege mindestens zwei an.",
        };
      }
      if (total < classes * 2) {
        return {
          level: "warn",
          text: "So wenige Bilder: Die KI wird oft raten und dich unsicher anschauen.",
        };
      }
      if (perClass < 4) {
        return {
          level: "info",
          text: "Noch dünn. Ab etwa 6 Bildern pro Sache wird es deutlich besser.",
        };
      }
      if (perClass >= 8) {
        return {
          level: "good",
          text: "Prima! So viele Beispiele – damit kann die KI richtig gut erkennen.",
        };
      }
      return null;
    }
    return null;
  }

  return { run, last, shortLabel, consequence, report_ };
})();

// Auch direkt im Browser bereitstellen (fuer Tests und die Konsole).
if (typeof window !== "undefined") window.Perf = Perf;

if (typeof module !== "undefined" && module.exports) {
  module.exports = Perf;
}
