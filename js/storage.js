/*
 * storage.js - Wo der Fortschritt gespeichert wird.
 *
 * Es gibt zwei Speicherorte:
 *
 *   1. GITHUB (der richtige Ort): Der Fortschritt landet als Datei in deinem
 *      eigenen Repository, im Ordner "ai-projects/". So kannst du ihn von
 *      jedem Computer aus laden und siehst ihn sogar auf GitHub.
 *
 *   2. BROWSER (der Notfall-Plan): Wenn kein GitHub-Schluessel eingegeben ist,
 *      wird alles nur im Browser gespeichert. Das funktioniert genauso, aber
 *      nur auf diesem einen Geraet.
 *
 * Wichtig zum Schluessel ("Token"): Er wird NUR im Browser gespeichert und
 * niemals irgendwo hingeschickt ausser an GitHub selbst. Wer den Schluessel
 * hat, darf in dein Repository schreiben - deshalb nimmt man einen
 * "fein granulierten" Schluessel, der NUR dieses eine Repository darf.
 */

const Storage = (() => {
  "use strict";

  const TOKEN_KEY = "kinderki:github-token";
  const REPO_KEY = "kinderki:github-repo";
  const API = "https://api.github.com";

  // Das Standard-Repository. Kann in der Oberflaeche geaendert werden.
  const DEFAULT_REPO = "Dealwirth/ki-werkstatt";

  const listeners = [];

  // ---------------------------------------------------------------------------
  // Einstellungen: Schluessel und Repository
  // ---------------------------------------------------------------------------

  function getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function setToken(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token.trim());
      else localStorage.removeItem(TOKEN_KEY);
      notify();
    } catch (e) {
      /* egal */
    }
  }

  function getRepo() {
    try {
      return localStorage.getItem(REPO_KEY) || DEFAULT_REPO;
    } catch (e) {
      return DEFAULT_REPO;
    }
  }

  function setRepo(repo) {
    try {
      if (repo) localStorage.setItem(REPO_KEY, repo.trim());
      else localStorage.removeItem(REPO_KEY);
      notify();
    } catch (e) {
      /* egal */
    }
  }

  function isCloudEnabled() {
    return getToken().length > 0;
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  function notify() {
    listeners.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        /* egal */
      }
    });
  }

  // ---------------------------------------------------------------------------
  // GitHub-API
  // ---------------------------------------------------------------------------

  function headers() {
    return {
      Authorization: "Bearer " + getToken(),
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  /** Prueft, ob der Schluessel gueltig ist und ob wir schreiben duerfen. */
  async function checkConnection() {
    if (!isCloudEnabled()) {
      return { ok: false, reason: "no-token", message: "Kein Schlüssel eingegeben." };
    }
    try {
      const repo = getRepo();
      const res = await fetch(`${API}/repos/${repo}`, { headers: headers() });
      if (res.status === 401) {
        return { ok: false, reason: "bad-token", message: "Der Schlüssel ist ungültig." };
      }
      if (res.status === 404) {
        return { ok: false, reason: "no-repo", message: `Repository „${repo}" nicht gefunden.` };
      }
      if (!res.ok) {
        return { ok: false, reason: "http-" + res.status, message: "GitHub antwortete mit Fehler " + res.status + "." };
      }
      const data = await res.json();
      const canWrite = data.permissions ? data.permissions.push === true : false;
      if (!canWrite) {
        return {
          ok: false,
          reason: "no-write",
          message: "Der Schlüssel darf in diesem Repository nicht schreiben. Er braucht „Contents: Read and write“.",
        };
      }
      return { ok: true, message: `Verbunden mit ${data.full_name}` };
    } catch (e) {
      return { ok: false, reason: "network", message: "Keine Verbindung zu GitHub." };
    }
  }

  /** Baut den Pfad im Repository, z. B. "ai-projects/text/abc123.json". */
  function pathFor(moduleKey, projectId) {
    return `ai-projects/${moduleKey}/${projectId}.json`;
  }

  function encodeBase64(str) {
    // UTF-8-sicher (Umlaute!)
    const bytes = new TextEncoder().encode(str);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function decodeBase64(b64) {
    const binary = atob(b64.replace(/\n/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /**
   * Liest eine Datei. Gibt {found, content, sha} zurueck.
   * Bei Netzfehlern werfen wir, damit der Aufrufer es merkt.
   */
  async function readFile(path) {
    const repo = getRepo();
    const res = await fetch(`${API}/repos/${repo}/contents/${path}`, {
      headers: headers(),
    });
    if (res.status === 404) return { found: false };
    if (!res.ok) throw new Error("GitHub-Lesefehler " + res.status);
    const data = await res.json();
    if (Array.isArray(data)) return { found: false };
    return {
      found: true,
      sha: data.sha,
      content: decodeBase64(data.content || ""),
    };
  }

  /** Schreibt eine Datei. Legt sie an oder ersetzt sie. */
  async function writeFile(path, content, message) {
    const repo = getRepo();
    const existing = await readFile(path);
    const body = {
      message: message || `KI-Fortschritt aktualisieren: ${path}`,
      content: encodeBase64(content),
      branch: "main",
    };
    if (existing.found) body.sha = existing.sha;

    const res = await fetch(`${API}/repos/${repo}/contents/${path}`, {
      method: "PUT",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "GitHub-Schreibfehler " + res.status);
    }
    return res.json();
  }

  /** Loescht eine Datei. */
  async function deleteFile(path, message) {
    const repo = getRepo();
    const existing = await readFile(path);
    if (!existing.found) return { deleted: false };
    const res = await fetch(`${API}/repos/${repo}/contents/${path}`, {
      method: "DELETE",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({
        message: message || `KI löschen: ${path}`,
        sha: existing.sha,
        branch: "main",
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "GitHub-Löschfehler " + res.status);
    }
    return { deleted: true };
  }

  /** Listet alle Projektdateien eines Moduls auf. */
  async function listFiles(moduleKey) {
    const repo = getRepo();
    const res = await fetch(`${API}/repos/${repo}/contents/ai-projects/${moduleKey}`, {
      headers: headers(),
    });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error("GitHub-Leseffehler " + res.status);
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.filter((f) => f.name.endsWith(".json")).map((f) => f.name);
  }

  // ---------------------------------------------------------------------------
  // Oeffentliche Schnittstelle
  // ---------------------------------------------------------------------------

  return {
    DEFAULT_REPO,
    getToken,
    setToken,
    getRepo,
    setRepo,
    isCloudEnabled,
    checkConnection,
    pathFor,
    readFile,
    writeFile,
    deleteFile,
    listFiles,
    onChange,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = Storage;
}
