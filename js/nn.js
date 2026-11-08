/*
 * nn.js - Eine kleine, aber echte neuronale Netz-Engine in reinem JavaScript.
 *
 * Hier steckt keine Magie und kein fertiges KI-Modell. Es sind wirklich nur
 * Zahlen ("Gewichte"), die am Anfang zufaellig sind. Das Netz kann also erst
 * einmal NICHTS. Erst wenn wir ihm Beispiele zeigen und es immer wieder
 * korrigieren, lernt es etwas.
 *
 * Das ist genau die Idee hinter dem Projekt: Kinder sehen, dass eine KI nicht
 * klug geboren wird, sondern alles durch Beispiele lernen muss.
 */

const NN = (() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // Zufallszahlen
  // ---------------------------------------------------------------------------

  /**
   * Erzeugt einen Zufallsgenerator. Mit demselben "seed" kommen immer dieselben
   * Zahlen heraus. So koennen wir ein Modell reproduzierbar speichern.
   */
  function makeRandom(seed) {
    let state = (seed >>> 0) || 1;
    return function random() {
      state ^= state << 13;
      state >>>= 0;
      state ^= state >> 17;
      state ^= state << 5;
      state >>>= 0;
      return state / 4294967296;
    };
  }

  /**
   * Gewichte starten mit kleinen Zufallswerten. Waeren sie alle gleich gross,
   * wuerden alle Neuronen dasselbe lernen. Etwas Streuung ist wichtig.
   */
  function randomMatrix(rows, cols, random, scale) {
    const m = [];
    for (let r = 0; r < rows; r++) {
      const row = new Float64Array(cols);
      for (let c = 0; c < cols; c++) {
        // Box-Muller: aus zwei gleichverteilten Zahlen eine glockenfoermige
        const u1 = Math.max(random(), 1e-9);
        const u2 = random();
        const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        row[c] = gauss * scale;
      }
      m.push(row);
    }
    return m;
  }

  function zeros(rows, cols) {
    const m = [];
    for (let r = 0; r < rows; r++) m.push(new Float64Array(cols));
    return m;
  }

  // ---------------------------------------------------------------------------
  // Aktivierungsfunktionen ("Wie stark feuert ein Neuron?")
  // ---------------------------------------------------------------------------

  const ACTIVATIONS = {
    // Geradlinig: einfach und schnell. Standard fuer versteckte Schichten.
    relu: {
      name: "relu",
      forward: (x) => (x > 0 ? x : 0),
      backward: (x) => (x > 0 ? 1 : 0),
    },
    // Weiche Kurve zwischen -1 und 1.
    tanh: {
      name: "tanh",
      forward: (x) => Math.tanh(x),
      backward: (x) => {
        const t = Math.tanh(x);
        return 1 - t * t;
      },
    },
    // "Immer an" - fuer die Ausgabeschicht bei Zahlen (Regression).
    linear: {
      name: "linear",
      forward: (x) => x,
      backward: () => 1,
    },
  };

  /**
   * Softmax macht aus rohen Zahlen Wahrscheinlichkeiten, die zusammen 1 ergeben.
   * Beispiel: [2, 1, 0] -> [0.66, 0.24, 0.09]. Perfekt fuer "Welche Kategorie?"
   */
  function softmax(values) {
    let max = -Infinity;
    for (const v of values) if (v > max) max = v;
    let sum = 0;
    const out = new Float64Array(values.length);
    for (let i = 0; i < values.length; i++) {
      out[i] = Math.exp(values[i] - max); // -max verhindert Ueberlauf
      sum += out[i];
    }
    for (let i = 0; i < out.length; i++) out[i] /= sum;
    return out;
  }

  // ---------------------------------------------------------------------------
  // Das Netz selbst
  // ---------------------------------------------------------------------------

  /**
   * @param {number} seed  Startwert fuer den Zufall
   * @param {Array} spec   Beschreibung der Schichten, z.B.
   *                       [{size:16, act:'relu'}, {size:3, act:'softmax'}]
   *                       Die erste Schicht ist der Eingang (nur Groesse noetig).
   */
  class NeuralNet {
    constructor(seed, spec) {
      this.spec = spec.map((s) => ({ ...s }));
      this.random = makeRandom(seed);
      this.layers = [];
      this.trainedExamples = 0;
      this.trainingSteps = 0;
      this.lossHistory = [];

      // Jede Verbindung zwischen zwei Schichten bekommt Gewichte + einen Bias.
      for (let i = 0; i < spec.length - 1; i++) {
        const inSize = spec[i].size;
        const outSize = spec[i + 1].size;
        // Startskala nach He-Init, damit die Signale nicht explodieren.
        const scale = Math.sqrt(2 / inSize);
        this.layers.push({
          inSize,
          outSize,
          weights: randomMatrix(outSize, inSize, this.random, scale),
          bias: new Float64Array(outSize),
          // Zwischenspeicher fuer die Lernschritt-Berechnung
          lastInput: null,
          lastPreActivation: null,
          gradW: zeros(outSize, inSize),
          gradB: new Float64Array(outSize),
        });
      }

      // Adam-Optimizer-Zustand (eine sehr stabile Lern-Methode)
      this.adam = this.layers.map((l) => ({
        mW: zeros(l.outSize, l.inSize),
        vW: zeros(l.outSize, l.inSize),
        mB: new Float64Array(l.outSize),
        vB: new Float64Array(l.outSize),
      }));
      this.adamT = 0;
    }

    get inputSize() {
      return this.spec[0].size;
    }

    get outputSize() {
      return this.spec[this.spec.length - 1].size;
    }

    /** Rechnet ein Beispiel durch das Netz ("Vorhersage"). */
    forward(input) {
      if (input.length !== this.inputSize) {
        throw new Error(
          `Eingabe hat ${input.length} Werte, erwartet werden ${this.inputSize}.`
        );
      }
      let current = Float64Array.from(input);
      const activations = [current];

      for (let li = 0; li < this.layers.length; li++) {
        const layer = this.layers[li];
        const act = this.spec[li + 1].act;
        const pre = new Float64Array(layer.outSize);
        const out = new Float64Array(layer.outSize);

        for (let o = 0; o < layer.outSize; o++) {
          let sum = layer.bias[o];
          const w = layer.weights[o];
          for (let i = 0; i < layer.inSize; i++) sum += w[i] * current[i];
          pre[o] = sum;
          if (act === "softmax") {
            out[o] = sum; // Softmax kommt gleich ueber die ganze Schicht
          } else {
            out[o] = ACTIVATIONS[act].forward(sum);
          }
        }

        if (act === "softmax") {
          const sm = softmax(out);
          out.set(sm);
        }

        layer.lastInput = current;
        layer.lastPreActivation = pre;
        current = out;
        activations.push(current);
      }

      this.lastActivations = activations;
      return current;
    }

    /** Wie falsch liegt das Netz? Kleiner ist besser. */
    computeLoss(output, target) {
      const outAct = this.spec[this.spec.length - 1].act;
      if (outAct === "softmax") {
        // Kreuz-Entropie: bestraft sichere falsche Antworten stark.
        let loss = 0;
        for (let i = 0; i < output.length; i++) {
          loss -= target[i] * Math.log(Math.max(output[i], 1e-12));
        }
        return loss;
      }
      // Mittlerer quadratischer Fehler fuer Zahlen-Vorhersagen.
      let loss = 0;
      for (let i = 0; i < output.length; i++) {
        const d = output[i] - target[i];
        loss += d * d;
      }
      return loss / output.length;
    }

    /**
     * Rueckwaertsrechnung (Backpropagation): findet heraus, welches Gewicht
     * wie stark schuld am Fehler war, und merkt sich die Korrektur.
     */
    backward(target) {
      const L = this.layers.length;
      const outAct = this.spec[this.spec.length - 1].act;
      const output = this.lastActivations[L];

      let delta = new Float64Array(output.length);
      if (outAct === "softmax") {
        // Bei Softmax + Kreuz-Entropie ist der Fehler einfach: Ausgabe - Ziel.
        for (let i = 0; i < output.length; i++) delta[i] = output[i] - target[i];
      } else {
        for (let i = 0; i < output.length; i++) {
          const grad = (2 * (output[i] - target[i])) / output.length;
          delta[i] =
            grad *
            ACTIVATIONS[outAct].backward(this.layers[L - 1].lastPreActivation[i]);
        }
      }

      // Von hinten nach vorne durch alle Schichten.
      for (let li = L - 1; li >= 0; li--) {
        const layer = this.layers[li];
        const input = this.lastActivations[li];
        const gradW = layer.gradW;
        const gradB = layer.gradB;

        for (let o = 0; o < layer.outSize; o++) {
          const d = delta[o];
          gradB[o] += d;
          const gw = gradW[o];
          for (let i = 0; i < layer.inSize; i++) gw[i] += d * input[i];
        }

        if (li > 0) {
          // Fehler auf die vorherige Schicht zurueckrechnen.
          const prevAct = this.spec[li].act;
          const prevPre = this.layers[li - 1].lastPreActivation;
          const newDelta = new Float64Array(layer.inSize);
          for (let i = 0; i < layer.inSize; i++) {
            let sum = 0;
            for (let o = 0; o < layer.outSize; o++) {
              sum += layer.weights[o][i] * delta[o];
            }
            newDelta[i] = sum * ACTIVATIONS[prevAct].backward(prevPre[i]);
          }
          delta = newDelta;
        }
      }
    }

    /** Wendet die gemerkten Korrekturen an (Adam-Optimizer). */
    applyGradients(batchSize, lr) {
      this.adamT += 1;
      const b1 = 0.9;
      const b2 = 0.999;
      const eps = 1e-8;
      const t = this.adamT;
      const c1 = 1 - Math.pow(b1, t);
      const c2 = 1 - Math.pow(b2, t);

      for (let li = 0; li < this.layers.length; li++) {
        const layer = this.layers[li];
        const a = this.adam[li];

        for (let o = 0; o < layer.outSize; o++) {
          const gb = layer.gradB[o] / batchSize;
          a.mB[o] = b1 * a.mB[o] + (1 - b1) * gb;
          a.vB[o] = b2 * a.vB[o] + (1 - b2) * gb * gb;
          const mHat = a.mB[o] / c1;
          const vHat = a.vB[o] / c2;
          layer.bias[o] -= (lr * mHat) / (Math.sqrt(vHat) + eps);
          layer.gradB[o] = 0;

          const gw = layer.gradW[o];
          const mW = a.mW[o];
          const vW = a.vW[o];
          const w = layer.weights[o];
          for (let i = 0; i < layer.inSize; i++) {
            const g = gw[i] / batchSize;
            mW[i] = b1 * mW[i] + (1 - b1) * g;
            vW[i] = b2 * vW[i] + (1 - b2) * g * g;
            const mHatW = mW[i] / c1;
            const vHatW = vW[i] / c2;
            w[i] -= (lr * mHatW) / (Math.sqrt(vHatW) + eps);
            gw[i] = 0;
          }
        }
      }
    }

    /**
     * Trainiert einen einzelnen Durchlauf ("Epoche") ueber alle Beispiele.
     * @param {Array<{input:number[], target:number[]}>} dataset
     * @param {object} opts {lr, batchSize}
     */
    trainEpoch(dataset, opts = {}) {
      const lr = opts.lr ?? 0.01;
      const batchSize = opts.batchSize ?? 8;
      const order = dataset.map((_, i) => i);

      // Beispiele mischen, damit das Netz nicht eine Reihenfolge auswendig lernt.
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }

      let epochLoss = 0;
      let processed = 0;
      let inBatch = 0;

      for (let k = 0; k < order.length; k++) {
        const sample = dataset[order[k]];
        const output = this.forward(sample.input);
        epochLoss += this.computeLoss(output, sample.target);
        this.backward(sample.target);
        processed++;
        inBatch++;

        if (inBatch >= batchSize || k === order.length - 1) {
          this.applyGradients(inBatch, lr);
          inBatch = 0;
        }
      }

      const avgLoss = epochLoss / Math.max(processed, 1);
      this.lossHistory.push(avgLoss);
      if (this.lossHistory.length > 200) this.lossHistory.shift();
      this.trainingSteps++;
      this.trainedExamples += processed;
      return avgLoss;
    }

    /** Vorhersage als normale Zahlen (nicht als Float64Array). */
    predict(input) {
      return Array.from(this.forward(input));
    }

    /** Alle Gewichte lesbar machen (zum Anschauen in der Konsole). */
    toJSON() {
      return {
        spec: this.spec,
        trainedExamples: this.trainedExamples,
        trainingSteps: this.trainingSteps,
        lossHistory: this.lossHistory.slice(-40),
        layers: this.layers.map((l) => ({
          weights: l.weights.map((row) => Array.from(row)),
          bias: Array.from(l.bias),
        })),
      };
    }

    /** Aus lesbaren Gewichten wieder ein Netz machen. */
    static fromJSON(data) {
      const net = new NeuralNet(1, data.spec);
      net.trainedExamples = data.trainedExamples || 0;
      net.trainingSteps = data.trainingSteps || 0;
      net.lossHistory = data.lossHistory || [];
      data.layers.forEach((saved, li) => {
        const layer = net.layers[li];
        if (!layer) return;
        saved.weights.forEach((row, o) => {
          for (let i = 0; i < row.length; i++) layer.weights[o][i] = row[i];
        });
        for (let o = 0; o < saved.bias.length; o++) layer.bias[o] = saved.bias[o];
      });
      return net;
    }

    /**
     * Kompakte Form zum Speichern. Die Gewichte werden als 32-Bit-Zahlen
     * gepackt und mit base64 als Text geschrieben. Das ist etwa 10-mal
     * kleiner als die lesbare Form - wichtig, weil der Browser-Speicher
     * begrenzt ist.
     */
    toCompact() {
      return {
        spec: this.spec,
        trainedExamples: this.trainedExamples,
        trainingSteps: this.trainingSteps,
        lossHistory: this.lossHistory.slice(-40).map((v) => Math.round(v * 1e4) / 1e4),
        layers: this.layers.map((l) => {
          const flat = new Float32Array(l.outSize * l.inSize);
          for (let o = 0; o < l.outSize; o++) {
            for (let i = 0; i < l.inSize; i++) flat[o * l.inSize + i] = l.weights[o][i];
          }
          return {
            out: l.outSize,
            in: l.inSize,
            weights: float32ToBase64(flat),
            bias: float32ToBase64(new Float32Array(l.bias)),
          };
        }),
      };
    }

    static fromCompact(data) {
      const net = new NeuralNet(1, data.spec);
      net.trainedExamples = data.trainedExamples || 0;
      net.trainingSteps = data.trainingSteps || 0;
      net.lossHistory = data.lossHistory || [];
      data.layers.forEach((saved, li) => {
        const layer = net.layers[li];
        if (!layer) return;
        const flat = base64ToFloat32(saved.weights);
        for (let o = 0; o < layer.outSize; o++) {
          for (let i = 0; i < layer.inSize; i++) {
            layer.weights[o][i] = flat[o * layer.inSize + i];
          }
        }
        const bias = base64ToFloat32(saved.bias);
        for (let o = 0; o < layer.outSize; o++) layer.bias[o] = bias[o];
      });
      return net;
    }
  }

  // ---------------------------------------------------------------------------
  // Zahlen packen und entpacken (fuer die kompakte Speicherform)
  // ---------------------------------------------------------------------------

  function float32ToBase64(f32) {
    const bytes = new Uint8Array(f32.buffer);
    let binary = "";
    const chunk = 0x8000; // stueckweise, sonst wird der Text zu lang fuer apply()
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToFloat32(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Float32Array(bytes.buffer);
  }

  // ---------------------------------------------------------------------------
  // Kleine Helfer, die in allen Modulen gebraucht werden
  // ---------------------------------------------------------------------------

  /** Ein Beispiel als "one-hot" Vektor: [0,1,0] bedeutet "Klasse 1". */
  function oneHot(index, size) {
    const v = new Float64Array(size);
    v[index] = 1;
    return v;
  }

  /** Mischt und teilt Daten in Training und Test auf. */
  function trainTestSplit(items, testRatio, random) {
    const shuffled = items.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const testCount = Math.floor(shuffled.length * testRatio);
    return {
      train: shuffled.slice(testCount),
      test: shuffled.slice(0, testCount),
    };
  }

  /** Erzeugt eine stabile Zahl aus einem Text (fuer gleichbleibende Hashes). */
  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  return {
    NeuralNet,
    softmax,
    oneHot,
    makeRandom,
    trainTestSplit,
    hashString,
    ACTIVATIONS,
  };
})();

// Damit die Engine auch in Node (fuer Tests) geladen werden kann.
if (typeof module !== "undefined" && module.exports) {
  module.exports = NN;
}
