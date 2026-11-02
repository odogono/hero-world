defmodule OdgnEcsTalk.Case do
  @moduledoc false
  alias OdgnEcs.{Column, Component}

  @epoch ~U[2000-01-01 00:00:00Z]

  @defs [
    %Component{name: "meta", columns: [%Column{name: "props", type: :json}]},
    %Component{
      name: "stats",
      columns: [
        %Column{name: "hp", type: :int},
        %Column{name: "mood", type: :string, default: "calm"}
      ]
    },
    %Component{name: "item", columns: [%Column{name: "weight", type: :float, default: 1}]},
    %Component{
      name: "link",
      columns: [
        %Column{name: "locked", type: :boolean, default: false},
        %Column{name: "to", type: :eid}
      ]
    }
  ]

  @doc "A World built from `edl`, at `path` (in memory by default)."
  def world(edl, path \\ ":memory:") do
    {:ok, world} = OdgnEcs.open(path)

    world =
      Enum.reduce(OdgnEcsTalk.components() ++ @defs, world, fn c, w ->
        elem(OdgnEcs.define(w, c), 1)
      end)

    {:ok, world, _} = OdgnEdl.load(world, edl)
    world
  end

  def talk(world, opts \\ []) do
    test = self()

    {:ok, talk} =
      OdgnEcsTalk.start(world, Keyword.put_new(opts, :on_show, &send(test, {:show, &1, &2})))

    talk
  end

  def id(world, name), do: OdgnEdl.entity_named(world, name)

  def now(ms \\ 0), do: DateTime.add(@epoch, ms, :millisecond)

  @doc "Requests a message of an entity, Pumping until it settles."
  def ask(talk, eid, message, args \\ []) do
    {:ok, pending} = OdgnEcsTalk.request(talk, eid, message, args, now())
    settle(talk, pending)
  end

  def settle(talk, pending, tries \\ 20) do
    case NorthTalk.await(pending, 0) do
      {:error, %NorthTalk.HostError{code: "timeout"}} when tries > 0 ->
        {:ok, _} = OdgnEcsTalk.pump(talk, now())
        settle(talk, pending, tries - 1)

      result ->
        result
    end
  end

  def value({:ok, %NorthTalk.Result{value: v}}), do: v
  def value(other), do: other
end

ExUnit.start()
