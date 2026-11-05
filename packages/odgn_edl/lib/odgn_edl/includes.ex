defmodule OdgnEdl.Includes do
  @moduledoc false
  # Reads `include` lines (ADR 0025): each is replaced by the definitions of
  # the file it names, in place. A file is read once however often it is
  # included, so includes may repeat or form a cycle. Scripts in an included
  # file resolve against that file's directory.
  #
  # The source returned is the EDL's own source followed by each included
  # file's, so the World's EDL hash changes when an included file does. An
  # EDL with no includes keeps the hash of its source alone.

  alias OdgnEdl.{Atom, Entity, Error, Include}

  @spec expand([OdgnEdl.definition() | Include.t()], String.t(), keyword()) ::
          {:ok, [OdgnEdl.definition()], String.t()} | {:error, Error.t()}
  def expand(definitions, source, opts) do
    roots = Keyword.get(opts, :roots, %{})
    path = Keyword.get(opts, :path)
    seen = if path, do: MapSet.new([Path.expand(path)]), else: MapSet.new()

    {definitions, sources, _seen} = expand_all(definitions, path, roots, seen)
    {:ok, definitions, Enum.join([source | sources], "\n")}
  catch
    {:edl_error, %Error{} = error} -> {:error, error}
  end

  defp expand_all(definitions, from, roots, seen) do
    {defs, sources, seen} =
      Enum.reduce(definitions, {[], [], seen}, fn
        %Include{path: include}, {defs, sources, seen} ->
          file = resolve(include, from, roots)

          if MapSet.member?(seen, file) do
            {defs, sources, seen}
          else
            source = read(file, include)
            seen = MapSet.put(seen, file)

            {included, nested, seen} =
              source
              |> parse(file)
              |> Enum.map(&anchor_script(&1, file))
              |> expand_all(file, roots, seen)

            {Enum.reverse(included, defs), sources ++ [source | nested], seen}
          end

        definition, {defs, sources, seen} ->
          {[definition | defs], sources, seen}
      end)

    {Enum.reverse(defs), sources, seen}
  end

  defp resolve(include, from, roots) do
    case String.split(include, ":", parts: 2) do
      [root, rest] when byte_size(root) > 1 ->
        case Map.fetch(roots, root) do
          {:ok, dir} -> Path.expand(rest, dir)
          :error -> fail("include \"#{include}\": no root named '#{root}' is configured")
        end

      _ ->
        if Path.type(include) == :absolute do
          Path.expand(include)
        else
          if from == nil,
            do: fail("include \"#{include}\": a relative include needs the EDL's :path")

          Path.expand(include, Path.dirname(from))
        end
    end
  end

  defp read(file, include) do
    case File.read(file) do
      {:ok, source} ->
        source

      {:error, reason} ->
        fail("include \"#{include}\": cannot read #{file}: #{:file.format_error(reason)}")
    end
  end

  defp parse(source, file) do
    case OdgnEdl.parse(source) do
      {:ok, definitions} ->
        definitions

      {:error, %Error{} = error} ->
        throw({:edl_error, %{error | message: "#{file}: #{error.message}"}})
    end
  end

  # A script in an included file is relative to that file, not the includer
  defp anchor_script(%struct{components: %{"script" => %{"src" => src} = script}} = d, file)
       when struct in [Atom, Entity] and is_binary(src) and src != "" do
    put_in(d.components["script"], %{script | "src" => Path.expand(src, Path.dirname(file))})
  end

  defp anchor_script(definition, _file), do: definition

  defp fail(message), do: throw({:edl_error, Error.new(:include, message)})
end
