/*
 * nn-test.js - Prueft die neuronale Netz-Engine ohne Browser.
 *
 * Aufruf: node tests/nn-test.js
 *
 * Das ist wichtig, weil die Engine das Herzstueck ist. Wenn hier etwas
 * kaputtgeht, funktioniert keine der drei KIs mehr.
 */
const NN = require("../js/nn.js");

let passed = 0;
let failed = 0;
function check(name, cond, extra = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

// ---------------------------------------------------------------------------
console.log("\n[1] XOR lernen (das klassische Testproblem)");
{
  const net = new NN.NeuralNet(42, [
    { size: 2 },
    { size: 8, act: "relu" },
    { size: 2, act: "softmax" },
  ]);
  const data = [
    { input: [0, 0], target: [1, 0] },
    { input: [0, 1], target: [0, 1] },
    { input: [1, 0], target: [0, 1] },
    { input: [1, 1], target: [1, 0] },
  ];
  let loss = 1;
  for (let i = 0; i < 800; i++) loss = net.trainEpoch(data, { lr: 0.05, batchSize: 4 });

  check("Fehler ist klein", loss < 0.01, "loss=" + loss.toFixed(4));
  let allCorrect = true;
  for (const d of data) {
    const p = net.predict(d.input);
    const guess = p[0] > p[1] ? 0 : 1;
    const want = d.target[0] > d.target[1] ? 0 : 1;
    if (guess !== want) allCorrect = false;
  }
  check("alle 4 Faelle richtig", allCorrect);
}

// ---------------------------------------------------------------------------
console.log("\n[2] Zahlen-Regel lernen (y = 2x + 1)");
{
  const xs = [-3, -2, -1, 0, 1, 2, 3];
  const net = new NN.NeuralNet(7, [
    { size: 1 },
    { size: 24, act: "tanh" },
    { size: 24, act: "tanh" },
    { size: 1, act: "linear" },
  ]);
  // Auf -1..1 umrechnen (so wie es die Zahlen-KI auch macht)
  // x reicht von -3 bis 3, y von -5 bis 7.
  const nx = (x) => ((x + 3) / 6) * 2 - 1;
  const ny = (y) => ((y + 5) / 12) * 2 - 1;
  const dy = (v) => ((v + 1) / 2) * 12 - 5;
  const data = xs.map((x) => ({ input: [nx(x)], target: [ny(2 * x + 1)] }));
  for (let i = 0; i < 1500; i++) net.trainEpoch(data, { lr: 0.01, batchSize: 7 });

  // INNERHALB des Bereichs pruefen (dort soll die KI gut sein)
  const p1 = dy(net.predict([nx(0)])[0]);
  const p2 = dy(net.predict([nx(2.5)])[0]);
  check("x=0   → ≈1", Math.abs(p1 - 1) < 0.2, "war " + p1.toFixed(3));
  check("x=2.5 → ≈6", Math.abs(p2 - 6) < 0.3, "war " + p2.toFixed(3));
}

// ---------------------------------------------------------------------------
console.log("\n[3] Speichern und Laden (kompakt)");
{
  const net = new NN.NeuralNet(1, [
    { size: 64 },
    { size: 16, act: "relu" },
    { size: 3, act: "softmax" },
  ]);
  const r = NN.makeRandom(3);
  const data = [];
  for (let i = 0; i < 20; i++) {
    const inp = new Float64Array(64);
    for (let j = 0; j < 8; j++) inp[Math.floor(r() * 64)] = r();
    data.push({ input: inp, target: NN.oneHot(Math.floor(r() * 3), 3) });
  }
  for (let i = 0; i < 40; i++) net.trainEpoch(data, { lr: 0.01, batchSize: 8 });

  const before = net.predict(data[0].input);
  const compact = net.toCompact();
  const json = JSON.stringify(compact);
  const net2 = NN.NeuralNet.fromCompact(JSON.parse(json));
  const after = net2.predict(data[0].input);

  let maxDiff = 0;
  for (let i = 0; i < before.length; i++) maxDiff = Math.max(maxDiff, Math.abs(before[i] - after[i]));

  check("kompakte Form ist kleiner als 1 MB", json.length < 1024 * 1024, (json.length / 1024).toFixed(0) + " KB");
  check("Wiederherstellung ist genau", maxDiff < 1e-6, "Abweichung " + maxDiff.toExponential(2));
  check("Trainingsrunden erhalten", net2.trainingSteps === net.trainingSteps);
}

// ---------------------------------------------------------------------------
console.log("\n[4] Hilfsfunktionen");
{
  const oh = NN.oneHot(1, 3);
  check("oneHot setzt die richtige 1", oh[1] === 1 && oh[0] === 0 && oh[2] === 0);

  const sm = NN.softmax([2, 1, 0]);
  const sum = sm[0] + sm[1] + sm[2];
  check("Softmax ergibt Summe 1", Math.abs(sum - 1) < 1e-9, "Summe " + sum);
  check("Softmax: groesster Wert vorn", sm[0] > sm[1] && sm[1] > sm[2]);

  check("hashString ist stabil", NN.hashString("hallo") === NN.hashString("hallo"));
  check("hashString unterscheidet Woerter", NN.hashString("hallo") !== NN.hashString("halle"));

  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const { train, test } = NN.trainTestSplit(items, 0.3, NN.makeRandom(1));
  check("Aufteilung passt", train.length === 7 && test.length === 3, `${train.length}/${test.length}`);
  const all = [...train, ...test].sort((a, b) => a - b);
  check("Aufteilung verliert nichts", JSON.stringify(all) === JSON.stringify(items));
}

// ---------------------------------------------------------------------------
console.log("\n[5] Neue Faehigkeiten der Engine");
{
  // evaluate(): Trefferquote auf bekannten Daten
  const net = new NN.NeuralNet(7, [
    { size: 4 },
    { size: 8, act: "relu" },
    { size: 2, act: "softmax" },
  ]);
  const data = [
    { input: [1, 1, 0, 0], target: NN.oneHot(0, 2) },
    { input: [0, 0, 1, 1], target: NN.oneHot(1, 2) },
  ];
  for (let i = 0; i < 300; i++) net.trainEpoch(data, { lr: 0.05, batchSize: 2 });
  check("evaluate() gibt 1.0 bei gelernten Daten", net.evaluate(data) === 1);

  // inputGradient(): stimmt mit dem numerischen Gradienten ueberein
  const base = [1, 1, 0, 0];
  const grad = net.inputGradient(base, 0);
  check("inputGradient() hat die richtige Laenge", grad.length === base.length);
  const eps = 1e-3;
  let maxErr = 0;
  for (let i = 0; i < base.length; i++) {
    const a = base.slice();
    const b = base.slice();
    a[i] += eps;
    b[i] -= eps;
    const numeric = (net.predict(a)[0] - net.predict(b)[0]) / (2 * eps);
    maxErr = Math.max(maxErr, Math.abs(numeric - grad[i]));
  }
  check("inputGradient() stimmt mit numerischem Gradienten", maxErr < 1e-3,
    "groesste Abweichung " + maxErr.toExponential(2));

  // generateFor(): die KI erzeugt ein Bild, das sie sicher erkennt
  const gen = net.generateFor(0, { steps: 40, lr: 0.5 });
  check("generateFor() liefert die richtige Laenge", gen.length === 4);
  const probs = net.predict(gen);
  check("generateFor() erzeugt ein sicheres Bild", probs[0] > 0.8,
    "Sicherheit " + probs[0].toFixed(3));

  // Fruehstopp-Idee: trainEpoch meldet sinkenden Fehler
  const net2 = new NN.NeuralNet(3, [{ size: 1 }, { size: 8, act: "relu" }, { size: 1, act: "linear" }]);
  const reg = [
    { input: [0], target: [1] },
    { input: [1], target: [3] },
    { input: [2], target: [5] },
  ];
  const first = net2.trainEpoch(reg, { lr: 0.05, batchSize: 3 });
  for (let i = 0; i < 200; i++) net2.trainEpoch(reg, { lr: 0.05, batchSize: 3 });
  const last = net2.lossHistory[net2.lossHistory.length - 1];
  check("Lernen senkt den Fehler deutlich", last < first / 10,
    `${first.toFixed(3)} -> ${last.toFixed(4)}`);
}

console.log(`\n=== Engine-Ergebnis: ${passed} bestanden, ${failed} fehlgeschlagen ===`);
process.exit(failed > 0 ? 1 : 0);
