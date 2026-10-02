let context,
  muted = false;
export function muteAudio(value) {
  muted = value;
  if (value) context?.suspend().catch(() => {});
  else context?.resume().catch(() => {});
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
