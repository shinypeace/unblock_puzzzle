let context,
  muted = false,
  enabled = true,
  musicUrl = null,
  musicLoading = null,
  musicSource = null;
export function configureAudio(base, file, value) {
  musicUrl = file ? new URL(file, base).href : null;
  enabled = value;
}
export function setAudioEnabled(value) {
  enabled = value;
  if (!enabled) context?.suspend().catch(() => {});
  else void unlockAudio();
}
export async function unlockAudio() {
  if (!enabled || muted) return;
  try {
    context ||= new (window.AudioContext || window.webkitAudioContext)();
    await context.resume();
    if (!musicUrl || musicSource) return;
    // Decode audio bytes directly: music.png deliberately has an image extension.
    musicLoading ||= fetch(musicUrl)
      .then((r) => {
        if (!r.ok) throw new Error("Music unavailable");
        return r.arrayBuffer();
      })
      .then((bytes) => context.decodeAudioData(bytes))
      .catch(() => null);
    const buffer = await musicLoading;
    if (!buffer || musicSource) return;
    const gain = context.createGain();
    gain.gain.value = 0.22;
    musicSource = context.createBufferSource();
    musicSource.buffer = buffer;
    musicSource.loop = true;
    musicSource.connect(gain);
    gain.connect(context.destination);
    musicSource.start();
    if (muted || !enabled) await context.suspend();
  } catch {
    /* Audio may remain blocked until the next user gesture. */
  }
}
export function muteAudio(value) {
  muted = value;
  if (value) context?.suspend().catch(() => {});
  else if (enabled) void unlockAudio();
}
export function sound(kind, enabled = true) {
  if (!enabled || muted) return;
  try {
    context ||= new (window.AudioContext || window.webkitAudioContext)();
    if (context.state === "suspended") context.resume();
    const t = context.currentTime;
    const notes =
      kind === "win"
        ? [523.25, 659.25, 783.99, 1046.5]
        : kind === "buy"
          ? [659.25, 880]
          : kind === "tap"
            ? [420]
            : [260];
    notes.forEach((freq, i) => {
      const o = context.createOscillator(),
        g = context.createGain();
      o.type = kind === "move" ? "sine" : "triangle";
      o.frequency.setValueAtTime(freq, t + i * 0.095);
      if (kind === "move")
        o.frequency.exponentialRampToValueAtTime(130, t + 0.09);
      g.gain.setValueAtTime(0, t + i * 0.095);
      g.gain.linearRampToValueAtTime(0.055, t + i * 0.095 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.095 + 0.18);
      o.connect(g);
      g.connect(context.destination);
      o.start(t + i * 0.095);
      o.stop(t + i * 0.095 + 0.2);
    });
  } catch {}
}
