defmodule MuaServer.Release do
  @moduledoc """
  Operator commands for a release, run with `bin/mua_server`.
  `docs/operations.md` has the whole procedure.

  While the server runs, through `rpc`:

      bin/mua_server rpc 'MuaServer.Release.backup()'

  While it is stopped, through `eval`, which reads the same environment as
  the server but starts neither the World nor the web server:

      bin/mua_server eval 'MuaServer.Release.maintain(dry_run: true)'
      bin/mua_server eval 'MuaServer.Release.maintain()'
      bin/mua_server eval 'MuaServer.Release.restore("/data/backups/world-….db")'

  Each prints what it did and raises on failure, so the command exits
  non-zero.
  """

  alias MuaWorld.{Backup, Migration}

  @doc """
  Backs up the running World, between Steps, to `dest`: by default a
  timestamped file in a `backups` directory beside the database.
  """
  def backup(dest \\ nil, world \\ MuaServer.World) do
    dest = dest || default_backup(config())
    done(MuaWorld.backup(world, dest), &"Backed up the World to #{&1}")
  end

  @doc """
  The maintenance procedure, for a stopped World: back up, then migrate to
  the configured EDL, a dry run first. With `dry_run: true` it stops after
  printing what would change. Options: `:dry_run`, `:prune`, `:backup` (the
  backup's path) and `:world` (the World's settings, for tests).
  """
  def maintain(opts \\ []) do
    world = Keyword.get_lazy(opts, :world, &config/0)
    dest = opts[:backup] || default_backup(world)

    done(Backup.offline(world[:path], dest), &"Backed up the World to #{&1}")
    migrate(Keyword.merge(opts, world: world, dry_run: true))
    unless opts[:dry_run], do: migrate(Keyword.put(opts, :world, world))
    :ok
  end

  @doc """
  Migrates a stopped World to the configured EDL. Options: `:dry_run`,
  `:prune` and `:world`.
  """
  def migrate(opts \\ []) do
    world = Keyword.get_lazy(opts, :world, &config/0)

    result =
      Migration.migrate_file(world[:path], world[:edl],
        starting_room: world[:starting_room],
        dry_run: opts[:dry_run] == true,
        prune: opts[:prune] == true
      )

    done(result, &Enum.join(&1, "\n"))
  end

  @doc """
  Restores a backup as the World's database, which must not exist yet:
  restore into a clean instance, then start the server.
  """
  def restore(backup, opts \\ []) do
    world = Keyword.get_lazy(opts, :world, &config/0)
    done(Backup.restore(backup, world[:path]), &"Restored #{backup} to #{&1}")
  end

  @doc """
  Makes `count` simulated players for the load script (#132,
  `packages/mua_client/load`), each an Account with a Character, and prints
  them as one line of JSON, `[{"character": id, "token": socket_token}]`.
  It skips the allowlist, so it refuses to run unless the server was started
  with `MUA_LOAD_TEST=true`: only on a scratch instance, never on the alpha.
  Running it again returns the same players.
  """
  def load_players(count, world \\ MuaServer.World) when is_integer(count) and count > 0 do
    unless System.get_env("MUA_LOAD_TEST") == "true",
      do: raise("load_players needs a scratch server started with MUA_LOAD_TEST=true")

    players =
      for i <- 1..count do
        {:ok, account} = MuaWorld.sign_in(world, "load:#{i}", "load#{i}@load.invalid")

        character =
          case MuaWorld.characters(world, account) do
            [%{id: id} | _] ->
              id

            [] ->
              {:ok, id} = MuaWorld.create_character(world, account, "Loader#{i}")
              id
          end

        %{character: character, token: Phoenix.Token.sign(MuaServer.Endpoint, "socket", account)}
      end

    IO.puts(Jason.encode!(players))
    {:ok, length(players)}
  end

  defp done({:ok, value}, describe) do
    IO.puts(describe.(value))
    {:ok, value}
  end

  defp done({:error, reason}, _), do: raise(reason)

  defp config do
    Application.load(:mua_server)
    Application.fetch_env!(:mua_server, :world)
  end

  defp default_backup(world) do
    stamp = DateTime.utc_now() |> DateTime.to_iso8601(:basic) |> String.replace(~r/[^0-9TZ]/, "")
    Path.join([Path.dirname(world[:path]), "backups", "world-#{stamp}.db"])
  end
end
