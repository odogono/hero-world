import type { Database } from '../db';
import type { Components } from '../types';
import type { World } from '../world';

/** An atom or entity that owns a Script, with the Script's source path */
export type ScriptOwner =
  | { kind: 'atom'; name: string; src: string }
  | { eid: number; kind: 'entity'; src: string };

/**
 * What a Build or Migration recorded about a world's EDL: Lineage, Script
 * owners, Definition names, the EDL values of components and the EDL's
 * hash. Only the EDL module writes it; World passes on the reads that
 * ecs-talk and mua use.
 */
export class EDLRecord {
  private readonly atomLineage = new Map<string, string[]>();
  private readonly entityLineage = new Map<number, string[]>();
  private readonly atomScripts = new Map<string, string>();
  private readonly entityScripts = new Map<number, string>();

  constructor(private readonly db: Database) {
    db.exec(
      `CREATE TABLE IF NOT EXISTS tbl_lineage (kind TEXT NOT NULL, name TEXT NOT NULL, bases TEXT NOT NULL, PRIMARY KEY (kind, name))`
    );
    db.exec(
      `CREATE TABLE IF NOT EXISTS tbl_script_owner (kind TEXT NOT NULL, name TEXT NOT NULL, src TEXT NOT NULL, PRIMARY KEY (kind, name))`
    );
    db.exec(
      `CREATE TABLE IF NOT EXISTS tbl_definition_name (name TEXT PRIMARY KEY, eid INTEGER NOT NULL)`
    );
    db.exec(
      `CREATE TABLE IF NOT EXISTS tbl_edl (key TEXT PRIMARY KEY, value TEXT NOT NULL)`
    );
    db.exec(
      `CREATE TABLE IF NOT EXISTS tbl_edl_value (eid INTEGER NOT NULL, component TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (eid, component))`
    );

    const lineage = db.query('SELECT kind, name, bases FROM tbl_lineage') as {
      bases: string;
      kind: string;
      name: string;
    }[];
    for (const { bases, kind, name } of lineage) {
      const parsed = JSON.parse(bases) as string[];
      if (kind === 'atom') {
        this.atomLineage.set(name, parsed);
      } else {
        this.entityLineage.set(Number(name), parsed);
      }
    }
    const owners = db.query('SELECT kind, name, src FROM tbl_script_owner') as {
      kind: string;
      name: string;
      src: string;
    }[];
    for (const { kind, name, src } of owners) {
      if (kind === 'atom') {
        this.atomScripts.set(name, src);
      } else {
        this.entityScripts.set(Number(name), src);
      }
    }
  }

  /** Whether a Build or Migration has recorded anything */
  isBuilt() {
    return (
      this.getEDLHash() !== undefined || this.getDefinitionNames().size > 0
    );
  }

  // Atoms

  /** The ordered base atoms an atom extends, or undefined if no such atom */
  getAtomLineage(name: string): string[] | undefined {
    const lineage = this.atomLineage.get(name);
    return lineage ? [...lineage] : undefined;
  }

  atomNames(): string[] {
    return [...this.atomLineage.keys()];
  }

  /** Forget every atom's Lineage and Script */
  clearAtoms() {
    this.atomLineage.clear();
    this.atomScripts.clear();
    this.db.exec("DELETE FROM tbl_lineage WHERE kind = 'atom'");
    this.db.exec("DELETE FROM tbl_script_owner WHERE kind = 'atom'");
  }

  /** Record an atom's bases, and the Script it owns, if any */
  setAtom(name: string, bases: readonly string[], src: string | undefined) {
    this.atomLineage.set(name, [...bases]);
    this.db.exec(
      'INSERT OR REPLACE INTO tbl_lineage (kind, name, bases) VALUES (?1, ?2, ?3)',
      ['atom', name, JSON.stringify(bases)]
    );
    if (src) {
      this.atomScripts.set(name, src);
      this.db.exec(
        'INSERT OR REPLACE INTO tbl_script_owner (kind, name, src) VALUES (?1, ?2, ?3)',
        ['atom', name, src]
      );
    }
  }

