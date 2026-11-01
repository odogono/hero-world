import { StyledText, fg, stringToStyledText } from '@opentui/core';

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
  const dotColor =
    connectionStatus === 'connected'
      ? '#9ece6a' // Green
      : connectionStatus === 'connecting'
        ? '#e0af68' // Yellow
        : '#f7768e'; // Red

  // Build status line
  const parts: string[] = [];

  parts.push(`Location: ${location}`);

  if (health !== undefined) {
    parts.push(`HP: ${health}`);
  }

  if (level !== undefined) {
    parts.push(`Level: ${level}`);
  }

  // the connection part ends the line, with a coloured dot before it
  const before = [...parts.map(p => `[${p}]`), '['].join(' ');
  const statusLine = new StyledText([
    ...stringToStyledText(before).chunks,
    fg(dotColor)('●'),
    ...stringToStyledText(`${connectionStatus}]`).chunks
  ]);

  return (
    <box
      style={{
        backgroundColor: '#1a1b26',
        border: ['top'],
        borderStyle: 'single',
        height: 1,
        paddingLeft: 1,
        paddingRight: 1
      }}
    >
      <text content={statusLine} />
    </box>
  );
};
