export const generateHash = (data: unknown): string => {
  const dataString = typeof data === 'string' ? data : JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < dataString.length; i++) {
    const char = dataString.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36); // Convert to base36 for shorter string
};

export const fastHash = async (data: unknown): Promise<string> => {
  const dataString = typeof data === 'string' ? data : JSON.stringify(data);
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(dataString)
  );
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};
