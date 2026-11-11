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

  @doc """
  Checks a `place` message from a builder's client (#258): a composition,
  a map of component names to their data. What may be in it is the
  World's to decide.
  """
  @spec place(map()) ::
          {:ok, %{composition: map(), ref: String.t() | integer() | nil}} | {:error, String.t()}
  def place(%{"composition" => composition} = msg) when is_map(composition) do
    ref = msg["ref"]

    if is_nil(ref) or is_binary(ref) or is_integer(ref),
      do: {:ok, %{composition: composition, ref: ref}},
      else: {:error, "ref must be text or a number"}
  end

  def place(_), do: {:error, "a place needs a composition"}

  @doc """
  Checks an `edit` message from a builder's client (#274): the thing the
  `edit` Verb opened, and a patch, `%{"put" => %{name => properties},
  "remove" => [name]}`. What the patch may change is the World's to decide.
  """
  @spec edit(map()) ::
          {:ok, %{eid: integer(), patch: map(), ref: String.t() | integer() | nil}}
          | {:error, String.t()}
  def edit(%{"eid" => eid, "patch" => patch} = msg) when is_integer(eid) and is_map(patch) do
    ref = msg["ref"]

    if is_nil(ref) or is_binary(ref) or is_integer(ref),
      do: {:ok, %{eid: eid, patch: patch, ref: ref}},
      else: {:error, "ref must be text or a number"}
  end

  def edit(_), do: {:error, "an edit needs an eid and a patch"}

  @doc """
  The placed thing the Character has open to edit (#274): its eid and its
  buildable components as they stand.
  """
  def compose(%{eid: eid, composition: composition}), do: %{eid: eid, composition: composition}

  @doc """
  What a builder's client is told on joining: how many things the Account
  has placed and may place, and the largest container it may make, or
  `nil` for an Account that doesn't build.
  """
  def builder(nil), do: nil
  def builder(%{} = b), do: Map.take(b, [:placed, :max_placed, :max_capacity])

  @doc "Lines a Character was told."
  def output(lines), do: %{lines: List.wrap(lines)}

  @doc "A question the Character must answer, such as \"which do you mean?\"."
  def prompt(text, options), do: %{text: text, options: options}

  @doc "What the Character can see (`MuaWorld.View`)."
  def state(view), do: view

  @doc """
  What the Character perceives, as rows in the shared layout
  (`MuaWorld.Mirror.snapshot/2`), for the client's mirror of the World.
  """
  def mirror(snapshot), do: snapshot

  @doc "What changed in the Character's Perception in one Step (`MuaWorld.Mirror.change_set/5`)."
  def changes(change_set), do: change_set

  @doc "The Connection's status: `connected`, `replaced` or `limbo`."
  def status(status) when status in [:connected, :replaced, :limbo],
    do: %{status: Atom.to_string(status)}
end
