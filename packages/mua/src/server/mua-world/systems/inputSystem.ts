import { createMuaSystem } from './create-mua-system';

// No-op system - input events created directly by onConnectionCommand
// This system just logs for debugging
export const inputSystem = createMuaSystem(
  ({ entity }) => {
    // Input events are processed by parseSystem
  },
  {
    frequency: 1,
    priority: 40,
    with: ['inputEvent']
  }
);
