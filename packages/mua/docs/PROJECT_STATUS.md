# MUA Project Status & Recommendations

**Last Updated:** 2026-01-12

## Current State Summary

You've built a **solid foundation** for a Multi-User Adventure (MUD) server with approximately **770 lines of core code**. The architecture is clean and well-tested, featuring:

**✅ Completed Infrastructure:**
- ECS-based game engine with SQLite persistence
- OAuth2 Device Authorization Flow for CLI authentication
- WebSocket server with message validation (Zod schemas)
- EDL world loader with a Zork-inspired demo world (4 rooms, mailbox, leaflet)
- Terminal UI client with OpenTUI
- ORPC type-safe API layer
- Comprehensive test coverage (~500 lines of tests)

**⚠️ Partially Implemented:**
- **Authentication system**: Structure exists but login command handling commented out
- **Connection lifecycle**: Tracks connection state but doesn't create player entities
- **Command processing**: `onConnectionCommand()` just logs, no parsing/execution
- **Event system**: Architecture documented in comments but not implemented

**❌ Missing Core Game Mechanics:**
- Command parser (interpret "go north", "take leaflet", etc.)
- Action system (look, move, take, drop, etc.)
- Player entity creation and persistence
- Game output formatting and broadcasting
- Container/inventory interactions

---

## Suggested Directions & Improvements

### **Priority 1: Complete the Game Loop** 🎮

The most impactful next step is implementing the **command → action → output** pipeline:

1. **Command Parser** (`src/server/mua-world/commands/`)
   - Parse player input into command objects
   - Pattern matching for verbs: `go|move|north`, `take|get`, `look|examine`
   - Handle aliases and shortcuts (`n` → `go north`)

2. **Action System** (`src/server/mua-world/actions/`)
   - Implement core verbs:
     - `lookAction`: Describe room, list contents/exits
     - `moveAction`: Navigate through portals, update `contained` component
     - `takeAction`: Move item from room to player inventory
     - `dropAction`: Reverse of take
   - Use ECS queries to check preconditions (is item here? is exit valid?)

3. **Output Formatter** (`src/server/mua-world/output/`)
   - Convert game state changes to narrative text
   - Template system for descriptions (you already have `described` component)
   - Broadcast to relevant connections (current room observers)

4. **Player Entity Management**
   - When authenticated, create `player` component linked to connection
   - Spawn player in starting room (add `contained{container: west_of_house}`)
   - Persist player state between sessions

**Why this priority?** You can't really test or demonstrate the MUA world until players can interact with it. This makes the existing EDL world "playable."

---

### **Priority 2: Leverage Your Event System Architecture** 📡

Your test file `event.test.ts` contains excellent architectural notes about the Java MUA's event system:

```
Input Event -> Parse Event -> Named Event -> Bound Event -> Action -> Outbound Event
```

**Recommendation:** Implement this as an ECS event pipeline:

1. **Event Components** (add to `coms.ts`):
   ```typescript
   // Represents a pending command to be processed
   inputEvent: { wsId: string, text: string, timestamp: number }

   // Represents a parsed command ready for execution
   commandEvent: { verb: string, target?: string, args: string[] }

   // Represents output to be sent to client
   outputEvent: { wsId: string, message: string }
   ```

2. **Processing Systems** (add to `MuaWorld`):
   - `inputSystem`: Create `inputEvent` entities from WebSocket messages
   - `parseSystem`: Convert `inputEvent` → `commandEvent`
   - `actionSystem`: Execute `commandEvent`, modify world state
   - `outputSystem`: Generate and send `outputEvent` messages

**Why this approach?** It aligns with your documented design, keeps systems decoupled, and enables features like:
- Command queuing/throttling
- Undo/replay (events are persisted in SQLite)
- Multi-action commands ("go north then take leaflet")
- Observability (query event history)

---

### **Priority 3: Improve EDL World Authoring** 📝

Your EDL integration is powerful but could be more developer-friendly:

1. **Hot Reload**: Watch `main.edl` for changes and reload world
   - Use `Bun.file().watch()` or `chokidar`
   - Call `muaWorld.reloadFromEdl()` on change

2. **EDL Validation**: Catch errors before runtime
   - Verify entity references (`$west_of_house` must exist)
   - Check portal bidirectionality (north exit has matching south)
   - Validate component schemas match ECS definitions

