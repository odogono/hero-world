defmodule Mix.Tasks.Mua.Migrate do
  @shortdoc "Brings a World kept in a file up to date with a changed EDL"
  @moduledoc """
  Brings a World kept in a file up to date with a changed EDL, keeping its
  players, Play state and time (ADR 0005), and prints what changed. It is
  offline maintenance: stop the World first. It refuses while another
  process, such as a running World, holds the database.

      mix mua.migrate --db world.db --edl main.edl --starting-room harbour_steps [--dry-run] [--prune]

    * `--db` - the World's database, which must exist.
    * `--edl` - the changed EDL.
    * `--starting-room` - the Definition name of the Starting room, which
      must still be valid after the Migration.
    * `--dry-run` - print what would change, and change nothing.
    * `--prune` - move entities gone from the EDL to Limbo; without it they
      are only listed.
  """
  use Mix.Task

  @switches [
    db: :string,
    edl: :string,
    starting_room: :string,
    dry_run: :boolean,
    prune: :boolean
  ]

  @impl true
  def run(args) do
    {opts, _, invalid} = OptionParser.parse(args, strict: @switches)
    if invalid != [], do: Mix.raise("Unknown options: #{inspect(invalid)}")

    db = required(opts, :db)
    edl = required(opts, :edl)
    starting_room = required(opts, :starting_room)
    unless File.exists?(db), do: Mix.raise("There is no World at #{db}")

    Mix.Task.run("app.start")

    case MuaWorld.Migration.migrate_file(db, edl,
           starting_room: starting_room,
           dry_run: opts[:dry_run] == true,
           prune: opts[:prune] == true
         ) do
      {:ok, lines} -> Enum.each(lines, fn line -> Mix.shell().info(line) end)
      {:error, reason} -> Mix.raise(reason)
    end
  end

  defp required(opts, key) do
    opts[key] || Mix.raise("--#{String.replace(to_string(key), "_", "-")} is required")
  end
end
