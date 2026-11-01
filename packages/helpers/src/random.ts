export const prng = (seed: number): number => (seed * 16_807) % 2_147_483_647;

/**
 * provides the next psuedo-random number as
 * an unsigned integer (31 bits)
 * @param seed
 * @returns
 */
export const prngInt = (seed: number): [number, number] => {
  const next = prng(seed);
  return [next, next];
};

/**
 * Returns a tuple of [seed, unsigned integer (31 bits)]
 */
export const prngUnsignedInt = (seed: number): [number, number] => {
  const [next, value] = prngInt(seed);
  return [next, value & 0x7f_ff_ff_ff];
};

/**
 * Returns a tuple of [seed, float between nearly 0 and nearly 1]
 */
export const prngDouble = (seed: number): [number, number] => {
  const next = prng(seed);
  return [next, seed / 2_147_483_647];
};

export const prngBoolean = (seed: number): [number, boolean] => {
  const next = prng(seed);
  return [next, next % 2 === 0];
};

export const prngIntRange = (
  seed: number,
  min: number,
  max: number
): [number, number] => {
  const [next, double] = prngDouble(seed);
  return [next, Math.round(min + (max - min) * double)];
};

export const prngDoubleRange = (
  seed: number,
  min: number,
  max: number
): [number, number] => {
  const [next, double] = prngDouble(seed);
  return [next, min + (max - min) * double];
};

export const prngShuffle = <T>(seed: number, array: T[]): [number, T[]] => {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const [next, j] = prngIntRange(seed, 0, i);
    seed = next;
    // i and j are both within the array
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return [seed, result];
};

export const randomUnsignedInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

/**
 * djb2 hash function
 * @param str
 * @returns
 */
export const djb2Hash = (str: string) => {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i); /* hash * 33 + c */
  }
  return hash >>> 0; // Ensure it's a positive integer
};

// Seeded random number generator
export const seededRandomUnsignedInt = (seed: number) => {
  const x = Math.sin(seed++) * 10_000;
  return x - Math.floor(x);
};
