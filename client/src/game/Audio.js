// client/src/game/Audio.js
//
// Slice 6c: procedural SFX + MP3 background track.
// SFX are synthesized with WebAudio (oscillators + envelopes only, no
// samples, no dependencies — the LAN party is offline so SFX stay local).
// Music is a vendored loop at client/assets/background.mp3, played through
// a looping <audio> element (gapless enough for a first pass; swap the file
// later for a seamless-loop mastered version).
//
// Usage (main.js owns all calls; this module never touches game state):
//   ElDoradoAudio.unlock()            — call on first user gesture (autoplay
//                                       policy blocks sound before one)
//   ElDoradoAudio.sfx('move'|...)     — one-shot UI sounds (no-ops safely)
//   ElDoradoAudio.startMusic()        — begin the ambient loop (idempotent)
//   ElDoradoAudio.stopMusic()         — end it
//   ElDoradoAudio.setMuted(bool)      — persisted to localStorage
//   ElDoradoAudio.isMuted() / hasStoredPref()
//
// Volumes are deliberately conservative: music sits under everything, SFX
// are short blips. A table with a TV + four phones each playing sound would
// be chaos, so main.js defaults phones to muted (still one tap to unmute).
(function () {
  const MUTE_KEY = 'eldorado-muted';
  const MUSIC_SRC = 'assets/background.mp3';
  const MUSIC_VOLUME = 0.35;

  let ctx = null;
  let master = null;
  let musicBus = null;
  let sfxBus = null;
  let muted = false;
  let musicOn = false;
  // File-backed loop: enabled by default. setMusicEnabled(false) parks it
  // (same escape hatch the old generative loop had, for tests / settings).
  let MUSIC_ENABLED = true;
  let bgAudio = null;

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
    // Autoplay policy: the first play() often rejects until a gesture.
    // Every tap retries while music was requested.
    updatePlayback();
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

  // ── Background music: vendored MP3 loop ─────────────────────────────────
  // client/assets/background.mp3 served same-origin (LAN-safe, no CDN).
  // <audio loop> is gapless enough for a first pass; if the loop clicks,
  // remaster the file with a seamless tail — no code change needed.
  function ensureTrack() {
    if (bgAudio) return bgAudio;
    try {
      const a = new Audio(MUSIC_SRC);
      a.loop = true;
      a.preload = 'auto';
      a.volume = MUSIC_VOLUME;
      bgAudio = a;
      return a;
    } catch (_) {
      return null;
    }
  }

  function updatePlayback() {
    if (!bgAudio) return;
    if (!MUSIC_ENABLED || !musicOn || muted) {
      try { bgAudio.pause(); } catch (_) { /* silent */ }
      return;
    }
    try {
      bgAudio.muted = false;
      bgAudio.volume = MUSIC_VOLUME;
      const p = bgAudio.play();
      if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay blocked — unlock() retries */ });
    } catch (_) { /* sound must never break gameplay */ }
  }

  function startMusic() {
    if (!MUSIC_ENABLED) return;
    if (!ensureTrack()) return;
    musicOn = true;
    updatePlayback();
  }

  function stopMusic() {
    musicOn = false;
    if (bgAudio) {
      try { bgAudio.pause(); } catch (_) { /* silent */ }
    }
  }

  function setMuted(m) {
    muted = !!m;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch (_) { /* preference lost — sound state still applies */ }
    if (master) master.gain.value = muted ? 0 : 1;
    updatePlayback();
  }

  function isMuted() {
    return muted;
  }

  // Kill-switch (see MUSIC_ENABLED above). Exposed so the loop stays
  // testable and a future settings UI can toggle it without code changes.
  function setMusicEnabled(on) {
    MUSIC_ENABLED = !!on;
    if (!MUSIC_ENABLED) {
      musicOn = false;
      if (bgAudio) {
        try { bgAudio.pause(); } catch (_) { /* silent */ }
      }
    } else {
      updatePlayback();
    }
  }

  window.ElDoradoAudio = {
    unlock, sfx, startMusic, stopMusic, setMuted, isMuted, hasStoredPref,
    setMusicEnabled,
  };
})();
