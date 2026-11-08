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

## Unter der Haube

| Datei | Aufgabe |
|---|---|
| `js/nn.js` | Die neuronale Netz-Engine: Dense-Layer, ReLU/Tanh/Softmax, Kreuz-Entropie und MSE, **Adam-Optimizer**, Mini-Batches, Speichern/Laden |
| `js/ui.js` | Oberflächen-Werkzeuge: Konfetti, Lernkurven, Wahrscheinlichkeits-Balken, Speicher, Export |
| `js/text-ai.js` | Wörter-Modul (N-Gramm-Features über Hashing) |
| `js/image-ai.js` | Bild-Modul (16×16-Raster, Zentrierung, Augmentation) |
| `js/number-ai.js` | Zahlen-Modul (Normalisierung, Regression, Funktionsplot) |
| `js/app.js` | Navigation, Maskottchen „Nullo", Abzeichen, Fortschritt |
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
```

## Tests

```bash
node tests/nn-test.js       # 14 Tests: die Engine (XOR, Regression, Speichern)
node tests/browser-test.js  # 33 Tests: die ganze Seite im echten Browser
```

Der Browser-Test braucht `playwright-core` und Chromium:

```bash
npm install                  # installiert playwright-core
node tests/browser-test.js
```

Getestet wird unter anderem: echtes Lernen (XOR, Regel `2x+1`), Vorhersage auf
**ungesehenen** Wörtern und Zeichnungen, Selbst-Test mit Holdout-Daten,
Speichern/Laden, Persistenz über einen Seiten-Neuladen und eine saubere Konsole.

## Ehrlichkeit als Prinzip

Diese Website verspricht nichts, was die KI nicht halten kann. Überall dort, wo
die KI an ihre Grenzen stößt, steht das ausdrücklich dabei – in Hinweiskästen,
in der Hilfe-Seite und in den Ergebnissen. Kinder sollen nicht glauben, KI sei
allwissend, sondern verstehen, dass sie immer nur so gut ist wie die Beispiele,
die wir ihr geben.

## Lizenz

MIT – frei zum Lernen, Weitergeben und Verändern.
