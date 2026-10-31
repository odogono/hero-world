import { fg } from '@opentui/core';

type StatusBarProps = {
  connectionStatus: 'connected' | 'disconnected' | 'connecting';
  health?: number;
  level?: number;
  location: string;
};

export const StatusBar = ({
  connectionStatus,
  health,
  level,
  location
}: StatusBarProps) => {
  // Connection status indicator
  const statusDot =
    connectionStatus === 'connected'
      ? fg('#9ece6a', '●') // Green
      : connectionStatus === 'connecting'
        ? fg('#e0af68', '●') // Yellow
        : fg('#f7768e', '●'); // Red

  // Build status line
  const parts: string[] = [];

  parts.push(`Location: ${location}`);

  if (health !== undefined) {
    parts.push(`HP: ${health}`);
  }

  if (level !== undefined) {
    parts.push(`Level: ${level}`);
  }

  parts.push(`${statusDot}${connectionStatus}`);

  const statusLine = parts.map(p => `[${p}]`).join(' ');

  return (
    <box
      style={{
        backgroundColor: '#1a1b26',
        border: true,
        borderBottom: false,
        borderLeft: false,
        borderRight: false,
        borderStyle: 'single',
        borderTop: true,
        height: 1,
        paddingLeft: 1,
        paddingRight: 1
      }}
    >
      <text content={statusLine} />
    </box>
  );
};
