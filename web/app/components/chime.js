// The GM inbox chime — "Airy notify swell": a soft bandpassed noise swell
// under a sine layer, with a short synthesized reverb tail and gentle
// soft-clipping on the master bus so the layers never crackle. Chosen over
// five other candidates auditioned in scratchpad/chime-audition-v2.html.
//
// Synthesized with Web Audio rather than shipped as a file — no asset to
// serve, no cache-busting, and the whole thing is a couple dozen lines.

let ctx;
let limiter;
let reverbIR;

// When the chime last rang, so two different watchers don't ring for the same
// message: the live inbox poll hears an inbound DM within seconds, and the
// nav badge's count (fed by the 30s router.refresh) catches up to the same
// arrival later. InboxChime.js checks this before ringing.
let lastChimeAt = 0;
export function noteChime() {
  lastChimeAt = Date.now();
}
export function chimedRecently(withinMs = 45_000) {
  return Date.now() - lastChimeAt < withinMs;
}

function getCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    limiter = ctx.createWaveShaper();
    const n = 4096;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.5) / Math.tanh(1.5);
    }
    limiter.curve = curve;
    limiter.oversample = "2x";
    limiter.connect(ctx.destination);
  }
  return ctx;
}

// A short synthesized plate-ish impulse response: exponentially decaying
// stereo noise. Built once and reused by the convolver on every play.
function getReverbIR() {
  const c = getCtx();
  if (reverbIR) return reverbIR;
  const dur = 1.4;
  const len = Math.ceil(c.sampleRate * dur);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.5);
    }
  }
  reverbIR = buf;
  return reverbIR;
}

function makeVerbSend(wetAmount) {
  const c = getCtx();
  const convolver = c.createConvolver();
  convolver.buffer = getReverbIR();
  const wet = c.createGain();
  wet.gain.value = wetAmount;
  convolver.connect(wet).connect(limiter);
  return convolver;
}

function dest(verbAmount) {
  const c = getCtx();
  const dry = c.createGain();
  dry.connect(limiter);
  return { dry, verb: makeVerbSend(verbAmount) };
}

function tone(d, t0, freq, dur, gainPeak, { pan = 0, attack = 0.02 } = {}) {
  const c = getCtx();
  const osc = c.createOscillator();
  const gain = c.createGain();
  const panner = c.createStereoPanner();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, t0);
  panner.pan.value = pan;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(gainPeak, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(panner);
  panner.connect(d.dry);
  panner.connect(d.verb);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noiseSwell(d, t0, dur, gainPeak, filterFreq, filterQ, pan) {
  const c = getCtx();
  const bufferSize = Math.ceil(c.sampleRate * dur);
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = filterFreq;
  filter.Q.value = filterQ;
  const gain = c.createGain();
  const panner = c.createStereoPanner();
  panner.pan.value = pan;
  gain.gain.setValueAtTime(gainPeak, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(gain).connect(panner);
  panner.connect(d.dry);
  panner.connect(d.verb);
  src.start(t0);
}

// Plays the chime at the given volume (0-1). Never throws — a fresh
// AudioContext is suspended until a user gesture, and by the time a message
// lands the GM has already clicked something, so resume() is a formality;
// if it isn't, the rejection is swallowed rather than breaking the caller.
export function playChime(volume = 0.4) {
  noteChime();
  try {
    const c = getCtx();
    const armed = () => {
      const d = dest(0.22);
      const t0 = c.currentTime;
      noiseSwell(d, t0, 0.5, volume * 0.5, 1800, 1.2, -0.2);
      tone(d, t0 + 0.03, 987.8, 0.5, volume * 0.5, { pan: 0.2, attack: 0.02 });
    };
    if (c.state === "suspended") {
      c.resume().then(armed, () => {});
    } else {
      armed();
    }
  } catch {
    // Web Audio unavailable or blocked — a missed chime is not worth surfacing.
  }
}
