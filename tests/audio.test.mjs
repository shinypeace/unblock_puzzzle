import test from "node:test";
import assert from "node:assert/strict";

test("music uses audio bytes despite .png, loops once and follows mute/settings", async () => {
  const events = [];
  class AudioContext {
    state = "suspended";
    destination = {};
    async resume() {
      this.state = "running";
      events.push("resume");
    }
    async suspend() {
      this.state = "suspended";
      events.push("suspend");
    }
    async decodeAudioData(bytes) {
      assert.equal(bytes.byteLength, 4);
      events.push("decode");
      return {};
    }
    createGain() {
      return { gain: {}, connect() {} };
    }
    createBufferSource() {
      return {
        connect() {},
        start() {
          assert.equal(this.loop, true);
          events.push("start");
        },
      };
    }
  }
  const oldWindow = global.window,
    oldFetch = global.fetch;
  global.window = { AudioContext };
  global.fetch = async (url) => {
    assert.equal(url, "https://example.test/game/music.png");
    events.push("fetch");
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
  };
  try {
    const audio = await import("../src/audio.js?lifecycle");
    audio.configureAudio("https://example.test/game/", "music.png", true);
    assert.deepEqual(events, []);
    await Promise.all([audio.unlockAudio(), audio.unlockAudio()]);
    assert.equal(events.filter((e) => e === "fetch").length, 1);
    assert.equal(events.filter((e) => e === "start").length, 1);
    audio.muteAudio(true);
    assert.equal(events.at(-1), "suspend");
    audio.setAudioEnabled(false);
    audio.muteAudio(false);
    assert.equal(events.at(-1), "suspend");
    audio.setAudioEnabled(true);
    await audio.unlockAudio();
    assert.equal(events.at(-1), "resume");
    assert.equal(events.filter((e) => e === "start").length, 1);
  } finally {
    global.window = oldWindow;
    global.fetch = oldFetch;
  }
});

test("missing optional music does not fetch or prevent sound initialization", async () => {
  const oldWindow = global.window,
    oldFetch = global.fetch;
  global.window = {
    AudioContext: class {
      async resume() {}
    },
  };
  global.fetch = () => {
    throw Error("No music request expected");
  };
  try {
    const audio = await import("../src/audio.js?absent");
    audio.configureAudio("https://example.test/", null, true);
    await audio.unlockAudio();
  } finally {
    global.window = oldWindow;
    global.fetch = oldFetch;
  }
});
