# Pictures

A place's Picture is an illustration shown in the transcript just before its description, when a Character arrives or looks ([ADR 0027](../../../docs/adr/0027-a-picture-travels-with-its-place-s-description.md)). This is how Porthleven's are made, so a new one matches the rest.

## Adding one

1. Generate a draft with an image model, from the prompt below with your own Subject line. A draft comes out about 2000×800 and isn't real pixel art yet. Keep drafts out of the repo.
2. Reduce it: `tools/pictures/reduce.sh <draft.png> <place_id>`. It writes `priv/edl/pictures/<place_id>.png`: 480×192, its own palette of at most 256 colours, no dithering, no metadata. Nothing else puts a file in `pictures/`, which the server publishes as it is.
3. Give the place `picture { src: "pictures/<place_id>.png" }` in its `entity` block, after `described`, never on an atom.
4. Add the prompt you used to [Prompts](#prompts), so the Picture can be drawn again.
5. Look at it in the client before committing: it shows at up to 960 pixels wide, each pixel doubled.

A World won't start or migrate while a Picture's file is missing, so a typo in `src` fails at once.

## Style

VGA-era adventure backgrounds, as original artwork. Never copy or imitate a particular game's pictures or compositions.

- **Medium:** pixel art at 480×192, with up to 256 colours, smooth colour ramps and little dithering.
- **Frame:** a wide 2.5:1 band, full bleed, seen at eye level by a visitor arriving.
- **Light:** late afternoon, warm, with cool slate shadows. Indoors, the same light comes through windows and doors.
- **Place:** Cornish slate, granite and whitewash; quiet.
- **Empty:** no people or animals, only distant gulls outdoors. Characters and NPCs move about, so a figure in a Picture would be wrong whenever they aren't there.
- **Faithful:** draw what the description says and nothing it doesn't. A lighthouse or boat the text never mentions is a promise the place can't keep.
- **Neutral state:** tidal places are drawn at mid-tide, and the lighthouse lamp unlit in daylight, since a Picture doesn't change with Play state.

### The prompt

Every Picture's prompt is these lines, with its own Subject line between them:

```text
Use case: illustration-story. Asset type: room background for a text adventure set in a Cornish harbour town. Original artwork evoking illustrated home-computer adventures of the late 1980s; do not copy any existing game's pictures or compositions. Wide landscape band, exactly 2.5:1 aspect ratio, preferably 1600x640 output. Full bleed, no text, border, frame, UI, lettering or watermark. Empty place seen at eye level as a visitor arriving; no people or creatures, except tiny distant gulls in harbour scenes. Consistent late-afternoon warm light, cool slate shadows, Cornish slate and whitewash, quiet coastal atmosphere.
Subject: <what the place's description says, and the view>
Style/medium: VGA 256-colour pixel art. Compose at a native resolution of about 320x128 with a richer 256-colour palette, smooth colour ramps and little dithering; upscale with crisp visible square pixels and no smoothing, evoking early-90s VGA adventure backgrounds.
```

Give the model two or three existing Pictures as style references, and ask it to match them as one illustration set.

## Prompts

Each Picture's Subject line, by place.

### `harbour_steps`

Worn granite steps climb from the ferry landing to the quay. The town rises beyond in terraces of slate and whitewash. Draw at mid-tide: seawater halfway up the landing, wet lower granite, exposed upper steps and quay bollards. View arriving from the ferry landing looking up the steps toward the town. The narrative mentions gulls squabbling on bollards, but for this empty-scene trial leave bollards unoccupied; only tiny distant gulls are allowed.

### `fish_market`

Slate counters under a tin roof, hosed clean after the morning's sale. A few boxes of mackerel sit on melting ice. The fish are market produce, not living creatures. Frame entirely within the roofed market, with no harbour view, boats, lighthouse or other landmarks. Match the three supplied images as style references only, as the same illustration set: the same palette feel, warm late-afternoon light and fine pixel scale. Do not borrow objects or landmarks from the references; depict only this room's described contents.

### `slipway`

A concrete slipway runs down into the harbour, green with weed below the tideline. Lobster pots are stacked against the wall, and a yard opens to the west. Draw at mid-tide, with the lower slipway submerged and a visible weed-covered tideline. No boats or lighthouse. Match the three supplied images as style references only, as the same illustration set: the same palette feel, warm late-afternoon light and fine pixel scale. Do not borrow objects or landmarks from the references; depict only this room's described contents.

### `boatyard`

A yard of cradles and empty berths beside a Cornish harbour slipway, smelling of tar and fresh-cut oak. Half-built wooden hulls stand on trestles, their exposed oak ribs and unfinished planking visible, with empty cradles and ample open yard for plenty more boats. Hand tools lie where they were left beside oak shavings, stacked timber and tar pots. The slipway descends into harbour water, with slate and whitewashed harbour buildings beyond. View at eye level as a visitor arriving in the empty yard. Match the supplied b-harbour-steps.png and b-garden-path.png style references as the same illustration set: the same palette feel, late-afternoon light and fine pixel scale.

### `square`

A cobbled square around a granite cross. The Ship stands on the west side and a chandler's shop on the east; a lane climbs north out of town, and the harbour lies south. Show these spatial relationships, with no lettering on buildings or signs. No boats or lighthouse. Match the three supplied images as style references only, as the same illustration set: the same palette feel, warm late-afternoon light and fine pixel scale. Do not borrow objects or landmarks from the references; depict only this room's described contents.

### `chandlers`

Inside the chandler's shop: rope, tar, brass fittings and oilskins crowd every shelf. Nobody minds the shop, but there's an honesty box on the counter. Warm late-afternoon light enters through a window or doorway. No text on the honesty box. Match the three supplied images as style references only, as the same illustration set: the same palette feel, warm late-afternoon light and fine pixel scale. Do not borrow objects or landmarks from the references; depict only this room's described contents.

### `hill_lane`

A steep lane between granite walls. North, a gate opens into a walled garden behind a cottage; east, the lane runs out onto the headland. No lighthouse, boats or added landmarks. Match the three supplied images as style references only, as the same illustration set: the same palette feel, warm late-afternoon light and fine pixel scale. Do not borrow objects or landmarks from the references; depict only this room's described contents.

### `ship_bar`

Inside The Ship: a low-beamed bar, its ceiling hung with glass floats and an old ship's wheel. A fire smokes in the grate, and a door at the back leads north. Warm late-afternoon light enters through a window or doorway. The entire room is empty; nobody stands behind the bar. Match the three supplied images as style references only, as the same illustration set: the same palette feel, warm late-afternoon light and fine pixel scale. Do not borrow objects or landmarks from the references; depict only this room's described contents.

### `back_room`

A cramped interior room stacked with barrels. Coats nobody came back for hang on a row of pegs. Warm late-afternoon light comes through a doorway into the room. The coats are empty garments, with no figures or silhouettes. Frame the view entirely inside the cramped room; the light source is outside the picture. No exterior view, harbour, water, cliffs, bollards, furniture or other props. Match the three supplied images as style references only, as the same illustration set: the same palette feel, warm late-afternoon light and fine pixel scale. Do not borrow objects or landmarks from the references; depict only this room's described contents.

### `garden_path`

A gravel path runs between high brick walls behind the keeper's cottage. Rose bushes crowd the borders, and a wooden shed stands at the far end. View as a visitor arriving at the entrance to the path. A glimpse of Cornish slate and whitewashed keeper's cottage establishes the shared setting. No people, birds or other creatures.

### `orchard`

Old apple trees lean together over long grass. Windfalls lie where they dropped. Only the orchard is visible, no buildings, boats, lighthouse or additional landmarks. Match the three supplied images as style references only, as the same illustration set: the same palette feel, warm late-afternoon light and fine pixel scale. Do not borrow objects or landmarks from the references; depict only this room's described contents.

### `well`

A mossy stone well sits in the middle of a small grassy clearing, with a wooden winch, rope and bucket hanging from it. The clearing is ringed by old, leaning apple trees, just north of the orchard inside the lighthouse keeper's walled garden behind his cottage. A glimpse of an old granite garden wall is visible through the trees. Late-afternoon light falls through the branches onto the grass and mossy well. Keep the view enclosed within this intimate garden clearing. No sea, sea pinks, moorland, people or animals; no cottage, lighthouse or boats visible. Match the two supplied images, orchard.png and boatyard.png, as style references only, as the same illustration set: the same palette feel, warm late-afternoon light and fine pixel scale. Do not borrow objects or landmarks from the references; depict only this room's described contents.

### `shed`

Inside the garden shed: shelves of pots and tools line the walls. Earthy surfaces and creosoted wood convey the smell of earth and creosote. Warm late-afternoon light enters through the open doorway. Frame only the interior shelves and walls; daylight enters from an unseen open doorway outside the picture. No exterior view, houses, flowers, barrel, crate, workbench, rope, extra furnishings or figures. Pots and gardening tools only. Match the three supplied images as style references only, as the same illustration set: the same palette feel, warm late-afternoon light and fine pixel scale. Do not borrow objects or landmarks from the references; depict only this room's described contents.

### `headland`

Short turf and sea pinks run out to a rocky Cornish headland point. East, to the right of the view, a causeway of weed-slick stones crosses to a lighthouse on its rocky island. Draw at mid-tide with the causeway half awash: individual wet stones clearly showing above the surface, water lapping in the gaps between them and partially covering the lower stones; do not depict a dry continuous walkway. The lighthouse is switched off in daylight: its lantern enclosure contains only dark blue-grey glass and a dark inactive lamp, with absolutely no yellow or white luminous spot, no glow and no beam. View at eye level as a visitor arriving along the turf, with sea pinks in the foreground and the island lighthouse clearly visible beyond the causeway. Match the supplied b-harbour-steps.png and b-garden-path.png style references as the same illustration set: the same palette feel, late-afternoon light and fine pixel scale.

### `lighthouse`

Inside the whitewashed foot of the lighthouse tower. Coils of rope and a can of paraffin stand by an iron stair that winds up into the dark. Warm late-afternoon light enters through the entrance. This is the interior base beside the stair, not an exterior tower view or lantern room. No boats, lamp or added landmarks. Match the three supplied images as style references only, as the same illustration set: the same palette feel, warm late-afternoon light and fine pixel scale. Do not borrow objects or landmarks from the references; depict only this room's described contents.

### `lamp_room`

A round room of glass at the top of the tower, the great lamp at its centre. Through the salt-crusted panes you can see the whole harbour in daylight. The great lamp is completely unlit: no luminous spot, glow or beam. Warm late-afternoon daylight comes through the salt-crusted glass. No people, boats or extra lighthouse in the harbour view. The floor is bare around the central lamp; no chest, rope, jar, stool, steps, tools or other furnishings. Match the three supplied images as style references only, as the same illustration set: the same palette feel, warm late-afternoon light and fine pixel scale. Do not borrow objects or landmarks from the references; depict only this room's described contents.
