import { type GameMessage, type RoomData } from '../types';
import { colorByType, colorizeMessage } from '../utils/color-utils';

type MessageLineProps = {
  message: GameMessage;
  roomData?: RoomData;
};

export const MessageLine = ({ message, roomData }: MessageLineProps) => {
  // game text colours the room's exits, items and NPCs; errors, successes
  // and system lines are coloured whole
  const displayContent =
    message.type === 'game'
      ? colorizeMessage(message.content, roomData)
      : colorByType(message.content, message.type);

  return (
    <box
      style={{
        marginBottom: 0,
        paddingLeft: 1,
        paddingRight: 1,
        width: '100%'
      }}
    >
      <text content={displayContent} />
    </box>
  );
};
