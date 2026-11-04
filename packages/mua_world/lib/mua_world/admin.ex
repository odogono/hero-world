defmodule MuaWorld.Admin do
  @moduledoc """
  The text side of an admin's NorthTalk line (#91): the Script a line
  becomes, and how its result or failure reads back to the admin.
  """

  @doc "A line as the Handler `on line actor, here`."
  def source(line), do: "on line actor, here\n" <> line <> "\nend line\n"

  @doc "A NorthTalk value, as the admin reads it."
  def show(nil), do: "nothing"
  def show(true), do: "true"
  def show(false), do: "false"
  def show(text) when is_binary(text), do: inspect(text)
  def show(n) when is_integer(n), do: Integer.to_string(n)
  def show(%Decimal{} = d), do: Decimal.to_string(d, :normal)
  def show(list) when is_list(list), do: "[" <> Enum.map_join(list, ", ", &show/1) <> "]"

  def show(%NorthTalk.Map{entries: entries}),
    do: "{" <> Enum.map_join(entries, ", ", fn {k, v} -> "#{k}: #{show(v)}" end) <> "}"

  def show(%NorthTalk.Object{kind: kind, id: id}), do: "<#{kind} #{id}>"
  def show(other), do: inspect(other)

  @doc "Why a line changed nothing."
  def failure(outcome, line \\ "")

  def failure({:error, %NorthTalk.LoadError{diagnostics: [d | _]}}, text) do
    # the admin's text starts on the Handler's second line; an error found
    # at its `end` is in their last line
    lines = max(length(String.split(text, "\n")), 1)
    at = ((d["line"] || 2) - 1) |> max(1) |> min(lines)
    "line #{at}: #{d["message"]}"
  end

  def failure({:error, %NorthTalk.ScriptError{error: %{"code" => code} = error}}, _),
    do: "#{code}: #{error["message"] || ""}" |> String.trim_trailing(": ")

  def failure({:error, %NorthTalk.ScriptError{outcome: outcome}}, _), do: outcome
  def failure({:failed, error}, line), do: failure({:error, error}, line)
  def failure(:waiting, _), do: "the line didn't finish, so nothing changed"
  def failure({:error, other}, _), do: inspect(other)
  def failure(other, _), do: inspect(other)
end
