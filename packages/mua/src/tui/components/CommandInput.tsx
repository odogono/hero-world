
type CommandInputProps = {
  onHistoryNext: () => void;
  onHistoryPrevious: () => void;
  onSubmit: (value: string) => void;
  onTabComplete: () => void;
  onValueChange: (value: string) => void;
  value: string;
};

export const CommandInput = ({
  onHistoryNext,
  onHistoryPrevious,
  onSubmit,
  onTabComplete,
  onValueChange,
  value
}: CommandInputProps) => (
    <box style={{ border: true, height: 3 }}>
      <input
        focused
        onInput={onValueChange}
        onSubmit={onSubmit}
        placeholder="Type a command..."
        value={value}
      />
    </box>
  );
