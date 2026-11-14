defmodule MuaWorld.Request do
  @moduledoc """
  Requests to Scripts: questions a Script answers with a reply.

  A Request says no by replying `{refused: text}`, and a Run that fails or
  never replies says no too. What any other reply means is for whoever
  asked to read.
  """

  @doc """
  What a Request's outcome says: `{:refused, text}` when the Script said
  no, `{:malformed, value}` when it meant to but its refusal isn't text,
  `{:failed, outcome}` when its Run didn't reply, and otherwise
  `{:replied, value}` for the asker to read.
  """
  def reply({:replied, %NorthTalk.Map{} = value} = replied) do
    case NorthTalk.Map.get(value, "refused", :none) do
      text when is_binary(text) -> {:refused, text}
      :none -> replied
      _ -> {:malformed, value}
    end
  end

  def reply({:replied, _} = replied), do: replied
  def reply(outcome), do: {:failed, outcome}
end
