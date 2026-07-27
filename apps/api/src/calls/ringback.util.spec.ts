import { buildRingbackWav } from './ringback.util';

const SAMPLE_RATE = 8000;

const wav = buildRingbackWav();
const sampleCount = (wav.length - 44) / 2;
const sample = (i: number) => wav.readInt16LE(44 + i * 2) / 32768;

const rms = (from: number, to: number) => {
  let total = 0;
  for (let i = from; i < to; i++) total += sample(i) ** 2;
  return Math.sqrt(total / (to - from));
};

/** Goertzel: energy at one frequency, without pulling in an FFT dependency. */
const magnitudeAt = (freq: number, from: number, to: number) => {
  const k = 2 * Math.cos((2 * Math.PI * freq) / SAMPLE_RATE);
  let s1 = 0;
  let s2 = 0;
  for (let i = from; i < to; i++) {
    const x = sample(i) + k * s1 - s2;
    s2 = s1;
    s1 = x;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - k * s1 * s2) / (to - from);
};

describe('ringback tone', () => {
  it('is a valid PCM WAV header Twilio can play', () => {
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(SAMPLE_RATE);
    expect(wav.readUInt16LE(34)).toBe(16); // bits per sample
  });

  it('declares a chunk size matching the actual payload', () => {
    // A wrong size here plays as static or nothing at all.
    expect(wav.readUInt32LE(40)).toBe(sampleCount * 2);
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
  });

  it('runs for one full six-second ring cycle', () => {
    expect(sampleCount / SAMPLE_RATE).toBe(6);
  });

  it('rings for two seconds then goes quiet for four', () => {
    expect(rms(0, 2 * SAMPLE_RATE)).toBeGreaterThan(0.1);
    expect(rms(2 * SAMPLE_RATE, sampleCount)).toBe(0);
  });

  it('carries the North American 440 Hz and 480 Hz pair and nothing else', () => {
    const on = [0, 2 * SAMPLE_RATE] as const;
    expect(magnitudeAt(440, ...on)).toBeGreaterThan(0.1);
    expect(magnitudeAt(480, ...on)).toBeGreaterThan(0.1);
    for (const stray of [300, 600, 1000]) {
      expect(magnitudeAt(stray, ...on)).toBeLessThan(0.01);
    }
  });

  it('never clips', () => {
    // Two summed sines can overshoot; int16 wrap would be audible as a crackle.
    for (let i = 0; i < sampleCount; i++) {
      expect(Math.abs(sample(i))).toBeLessThanOrEqual(1);
    }
  });
});
