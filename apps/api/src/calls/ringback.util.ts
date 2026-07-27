/**
 * A standard US ringback tone, generated rather than hosted.
 *
 * The browser dialer puts the agent in a Twilio conference on their own while
 * the seller's phone rings, and a lone participant hears the conference
 * `waitUrl`. Twilio's default there is hold music, which sounds nothing like
 * placing a call. Pointing waitUrl at this file gives the normal ring instead.
 *
 * Precise Tone Plan (North America): 440 Hz + 480 Hz played together, two
 * seconds on, four seconds off. Twilio loops the wait audio, so the six-second
 * cycle repeats on its own.
 *
 * Generated in code so there is no binary in the repo and no external asset
 * that can 404 mid-call.
 */

const SAMPLE_RATE = 8000; // 8 kHz mono is what Twilio transcodes to anyway
const TONE_HZ_A = 440;
const TONE_HZ_B = 480;
const ON_SECONDS = 2;
const OFF_SECONDS = 4;

/** Peak per tone. Two summed sines at 0.3 stay clear of clipping at 0.6. */
const AMPLITUDE = 0.3;

/**
 * A 16-bit PCM mono WAV of one full ring cycle (2s tone, 4s silence).
 *
 * Deterministic: same bytes every call, so it can be built once and cached.
 */
export function buildRingbackWav(): Buffer {
  const totalSamples = SAMPLE_RATE * (ON_SECONDS + OFF_SECONDS);
  const onSamples = SAMPLE_RATE * ON_SECONDS;
  const dataBytes = totalSamples * 2; // 16-bit => 2 bytes per sample

  const buffer = Buffer.alloc(44 + dataBytes);

  // ── RIFF header ──────────────────────────────────────────────────────────
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4); // file size minus the first 8 bytes
  buffer.write('WAVE', 8, 'ascii');

  // ── fmt chunk ────────────────────────────────────────────────────────────
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // audio format: 1 = PCM
  buffer.writeUInt16LE(1, 22); // channels: mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate: rate * channels * bytes
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample

  // ── data chunk ───────────────────────────────────────────────────────────
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < totalSamples; i++) {
    let sample = 0;
    if (i < onSamples) {
      const t = i / SAMPLE_RATE;
      sample =
        AMPLITUDE * Math.sin(2 * Math.PI * TONE_HZ_A * t) +
        AMPLITUDE * Math.sin(2 * Math.PI * TONE_HZ_B * t);
    }
    // Clamp before scaling so a rounding overshoot cannot wrap the int16.
    const clamped = Math.max(-1, Math.min(1, sample));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }

  return buffer;
}

/** Built once at module load; the bytes never change. */
export const RINGBACK_WAV = buildRingbackWav();
