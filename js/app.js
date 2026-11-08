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
    { id: "saved", emoji: "💾", name: "Sicherer Hafen", desc: "Eine KI als Datei gespeichert" },
    { id: "many_kis", emoji: "🤖", name: "KI-Fabrik", desc: "Mehrere KIs gleichzeitig erstellt" },
    { id: "cloud_saved", emoji: "☁️", name: "In der Wolke", desc: "Fortschritt ins Repository gespeichert" },
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
    updateSyncBadge();
  }

  // ---------------------------------------------------------------------------
  // Cloud-Speicher: Fortschritt ins eigene GitHub-Repository schreiben
  // ---------------------------------------------------------------------------

  /** Zeigt oben rechts an, ob die Cloud verbunden ist. */
  function updateSyncBadge() {
    const el = document.getElementById("sync-status");
    if (!el) return;
    const count =
      textAI.projects.list().length +
      imageAI.projects.list().length +
      numberAI.projects.list().length;
    if (Storage.isCloudEnabled()) {
      el.textContent = `☁️ ${count} KIs im Repo`;
      el.className = "sync-badge cloud";
      el.title = "Dein Fortschritt wird in dein GitHub-Repository gespeichert.";
    } else {
      el.textContent = `💾 ${count} KIs (nur dieser Browser)`;
      el.className = "sync-badge local";
      el.title = "Tippe hier, um den Fortschritt in dein GitHub-Repository zu speichern.";
    }
    el.onclick = openCloudDialog;
  }

  /** Der Dialog fuer den GitHub-Schluessel. */
  function openCloudDialog() {
    const overlay = document.getElementById("cloud-overlay");
    if (!overlay) return;
    overlay.classList.add("open");
    const tokenInput = document.getElementById("cloud-token");
    const repoInput = document.getElementById("cloud-repo");
    const status = document.getElementById("cloud-status");
    tokenInput.value = Storage.getToken();
    repoInput.value = Storage.getRepo();
    status.textContent = Storage.isCloudEnabled()
      ? "Schlüssel gespeichert (nur in diesem Browser)."
      : "Noch kein Schlüssel – alles bleibt vorerst nur im Browser.";
    status.className = "cloud-status";
    document.getElementById("cloud-forget").style.display = Storage.isCloudEnabled()
      ? "inline-block"
      : "none";
  }

  function closeCloudDialog() {
    document.getElementById("cloud-overlay")?.classList.remove("open");
  }

  async function connectCloud() {
    const token = document.getElementById("cloud-token").value.trim();
    const repo = document.getElementById("cloud-repo").value.trim() || Storage.DEFAULT_REPO;
    const status = document.getElementById("cloud-status");
    const btn = document.getElementById("cloud-connect");

    Storage.setRepo(repo);
    Storage.setToken(token);
    document.getElementById("cloud-forget").style.display = token
      ? "inline-block"
      : "none";
    if (!token) {
      status.textContent = "Kein Schlüssel eingegeben. Alles bleibt im Browser.";
      status.className = "cloud-status";
      updateSyncBadge();
      return;
    }

    btn.disabled = true;
    status.textContent = "Verbinde mit GitHub…";
    status.className = "cloud-status";
    const res = await Storage.checkConnection();
    btn.disabled = false;
    if (!res.ok) {
      status.textContent = "❌ " + res.message;
      status.className = "cloud-status error";
      return;
    }
    status.textContent = "✅ " + res.message;
    status.className = "cloud-status ok";
    updateSyncBadge();
    UI.toast("Verbunden! Jetzt speichern wir in dein Repository. ☁️", "success");
  }

  /** Alle Projekte aller Module ins Repository schreiben. */
  async function saveAllToCloud() {
    const status = document.getElementById("cloud-status");
    const btn = document.getElementById("cloud-save-all");
    if (!Storage.isCloudEnabled()) {
      if (status) {
        status.textContent = "Bitte zuerst einen Schlüssel eingeben.";
        status.className = "cloud-status error";
      }
      return;
    }
    const check = await Storage.checkConnection();
    if (!check.ok) {
      if (status) {
        status.textContent = "❌ " + check.message;
        status.className = "cloud-status error";
      }
      return;
    }
    btn.disabled = true;
    let done = 0;
    const modules = [
      ["Wörter", textAI.projects],
      ["Bild", imageAI.projects],
      ["Zahlen", numberAI.projects],
    ];
    const totalCount = modules.reduce((n, m) => n + m[1].list().length, 0);
    try {
      for (const [label, mgr] of modules) {
        status.textContent = `${label}-KIs werden gespeichert…`;
        status.className = "cloud-status";
        await mgr.pushAllToCloud((i, n) => {
          done++;
        });
      }
      UI.confetti(60);
      status.textContent = `✅ Fertig! ${done} von ${totalCount} KIs gespeichert.`;
      status.className = "cloud-status ok";
      UI.toast("Alle KIs sind jetzt in deinem Repository! ☁️", "success");
      unlockBadge("cloud_saved");
    } catch (e) {
      status.textContent = "❌ " + e.message;
      status.className = "cloud-status error";
    } finally {
      btn.disabled = false;
    }
  }

  /** Alle Projekte aller Module aus dem Repository laden. */
  async function loadAllFromCloud() {
    const status = document.getElementById("cloud-status");
    const btn = document.getElementById("cloud-load-all");
    if (!Storage.isCloudEnabled()) {
      if (status) {
        status.textContent = "Bitte zuerst einen Schlüssel eingeben.";
        status.className = "cloud-status error";
      }
      return;
    }
    btn.disabled = true;
    status.textContent = "Lade aus dem Repository…";
    status.className = "cloud-status";
    let added = 0;
    try {
      added += await textAI.projects.pullFromCloud();
      added += await imageAI.projects.pullFromCloud();
      added += await numberAI.projects.pullFromCloud();
      // Die Ansichten neu aufbauen
      textAI.renderProjects();
      imageAI.renderProjects();
      numberAI.renderProjects();
      status.textContent = added > 0
        ? `✅ ${added} neue KI(s) gefunden und geladen.`
        : "✅ Alles war schon da – nichts Neues gefunden.";
      status.className = "cloud-status ok";
      updateSyncBadge();
    } catch (e) {
      status.textContent = "❌ " + e.message;
      status.className = "cloud-status error";
    } finally {
      btn.disabled = false;
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
    textAI.projects.clearAll();
    imageAI.projects.clearAll();
    numberAI.projects.clearAll();
    // Danach wieder je ein frisches Projekt anlegen
    textAI.projects.init();
    imageAI.projects.init();
    numberAI.projects.init();
    textAI.renderProjects();
    imageAI.renderProjects();
    numberAI.renderProjects();
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

    // Cloud-Speicher
    document.getElementById("cloud-connect")?.addEventListener("click", connectCloud);
    document.getElementById("cloud-save-all")?.addEventListener("click", saveAllToCloud);
    document.getElementById("cloud-load-all")?.addEventListener("click", loadAllFromCloud);
    document.getElementById("cloud-close")?.addEventListener("click", closeCloudDialog);
    document.getElementById("cloud-forget")?.addEventListener("click", () => {
      Storage.setToken("");
      document.getElementById("cloud-token").value = "";
      document.getElementById("cloud-status").textContent =
        "Schlüssel gelöscht. Ab jetzt bleibt alles im Browser.";
      document.getElementById("cloud-status").className = "cloud-status";
      document.getElementById("cloud-forget").style.display = "none";
      updateSyncBadge();
      UI.toast("Schlüssel vergessen. 🔒", "info");
    });
    document.getElementById("cloud-overlay")?.addEventListener("click", (e) => {
      if (e.target.id === "cloud-overlay") closeCloudDialog();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeCloudDialog();
    });

    // Wenn sich mehrere KIs ansammeln: Abzeichen geben
    const checkManyKis = () => {
      const count =
        textAI.projects.list().length +
        imageAI.projects.list().length +
        numberAI.projects.list().length;
      if (count >= 4) unlockBadge("many_kis");
    };
    setInterval(checkManyKis, 2000);

    renderBadges();
    refreshGlobalCount();
    updateSyncBadge();

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
      storage: Storage,
      cloud: { open: openCloudDialog, saveAll: saveAllToCloud, loadAll: loadAllFromCloud },
    };
    window.Storage = Storage;

    // Begruessung
    say("Hallo! Ich bin Nullo und kann noch nichts. Zeig mir etwas!");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
