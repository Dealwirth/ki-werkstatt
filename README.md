# 🤖 Meine KI-Werkstatt

Eine **echte** künstliche Intelligenz zum Selber-Beibringen – gebaut als Website
für Kinder. Die KI startet mit **null Wissen** und lernt ausschließlich aus dem,
was du ihr zeigst. Kein fertiges Modell, keine Magie, kein Internet.

## Die Idee

Kinder sollen verstehen, wie KI wirklich funktioniert: Eine KI wird nicht klug
geboren. Sie lernt aus Beispielen, macht Fehler, wird korrigiert und verbessert
sich. Genau diesen Kreislauf können Kinder hier selbst erleben – und dabei
lernen, was KI *kann* und was sie *nicht kann*.

## Loslegen

Es ist kein Bauen und kein Installieren nötig. Einfach die Datei
`index.html` im Browser öffnen – oder einen kleinen Server starten:

```bash
python3 -m http.server 12000
# dann http://localhost:12000/index.html öffnen
```

Alles läuft im Browser. Nichts wird ins Internet geschickt.

## Die drei Lern-Bereiche

### 📚 Wörter-KI – Wörter in Schubladen sortieren

Kinder bauen Kategorien („Schubladen") und zeigen Beispiele. Die KI verwandelt
jedes Wort in einen Zahlen-„Fingerabdruck" aus Buchstaben, Buchstabenpaaren,
Drillingen und Vierergruppen.

**Wichtig und ehrlich:** Die KI sieht nur Buchstaben, keine Bedeutung.
Sie lernt Muster hervorragend („Wörter mit SCH" → fast 100 % richtig),
aber sie kann nicht lernen, dass ein Apfel Obst ist. Genau das ist die
wertvolle Lektion. Vier fertige Muster-Knöpfe helfen beim Start.

### 🎨 Bild-KI – Zeichnungen erkennen

Kinder malen mit Maus oder Finger. Die Zeichnung wird auf ein 16×16-Raster
verkleinert, zentriert und als 256 Zahlen an die KI gegeben. Beim Lernen wird
jede Zeichnung zufällig verschoben, gedreht und leicht verrauscht – so lernt
die KI echte Formen statt auswendig gemalte Bilder.

### 🔢 Zahlen-KI – geheime Regeln entdecken

Kinder geben Paare ein (Eingabe → Ergebnis), z. B. `3 → 7`. Die KI sucht die
Regel dahinter. Sie interpoliert sehr gut (Fehler unter 0,05), kann aber nicht
über ihre Beispiele hinausdenken (Extrapolation) – auch das ist eine ehrliche,
lehrreiche Grenze neuronaler Netze.

## Mehrere KIs gleichzeitig – und Fortschritt sichern

### 🤖 Deine eigene KI-Fabrik

Über jedem Lern-Bereich liegt eine Leiste **„Meine …-KIs"**. Dort kannst du:

- **➕ Neue KI** anlegen – jede lernt für sich allein (eigene Schubladen,
  eigene Beispiele, eigenes Training).
- **Wechseln**, indem du auf den Namen tippst. Jede KI hat ihren eigenen
  Fortschritt; nichts vermischt sich.
- **✏️ Umbenennen**, damit du den Überblick behältst.
- **🗑 Löschen**, wenn eine KI weg soll – ihr Wissen wird dann gelöscht.
  (Auf der Startseite gibt es zusätzlich **„Alles löschen"**.)

So kannst du z. B. eine „SCH-KI", eine „IE-KI" und eine „kurze Wörter-KI"
nebeneinander aufbauen und vergleichen.

### ☁️ Fortschritt ins eigene Repository speichern

Normalerweise lebt der Fortschritt nur in **diesem** Browser. Damit du von
jedem Computer weitertrainieren kannst, gibt es oben rechts die Anzeige
**💾 KIs**. Ein Tipp darauf öffnet den Cloud-Speicher:

1. Bei GitHub einen **fein abgestuften Schlüssel** (Token) anlegen:
   *Fine-grained token* → *Only select repositories* → dein Repository →
   *Permissions → Contents: Read and write*.
2. Repository und Schlüssel in die App eintragen und **Verbinden** tippen.
3. **☁️ Alles speichern** schreibt jede KI in dein Repository.
   **⬇️ Alles laden** holt sie auf einem anderen Gerät wieder zurück.

Der Schlüssel bleibt **nur im Browser** (localStorage) und geht nirgendwohin
außer an GitHub selbst. Über **„Schlüssel vergessen"** löschst du ihn wieder.
Ohne Schlüssel funktioniert alles wie gewohnt weiter – nur eben lokal.

Gespeichert wird unter `ai-projects/<bereich>/<id>.json` – eine Datei pro KI,
mit Kategorien, Beispielen und dem trainierten Netz.

## Gratis veröffentlichen (GitHub Pages)

Damit Freunde und Familie die Werkstatt im Browser öffnen können:

1. Den Inhalt dieses Projekts in ein GitHub-Repository legen.
2. Im Repository auf **Settings → Pages**.
3. Unter *Source* **Deploy from a branch**, Branch **main**, Ordner **/ (root)**.
4. Nach kurzer Zeit ist die Seite erreichbar unter
   `https://<benutzername>.github.io/<repository>/`.

Es ist kein Server und kein Bauen nötig – die Seite ist reines HTML/CSS/JS.

## Unter der Haube

| Datei | Aufgabe |
|---|---|
| `js/nn.js` | Die neuronale Netz-Engine: Dense-Layer, ReLU/Tanh/Softmax, Kreuz-Entropie und MSE, **Adam-Optimizer**, Mini-Batches, Speichern/Laden |
| `js/ui.js` | Oberflächen-Werkzeuge: Konfetti, Lernkurven, Wahrscheinlichkeits-Balken, Speicher, Export |
| `js/text-ai.js` | Wörter-Modul (N-Gramm-Features über Hashing) |
| `js/image-ai.js` | Bild-Modul (16×16-Raster, Zentrierung, Augmentation) |
| `js/number-ai.js` | Zahlen-Modul (Normalisierung, Regression, Funktionsplot) |
| `js/storage.js` | Speicher-Backend: Browser-Speicher **und** GitHub-Repository |
| `js/projects.js` | Verwaltung mehrerer KIs pro Bereich (anlegen/wechseln/löschen) |
| `js/app.js` | Navigation, Maskottchen „Nullo", Abzeichen, Cloud-Dialog |
| `index.html` | Aufbau und Inhalte |
| `css/style.css` | Freundliches, kindgerechtes Design |

Das Netz ist ein echter Mehrschicht-Perzeptron mit Backpropagation. Die Gewichte
sind am Anfang Zufallszahlen. Erst durch Beispiele und Korrektur entsteht Wissen.

### Für neugierige Kinder

In der Browser-Konsole (`F12`) kann man direkt in die KI schauen:

```js
window.KI                          // alle drei KIs
window.KI.text.net                 // das neuronale Netz der Wörter-KI
window.KI.text.predict("Apfel")    // was die KI denkt
window.KI.badges                   // alle Abzeichen
window.KI.text.projects.list()     // alle Wörter-KIs
window.Storage.isCloudEnabled()    // ist ein Repository verbunden?
```

## Tests

```bash
node tests/nn-test.js       # 14 Tests: die Engine (XOR, Regression, Speichern)
node tests/browser-test.js  # 50 Tests: die ganze Seite im echten Browser
```

Der Browser-Test braucht `playwright-core` und Chromium:

```bash
npm install                  # installiert playwright-core
node tests/browser-test.js
```

Getestet wird unter anderem: echtes Lernen (XOR, Regel `2x+1`), Vorhersage auf
**ungesehenen** Wörtern und Zeichnungen, Selbst-Test mit Holdout-Daten,
Speichern/Laden, Persistenz über einen Seiten-Neuladen, das Anlegen/Wechseln/
Löschen mehrerer KIs und die Cloud-Oberfläche – plus eine saubere Konsole.

Zusätzlich gibt es `tests/cloud-test.js`: Es lädt die Seite, verbindet sie mit
einem echten GitHub-Repository, speichert trainierten Fortschritt, lädt ihn in
einem **frischen Browser** zurück und prüft, dass die KI danach sofort richtig
antwortet (Token über die Umgebungsvariable `GITHUB_TOKEN`).

## Ehrlichkeit als Prinzip

Diese Website verspricht nichts, was die KI nicht halten kann. Überall dort, wo
die KI an ihre Grenzen stößt, steht das ausdrücklich dabei – in Hinweiskästen,
in der Hilfe-Seite und in den Ergebnissen. Kinder sollen nicht glauben, KI sei
allwissend, sondern verstehen, dass sie immer nur so gut ist wie die Beispiele,
die wir ihr geben.

## Lizenz

MIT – frei zum Lernen, Weitergeben und Verändern.
