defmodule MuaServer.Protocol do
  @moduledoc """
  The messages on a `character:<id>` Channel (docs/protocol.md). They don't
  depend on which commands exist: a command is text, and what comes back is
  lines of text and a view of the World.
  """

  @max_text 500

  @doc "Checks a `command` message from a client."
  @spec command(map()) ::
          {:ok, %{text: String.t(), ref: String.t() | integer() | nil}} | {:error, String.t()}
  def command(%{"text" => text} = msg) when is_binary(text) do
    text = String.trim(text)
    ref = msg["ref"]

    cond do
      text == "" ->
        {:error, "empty command"}

      String.length(text) > @max_text ->
        {:error, "command too long"}

      not (is_nil(ref) or is_binary(ref) or is_integer(ref)) ->
        {:error, "ref must be text or a number"}

      true ->
        {:ok, %{text: text, ref: ref}}
    end
  end

  def command(_), do: {:error, "a command needs text"}

  @doc "Lines a Character was told."
  def output(lines), do: %{lines: List.wrap(lines)}

  @doc "A question the Character must answer, such as \"which do you mean?\"."
  def prompt(text, options), do: %{text: text, options: options}

  @doc "What the Character can see (`MuaWorld.View`)."
  def state(view), do: view

  @doc "The Connection's status: `connected`, `replaced` or `limbo`."
  def status(status) when status in [:connected, :replaced, :limbo],
    do: %{status: Atom.to_string(status)}
end
