/** Install repeatable wall-clock and random inputs for one node:test case. */
export function installDeterministicInputs(seed: number, now: number): () => void {
  const originalRandom = Math.random;
  const originalNow = Date.now;
  let state = seed >>> 0;

  Math.random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
  Date.now = () => now;

  return () => {
    Math.random = originalRandom;
    Date.now = originalNow;
  };
}
