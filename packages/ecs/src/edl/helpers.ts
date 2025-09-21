import { parseEDL } from '.';
import { hashComponentDefinition } from '../schema/component-hash';
import type { CDef } from '../types';

// Helper to parse an EDL default literal from a line-tail token into a typed value
export const parseEDLDefault = (
  val: string
): string | number | boolean | Date => {
  const s = String(val).trim();
  if (s.length === 0) {
    return s;
  }
  // Preserve timestamp/date/time sentinels for downstream handling
  if (
    s === 'current_timestamp' ||
    s === 'current_date' ||
    s === 'current_time'
  ) {
    return s;
  }
  if (s === 'true') {
    return true;
  }
  if (s === 'false') {
    return false;
  }
  if (/^-?\d+$/.test(s)) {
    return Number.parseInt(s, 10);
  }
  if (/^-?\d*\.\d+$/.test(s)) {
    return Number.parseFloat(s);
  }
  // Strip surrounding quotes if present
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
};

const cdefFromEDL = (d: any) => {
  const columns = (d.columns || []).map((c: any) => ({
    foreignKey: c.foreignKey,
    isIndexed: c.isIndexed,
    isUnique: c.isUnique,
    name: c.name,
    optional: c.optional,
    type: c.type,
    values: c.values,
    // Convert simple literal defaults into typed values where possible
    default:
      typeof c.default === 'string' ? parseEDLDefault(c.default) : c.default
  }));
  const id = d.id;
  const hash = hashComponentDefinition({ columns, id });
  return {
    columns,
    hash,
    id
    // tableName: d.tableName || `tbl_${toSnakeCase(d.id) || d.id}`
  } as CDef;
};

export const parseDefsFromEDL = (edl: string) =>
  parseEDL(edl)
    .filter(
      (d: unknown) =>
        d && typeof d === 'object' && 'type' in d && d.type === 'component'
    )
    .map(cdefFromEDL);
