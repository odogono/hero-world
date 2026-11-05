defmodule MuaWorld.TablesTest do
  use ExUnit.Case, async: true

  alias OdgnEcs.SQL

  test "moves World time and Waiting inputs into the engine's tables (ADR 0022)" do
    {:ok, world} = OdgnEcs.open(":memory:")

    SQL.exec!(world.conn, """
    CREATE TABLE mua_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE mua_waiting (id INTEGER PRIMARY KEY, character INTEGER NOT NULL, command TEXT NOT NULL);
    INSERT INTO mua_meta (key, value) VALUES ('world_time', '12345');
    INSERT INTO mua_waiting (character, command) VALUES (7, 'ring bell'), (8, 'look');
    """)

    :ok = MuaWorld.Tables.ensure(world)
    # and again, as the next start does
    :ok = MuaWorld.Tables.ensure(world)

    assert OdgnEcsEngine.Tables.world_time(world) == 12_345

    assert OdgnEcsEngine.Tables.take_waiting(world) == [
             %{actor: 7, input: "ring bell"},
             %{actor: 8, input: "look"}
           ]

    assert SQL.all!(
             world.conn,
             "SELECT name FROM sqlite_master WHERE name IN ('mua_meta', 'mua_waiting')"
           ) == []
  end
end
