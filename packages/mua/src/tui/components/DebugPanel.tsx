import { fg } from '@opentui/core';

import { type DebugState } from '../types';

type DebugPanelProps = {
  debugState: DebugState;
  onClear: () => void;
  onRecord: () => void;
  onReplay: () => void;
  onStop: () => void;
  visible: boolean;
};

export const DebugPanel = ({
  debugState,
  onClear,
  onRecord,
  onReplay,
  onStop,
  visible
}: DebugPanelProps) => {
  if (!visible) {
    return null;
  }

  const { isRecording, recordedCommands } = debugState;

  const title = fg('#7aa2f7', '=== Debug Panel ===');
  const statusText = isRecording
    ? fg('#f7768e', '● RECORDING')
    : fg('#9ece6a', '○ Stopped');

  const commandCount = `Commands: ${recordedCommands.length}`;

  return (
    <box
      style={{
        backgroundColor: '#1a1b26',
        border: true,
        borderStyle: 'double',
        height: 20,
        padding: 1,
        position: 'absolute',
        right: 2,
        top: 2,
        width: 40
      }}
    >
      <box flexDirection="column">
        <text content={title} />
        <text content={statusText} />
        <text content={commandCount} />
        <text content="" />
        <text content="Controls:" />
        <text content="  Ctrl+R - Toggle recording" />
        <text content="  Ctrl+P - Replay" />
        <text content="  Ctrl+C - Clear" />
        <text content="  Ctrl+D - Close panel" />
        <text content="" />
        <text content="Recorded:" />
        <scrollbox style={{ height: 6 }}>
          {recordedCommands.length === 0 ? (
            <text content="  (no commands yet)" />
          ) : (
            recordedCommands.map((cmd, i) => (
              <box key={i}>
                <text content={`  ${i + 1}. ${cmd.command}`} />
              </box>
            ))
          )}
        </scrollbox>
      </box>
    </box>
  );
};
