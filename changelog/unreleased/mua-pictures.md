---
type: feat
scope: mua
---

Places can have a Picture, an illustration shown in the transcript just before the place's description, when you arrive or look. The Harbour Steps, the Boatyard and the Headland have the first ones, in VGA-style pixel art. The newest Picture shows and older ones fold to their place's name, which shows them again when clicked; the profile menu sets Pictures to shown, folded or off. A place gets one with `picture { src: "pictures/<file>.png" }`, a file in `pictures/` beside the EDL, and a World won't start or migrate while a Picture's file is missing.
