defmodule MuaWorld.Migration do
  @moduledoc """
  Brings a mua World kept in a file up to date with a changed EDL, keeping
  its players, Play state and time (ADR 0005): `OdgnEdl.migrate/3` with
  mua's policy, ported from `world/migrate.ts`. It is offline maintenance:
  run it with `mix mua.migrate` while the World is stopped.

  On top of the library's Migration:

  - **Pruning:** with `prune: true`, an entity whose Definition name is gone
    from the EDL moves to Limbo, never deleted. Its Elements go with it,
    except Characters inside it, which move to the Starting room. Timers it
    owns are cancelled, and references to it stay valid.
  - **Exits:** the exits made from a room's `exits` are made again when the
    Migration changes them, and new rooms get theirs.
  - **Timers:** mua's `timers` that nothing declares any more are cancelled.
  - **Homes:** new things get theirs.
  - **The Starting room** must still be valid afterwards: if it isn't, the
    Migration fails and changes nothing, on a dry run too.
  """

  alias MuaWorld.{Exits, Lifecycle, Places}

  @timer "talk_timer"

  @type report :: %{
          plan: OdgnEdl.Plan.t(),
          exits_remade: [OdgnEcs.eid()],
          timers_cancelled: [%{owner: OdgnEcs.eid(), message: String.t()}]
        }

  @doc """
  Migrates `world` (with mua's components defined) to `source`. Options:
  `:starting_room` (required), `:path` of the `.edl` file, `:prune` and
  `:dry_run`. Returns the World and a report, or `{:error, reason}`.
  """
  @spec run(OdgnEcs.t(), String.t(), keyword()) ::
          {:ok, OdgnEcs.t(), report()} | {:error, String.t()}
  def run(world, source, opts) do
    starting_room = Keyword.fetch!(opts, :starting_room)
    report_key = {__MODULE__, make_ref()}

    prune =
      if opts[:prune] do
        limbo = Places.limbo(world)
        fn eid -> :ok = OdgnEcs.put(world, eid, "location", %{"in" => limbo}) end
      end

    finish = fn world, plan ->
      with {:ok, report} <- finish(world, plan, starting_room) do
        Process.put(report_key, report)
        :ok
      end
    end

    result =
      OdgnEdl.migrate(world, source,
        path: opts[:path],
        dry_run: opts[:dry_run] == true,
        prune: prune,
        finish: finish
      )

    report = Process.delete(report_key)

    case result do
      {:ok, world, plan} -> {:ok, world, Map.put(report, :plan, plan)}
      {:error, error} -> {:error, error.message}
    end
  end

  defp finish(world, plan, starting_room) do
    starting = OdgnEdl.entity_named(world, starting_room)
    pruned = if plan.pruned, do: Enum.map(plan.gone, & &1.eid), else: []

    # Characters never go to Limbo with a pruned place: they move to the
    # Starting room, if it is one
    if starting && Places.place?(world, starting, Places.limbo(world)) do
      for eid <- pruned,
          character <- Places.characters_within(world, eid),
          do: :ok = OdgnEcs.put(world, character, "location", %{"in" => starting})
    end

    cancelled = cancel_timers(world, pruned) ++ cancel_stale_timers(world)

    rooms = touched(plan, "exits")
    remove_made_exits(world, rooms)
    Exits.expand(world)
    Lifecycle.record_homes(world)

    case Places.ensure(world, starting_room) do
      {:ok, _} ->
        {:ok, %{exits_remade: rooms, timers_cancelled: cancelled}}

      {:error, reason} ->
        {:error, "the Migration would leave the World without a Starting room: #{reason}"}
    end
  end

  # Entities the Migration changed a component of
  defp touched(plan, component) do
    for %{eid: eid} = u <- plan.updated, component in (u.added ++ u.changed ++ u.removed), do: eid
  end

  # The exits made from these rooms' `exits`, and the ways back to them, so
  # `Exits.expand/1` makes them as they are now. Exits the EDL declares as
  # entities have Definition names, and stay.
  defp remove_made_exits(_world, []), do: :ok

  defp remove_made_exits(world, rooms) do
    named = world |> OdgnEdl.definition_names() |> Map.values() |> MapSet.new()
    rooms = MapSet.new(rooms)

    for exit <- OdgnEcs.query(world, with: ["portal", "location"]),
        not MapSet.member?(named, exit),
        MapSet.member?(rooms, OdgnEcs.get(world, exit, "location")["in"]) or
          MapSet.member?(rooms, OdgnEcs.get(world, exit, "portal")["to"]),
        do: :ok = OdgnEcs.delete(world, exit)

    :ok
  end

  # Every timer a pruned entity owns, a Script's or mua's. Its `timers` go
  # too, or the World would arm them again when it next starts.
  defp cancel_timers(world, owners) do
    for owner <- owners,
        OdgnEcs.get(world, owner, "timers"),
        do: :ok = OdgnEcs.remove(world, owner, "timers")

    for owner <- owners, eid <- OdgnEcs.query(world, where: [{@timer, "owner", owner}]) do
      timer = OdgnEcs.get(world, eid, @timer)
      :ok = OdgnEcs.delete(world, eid)
      %{owner: owner, message: timer["message"]}
    end
  end

  # mua's timers whose entity is gone, or whose `timers` no longer declares them
  defp cancel_stale_timers(world) do
    for eid <- OdgnEcs.query(world, where: [{@timer, "script", Lifecycle.timers_script()}]),
        timer = OdgnEcs.get(world, eid, @timer),
        not OdgnEcs.exists?(world, timer["owner"]) or
          Lifecycle.interval(world, timer["owner"], timer["name"]) == nil do
      :ok = OdgnEcs.delete(world, eid)
      %{owner: timer["owner"], message: timer["name"]}
    end
  end

  @doc """
  Migrates the World in the database at `db` to the EDL at `edl_path`, in one
  transaction, and returns the report as lines of text. It refuses while
  another process holds the database. Options as `run/3`.
  """
  @spec migrate_file(String.t(), String.t(), keyword()) ::
          {:ok, [String.t()]} | {:error, String.t()}
  def migrate_file(db, edl_path, opts) do
    case MuaWorld.Lock.acquire(db) do
      :ok ->
        try do
          case OdgnEcs.open(db) do
            {:ok, world} -> migrate_open(world, db, edl_path, opts)
            {:error, %OdgnEcs.Error{message: message}} -> {:error, message}
          end
        after
          MuaWorld.Lock.release(db)
        end

      {:error, :locked} ->
        {:error, "Another process holds the World at #{db}: stop the World before migrating it"}
    end
  end

  defp migrate_open(world, db, edl_path, opts) do
    try do
      case OdgnEcs.begin(world) do
        :ok ->
          try do
            world = Enum.reduce(MuaWorld.Components.all(), world, &define!(&2, &1))
            MuaWorld.Tables.ensure(world)

            case run(world, File.read!(edl_path), Keyword.put(opts, :path, edl_path)) do
              {:ok, _world, report} ->
                if opts[:dry_run],
                  do: :ok = OdgnEcs.rollback(world),
                  else: :ok = OdgnEcs.commit(world)

                {:ok, describe(report, opts[:dry_run] == true)}

              {:error, reason} ->
                :ok = OdgnEcs.rollback(world)
                {:error, reason}
            end
          rescue
            e ->
              OdgnEcs.rollback(world)
              reraise e, __STACKTRACE__
          end

        {:error, %OdgnEcs.Error{message: message}} ->
          {:error, "Cannot write the World at #{db}: #{message}"}
      end
    after
      OdgnEcs.close(world)
    end
  end

  defp define!(world, component) do
    case OdgnEcs.define(world, component) do
      {:ok, world} -> world
      {:error, error} -> raise ArgumentError, error.message
    end
  end

  @doc "The report as lines of text, for an operator."
  @spec describe(report(), boolean()) :: [String.t()]
  def describe(%{plan: plan} = report, dry_run?) do
    updates =
      for u <- plan.updated do
        parts =
          [
            u.added != [] && "adds #{Enum.join(u.added, " ")}",
            u.changed != [] && "sets #{Enum.join(u.changed, " ")}",
            u.removed != [] && "removes #{Enum.join(u.removed, " ")}",
            u.lineage &&
              "bases #{Enum.join(u.lineage.from, " ")} -> #{Enum.join(u.lineage.to, " ")}"
          ]
          |> Enum.filter(& &1)

        "Updated #{u.name} (##{u.eid}): #{Enum.join(parts, "; ")}"
      end

    gone_label = if plan.pruned, do: "Moved to Limbo", else: "Gone from the EDL (pass --prune)"

    lines =
      [line("Created", plan.created)] ++
        [line("Renamed", Enum.map(plan.renamed, &"#{&1.from} -> #{&1.to} (##{&1.eid})"))] ++
        updates ++
        [
          line(gone_label, Enum.map(plan.gone, &"#{&1.name} (##{&1.eid})")),
          line("Deleted in play, not brought back", Enum.map(plan.missing, & &1.name)),
          line(
            "Changed in play, so the EDL edit is not applied",
            Enum.map(plan.kept, &"#{&1.name} (##{&1.eid}) #{Enum.join(&1.components, " ")}")
          ),
          line("Atoms added", plan.atoms.added),
          line("Atoms with new bases", plan.atoms.changed),
          line("Atoms removed", plan.atoms.removed),
          line("Exits made again for", Enum.map(report.exits_remade, &"##{&1}")),
          line(
            "Timers cancelled",
            Enum.map(report.timers_cancelled, &"#{&1.message} on ##{&1.owner}")
          )
        ]

    lines = Enum.reject(lines, &is_nil/1)
    lines = if lines == [], do: ["Nothing to change."], else: lines
    if dry_run?, do: ["Dry run: nothing was changed." | lines], else: lines
  end

  defp line(_label, []), do: nil
  defp line(label, items), do: "#{label}: #{Enum.join(items, ", ")}"
end