  // Entities

  /** The ordered base atoms an entity was built from (empty if none) */
  getEntityLineage(eid: number): string[] {
    return [...(this.entityLineage.get(eid) ?? [])];
  }

  setEntityLineage(eid: number, bases: readonly string[]) {
    this.entityLineage.set(eid, [...bases]);
    this.db.exec(
      'INSERT OR REPLACE INTO tbl_lineage (kind, name, bases) VALUES (?1, ?2, ?3)',
      ['entity', String(eid), JSON.stringify(bases)]
    );
  }

  /** Record the Script an entity owns, or that it owns none */
  setEntityScript(eid: number, src: string | undefined) {
    this.entityScripts.delete(eid);
    this.db.exec(
      "DELETE FROM tbl_script_owner WHERE kind = 'entity' AND name = ?1",
      [String(eid)]
    );
    if (src) {
      this.entityScripts.set(eid, src);
      this.db.exec(
        'INSERT OR REPLACE INTO tbl_script_owner (kind, name, src) VALUES (?1, ?2, ?3)',
        ['entity', String(eid), src]
      );
    }
  }

  /** Atoms and entities that own a Script, with the Script's source path */
  getScriptOwners(): ScriptOwner[] {
    return [
      ...[...this.atomScripts].map(([name, src]) => ({
        kind: 'atom' as const,
        name,
        src
      })),
      ...[...this.entityScripts].map(([eid, src]) => ({
        eid,
        kind: 'entity' as const,
        src
      }))
    ];
  }

  // Definition names

  /** Each Definition name the EDL gave, with the id of its entity */
  getDefinitionNames(): Map<string, number> {
    const rows = this.db.query('SELECT name, eid FROM tbl_definition_name') as {
      eid: number;
      name: string;
    }[];
    return new Map(rows.map(({ eid, name }) => [name, eid]));
  }

  setDefinitionName(name: string, eid: number) {
    this.db.exec(
      'INSERT OR REPLACE INTO tbl_definition_name (name, eid) VALUES (?1, ?2)',
      [name, eid]
    );
  }

  /** Forget a Definition name, once its entity is out of play */
  deleteDefinitionName(name: string) {
    this.db.exec('DELETE FROM tbl_definition_name WHERE name = ?1', [name]);
  }

  // EDL values

  /** Each component's value, normalised, as the EDL last set it */
  getEDLValues(eid: number): Map<string, string> {
    const rows = this.db.query(
      'SELECT component, value FROM tbl_edl_value WHERE eid = ?1',
      [eid]
    ) as { component: string; value: string }[];
    return new Map(rows.map(({ component, value }) => [component, value]));
  }

  /** Replace the values the EDL last set on an entity */
  setEDLValues(eid: number, values: ReadonlyMap<string, string>) {
    this.db.exec('DELETE FROM tbl_edl_value WHERE eid = ?1', [eid]);
    for (const [component, value] of values) {
      this.db.exec(
        'INSERT INTO tbl_edl_value (eid, component, value) VALUES (?1, ?2, ?3)',
        [eid, component, value]
      );
    }
  }

  // Hash

  /** The hash of the EDL the world was last built or migrated from */
  getEDLHash(): string | undefined {
    const rows = this.db.query(
      "SELECT value FROM tbl_edl WHERE key = 'hash'"
    ) as { value: string }[];
    return rows[0]?.value;
  }

  setEDLHash(hash: string) {
    this.db.exec(
      "INSERT OR REPLACE INTO tbl_edl (key, value) VALUES ('hash', ?1)",
      [hash]
    );
  }
}

const records = new WeakMap<object, EDLRecord>();

/** A world's EDL record, read from its database the first time it is asked for */
export const edlRecord = <T extends Components>(world: World<T>): EDLRecord => {
  let record = records.get(world);
  if (!record) {
    record = new EDLRecord(world.db);
    records.set(world, record);
  }
  return record;
};
