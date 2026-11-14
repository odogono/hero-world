defmodule MuaWorld.Pictures do
  @moduledoc """
  Places' Pictures (see GLOSSARY.md, ADR 0027): image files in the
  `pictures/` directory beside a World's EDL. A place's `picture` names one
  by its path from the EDL's directory, such as `pictures/harbour_steps.png`.

  A World checks every Picture when it starts and when it is migrated, so a
  missing file never reaches a player. Each is served at its path with a
  hash of its content added, so a redrawn Picture is never shown stale from
  a browser's cache.

  A Picture reaches a Character through the `rooms` Library's `describe`,
  which asks the `mua` Capability to show it just before the description
  (`MuaWorld.Talk`).
  """

  # where Pictures live, beside the EDL, and the files they may be
  @src ~r{\Apictures/[A-Za-z0-9_\-]+(/[A-Za-z0-9_\-]+)*\.(png|webp|jpe?g|gif)\z}

  @typedoc "Each Picture's `src`, and the URL it is served at"
  @type urls :: %{String.t() => String.t()}

  @doc """
  Checks every place's Picture against the files beside the EDL at
  `edl_path`, and returns each one's URL. Fails naming every place whose
  Picture has a `src` that can't be served or has no file.
  """
  @spec load(OdgnEcs.t(), String.t()) :: {:ok, urls()} | {:error, String.t()}
  def load(world, edl_path) do
    base = Path.dirname(edl_path)

    checked =
      for {eid, %{"picture" => %{"src" => src}} = data} <-
            OdgnEcs.select(world, ["picture", "described"], with: ["picture"]) do
        {src, check(base, src, place_name(eid, data))}
      end

    case for({_src, {:error, why}} <- checked, do: why) do
      [] ->
        {:ok, for({src, {:ok, url}} <- checked, into: %{}, do: {src, url})}

      problems ->
        {:error, "Pictures can't be shown: " <> Enum.join(Enum.uniq(problems), "; ")}
    end
  end

  defp check(_base, src, place) when not is_binary(src),
    do: {:error, "#{place} has a picture with no src"}

  defp check(base, src, place) do
    path = Path.join(base, src)

    cond do
      not Regex.match?(@src, src) ->
        {:error, "#{place}'s picture #{inspect(src)} is not a file in pictures/"}

      not File.regular?(path) ->
        {:error, "#{place}'s picture #{src} has no file at #{path}"}

      true ->
        {:ok, url(src, File.read!(path))}
    end
  end

  @doc "The directory the Pictures of the World Definition at `edl_path` are in."
  @spec dir(String.t()) :: String.t()
  def dir(edl_path), do: Path.join(Path.dirname(edl_path), "pictures")

  @doc """
  The URL a Picture with `src` and these contents is served at. `vsn` is
  the query Plug.Static caches for good.
  """
  @spec url(String.t(), binary()) :: String.t()
  def url(src, contents) do
    hash = :crypto.hash(:sha256, contents) |> Base.encode16(case: :lower) |> binary_part(0, 12)
    "/" <> src <> "?vsn=" <> hash
  end

  defp place_name(eid, %{"described" => %{"name" => name}}) when is_binary(name),
    do: "#{name} (#{eid})"

  defp place_name(eid, _), do: "entity #{eid}"

  @doc """
  The line that shows `place`'s Picture, or `nil` when it has none to show:
  its `src`, the URL it is served at, and the place's name and description,
  which stand in for it where it isn't shown.
  """
  @spec line(OdgnEcs.t(), integer(), urls()) :: map() | nil
  def line(world, place, urls) do
    with %{"src" => src} <- OdgnEcs.get(world, place, "picture"),
         url when is_binary(url) <- urls[src] do
      described = OdgnEcs.get(world, place, "described") || %{}

      %{
        picture: %{
          src: src,
          url: url,
          name: described["name"] || "",
          alt: described["description"] || ""
        }
      }
    else
      _ -> nil
    end
  end
end
