import { prngInt, prngIntRange } from '../random';
import { toCapitalized } from '../string';

type PasswordGeneratorOptions = {
  seed?: number;
};

type PasswordGenerateOptions = {
  wordCount?: number;
  separator?: string;
  capitalise?: boolean;
  includeNumber?: boolean;
  includeSymbol?: boolean;
};

const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';
const numbers = '123456789';

const getRandomSymbol = (seed: number): [number, string] => {
  const [next, index] = prngIntRange(seed, 0, symbols.length - 1);
  return [next, symbols.at(index)!];
};

const getRandomNumber = (seed: number): [number, string] => {
  const [next, index] = prngIntRange(seed, 0, numbers.length - 1);
  return [next, numbers.at(index)!];
};

export const createPasswordGenerator = async ({
  seed = Math.floor(Math.random() * 1000000),
}: PasswordGeneratorOptions = {}) => {
  seed = seed ?? Math.floor(Math.random() * 1000000);

  // work the seed to ensure it is in a good state
  for (let i = 0; i < 10; i++) {
    const [initSeed] = prngInt(seed);
    seed = initSeed;
  }

  // read the file from the same directory
  const file = Bun.file(new URL('eff_large_wordlist.txt', import.meta.url));

  const words = (await file.text())
    .split('\n')
    .map((line) => line.trim().split(/\s+/).pop()) // last column = word
    .filter(Boolean) as string[];

  return {
    generate: (options: PasswordGenerateOptions = {}) => {
      const {
        wordCount = 4,
        separator = '-',
        capitalise = true,
        includeNumber = true,
        includeSymbol = false,
      } = options;

      let result: string[] = [];

      for (let i = 0; i < wordCount; i++) {
        const [next, index] = prngIntRange(seed, 0, words.length - 1);
        seed = next;
        const word = words[index]!;
        if (capitalise) {
          result.push(toCapitalized(word));
        } else {
          result.push(word);
        }
      }
      if (includeNumber) {
        // select a random word and append a random number
        const [nextR, index] = prngIntRange(seed, 0, result.length - 1);
        seed = nextR;
        const word = result[index]!;
        const [nextN, number] = getRandomNumber(seed);
        seed = nextN;
        result[index] = word + number;
      }

      if (includeSymbol) {
        // select a random word and append a random symbol
        const [nextR, index] = prngIntRange(seed, 0, result.length - 1);
        seed = nextR;
        const word = result[index]!;
        const [nextS, symbol] = getRandomSymbol(seed);
        seed = nextS;
        result[index] = word + symbol;
      }

      return result.join(separator);
    },
  };
};
