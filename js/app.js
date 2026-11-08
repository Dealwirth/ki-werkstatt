/*
 * app.js - Verbindet alles: Navigation, Abzeichen und der kleine Roboter.
 */

(function () {
  "use strict";

  // Die drei Lern-Module
  const textAI = createTextAI();
  const imageAI = createImageAI();
  const numberAI = createNumberAI();

  // ---------------------------------------------------------------------------
  // Abzeichen
  // ---------------------------------------------------------------------------

  const BADGES = [
    { id: "two_categories", emoji: "🗂️", name: "Sortier-Profi", desc: "2 Schubladen gebaut" },
    { id: "ten_examples", emoji: "📚", name: "Fleißige Lehrerin", desc: "10 Wörter beigebracht" },
    { id: "low_loss", emoji: "🧠", name: "Musterfinder", desc: "Wörter-KI sicher trainiert" },
    { id: "self_test", emoji: "🧪", name: "Ehrlicher Test", desc: "Wörter-KI Selbst-Test bestanden" },
    { id: "image_two", emoji: "🎨", name: "Maler:in", desc: "2 Sachen zum Erkennen" },
    { id: "image_twenty", emoji: "🖼️", name: "Kunst-Sammler", desc: "20 Zeichnungen beigebracht" },
    { id: "image_low_loss", emoji: "👁️", name: "Bild-Erkenner", desc: "Bild-KI sicher trainiert" },
    { id: "image_self_test", emoji: "🔬", name: "Bild-Forscher", desc: "Bild-KI Selbst-Test bestanden" },
    { id: "number_ten", emoji: "🔢", name: "Zahlen-Freund", desc: "10 Zahlen-Paare gezeigt" },
    { id: "number_low_loss", emoji: "📐", name: "Regel-Knacker", desc: "Geheime Regel gefunden" },
    { id: "saved", emoji: "💾", name: "Sicherer Hafen", desc: "Eine KI gespeichert" },
  ];

  const earned = new Set(UI.load("badges", []));

  function renderBadges() {
    const list = document.getElementById("badge-list");
    if (!list) return;
    list.innerHTML = "";
    BADGES.forEach((badge) => {
      const div = document.createElement("div");
      div.className = "badge" + (earned.has(badge.id) ? " earned" : "");
      div.innerHTML = `
        <span class="badge-emoji">${badge.emoji}</span>
        <span class="badge-name">${badge.name}</span>
        <span class="badge-desc">${badge.desc}</span>
      `;
      list.appendChild(div);
    });
  }

  function unlockBadge(id) {
    if (earned.has(id)) return;
    earned.add(id);
    UI.save("badges", Array.from(earned));
    renderBadges();
    const badge = BADGES.find((b) => b.id === id);
    if (badge) {
      UI.toast(`${badge.emoji} Neues Abzeichen: ${badge.name}!`, "success");
      UI.confetti(50);
    }
  }

  // ---------------------------------------------------------------------------
  // Navigation zwischen den Bereichen
  // ---------------------------------------------------------------------------

  function switchTab(name) {
    document.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.tab === name);
    });
    document.querySelectorAll(".panel").forEach((p) => {
      p.classList.toggle("active", p.id === "panel-" + name);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });

    // Diagramme neu zeichnen, weil die Groesse erst jetzt bekannt ist.
    setTimeout(() => window.dispatchEvent(new Event("resize")), 60);

    const greetings = {
      home: "Ich kann noch nichts. Aber du kannst mir alles beibringen!",
      text: "Zeig mir Wörter! Ich rate am Anfang – aber ich lerne schnell.",
      image: "Male mir etwas und sag mir, was es ist. Dann erkenne ich es wieder!",
      number: "Gib mir Zahlen und ihre Ergebnisse. Ich suche die geheime Regel!",
      howto: "Hier verrate ich dir, wie ich wirklich funktioniere.",
    };
    say(greetings[name] || "");
  }

  // ---------------------------------------------------------------------------
  // Der Roboter spricht
  // ---------------------------------------------------------------------------

  function say(text) {
    const bubble = document.getElementById("home-speech");
    const mascot = document.getElementById("home-mascot");
    if (bubble && text) bubble.textContent = text;
    if (mascot) {
      mascot.style.animation = "none";
      void mascot.offsetWidth;
      mascot.style.animation = "";
    }
  }

  // ---------------------------------------------------------------------------
  // Gesamtzahl der gelernten Beispiele (oben rechts)
  // ---------------------------------------------------------------------------

  function refreshGlobalCount() {
    const total =
      textAI.state.examples.length +
      imageAI.state.examples.length +
      numberAI.state.examples.length;
    const el = document.getElementById("global-samples");
    if (el) {
      el.textContent = total;
      el.animate(
        [
          { transform: "scale(1)", color: "#4d96ff" },
          { transform: "scale(1.35)", color: "#6bcb77" },
          { transform: "scale(1)", color: "#4d96ff" },
        ],
        { duration: 400 }
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Alles loeschen
  // ---------------------------------------------------------------------------

  function resetAll() {
    const sure = window.confirm(
      "Wirklich alles löschen? Deine KI vergisst dann ALLES, was du ihr beigebracht hast."
    );
    if (!sure) return;
    textAI.reset();
    imageAI.reset();
    numberAI.reset();
    earned.clear();
    UI.save("badges", []);
    renderBadges();
    refreshGlobalCount();
    UI.toast("Alles auf Anfang! Wir fangen bei null an. 🌱", "info");
    switchTab("home");
  }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------

  function boot() {
    // Module starten
    textAI.init();
    imageAI.init();
    numberAI.init();

    // Navigation
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => switchTab(tab.dataset.tab));
    });
    document.querySelectorAll("[data-goto]").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.goto));
    });

    // Aufraeumen
    document.getElementById("reset-all")?.addEventListener("click", resetAll);

    renderBadges();
    refreshGlobalCount();

    // Oeffentliche Schnittstelle fuer neugierige Kinder (und fuer Tests)
    window.NN = NN;
    window.KI = {
      text: textAI,
      image: imageAI,
      number: numberAI,
      unlockBadge,
      refreshGlobalCount,
      switchTab,
      badges: BADGES,
    };

    // Begruessung
    say("Hallo! Ich bin Nullo und kann noch nichts. Zeig mir etwas!");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
