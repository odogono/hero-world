import { diff as basicDiff, detailedDiff } from 'deep-object-diff';
import jsonpatch from 'fast-json-patch';

export const isObjectEqual = (a: object, b: object) => {
  return Object.keys(basicDiff(a, b)).length === 0;
};

export const getObjectDiff = (a: object, b: object) => {
  return detailedDiff(a, b);
};

/**
 * Compare two objects and return a JSON patch object that can be applied to the first object to make it equal to the second object
 * or an empty array if the objects are equal
 *
 * @param a - The first object to compare
 * @param b - The second object to compare
 * @returns A JSON patch object that can be applied to the first object to make it equal to the second object
 */
export const compareObjects = (a: object, b: object) => {
  return jsonpatch.compare(a, b);
};
