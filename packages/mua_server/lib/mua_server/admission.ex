defmodule MuaServer.Admission do
  @moduledoc """
  Who may enter: a signed-in identity whose verified email is on the
  configured allowlist (`MUA_ALLOWLIST`, comma separated), for the invite-only
  alpha (ADR 0010). Admitted identities are mapped to their Account by the
  World (`MuaWorld.sign_in/4`), which also learns from each sign-in whether
  the Account is an admin, one whose email is on `MUA_ADMINS` (#91).
  """

  @doc "The Account for an identity, if it is admitted."
  @spec admit(String.t(), String.t() | nil, boolean()) ::
          {:ok, pos_integer()} | {:error, :not_admitted}
  def admit(sub, email, verified?) do
    if verified? and admitted?(email),
      do: MuaWorld.sign_in(MuaServer.World, sub, String.downcase(email), admin: admin?(email)),
      else: {:error, :not_admitted}
  end

  @doc "Whether an email is on the allowlist."
  def admitted?(email) when is_binary(email),
    do: String.downcase(email) in Application.get_env(:mua_server, :allowlist, [])

  def admitted?(_), do: false

  @doc "Whether an email is one of the admins."
  def admin?(email) when is_binary(email),
    do: String.downcase(email) in Application.get_env(:mua_server, :admins, [])

  def admin?(_), do: false
end
