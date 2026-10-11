// client/src/game/Audio.js
//
// Slice 6c: procedural SFX + generative jungle-ambient background music.
// No audio assets — the LAN party is offline, so everything is synthesized
// with WebAudio (oscillators + envelopes only, no samples, no dependencies).
//
// Usage (main.js owns all calls; this module never touches game state):
//   ElDoradoAudio.unlock()            — call on first user gesture (autoplay
//                                       policy blocks sound before one)
//   ElDoradoAudio.sfx('move'|...)     — one-shot UI sounds (no-ops safely)
//   ElDoradoAudio.startMusic()        — begin the ambient loop (idempotent)
//   ElDoradoAudio.stopMusic()         — end it (pads ring out naturally)
//   ElDoradoAudio.setMuted(bool)      — persisted to localStorage
//   ElDoradoAudio.isMuted() / hasStoredPref()
//
// Volumes are deliberately conservative: music sits under everything, SFX
// are short blips. A table with a TV + four phones each playing sound would
// be chaos, so main.js defaults phones to muted (still one tap to unmute).
(function () {
  const MUTE_KEY = 'eldorado-muted';

  let ctx = null;
  let master = null;
  let musicBus = null;
  let sfxBus = null;
  let muted = false;
  let musicOn = false;
  let musicTimer = null;
  // Music loop state: PARKED for now — the generative loop wasn't landing
  // (retune 1 read as "drawn-out tones", arguably worse than the organ).
  // Blind timbre iteration (no ears on the output) converges too slowly, so
  // the loop is off while SFX stay live. Come back with either vendored
  // royalty-free loops or a better generative design; everything below is
  // intact — setMusicEnabled(true) brings it back.
  let MUSIC_ENABLED = false;

  try {
    muted = localStorage.getItem(MUTE_KEY) === '1';
  } catch (_) { /* private mode — default to sound on */ }

  function hasStoredPref() {
    try {
      return localStorage.getItem(MUTE_KEY) !== null;
    } catch (_) {
      return false;
    }
  }

  // Lazily create the context (autoplay-safe: only called from gestures or
  // game events that follow them). Resumes if the browser auto-suspended it.
  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
      musicBus = ctx.createGain();
      musicBus.gain.value = 0.16;
      musicBus.connect(master);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = 0.5;
      sfxBus.connect(master);
    }
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function unlock() {
    ac();
  }

  // enveloped oscillator blip; `when` offsets into the future for arpeggios.
  function tone({ freq, freqEnd, dur, type, gain, when, bus }) {
    const c = ac();
    if (!c || muted) return;
    const t = c.currentTime + (when || 0);
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || 0.3, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(bus || sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  const SFX = {
    move()  { tone({ freq: 520, freqEnd: 760, dur: 0.12, type: 'triangle', gain: 0.32 }); },
    buy()   {
      tone({ freq: 880, dur: 0.10, gain: 0.28 });
      tone({ freq: 1318, dur: 0.16, gain: 0.28, when: 0.08 });
    },
    breakit() {
      tone({ freq: 160, freqEnd: 60, dur: 0.30, type: 'square', gain: 0.22 });
      tone({ freq: 90, freqEnd: 45, dur: 0.35, gain: 0.26, when: 0.02 });
    },
    turn()  {
      tone({ freq: 660, dur: 0.10, gain: 0.22 });
      tone({ freq: 990, dur: 0.18, gain: 0.22, when: 0.09 });
    },
    win()   {
      [523, 659, 784, 1047, 1319].forEach((f, i) =>
        tone({ freq: f, dur: 0.22, gain: 0.28, when: i * 0.11 }));
    },
    error() { tone({ freq: 180, dur: 0.18, type: 'sawtooth', gain: 0.18 }); },
  };

  function sfx(name) {
    try {
      const fn = SFX[name];
      if (fn) fn();
    } catch (_) { /* sound must never break gameplay */ }
  }

  // ── Generative music: expedition-ambient loop ─────────────────────────────
  // Slow Am – F – C – G swells (soft sine stacks through an airy lowpass,
  // root drone an octave down), a quiet frame-drum heartbeat (3 soft thumps
  // per 8s), plus 2–4 sparse pentatonic plucks per chord on a loose rhythm.
  // Quiet, endless, no two loops identical. Pads are fire-and-forget
  // oscillators (stop themselves). Retuned away from triangle-pad organ
  // territory: sines + drone + drum carry the expedition feel.
  const CHORDS = [
    [220.0, 261.6, 329.6], // Am
    [174.6, 220.0, 261.6], // F
    [261.6, 329.6, 392.0], // C
    [196.0, 246.9, 293.7], // G
  ];
  const PENTA = [440.0, 523.3, 587.3, 659.3, 784.0, 880.0];
  const CHORD_SECS = 8;
  let chordIdx = 0;

  function padChord(freqs) {
    const c = ac();
    if (!c) return;
    const t = c.currentTime;
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 1200;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5, t + 2.5);
    g.gain.setValueAtTime(0.5, t + CHORD_SECS - 2);
    g.gain.linearRampToValueAtTime(0.0001, t + CHORD_SECS + 1);
    filt.connect(g);
    g.connect(musicBus);
    freqs.forEach((f) => {
      [-5, 5].forEach((det) => {
        const o = c.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        o.detune.value = det;
        o.connect(filt);
        o.start(t);
        o.stop(t + CHORD_SECS + 1.2);
      });
    });
    // Expedition drone: chord root an octave down, same swell.
    const drone = c.createOscillator();
    drone.type = 'sine';
    drone.frequency.value = freqs[0] / 2;
    drone.connect(filt);
    drone.start(t);
    drone.stop(t + CHORD_SECS + 1.2);
  }

  // Frame-drum heartbeat: soft low thumps, same pattern every loop so the
  // ear has something steady to hold (pads + plucks drift around it).
  function drumbeats() {
    [0, 3, 5.5].forEach((w) => {
      tone({ freq: 72, freqEnd: 44, dur: 0.28, gain: 0.22, when: w, bus: musicBus });
    });
  }

  function tick() {
    if (muted) return;
    if (!ac()) return;
    padChord(CHORDS[chordIdx % CHORDS.length]);
    chordIdx += 1;
    drumbeats();
    // Plucks on a loose rhythm (even-ish spacing + human jitter) instead of
    // fully random scatter — reads as melody, not stray notes.
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const f = PENTA[Math.floor(Math.random() * PENTA.length)];
      const when = 1 + (i * (CHORD_SECS - 2)) / n + (Math.random() * 0.5 - 0.25);
      tone({ freq: f, dur: 1.4, type: 'triangle', gain: 0.12, when, bus: musicBus });
    }
  }

  function startMusic() {
    if (!MUSIC_ENABLED) return;
    if (musicOn) return;
    if (!ac()) return;
    musicOn = true;
    tick();
    musicTimer = setInterval(tick, CHORD_SECS * 1000);
  }

  function stopMusic() {
    musicOn = false;
    if (musicTimer !== null) {
      clearInterval(musicTimer);
      musicTimer = null;
    }
  }

  function setMuted(m) {
    muted = !!m;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch (_) { /* preference lost — sound state still applies */ }
    if (master) master.gain.value = muted ? 0 : 1;
  }

  function isMuted() {
    return muted;
  }

  // Parked-loop switch (see MUSIC_ENABLED above). Exposed so the loop stays
  // testable and a future settings UI can revive it without code changes.
  function setMusicEnabled(on) {
    MUSIC_ENABLED = !!on;
    if (!MUSIC_ENABLED) stopMusic();
  }

  window.ElDoradoAudio = {
    unlock, sfx, startMusic, stopMusic, setMuted, isMuted, hasStoredPref,
    setMusicEnabled,
  };
})();
