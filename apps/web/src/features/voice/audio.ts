"use client";

/**
 * Audio for the live voice guide (VOICE.md §3.1): the mic is captured in an AudioWorklet,
 * downsampled to 16 kHz mono and sent as 16-bit PCM frames of 20 ms; the guide's 24 kHz PCM
 * replies are queued back to back and stopped at once on barge-in. Nothing is recorded or stored.
 */

/** Served from public/: worklets load under script-src, which allows 'self' but not blob:. */
const WORKLET_URL = "/voice/pcm16-worklet.js";

export interface Mic {
  stop(): void;
}

/** Closes a context once; a second close (socket close and unmount both clean up) is a no-op. */
function closeContext(ctx: AudioContext | null): void {
  if (ctx && ctx.state !== "closed") ctx.close().catch(() => {});
}

/** Starts the mic; onFrame receives 20 ms PCM16 16 kHz frames. Rejects when the mic is denied. */
export async function startMic(onFrame: (pcm: ArrayBuffer) => void): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const ctx = new AudioContext();
  const release = () => {
    for (const t of stream.getTracks()) t.stop();
    closeContext(ctx);
  };
  let src: MediaStreamAudioSourceNode;
  let node: AudioWorkletNode;
  try {
    await ctx.audioWorklet.addModule(WORKLET_URL);
    // Chrome starts a context created outside a gesture suspended: no frames would flow.
    if (ctx.state === "suspended") await ctx.resume();
    src = ctx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(ctx, "md-pcm16");
  } catch (e) {
    release(); // never leave the mic light on after a failed start
    throw e;
  }
  node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onFrame(e.data);
  src.connect(node);
  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      node.port.onmessage = null;
      src.disconnect();
      release();
    },
  };
}

/** Queues PCM16 24 kHz chunks (Gemini Live) or whole WAV files (the Dogri cascade's Bulbul voice). */
export class Player {
  private ctx: AudioContext | null = null;
  private at = 0;
  private live = new Set<AudioBufferSourceNode>();

  private context(): AudioContext {
    this.ctx ??= new AudioContext({ sampleRate: 24000 });
    // Created after a socket message (no gesture), so it may start suspended: no sound otherwise.
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  async play(chunk: ArrayBuffer): Promise<void> {
    const ctx = this.context();
    let buf: AudioBuffer;
    const head = new Uint8Array(chunk, 0, Math.min(4, chunk.byteLength));
    if (String.fromCharCode(...head) === "RIFF") {
      buf = await ctx.decodeAudioData(chunk.slice(0));
    } else {
      const pcm = new Int16Array(chunk.slice(0, chunk.byteLength - (chunk.byteLength % 2)));
      buf = ctx.createBuffer(1, pcm.length, 24000);
      const data = buf.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) data[i] = (pcm[i] ?? 0) / 0x8000;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    this.at = Math.max(this.at, ctx.currentTime);
    src.start(this.at);
    this.at += buf.duration;
    this.live.add(src);
    src.onended = () => this.live.delete(src);
  }

  /** Barge-in: stop everything queued (VOICE.md §3.1, within 100 ms). */
  stop(): void {
    for (const s of this.live) {
      try {
        s.stop();
      } catch {
        // already ended
      }
    }
    this.live.clear();
    this.at = 0;
  }

  close(): void {
    this.stop();
    closeContext(this.ctx);
    this.ctx = null;
  }
}
