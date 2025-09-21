export const uuidv7 = (): string => {
  if (typeof Bun !== 'undefined') {
    return Bun.randomUUIDv7();
  }

  // Current timestamp in milliseconds
  const time = BigInt(Date.now());

  // 16 bytes of randomness (128 bits)
  const rnds = new Uint8Array(16);

  crypto.getRandomValues(rnds);

  // Put timestamp into the most significant 48 bits
  const timeHex = time.toString(16).padStart(12, '0');

  // Convert random into hex
  const rndHex = Array.from(rnds, (b) => b.toString(16).padStart(2, '0')).join(
    ''
  );

  // Stitch together timestamp + randomness
  let hex = (timeHex + rndHex).slice(0, 32);

  // Set version (7) in the UUID
  hex = hex.substring(0, 12) + '7' + hex.substring(13);

  // Set the variant bits (10xx)
  const variantNibble = (parseInt(hex[16], 16) & 0x3) | 0x8;
  hex = hex.substring(0, 16) + variantNibble.toString(16) + hex.substring(17);

  // Format as UUID string
  return (
    hex.substring(0, 8) +
    '-' +
    hex.substring(8, 12) +
    '-' +
    hex.substring(12, 16) +
    '-' +
    hex.substring(16, 20) +
    '-' +
    hex.substring(20)
  );
};
