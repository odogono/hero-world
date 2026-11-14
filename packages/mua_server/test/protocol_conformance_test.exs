# Runs the shared protocol cases in spec/mua/protocol: what a Connection
# replies to each message's form, before the World sees it. The Local
# World's Worker runs the same file
# (packages/mua-local/src/__test__/protocol.test.ts).
defmodule MuaServer.ProtocolConformanceTest do
  use MuaServer.ChannelCase

  alias MuaServer.{CharacterChannel, UserSocket}

  @world MuaServer.World
  @file_path Path.expand("../../../spec/mua/protocol/messages.json", __DIR__)
  @external_resource @file_path
  @spec_cases @file_path |> File.read!() |> JSON.decode!() |> Map.fetch!("cases")
  # every reason the cases give for refusing a message's form
  @form_reasons for(%{"reply" => %{"error" => r}} <- @spec_cases, uniq: true, do: r)

  setup do
    p = player("bob@example.com", "Bob")
    :ok = MuaWorld.leave(@world, p.account, p.character)

    case Registry.lookup(MuaServer.Connections, p.character) do
      [{pid, _}] -> DynamicSupervisor.terminate_child(MuaServer.ConnectionSupervisor, pid)
      [] -> :ok
    end

    {:ok, socket} = connect(UserSocket, %{"token" => token(p.account)})
    {:ok, _, chan} = subscribe_and_join(socket, CharacterChannel, "character:#{p.character}")
    {:ok, chan: chan}
  end

  for c <- @spec_cases do
    test c["name"], %{chan: chan} do
      c = unquote(Macro.escape(c))
      ref = push(chan, c["send"], c["payload"])
      assert_reply(ref, status, reply, 5_000)
      check(c, status, reply)
    end
  end

  # Accepted: past the form checks, whatever the World said. A World's
  # refusal echoes the message's `ref`, and isn't a reason for its form.
  defp check(%{"reply" => "accepted", "payload" => payload}, status, reply) do
    assert status == :ok or
             (Map.has_key?(payload, "ref") and Map.has_key?(reply, :ref) and
                reply.ref == payload["ref"] and reply.reason not in @form_reasons),
           "expected it accepted, got #{status} #{inspect(reply)}"
  end

  defp check(%{"reply" => %{"error" => reason}}, status, reply) do
    assert {status, reply[:reason]} == {:error, reason}
  end
end