3. **EDL Tooling**:
   - `bun run edl:format` - Auto-format EDL files
   - `bun run edl:check` - Lint world definition
   - `bun run edl:graph` - Visualize room connections

4. **Extend World Content**:
   - Add more rooms (basement, attic, forest path)
   - Add interactive objects (door with lock, lamp, sword)
   - Add NPCs (enemies, vendors, quest givers)

**Why this priority?** EDL is your competitive advantage - making it exceptional will differentiate MUA from traditional MUD servers.

---

### **Priority 4: Authentication & Security** 🔐

Your OAuth2 implementation is well-structured but needs production hardening:

1. **Real OAuth Integration**:
   - Replace `MOCK_TOKEN` with actual Google OAuth flow
   - Add GitHub/Discord as alternative providers
   - Store tokens in SQLite (encrypted at rest)

2. **Session Management**:
   - Add `session` component with expiration
   - Refresh token flow before expiry
   - Multi-device support (same account, multiple connections)

3. **Authorization**:
   - Add `admin` component for privileged commands
   - Implement ACL for world modification (who can create rooms?)
   - Rate limiting on commands

4. **DEVICE_AUTH.md Updates**:
   - Document production deployment (environment variables)
   - Add security considerations (token rotation, HTTPS requirements)

**Why this priority?** Your auth flow is unique (device flow for CLI) - polishing it makes MUA production-ready.

---

### **Priority 5: TUI Client Enhancements** 💻

Your terminal client is functional but basic. Enhance the player experience:

1. **Game Output Display**:
   - Replace demo boxes with actual game messages
   - Scrolling text area for room descriptions/events
   - Status bar (HP, location, time)

2. **Command History**:
   - Up/down arrows to recall previous commands
   - Command completion (tab to autocomplete verbs/objects)

3. **Visual Improvements**:
   - ASCII art map of current area
   - Color coding (exits in green, items in yellow, NPCs in blue)
   - Split panes (output + inventory + room map)

4. **Testing Mode**:
   - Record/replay command sequences
   - Performance metrics overlay
   - Debug inspector for entity/component state

**Why this priority?** A polished TUI makes development faster and showcases the project's sophistication.

---

### **Priority 6: Performance & Scalability** ⚡

Optimize for multi-user scenarios:

