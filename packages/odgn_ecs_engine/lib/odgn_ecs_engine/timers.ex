defmodule OdgnEcsEngine.Timers do
  @moduledoc """
  Durable timers on World time, kept in the engine's `ecs_engine_timers`
  table (ADR 0022), and the `timer` Capability Scripts set them with.

  A timer belongs to an entity, its owner, and goes when the owner is
  deleted. It is scoped to its owner, a script name and its own name:
  storing one with the same three replaces it. A Script's timers are stored
  under its name (an atom's, for a copy) and are delivered to their owner
  when due; a Host keeps timers of its own under a script name of its
  choosing and handles them itself (`OdgnEcsEngine.new/3`'s `:timers`).

  Each timer is a map with string keys: `"id"`, `"owner"`, `"script"`,
  `"name"`, `"at"` (microseconds since the Unix epoch, as
  `OdgnEcsEngine.instant_us/1` gives World time), `"message"` and `"args"`
  (encoded).
  """

  alias NorthTalk.Capability
  alias OdgnEcs.SQL
  alias OdgnEcsTalk.Values

  @columns "id, owner, script, name, at, message, args"

  @doc """
  The `timer` Capability, for `OdgnEcsTalk.start/2`'s `:capabilities`:
  `schedule name, at, message, args` and `cancel name`, for the entity the
  Run was delivered to.
  """
  def capability(%OdgnEcsTalk{world: world} = talk) do
    Capability.from_functions("timer", %{
      "schedule" =>
        {[args: ["text", "any", "text", "any"], cost: 1, mode: :fire_and_forget],
         fn [name, at, message, args], call ->
           with {:ok, owner} <- owner(talk, call),
                {:ok, at_us} <- instant_us(at) do
             :ok =
               schedule(world, %{
                 owner: owner,
                 script: OdgnEcsTalk.script_name(talk, call.script),
                 name: name,
                 at: at_us,
                 message: message,
                 args: args || []
               })

             :noreply
           end
         end},
      "cancel" =>
        {[args: ["text"], cost: 1, mode: :fire_and_forget],
         fn [name], call ->
           with {:ok, owner} <- owner(talk, call) do
             :ok = cancel(world, owner, OdgnEcsTalk.script_name(talk, call.script), name)
             {:ok, nil}
           end
         end}
    })
  end

  # A timer a Run sets belongs to the entity its Delivery went to
  defp owner(talk, call) do
    case OdgnEcsTalk.delivery(talk, call) do
      %{receiver: eid} when eid != nil ->
        {:ok, eid}

      _ ->
        {:error, %{code: "invalid value", message: "A timer needs a Run delivered to an entity"}}
    end
  end

  defp instant_us(%NorthTalk.Instant{unix_us: us}), do: {:ok, us}
  defp instant_us(%DateTime{} = dt), do: {:ok, DateTime.to_unix(dt, :microsecond)}

  defp instant_us(other),
    do: {:error, %{code: "invalid value", message: "#{inspect(other)} is not an Instant"}}

  @doc """
  Stores a timer, replacing one of the same owner, script and name. `at` is
  in microseconds; `args` are Values, `[]` by default.
  """
  def schedule(%OdgnEcs{conn: conn} = world, %{owner: owner, script: script, name: name} = t) do
    :ok = cancel(world, owner, script, name)

    SQL.run!(
      conn,
      "INSERT INTO ecs_engine_timers (owner, script, name, at, message, args) " <>
        "VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      [owner, script, name, t.at, t.message, Values.encode(Map.get(t, :args, []))]
    )

    :ok
  end

  @doc "Removes the timer of this owner, script and name, if there is one."
  def cancel(%OdgnEcs{conn: conn}, owner, script, name) do
    SQL.run!(
      conn,
      "DELETE FROM ecs_engine_timers WHERE owner = ?1 AND script = ?2 AND name = ?3",
      [owner, script, name]
    )

    :ok
  end

  @doc "The timers due at or before `now_us`, earliest first, then oldest first."
  def due(%OdgnEcs{conn: conn}, now_us),
    do: select(conn, "WHERE at <= ?1 ORDER BY at, id", [now_us])

  @doc "Every timer stored under `script`, oldest first."
  def timers(%OdgnEcs{conn: conn}, script),
    do: select(conn, "WHERE script = ?1 ORDER BY id", [script])

  @doc "Every timer, oldest first."
  def all(%OdgnEcs{conn: conn}), do: select(conn, "ORDER BY id", [])

  @doc "Every timer `owner` has, oldest first."
  def owned_by(%OdgnEcs{conn: conn}, owner),
    do: select(conn, "WHERE owner = ?1 ORDER BY id", [owner])

  @doc "When the earliest timer falls due, in microseconds, or `nil` if there is none."
  def next_at(%OdgnEcs{conn: conn}) do
    case SQL.one!(conn, "SELECT min(at) FROM ecs_engine_timers") do
      [at] -> at
      nil -> nil
    end
  end

  @doc "Removes a timer, as `due/2` gave it, without delivering it."
  def remove(%OdgnEcs{conn: conn}, %{"id" => id}) do
    SQL.run!(conn, "DELETE FROM ecs_engine_timers WHERE id = ?1", [id])
    :ok
  end

  @doc "Removes a due timer and delivers its message to its owner."
  def fire(%OdgnEcsTalk{world: world} = talk, %{"owner" => owner} = timer) do
    :ok = remove(world, timer)
    OdgnEcsTalk.deliver(talk, owner, timer["message"], Values.decode(timer["args"]))
  end

  defp select(conn, where, params) do
    for [id, owner, script, name, at, message, args] <-
          SQL.all!(conn, "SELECT #{@columns} FROM ecs_engine_timers #{where}", params) do
      %{
        "id" => id,
        "owner" => owner,
        "script" => script,
        "name" => name,
        "at" => at,
        "message" => message,
        "args" => args
      }
    end
  end
end
