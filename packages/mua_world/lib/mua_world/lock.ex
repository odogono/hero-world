defmodule MuaWorld.Lock do
  @moduledoc """
  A lock file beside a World's database (`world.db.lock`), held while a World
  runs or a Migration changes it, so only one of them writes the database.
  Other processes may still open the database to read it, such as `sqlite3`
  or a backup tool.

  The file holds the holder's OS process id, a token unique to its Erlang VM,
  and its Erlang process. A lock is stale, and is taken over, when:

  - that OS process is gone;
  - it is this OS process id but another VM, as after a restart in a
    container, where the OS process id repeats; or
  - it is this VM and that Erlang process is gone, as after a crash.
  """

  @doc "Takes the lock for `db` on behalf of the calling process."
  @spec acquire(String.t()) :: :ok | {:error, :locked}
  def acquire(db) do
    path = path(db)

    case File.open(path, [:write, :exclusive]) do
      {:ok, file} ->
        IO.write(file, "#{System.pid()} #{vm_token()} #{:erlang.pid_to_list(self())}\n")
        File.close(file)
        :ok

      {:error, :eexist} ->
        if stale?(path) do
          File.rm(path)
          acquire(db)
        else
          {:error, :locked}
        end

      {:error, reason} ->
        raise File.Error, reason: reason, action: "create", path: path
    end
  end

  @doc "Gives up the lock for `db`, if the calling process holds it."
  @spec release(String.t()) :: :ok
  def release(db) do
    path = path(db)
    if holder(path) == {System.pid(), vm_token(), self()}, do: File.rm(path)
    :ok
  end

  @doc "Whether a live process holds the lock for `db`."
  def held?(db), do: File.exists?(path(db)) and not stale?(path(db))

  def path(db), do: db <> ".lock"

  defp holder(path) do
    with {:ok, text} <- File.read(path),
         [os_pid, token, erl] <- String.split(String.trim(text), " ", parts: 3) do
      {os_pid, token, :erlang.list_to_pid(String.to_charlist(erl))}
    else
      _ -> nil
    end
  rescue
    ArgumentError -> nil
  end

  defp stale?(path) do
    case holder(path) do
      nil ->
        true

      {os_pid, token, erl} ->
        cond do
          os_pid != System.pid() -> not os_alive?(os_pid)
          token != vm_token() -> true
          true -> not Process.alive?(erl)
        end
    end
  end

  # A token for this VM, made once: an OS process id alone can repeat
  defp vm_token do
    case :persistent_term.get({__MODULE__, :vm_token}, nil) do
      nil ->
        token = Base.url_encode64(:crypto.strong_rand_bytes(9), padding: false)
        :persistent_term.put({__MODULE__, :vm_token}, token)
        token

      token ->
        token
    end
  end

  defp os_alive?(os_pid) do
    case System.cmd("kill", ["-0", os_pid], stderr_to_stdout: true) do
      {_, 0} -> true
      _ -> false
    end
  end
end
