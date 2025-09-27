import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { uuidv7 } from './uuid';

export const withTempFile = async <T>(
  fn: (filePath: string) => Promise<T> | T,
  ext: string = '.tmp'
): Promise<T> => {
  // Create unique temp directory
  const tempDir = mkdtempSync(join(tmpdir(), 'odgn'));
  const filePath = join(tempDir, `${uuidv7()}${ext}`);

  try {
    // Run caller’s code
    return await fn(filePath);
  } finally {
    // Cleanup temp directory and file
    rmSync(tempDir, { recursive: true, force: true });
  }
};

export const makeTempFile = (ext: string = '.tmp') => {
  const filePath = join(tmpdir(), `${uuidv7()}${ext}`);
  return filePath;
};

export const deleteTempFile = (filePath: string) => {
  rmSync(filePath, { force: true });
};
