defmodule OdgnEcs.System do
  @moduledoc """
  A System: logic that runs at its own interval over every entity matching
  its query (ADR 0018, ADR 0020).

  The store keeps no clock and runs nothing by itself. The caller says what
  the time is, in a unit of its choosing (mua uses World time in
  milliseconds), asks which Systems are `due/3`, and runs each with `run/4`,
  inside whatever transaction it commits by, such as a Step. When each
  System last ran is World data, so a restarted World carries on where it
  stopped.

    * `:name` - unique among the World's Systems.
    * `:every` - the interval, in the caller's time unit.
    * `:query` - options for `OdgnEcs.query/2`, choosing the entities.
    * `:select` - component names to read with each entity, as
      `OdgnEcs.select/3` does; without it, the entities are plain ids.
    * `:run` - `fn entities, context -> result end`.

  A System first seen at time `t` runs one interval later, not at once. One
  that has missed several intervals, as after a long Step, runs once.
  """

  alias OdgnEcs.SQL

  @enforce_keys [:name, :every, :run]
  defstruct name: nil, every: nil, query: [], select: nil, run: nil

  @type t :: %__MODULE__{
          name: String.t(),
          every: pos_integer(),
          query: keyword(),
          select: [String.t()] | nil,
          run: (list(), term() -> term())
        }

  @schema "CREATE TABLE IF NOT EXISTS ecs_systems (name TEXT PRIMARY KEY, last_run INTEGER NOT NULL)"

  @doc """
  Records each System the World hasn't seen before as having run at `now`,
  so it first runs one interval later. A host calls it when the World
  starts; `due/3` does it too, for a System added later.
  """
  @spec arm(OdgnEcs.t(), [t()], integer()) :: :ok
  def arm(%OdgnEcs{} = world, systems, now) do
    last = last_runs(world)

    for %__MODULE__{name: name} <- systems,
        not Map.has_key?(last, name),
        do: record(world.conn, name, now)

    :ok
  end

  @doc "The Systems due at `now`, in the order given."
  @spec due(OdgnEcs.t(), [t()], integer()) :: [t()]
  def due(%OdgnEcs{} = world, systems, now) do
    :ok = arm(world, systems, now)
    last = last_runs(world)
    Enum.filter(systems, &(now >= last[&1.name] + &1.every))
  end

  @doc """
  When the first of `systems` is next due, or `nil` for none. A System the
  World hasn't seen yet isn't counted: it is armed when `due/3` first sees it.
  """
  @spec next_due(OdgnEcs.t(), [t()]) :: integer() | nil
  def next_due(%OdgnEcs{} = world, systems) do
    last = last_runs(world)

    systems
    |> Enum.filter(&Map.has_key?(last, &1.name))
    |> Enum.map(&(last[&1.name] + &1.every))
    |> Enum.min(fn -> nil end)
  end

  defp last_runs(%OdgnEcs{conn: conn}) do
    SQL.exec!(conn, @schema)

    conn
    |> SQL.all!("SELECT name, last_run FROM ecs_systems")
    |> Map.new(fn [name, at] -> {name, at} end)
  end

  @doc """
  Runs a System over its entities with `context`, and records that it ran
  at `now`. Returns what its `run` function returns.
  """
  @spec run(OdgnEcs.t(), t(), integer(), term()) :: term()
  def run(%OdgnEcs{conn: conn} = world, %__MODULE__{} = system, now, context) do
    SQL.exec!(conn, @schema)

    entities =
      case system.select do
        nil -> OdgnEcs.query(world, system.query)
        names -> OdgnEcs.select(world, names, system.query)
      end

    record(conn, system.name, now)
    system.run.(entities, context)
  end

  defp record(conn, name, at) do
    SQL.run!(
      conn,
      "INSERT INTO ecs_systems (name, last_run) VALUES (?1, ?2) " <>
        "ON CONFLICT(name) DO UPDATE SET last_run = excluded.last_run",
      [name, at]
    )
  end
end
