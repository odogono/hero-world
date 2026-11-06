# Recipes are not Atoms

Players save compositions to build from in the in-world composer (#149). These are Recipes, not Atoms. An Atom is a template in the EDL: entities and other atoms extend it, and their Lineage remembers it. A Recipe is saved during play, only makes new entities, and keeps no tie to them. Changing a Recipe changes only what is made from it afterwards. A Recipe is an Entity in Limbo, with a component naming the Account that owns it and whether it is shared, as Accounts are Entities (ADR 0016).

We considered making player-saved compositions Atoms, so that changing one would change every entity made from it. That would let one player's edit change things other players own and use. It would mean writing Atoms during play, when until now only the EDL defined them. A Migration would also have to tell a player's Atoms apart from the EDL's.

## Consequences

- There are two kinds of template, and the glossary keeps them apart.
- Recipes are in the World, so backups, Migrations and permission checks cover them with no storage of their own. A Migration leaves them alone, since they have no Definition name.
- Turning a Recipe into an Atom in the EDL would be an export, done by an author. It is not part of #149's first milestone.
