/**
 * The Message Path above a definition's bases: each base, rightmost first,
 * followed by its own bases, with an atom reached more than once kept only at
 * its last place, so a shared ancestor comes after every atom built on it.
 * `vase: box fragile`, both built on `thing`, climbs fragile, box, thing. As
 * `OdgnEcsTalk.MessagePath.linearize/2`.
 */
export const linearize = (
  bases: readonly string[],
  lineage: (atom: string) => readonly string[] | undefined
): string[] => {
  const order: string[] = [];
  // Each atom, then its bases, depth first; `climbing` breaks a cycle
  const visit = (atoms: readonly string[], climbing: ReadonlySet<string>) => {
    for (const atom of [...atoms].reverse()) {
      if (!climbing.has(atom)) {
        order.push(atom);
        visit(lineage(atom) ?? [], new Set([...climbing, atom]));
      }
    }
  };
  visit(bases, new Set());
  return order.filter((atom, index) => order.lastIndexOf(atom) === index);
};
