// Mic capture for the live voice guide (src/features/voice/audio.ts): downsample to 16 kHz mono
// PCM16 frames of 20 ms. A static file because the CSP script-src (which governs worklets) has no blob:.
class Pcm16 extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = [];
    this.ratio = sampleRate / 16000;
    this.acc = 0;
    this.sum = 0;
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.sum += ch[i];
      this.n++;
      this.acc += 1;
      if (this.acc >= this.ratio) {
        const v = Math.max(-1, Math.min(1, this.sum / this.n));
        this.buf.push(v < 0 ? v * 0x8000 : v * 0x7fff);
        this.acc -= this.ratio;
        this.sum = 0;
        this.n = 0;
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
