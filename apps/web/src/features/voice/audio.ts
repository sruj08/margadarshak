"use client";

/**
 * Audio for the live voice guide (VOICE.md §3.1): the mic is captured in an AudioWorklet,
 * downsampled to 16 kHz mono and sent as 16-bit PCM frames of 20 ms; the guide's 24 kHz PCM
 * replies are queued back to back and stopped at once on barge-in. Nothing is recorded or stored.
 */

const WORKLET = `
class Pcm16 extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.ratio = sampleRate / 16000; this.acc = 0; this.sum = 0; this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.sum += ch[i]; this.n++; this.acc += 1;
      if (this.acc >= this.ratio) {
        const v = Math.max(-1, Math.min(1, this.sum / this.n));
        this.buf.push(v < 0 ? v * 0x8000 : v * 0x7fff);
        this.acc -= this.ratio; this.sum = 0; this.n = 0;
      }
    }
    if (this.buf.length >= 320) {
      const out = new Int16Array(this.buf.splice(0, 320));
      this.port.postMessage(out.buffer, [out.buffer]);
    }
    return true;
  }
}
registerProcessor("md-pcm16", Pcm16);
`;

export interface Mic {
  stop(): void;
}

/** Starts the mic; onFrame receives 20 ms PCM16 16 kHz frames. Rejects when the mic is denied. */
export async function startMic(onFrame: (pcm: ArrayBuffer) => void): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const ctx = new AudioContext();
  const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "md-pcm16");
  node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onFrame(e.data);
  src.connect(node);
  return {
    stop() {
      node.port.onmessage = null;
      src.disconnect();
      for (const t of stream.getTracks()) t.stop();
      void ctx.close();
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
    void this.ctx?.close();
    this.ctx = null;
  }
}
