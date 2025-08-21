
export const objectHasProperties = <T extends object>(object: T, properties: Partial<T>) => {
  for (const [key, value] of Object.entries(properties)) {
    if (object[key as keyof T] !== value) {
      return false;
    }
  }
  return true;
}
