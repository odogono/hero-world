import type { TextareaOptions } from '@opentui/core';

/** The event `TextareaOptions.onSubmit` is typed with */
type TextareaSubmitEvent = Parameters<
  NonNullable<TextareaOptions['onSubmit']>
>[0];

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
      // OpenTUI calls this with the input's value, but its types also
      // inherit the textarea's (event: SubmitEvent) => void
      onSubmit={(value: string | TextareaSubmitEvent) => {
        if (typeof value === 'string') {
          onSubmit(value);
        }
      }}
      placeholder="Type a command..."
      value={value}
    />
  </box>
);
