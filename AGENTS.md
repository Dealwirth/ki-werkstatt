# AGENTS.md – Projektgedächtnis „Meine KI-Werkstatt"

Diese Datei sammelt Wissen über dieses Repository, damit neue Sitzungen schnell
weiterarbeiten können. Sie beschreibt **was schon da ist** und **wie man es
bedient**.

## Worum geht es?

Eine Website für Kinder, die eine KI **von null** trainieren: keine
Vorprogrammierung, alles lernt das neuronale Netz aus den Beispielen der Kinder.
Reines HTML/CSS/JavaScript, kein Build-Schritt, keine Abhängigkeiten zur
Laufzeit.

- **Live:** https://dealwirth.github.io/ki-werkstatt/
- **Repository:** https://github.com/Dealwirth/ki-werkstatt
- **Sprache:** Oberfläche und Kommentare auf Deutsch, Zielgruppe Grundschule.

## Aufbau

| Datei | Aufgabe |
| --- | --- |
| `index.html` | Aufbau der Seite: 5 Tabs (Start, Wörter, Bild, Zahlen, Hilfe) |
| `css/style.css` | Alle Stile; kindgerecht, große Flächen, klare Farben |
| `js/nn.js` | Neuronales Netz: Dense-Layer, ReLU/Tanh/Softmax/Linear, Kreuz-Entropie + MSE, Adam, Mini-Batches, Speichern/Laden, `evaluate()`, `inputGradient()`, `generateFor()` |
| `js/text-ai.js` | Wörter-KI: Wörter → Merkmale → Kategorien |
| `js/image-ai.js` | Bild-KI: Zeichnen (16×16), Werkzeuge, Training, Erkennen, Selbst-Malen |
| `js/number-ai.js` | Zahlen-KI: geheime Regeln lernen (Regression) |
| `js/perf.js` | Rechenleistungs-Test + unverbindliche Empfehlungen |
| `js/projects.js` | Mehrere KIs pro Modul verwalten (LocalStorage) |
| `js/cloud.js` | Fortschritt über GitHub API ins eigene Repository schreiben |
| `js/ui.js` | Kleine Helfer (Toast, Dialog, Speicher, Projektleiste) |
| `js/app.js` | Start, Tab-Wechsel, Abzeichen (Badges) |
| `tests/` | `nn-test.js`, `browser-test.js`, `cloud-test.js` |

## Tests ausführen

```bash
# Lokalen Server starten (Port 12000)
python3 -m http.server 12000 &

node tests/nn-test.js        # 20 Tests: die Engine
node tests/browser-test.js   # 79 Tests: die Seite im echten Chromium
TEST_URL="https://dealwirth.github.io/ki-werkstatt/index.html" \
  node tests/browser-test.js # dasselbe gegen die Live-Seite
GITHUB_TOKEN=... node tests/cloud-test.js  # 8 Tests: Cloud-Speichern
```

Playwright liegt unter `node_modules/playwright-core`, Chromium unter
`/usr/bin/chromium`.

## Wichtige Kniffe (aus Erfahrung)

- **Zeichen-Tests brauchen Scrollen.** Die Kopfleiste klebt oben. Immer
  `el.scrollIntoView({ block: "center" })` vor dem Maus-Zeichnen, sonst landet
  der Klick nicht auf der Leinwand.
- **`inputGradient()` muss die Eingabeschicht mitrechnen.** Sonst ist der
  Gradient zu kurz (Länge 3 statt 4) und liefert `NaN`. Getestet gegen den
  numerischen Gradienten.
- **Selbst-Malen: nicht die Tinte normieren, sondern binarisieren.** Ein
  weicher Durchschnitt plus Tinten-Normierung ergibt einen grauen Schleier.
  Besser: Tintenmenge der Beispiele als Ziel nehmen, mehrere Startpunkte
  (Durchschnitt, typisches Bild, klarstes Bild, Mischung) verfeinern, dann nur
  die K stärksten Zellen dunkel setzen. Auswahl über Sicherheit minus einsame
  Punkte. Ergibt klares Schwarz-Weiß.
- **Kein Frühstopp mehr.** Wer 1000 Runden eingibt, bekommt 1000 Runden. Die
  Lernrate hat eine kleine Untergrenze, damit späte Runden noch wirken.
- **`window.Perf` muss selbst gesetzt werden** (`if (typeof window !== "undefined") window.Perf = Perf;`),
  weil `const` auf oberster Ebene kein `window`-Feld anlegt.
- **Projekt-API heißt `switchTo`, nicht `activate`.** `projects.list()` liefert
  nur die Metadaten, **nicht** die Daten.
- **Cloud-Test schreibt echte Commits** ins Repository (KI-Fortschritt).
  Achtung: Der Push kann auf ein Passwort warten. Dann `git remote set-url`
  mit `$GITHUB_TOKEN` und `GIT_TERMINAL_PROMPT=0` benutzen.
  Danach ggf. `git pull`, sonst scheitert der nächste Push (Non-Fast-Forward).
- **Testdaten nie committen.** `ai-projects/` steht in `.gitignore`.

## Veröffentlichen

GitHub Pages ist auf `main` aktiviert. Nach dem Push ist die Seite nach kurzer
Zeit (meist 1–2 Minuten) aktuell. Cache umgehen: `?v=<zufall>` an die URL.
