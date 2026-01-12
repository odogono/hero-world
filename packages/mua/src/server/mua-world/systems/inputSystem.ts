import { createSystem } from 'odgn-ecs/system';

// No-op system - input events created directly by onConnectionCommand
// This system just logs for debugging
export const inputSystem = createSystem(
  ({ entity }) => {
    // Input events are processed by parseSystem
  },
  {
    frequency: 1,
    priority: 10,
    with: ['inputEvent']
  }
);
