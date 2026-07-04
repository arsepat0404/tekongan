// Procedural retro/cyberpunk SFX using Web Audio API.
// No assets needed — chiptune-style oscillator blips fit the Press Start 2P vibe.
let ctx: AudioContext | null = null;
let muted = false;
const MUTE_KEY = "tekongan_muted_v1";

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (muted) return null;
  if (!ctx) {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
    } catch { return null; }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

export function initAudio() {
  if (typeof window === "undefined") return;
  muted = localStorage.getItem(MUTE_KEY) === "1";
  getCtx();
}
export function isMuted() { return muted; }
export function setMuted(m: boolean) {
  muted = m;
  if (typeof window !== "undefined") localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  if (m && ctx) ctx.suspend().catch(() => {});
  else if (!m) getCtx();
}

type Tone = {
  freq: number; dur: number; type?: OscillatorType;
  vol?: number; sweep?: number; delay?: number;
};
function tone(opts: Tone) {
  const ac = getCtx(); if (!ac) return;
  const t0 = ac.currentTime + (opts.delay ?? 0);
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = opts.type ?? "square";
  osc.frequency.setValueAtTime(opts.freq, t0);
  if (opts.sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(40, opts.sweep), t0 + opts.dur);
  const peak = opts.vol ?? 0.12;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0); osc.stop(t0 + opts.dur + 0.02);
}

function noise(dur: number, vol = 0.08) {
  const ac = getCtx(); if (!ac) return;
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = ac.createBufferSource(); src.buffer = buf;
  const gain = ac.createGain(); gain.gain.value = vol;
  const filt = ac.createBiquadFilter(); filt.type = "highpass"; filt.frequency.value = 1200;
  src.connect(filt).connect(gain).connect(ac.destination);
  src.start();
}

export const sfx = {
  click: () => tone({ freq: 720, dur: 0.05, vol: 0.08 }),
  tap: () => tone({ freq: 520, dur: 0.04, type: "triangle", vol: 0.1 }),
  success: () => { tone({ freq: 660, dur: 0.08 }); tone({ freq: 990, dur: 0.12, delay: 0.08 }); },
  error: () => tone({ freq: 220, dur: 0.18, type: "sawtooth", sweep: 110, vol: 0.1 }),
  hide: () => tone({ freq: 440, dur: 0.1, type: "triangle", sweep: 880, vol: 0.09 }),
  start: () => {
    tone({ freq: 392, dur: 0.1 }); tone({ freq: 523, dur: 0.1, delay: 0.1 });
    tone({ freq: 659, dur: 0.14, delay: 0.2 }); tone({ freq: 784, dur: 0.2, delay: 0.34 });
  },
  countdown: () => tone({ freq: 880, dur: 0.06, vol: 0.09 }),
  match: () => {
    // alarm: rising siren
    tone({ freq: 300, dur: 0.18, type: "sawtooth", sweep: 900, vol: 0.14 });
    tone({ freq: 900, dur: 0.18, type: "sawtooth", sweep: 300, vol: 0.14, delay: 0.18 });
    noise(0.2, 0.06);
  },
  duelHeartbeat: () => {
    tone({ freq: 90, dur: 0.08, type: "sine", vol: 0.18 });
    tone({ freq: 70, dur: 0.1, type: "sine", vol: 0.14, delay: 0.12 });
  },
  caught: () => {
    tone({ freq: 330, dur: 0.12, type: "sawtooth", sweep: 80, vol: 0.16 });
    noise(0.25, 0.1);
  },
  safe: () => {
    tone({ freq: 523, dur: 0.1 }); tone({ freq: 784, dur: 0.1, delay: 0.1 });
    tone({ freq: 1046, dur: 0.18, delay: 0.2 });
  },
  trap: () => {
    tone({ freq: 180, dur: 0.25, type: "sawtooth", sweep: 60, vol: 0.16 });
    noise(0.18, 0.08);
  },
  empty: () => tone({ freq: 260, dur: 0.12, type: "triangle", sweep: 180, vol: 0.08 }),
  win: () => {
    [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.14, delay: i * 0.12 }));
  },
  emote: () => tone({ freq: 1200, dur: 0.05, type: "triangle", vol: 0.07 }),
};
