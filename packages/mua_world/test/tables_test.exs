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

  test "moves them inside a Migration's transaction too, and its rollback undoes the move" do
    {:ok, world} = OdgnEcs.open(":memory:")

    SQL.exec!(world.conn, """
    CREATE TABLE mua_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO mua_meta (key, value) VALUES ('world_time', '12345');
    """)

    # a dry run: the Migration's own transaction, rolled back
    :ok = OdgnEcs.begin(world)
    :ok = MuaWorld.Tables.ensure(world)
    assert OdgnEcsEngine.Tables.world_time(world) == 12_345
    :ok = OdgnEcs.rollback(world)

    assert SQL.all!(world.conn, "SELECT value FROM mua_meta") == [["12345"]]

    :ok = OdgnEcs.begin(world)
    :ok = MuaWorld.Tables.ensure(world)
    :ok = OdgnEcs.commit(world)
    assert OdgnEcsEngine.Tables.world_time(world) == 12_345
  end

  test "an outbox from before Suggestions gains them, and its lines keep" do
    {:ok, world} = OdgnEcs.open(":memory:")

    SQL.exec!(world.conn, """
    CREATE TABLE mua_outbox (id INTEGER PRIMARY KEY, character INTEGER NOT NULL, text TEXT NOT NULL);
    INSERT INTO mua_outbox (character, text) VALUES (7, 'You wake.');
    """)

    :ok = MuaWorld.Tables.ensure(world)
    :ok = MuaWorld.Tables.ensure(world)
    MuaWorld.Tables.output(world, 7, "You make the satchel.", ["edit the satchel"])

    assert MuaWorld.Tables.take_outbox(world) == [
             {7, "You wake."},
             {7, %{text: "You make the satchel.", suggestions: ["edit the satchel"]}}
           ]
  end
end
