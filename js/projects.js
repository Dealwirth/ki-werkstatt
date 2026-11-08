/*
 * projects.js - Verwaltet mehrere KIs pro Bereich.
 *
 * Jede KI ist ein eigenes "Projekt" mit eigenem Namen und eigenem Fortschritt.
 * Du kannst beliebig viele anlegen, umbenennen, wechseln und wieder loeschen.
 *
 * Gespeichert wird an zwei Orten:
 *   - immer im Browser (damit es sofort funktioniert)
 *   - zusaetzlich in deinem GitHub-Repository, wenn ein Schluessel eingegeben ist
 *
 * Der Aufbau einer Projektdatei:
 *   {
 *     id: "p123abc",
 *     moduleKey: "text",
 *     name: "Meine Wörter-KI",
 *     createdAt: "...",
 *     updatedAt: "...",
 *     data: { ... das, was das Modul speichern will ... }
 *   }
 */

const createProjects = (moduleKey, opts) => {
  "use strict";

  const INDEX_KEY = `kinderki:projects:${moduleKey}`;
  const DATA_PREFIX = `kinderki:project:${moduleKey}:`;
  const LIMIT = opts.limit || Infinity;

  let index = { activeId: null, projects: [] };

  // ---------------------------------------------------------------------------
  // Hilfsfunktionen
  // ---------------------------------------------------------------------------

  function newId() {
    return "p" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function loadIndex() {
    const saved = UI.load(`projects:${moduleKey}`);
    if (saved && Array.isArray(saved.projects)) {
      index = saved;
    } else {
      index = { activeId: null, projects: [] };
    }
    return index;
  }

  function saveIndex() {
    UI.save(`projects:${moduleKey}`, index);
  }

  function loadData(id) {
    return UI.load(`project:${moduleKey}:${id}`, null);
  }

  function saveData(id, data) {
    UI.save(`project:${moduleKey}:${id}`, data);
  }

  function removeData(id) {
    UI.remove(`project:${moduleKey}:${id}`);
  }

  // ---------------------------------------------------------------------------
  // Projekt-Verwaltung
  // ---------------------------------------------------------------------------

  function list() {
    return index.projects;
  }

  function active() {
    return index.projects.find((p) => p.id === index.activeId) || null;
  }

  function activeId() {
    return index.activeId;
  }

  /** Legt ein neues Projekt an. opts.withStarter fuellt Beispieldaten ein. */
  function create(name, withStarter) {
    const id = newId();
    const project = {
      id,
      moduleKey,
      name: (name || "Neue KI").trim() || "Neue KI",
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    index.projects.push(project);
    index.activeId = id;
    saveData(id, opts.starterData ? opts.starterData() : null);
    saveIndex();
    opts.onSwitch && opts.onSwitch(id);
    return project;
  }

  function rename(id, name) {
    const p = index.projects.find((x) => x.id === id);
    if (!p) return false;
    p.name = (name || "").trim() || p.name;
    p.updatedAt = nowISO();
    saveIndex();
    return true;
  }

  function switchTo(id) {
    if (!index.projects.some((p) => p.id === id)) return false;
    index.activeId = id;
    saveIndex();
    opts.onSwitch && opts.onSwitch(id);
    return true;
  }

  function remove(id) {
    const i = index.projects.findIndex((p) => p.id === id);
    if (i < 0) return false;
    index.projects.splice(i, 1);
    removeData(id);

    // Wenn das aktive Projekt geloescht wurde: zum ersten wechseln
    let switched = false;
    if (index.activeId === id) {
      index.activeId = index.projects.length ? index.projects[0].id : null;
      switched = true;
    }
    saveIndex();

    // Auch in der Cloud loeschen (im Hintergrund, Fehler nicht schlimm)
    if (Storage.isCloudEnabled()) {
      Storage.deleteFile(Storage.pathFor(moduleKey, id)).catch((e) => {
        console.warn("Cloud-Löschen fehlgeschlagen:", e);
      });
    }

    if (switched) opts.onSwitch && opts.onSwitch(index.activeId);
    return true;
  }

  function clearAll() {
    index.projects.forEach((p) => removeData(p.id));
    index = { activeId: null, projects: [] };
    saveIndex();
    opts.onSwitch && opts.onSwitch(null);
  }

  /** Speichert den aktuellen Fortschritt des aktiven Projekts. */
  function saveActive(data) {
    const id = index.activeId;
    if (!id) return;
    saveData(id, data);
    const p = index.projects.find((x) => x.id === id);
    if (p) p.updatedAt = nowISO();
    saveIndex();
    // Cloud im Hintergrund (nicht blockieren)
    if (Storage.isCloudEnabled()) {
      pushToCloud(id, data).catch((e) => {
        console.warn("Cloud-Speichern fehlgeschlagen:", e);
        UI.toast("Cloud-Speichern fehlgeschlagen. Lokal ist alles gesichert.", "warn");
      });
    }
  }

  /** Laedt den Fortschritt des aktiven Projekts. */
  function loadActive() {
    const id = index.activeId;
    if (!id) return null;
    return loadData(id);
  }

  // ---------------------------------------------------------------------------
  // Cloud (GitHub)
  // ---------------------------------------------------------------------------

  async function pushToCloud(id, data) {
    const p = index.projects.find((x) => x.id === id);
    if (!p) return;
    const payload = {
      id: p.id,
      moduleKey,
      name: p.name,
      createdAt: p.createdAt,
      updatedAt: nowISO(),
      data: data !== undefined ? data : loadData(id),
    };
    await Storage.writeFile(
      Storage.pathFor(moduleKey, id),
      JSON.stringify(payload, null, 2),
      `KI-Fortschritt: ${p.name} (${moduleKey})`
    );
  }

  /**
   * Holt alle Projekte dieses Moduls aus dem Repository und legt sie lokal an.
   * Gibt zurueck, wie viele neu waren.
   */
  async function pullFromCloud() {
    const files = await Storage.listFiles(moduleKey);
    let added = 0;
    let firstAddedId = null;
    for (const fileName of files) {
      const id = fileName.replace(/\.json$/, "");
      try {
        const file = await Storage.readFile(Storage.pathFor(moduleKey, id));
        if (!file.found) continue;
        const payload = JSON.parse(file.content);
        if (!payload || !payload.id) continue;

        // Kenne ich dieses Projekt schon? Dann nur lokal uebernehmen.
        const known = index.projects.find((x) => x.id === payload.id);
        if (!known) {
          index.projects.push({
            id: payload.id,
            moduleKey,
            name: payload.name || "KI aus Cloud",
            createdAt: payload.createdAt || nowISO(),
            updatedAt: payload.updatedAt || nowISO(),
          });
          added++;
          if (!firstAddedId) firstAddedId = payload.id;
        }
        saveData(payload.id, payload.data ?? null);
      } catch (e) {
        console.warn("Projekt konnte nicht geladen werden:", fileName, e);
      }
    }
    if (added > 0) {
      const cur = active();
      const curEmpty = !cur || !loadData(cur.id);
      if (curEmpty && firstAddedId) {
        // Ein leeres Standardprojekt steht dem geladenen Fortschritt im Weg.
        // Wir raeumen es weg und machen die geladene KI aktiv.
        if (cur) {
          index.projects = index.projects.filter((p) => p.id !== cur.id);
          removeData(cur.id);
        }
        index.activeId = firstAddedId;
      } else if (!index.activeId && index.projects.length) {
        index.activeId = index.projects[0].id;
      }
      saveIndex();
      opts.onSwitch && opts.onSwitch(index.activeId);
    }
    return added;
  }

  /** Alle Projekte dieses Moduls in die Cloud schreiben. */
  async function pushAllToCloud(onProgress) {
    const all = index.projects.slice();
    for (let i = 0; i < all.length; i++) {
      await pushToCloud(all[i].id);
      if (onProgress) onProgress(i + 1, all.length);
    }
    return all.length;
  }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------

  function init() {
    loadIndex();
    // Wenn es noch kein Projekt gibt, aber Daten aus der alten Version
    // vorhanden sind, uebernehmen wir sie in das erste Projekt.
    if (index.projects.length === 0) {
      const legacy = UI.load(moduleKey, null);
      const project = {
        id: newId(),
        moduleKey,
        name: opts.defaultName || "Meine erste KI",
        createdAt: nowISO(),
        updatedAt: nowISO(),
      };
      index.projects.push(project);
      index.activeId = project.id;
      saveData(project.id, legacy || null);
      saveIndex();
    }
    if (!index.activeId && index.projects.length) {
      index.activeId = index.projects[0].id;
      saveIndex();
    }
  }

  return {
    init,
    list,
    active,
    activeId,
    create,
    rename,
    switchTo,
    remove,
    clearAll,
    saveActive,
    loadActive,
    pullFromCloud,
    pushAllToCloud,
    get limit() { return LIMIT; },
  };
};