1. **Connection Pooling**:
   - Track active connections efficiently
   - Broadcast room events only to relevant players
   - Spatial partitioning (don't query entire world for nearby entities)

2. **ECS Query Optimization**:
   - Cache frequently-used queries (all rooms, all players)
   - Index components by location (`contained.container`)
   - Profile slow systems with `performance.mark()`

3. **World Persistence**:
   - Currently world state is in-memory (resets on restart)
   - Add persistence layer: SQLite file or separate database
   - Save/load world state on server start/stop
   - Player progress persistence (inventory, location, stats)

4. **Horizontal Scaling**:
   - Consider multi-server architecture (region-based sharding)
   - Redis for shared state (device codes, sessions)
   - Message queue for cross-server events (global chat)

---

## Architectural Improvements

### **Code Organization Suggestions**

```
src/server/mua-world/
├── coms.ts                    # ✅ Exists - Component definitions
├── index.ts                   # ✅ Exists - MuaWorld class
├── systems/                   # ➕ Add - Game loop systems
│   ├── inputSystem.ts
│   ├── parseSystem.ts
│   ├── actionSystem.ts
│   └── outputSystem.ts
├── commands/                  # ➕ Add - Command parser
│   ├── parser.ts
│   └── registry.ts
├── actions/                   # ➕ Add - Action implementations
│   ├── look.ts
│   ├── move.ts
│   ├── take.ts
│   └── drop.ts
├── queries/                   # ➕ Add - Common ECS queries
│   ├── findPlayer.ts
│   ├── getRoomContents.ts
│   └── getAvailableExits.ts
└── edl/
    ├── main.edl              # ✅ Exists - World definition
    ├── validator.ts           # ➕ Add - EDL validation
    └── loader.ts              # ➕ Add - Extract from index.ts
```

### **Testing Strategy Enhancements**

1. **Integration Tests**: End-to-end command execution
   ```typescript
   test("player can take item from room", async () => {
     const world = await createTestWorld()
     const playerId = await simulateLogin(world, "alice")
     const response = await sendCommand(playerId, "take leaflet")
     expect(response).toContain("You take the leaflet")
     expect(await queryPlayerInventory(playerId)).toContain("leaflet")
   })
   ```

2. **Load Testing**: Simulate 100+ concurrent players
3. **Fuzzing**: Random command generation to find edge cases

---

## Quick Wins (Low Effort, High Value) 🎯

1. **Implement `look` command** (2-3 hours)
   - Query room entity for `described` component
   - List entities with `contained{container: currentRoom}`
   - List `portal` components as exits
   - Send formatted output to client
   - **Impact**: Makes the world explorable

2. **Implement `go <direction>` command** (2-3 hours)
   - Find portal matching direction
   - Update player's `contained.container` to destination
   - Trigger `look` automatically
   - **Impact**: Makes the world navigable

3. **Hot reload EDL** (1 hour)
   - Add file watcher to `main.edl`
   - Call `muaWorld.reloadFromEdl()` on change
   - **Impact**: Faster iteration on world design

4. **Add command history to TUI** (1 hour)
   - Store last 50 commands in array
   - Handle up/down arrow keys
   - **Impact**: Much better developer experience

---

## Long-Term Vision Suggestions

1. **Web Client**: Add browser-based UI alongside TUI (use Elysia static serving)
2. **Builder Mode**: In-game commands to create/edit rooms (similar to LambdaMOO)
3. **Scripting Language**: Embed Lua/JavaScript for custom object behaviors
4. **AI NPCs**: Integrate LLM for dynamic NPC conversations
5. **Federation**: Multiple MUA servers with cross-server travel (ActivityPub-like)
6. **Version Control for Worlds**: Git-like diff/merge for EDL files
7. **Marketplace**: Share/download community-created worlds

---

## Key Technical Details

### Current Implementation Statistics

| File | Lines | Purpose |
|------|-------|---------|
| `src/server/mua-world/index.ts` | 176 | Core game world engine |
| `src/server/mua-world/edl/main.edl` | 126 | Zork-inspired world definition |
| `src/server/handlers/device-auth.ts` | 166 | OAuth2 device flow |
| `src/server/handlers/ws.ts` | 125 | WebSocket message handling |
| `src/server/index.ts` | 122 | Main server setup |
| `src/server/orpc/router.ts` | 106 | Type-safe API example |
| `src/tui/index.tsx` | 98 | Terminal UI client |
| `src/server/mua-world/coms.ts` | 82 | Component definitions |

**Total implementation:** ~770 lines of core code (excluding tests/docs)
**Test coverage:** ~500 lines of tests across multiple test files

### Component Architecture

Nine ECS components define the game world structure:
- **Connection**: `connected`, `authenticating`, `authenticated` - Track client connection and auth state
- **World Structure**: `container`, `contained`, `portal` - Define rooms, inventories, and exits
- **Objects**: `item`, `described`, `meta` - Define game objects with properties

### Server Configuration

- **Port**: 3974 (configurable via `HUB_API_PORT` environment variable)
- **CORS**: Enabled for cross-origin requests
- **WebSocket**: `/ws` endpoint for game connections
- **OAuth**: `/oauth/*` endpoints for device flow
- **API**: `/api/*` for ORPC handlers

### EDL World: "West of House" (Zork Tribute)

The demo world recreates the iconic opening of Zork:
- **4 rooms**: west_of_house, north_of_house, south_of_house, behind_house
- **Items**: mailbox (container) with leaflet inside
- **Exits**: Bidirectional portals with compass directions
- **Atoms**: Reusable templates for rooms, containers, items

---

## Recent Commits Context

From the git history:
- `2cc9996` - **feat: serialise entity/def to edl** - Can now export entities back to EDL format
- `8ce796c` - **feat: query maybe** - Added optional query support
- `3c8a7d2` - **chore: relaxed edl parser to allow anon entities** - Entities can be unnamed
- `189dd27` - **chore: helpers - boolean, random, password** - Added utility functions
- `4d19728` - **chore: mua world foundation** - Initial MuaWorld implementation

---

## Summary & Recommendation

**You've built an excellent foundation.** The ECS architecture, EDL integration, and OAuth2 flow are all production-quality. The biggest gap is the **game mechanics layer** - without it, your beautiful infrastructure can't be experienced.

**My recommendation:** Start with **Priority 1 (Game Loop)** to make the world playable, then immediately implement **Priority 2 (Event System)** to establish the architectural pattern for all future features. This gives you a working game you can demo while maintaining clean extensibility.

The "Quick Wins" section provides actionable next steps that can be completed in a few hours each and will dramatically increase the project's usability and demonstration potential.
