defmodule MuaServer.CharacterChannelTest do
  use MuaServer.ChannelCase

  alias MuaServer.{CharacterChannel, Connection, UserSocket}

  @world MuaServer.World
  @grace Application.compile_env!(:mua_server, :grace_ms)

  setup do
    ada = player("ada@example.com", "Ada")
    bob = player("bob@example.com", "Bob")
    # each test starts with both Characters out of play
    for p <- [ada, bob] do
      :ok = MuaWorld.leave(@world, p.account, p.character)
      stop_connection(p.character)
    end

    {:ok, ada: ada, bob: bob}
  end

  defp stop_connection(character) do
    case Registry.lookup(MuaServer.Connections, character) do
      [{pid, _}] -> DynamicSupervisor.terminate_child(MuaServer.ConnectionSupervisor, pid)
      [] -> :ok
    end
  end

  defp socket_for(%{account: account}) do
    {:ok, socket} = connect(UserSocket, %{"token" => token(account)})
    socket
  end

  defp join_as(p) do
    {:ok, _, chan} =
      subscribe_and_join(socket_for(p), CharacterChannel, "character:#{p.character}")

    assert_push("status", %{status: "connected"})
    assert_push("state", _)
    chan
  end

  defp join_as_view(p) do
    {:ok, _, chan} =
      subscribe_and_join(socket_for(p), CharacterChannel, "character:#{p.character}")

    assert_push("status", %{status: "connected"})
    chan
  end

  defp flush_pushes do
    receive do
      %Phoenix.Socket.Message{} -> flush_pushes()
    after
      0 -> :ok
    end
  end

  defp in_limbo?(p), do: not Enum.any?(MuaWorld.characters(@world, p.account), & &1.in_play)

  describe "admission" do
    test "a socket without a valid token is refused" do
      assert :error = connect(UserSocket, %{})
      assert :error = connect(UserSocket, %{"token" => "forged"})
    end

    test "an Account can't join another's Character", %{ada: ada, bob: bob} do
      assert {:error, %{reason: "not_owner"}} =
               subscribe_and_join(socket_for(ada), CharacterChannel, "character:#{bob.character}")

      assert in_limbo?(bob)
    end

    test "a topic that names no Character is refused", %{ada: ada} do
      assert {:error, %{reason: "no_such_character"}} =
               subscribe_and_join(socket_for(ada), CharacterChannel, "character:nobody")
    end
  end

  describe "playing" do
    test "joining enters the Character, with its view", %{ada: ada} do
      {:ok, _, _} =
        subscribe_and_join(socket_for(ada), CharacterChannel, "character:#{ada.character}")

      assert_push("status", %{status: "connected"})
      assert_push("output", %{lines: [_ | _]})
      assert_push("state", %{room: %{name: "West of house"}, inventory: [], actions: actions})
      assert "north" in actions
      refute in_limbo?(ada)
    end

    test "a command's output arrives after its reply, and then the view", %{ada: ada, bob: bob} do
      a = join_as(ada)
      _b = join_as(bob)

      ref = push(a, "command", %{"text" => "say hello", "ref" => "c1"})
      assert_reply(ref, :ok, %{ref: "c1"})
      assert_push("output", %{lines: ["You say, \"hello\""]})
      assert_push("state", %{room: %{players: players}})
      assert "Bob" in players
    end

    test "an invalid command is refused without reaching the World", %{ada: ada} do
      a = join_as(ada)
      ref = push(a, "command", %{"text" => "   "})
      assert_reply(ref, :error, %{reason: "empty command"})
      ref = push(a, "command", %{"nope" => 1})
      assert_reply(ref, :error, %{reason: "a command needs text"})
    end
  end

  describe "the admin prompt" do
    test "an admin's `;` line runs, and its result comes back to them", %{ada: ada} do
      a = join_as(ada)
      ref = push(a, "command", %{"text" => ";return 6 * 7", "ref" => "n1"})
      assert_reply(ref, :ok, %{ref: "n1"})
      assert_push("output", %{lines: ["=> 42"]})
    end

    test "a player who isn't an admin can't use it", %{bob: bob} do
      b = join_as(bob)
      ref = push(b, "command", %{"text" => ";return 1", "ref" => "n2"})
      assert_reply(ref, :ok, %{ref: "n2"})
      assert_push("output", %{lines: ["You can't do that."]})
    end
  end

  describe "the controlling Connection" do
    test "a new Connection takes over, and the old one can't command", %{ada: ada} do
      old = join_as(ada)
      Process.unlink(old.channel_pid)
      ref = Process.monitor(old.channel_pid)

      new = join_as(ada)
      assert_push("status", %{status: "replaced"})
      assert_receive {:DOWN, ^ref, _, _, _}

      refute Connection.controls?(ada.character, old.channel_pid)
      assert Connection.controls?(ada.character, new.channel_pid)
    end

    test "a stale Connection closing doesn't send the Character to Limbo", %{ada: ada} do
      old = join_as(ada)
      Process.unlink(old.channel_pid)
      _new = join_as(ada)
      assert_push("status", %{status: "replaced"})

      Process.sleep(@grace * 3)
      refute in_limbo?(ada)
    end

    test "a dropped Connection leaves the Character in play for the grace period, then in Limbo",
         %{ada: ada} do
      a = join_as(ada)
      Process.unlink(a.channel_pid)
      Process.exit(a.channel_pid, :kill)

      Process.sleep(div(@grace, 3))
      refute in_limbo?(ada)
      Process.sleep(@grace * 3)
      assert in_limbo?(ada)
    end

    test "coming back within the grace period resumes control", %{ada: ada} do
      a = join_as(ada)
      Process.unlink(a.channel_pid)
      Process.exit(a.channel_pid, :kill)
      Process.sleep(div(@grace, 3))

      _again = join_as(ada)
      Process.sleep(@grace * 3)
      refute in_limbo?(ada)
    end

    test "logging out leaves for Limbo at once", %{ada: ada} do
      a = join_as(ada)
      Process.unlink(a.channel_pid)
      ref = push(a, "logout", %{})
      assert_reply(ref, :ok)
      assert_push("status", %{status: "limbo"})
      assert in_limbo?(ada)
    end

    test "Characters in play when the World starts get their grace", %{ada: ada} do
      {:ok, _} = MuaWorld.enter(@world, ada.account, ada.character)
      :ok = Connection.grace_all()

      Process.sleep(@grace * 3)
      assert in_limbo?(ada)
    end

    test "an interrupted command is not run again when the client reconnects", %{
      ada: ada,
      bob: bob
    } do
      _b = join_as(bob)
      a = join_as(ada)
      Process.unlink(a.channel_pid)
      bob_topic = "character:#{bob.character}"
      Process.sleep(100)
      flush_pushes()

      # the command runs (Bob hears it), but Ada's Connection drops before
      # its reply reaches her
      push(a, "command", %{"text" => "say once", "ref" => "c1"})

      assert_receive %Phoenix.Socket.Message{
        topic: ^bob_topic,
        event: "output",
        payload: %{lines: [heard]}
      }

      assert heard =~ "once"
      Process.exit(a.channel_pid, :kill)

      _again = join_as(ada)

      # rejoining doesn't run it a second time
      refute_receive %Phoenix.Socket.Message{topic: ^bob_topic, event: "output"}, 200
      refute_push("output", %{lines: ["You say, \"once\""]})
    end

    test "a takeover moves nothing: others see no departure or arrival", %{ada: ada, bob: bob} do
      _b = join_as(bob)
      old = join_as(ada)
      Process.unlink(old.channel_pid)
      Process.sleep(100)
      flush_pushes()

      _new = join_as(ada)
      assert_push("status", %{status: "replaced"})
      bob_topic = "character:#{bob.character}"
      refute_receive %Phoenix.Socket.Message{topic: ^bob_topic, event: "output"}, 100
      refute in_limbo?(ada)
    end

    test "a stale Connection's command doesn't run once another has taken over", %{ada: ada} do
      old = join_as(ada)
      Process.unlink(old.channel_pid)
      _new = join_as(ada)
      assert_push("status", %{status: "replaced"})

      me = self()
      run = fn -> send(me, :ran) end
      assert {:error, :replaced} = Connection.run(ada.character, old.channel_pid, run)
      refute_received :ran
    end

    test "a stale Connection closing after a regrace doesn't cut the new one's control", %{
      ada: ada
    } do
      old = join_as(ada)
      Process.unlink(old.channel_pid)
      new = join_as(ada)
      Process.exit(old.channel_pid, :kill)

      Process.sleep(@grace * 3)
      refute in_limbo?(ada)
      assert Connection.controls?(ada.character, new.channel_pid)
    end

    for {name, wait?} <- [{"before", false}, {"after", true}] do
      test "an item taken by a command whose reply is lost #{name} commit is taken once",
           %{ada: ada} do
        a = join_as(ada)
        Process.unlink(a.channel_pid)
        ref = push(a, "command", %{"text" => "open mailbox", "ref" => "o"})
        assert_reply(ref, :ok)

        push(a, "command", %{"text" => "take leaflet", "ref" => "t"})
        if unquote(wait?), do: assert_push("output", %{lines: ["Taken."]})
        Process.exit(a.channel_pid, :kill)

        _again = join_as_view(ada)
        Process.sleep(100)
        {:ok, view} = MuaWorld.view(@world, ada.account, ada.character)
        held = Enum.count(view.inventory, &(&1 =~ ~r/leaflet/i))
        if unquote(wait?), do: assert(held == 1), else: assert(held <= 1)
        refute_push("output", %{lines: ["Taken."]})

        # back in the closed mailbox, for the other tests
        mailbox = MuaWorld.named(@world, "mailbox")
        leaflet = MuaWorld.named(@world, "leaflet")
        MuaWorld.set_component(@world, leaflet, "location", %{"in" => mailbox})
        box = MuaWorld.component(@world, mailbox, "container")
        MuaWorld.set_component(@world, mailbox, "container", %{box | "is_closed" => true})
      end
    end
  end
end
