defmodule MuaServer.CharacterChannel do
  @moduledoc """
  `character:<id>`: playing one Character the socket's Account owns
  (docs/protocol.md). Joining enters the Character into play, or resumes
  control of it, and takes over from any other Connection. Every line the
  Character is told arrives as `output` after the World commits the change
  behind it (ADR 0012); `state` and any `prompt` follow. On joining, the
  client is sent a `mirror` of what the Character perceives, and then a
  `changes` after each Step that changed it (#164).
  """
  use Phoenix.Channel

  alias MuaServer.{Connection, Protocol}

  @world MuaServer.World

  @impl true
  def join("character:" <> id, _params, socket) do
    account = socket.assigns.account

    with {character, ""} <- Integer.parse(id),
         {:ok, lines} <- MuaWorld.enter(@world, account, character) do
      :ok = Connection.attach(account, character, self())
      send(self(), {:after_join, lines})
      reply = %{builder: Protocol.builder(MuaWorld.builder(@world, account))}
      {:ok, reply, assign(socket, :character, character)}
    else
      {:error, reason} -> {:error, %{reason: to_string(reason)}}
      _ -> {:error, %{reason: "no_such_character"}}
    end
  end

  @impl true
  def handle_in("command", payload, socket) do
    %{account: account, character: character} = socket.assigns

    case Protocol.command(payload) do
      {:ok, %{text: text, ref: ref}} ->
        # checked and run as one, so a takeover can't slip in between
        run = fn -> MuaWorld.command(@world, account, character, text) end

        case Connection.run(character, self(), run) do
          {:error, :replaced} ->
            {:reply, {:error, %{ref: ref, reason: "replaced"}}, socket}

          # the World is behind (#139): nothing changed, so there's nothing
          # to refresh, and asking would only add to its queue
          {:error, :busy} ->
            {:reply, {:error, %{ref: ref, reason: "busy"}}, socket}

          result ->
            # after the output the command produced, which is already queued
            send(self(), :refresh)
            {:reply, command_reply(result, ref), socket}
        end

      {:error, reason} ->
        {:reply, {:error, %{reason: reason}}, socket}
    end
  end

  # A builder's composed thing, placed in the Character's room (#258)
  def handle_in("place", payload, socket) do
    %{account: account, character: character} = socket.assigns

    case Protocol.place(payload) do
      {:ok, %{composition: composition, ref: ref}} ->
        run = fn -> MuaWorld.place(@world, account, character, composition) end

        case Connection.run(character, self(), run) do
          {:ok, placed} ->
            send(self(), :refresh)
            {:reply, {:ok, Map.put(placed, :ref, ref)}, socket}

          {:error, reason} ->
            {:reply, {:error, %{ref: ref, reason: to_string(reason)}}, socket}
        end

      {:error, reason} ->
        {:reply, {:error, %{reason: reason}}, socket}
    end
  end

  # Saving an edit to the placed thing the `edit` Verb opened (#274)
  def handle_in("edit", payload, socket) do
    %{account: account, character: character} = socket.assigns

    case Protocol.edit(payload) do
      {:ok, %{eid: eid, patch: patch, ref: ref}} ->
        run = fn -> MuaWorld.edit(@world, account, character, eid, patch) end

        case Connection.run(character, self(), run) do
          {:ok, edited} ->
            send(self(), :refresh)
            {:reply, {:ok, Map.put(edited, :ref, ref)}, socket}

          {:error, reason} ->
            {:reply, {:error, %{ref: ref, reason: to_string(reason)}}, socket}
        end

      {:error, reason} ->
        {:reply, {:error, %{reason: reason}}, socket}
    end
  end

  # Storing or destroying the placed thing the `edit` Verb opened, from
  # the composer, as the `store` and `destroy` Verbs do (#284)
  def handle_in(verb, payload, socket) when verb in ["store", "destroy"] do
    %{account: account, character: character} = socket.assigns

    case Protocol.thing(payload) do
      {:ok, %{eid: eid, ref: ref}} ->
        run = fn -> MuaWorld.put_away(@world, account, character, eid, verb) end

        case Connection.run(character, self(), run) do
          {:ok, done} ->
            send(self(), :refresh)
            {:reply, {:ok, Map.put(done, :ref, ref)}, socket}

          {:error, reason} ->
            {:reply, {:error, %{ref: ref, reason: to_string(reason)}}, socket}
        end

      {:error, reason} ->
        {:reply, {:error, %{reason: reason}}, socket}
    end
  end

  # Closing the composer without saving
  def handle_in("stop_editing", _payload, socket) do
    %{account: account, character: character} = socket.assigns
    run = fn -> MuaWorld.stop_editing(@world, account, character) end

    case Connection.run(character, self(), run) do
      :ok -> {:reply, :ok, assign(socket, :composing, nil)}
      {:error, reason} -> {:reply, {:error, %{reason: to_string(reason)}}, socket}
    end
  end

  def handle_in("logout", _payload, socket) do
    case Connection.logout(socket.assigns.character, self()) do
      :ok ->
        push(socket, "status", Protocol.status(:limbo))
        {:stop, :normal, :ok, socket}

      {:error, _} ->
        {:reply, {:error, %{reason: "replaced"}}, socket}
    end
  end

  def handle_in(_event, _payload, socket),
    do: {:reply, {:error, %{reason: "unknown message"}}, socket}

  @impl true
  def handle_info({:after_join, lines}, socket) do
    push(socket, "status", Protocol.status(:connected))
    if lines != [], do: push(socket, "output", Protocol.output(lines))
    # subscribed after the entry's own lines, so none arrives twice
    :ok = MuaWorld.subscribe(@world, socket.assigns.character)
    # after subscribing, so no Step falls between the mirror and its changes
    case MuaWorld.mirror(@world, socket.assigns.account, socket.assigns.character) do
      {:ok, mirror} -> push(socket, "mirror", Protocol.mirror(mirror))
      {:error, _} -> :ok
    end

    {:noreply, refresh(socket)}
  end

  def handle_info(
        {:mua, character, %{text: text, suggestions: suggestions}},
        %{assigns: %{character: character}} = socket
      ) do
    push(socket, "output", Protocol.output([text], suggestions))
    {:noreply, socket}
  end

  def handle_info({:mua, character, text}, %{assigns: %{character: character}} = socket) do
    push(socket, "output", Protocol.output([text]))
    {:noreply, socket}
  end

  def handle_info(
        {:mua_changes, character, change_set},
        %{assigns: %{character: character}} = socket
      ) do
    push(socket, "changes", Protocol.changes(change_set))
    {:noreply, socket}
  end

  def handle_info(:refresh, socket), do: {:noreply, refresh(socket)}

  # A Step changed what the Character has open to edit, as when someone
  # stores or destroys it (#284)
  def handle_info({:mua_editing, character}, %{assigns: %{character: character}} = socket),
    do: {:noreply, push_compose(socket)}

  # Another Connection took the Character over: this one may not command it
  def handle_info({:replaced, character}, %{assigns: %{character: character}} = socket) do
    MuaWorld.unsubscribe(@world, character)
    push(socket, "status", Protocol.status(:replaced))
    {:stop, :normal, socket}
  end

  def handle_info(_, socket), do: {:noreply, socket}

  # A World too far behind to answer in time skips this `state`; the next
  # one brings the client up to date. Waiting longer, or crashing the
  # Channel into a rejoin, would only add to its queue (#139).
  defp refresh(socket) do
    push_view(socket)
    push_compose(socket)
  catch
    :exit, {:timeout, _} -> socket
  end

  # The thing the `edit` Verb opened, once each time it changes, so the
  # client opens it in the composer (#274). A rejoin opens it again. When
  # it closes in the World, the client is told `closed` (#284).
  defp push_compose(socket) do
    %{account: account, character: character} = socket.assigns

    case MuaWorld.editing(@world, account, character) do
      {:ok, %{eid: eid} = editing} ->
        if socket.assigns[:composing] != eid,
          do: push(socket, "compose", Protocol.compose(editing))

        assign(socket, :composing, eid)

      _ ->
        if eid = socket.assigns[:composing],
          do: push(socket, "closed", Protocol.closed(eid))

        assign(socket, :composing, nil)
    end
  catch
    :exit, {:timeout, _} -> socket
  end

  defp push_view(socket) do
    %{account: account, character: character} = socket.assigns

    case MuaWorld.view(@world, account, character) do
      {:ok, view} -> push(socket, "state", Protocol.state(view))
      {:error, _} -> :ok
    end

    case MuaWorld.component(@world, character, "player") do
      %{"pending" => %{"options" => [_ | _] = options}} ->
        push(
          socket,
          "prompt",
          Protocol.prompt("Which do you mean?", Enum.map(options, & &1["name"]))
        )

      _ ->
        :ok
    end
  end

  defp command_reply({:ok, _lines}, ref), do: {:ok, %{ref: ref}}
  defp command_reply({:error, reason}, ref), do: {:error, %{ref: ref, reason: to_string(reason)}}
end
