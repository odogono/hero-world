defmodule MuaServer.AuthTest do
  use ExUnit.Case

  import Plug.Conn
  import Phoenix.ConnTest

  @endpoint MuaServer.Endpoint

  defp google(code) do
    conn = get(build_conn(), "/auth/google")
    assert redirected_to(conn, 302) == "https://accounts.example/auth"
    get(recycle(conn), "/auth/google/callback", %{"code" => code})
  end

  test "an allowlisted, verified Google identity signs in to its Account" do
    conn = google("ada@example.com")
    # a browser goes back to the client
    assert redirected_to(conn, 302) == "/"

    session = get(recycle(conn), "/api/session")

    assert %{
             "account" => account,
             "socket_token" => token,
             "email" => "ada@example.com",
             "admin" => true
           } = json_response(session, 200)

    assert is_binary(token)

    # the same identity finds the same Account
    again = get(recycle(google("ada@example.com")), "/api/session")
    assert %{"account" => ^account} = json_response(again, 200)
  end

  test "serves the browser client, or says it isn't built" do
    conn = get(build_conn(), "/")
    assert conn.status in [200, 404]
  end

  # so a Local World's Worker can use sqlite-wasm in OPFS (ADR 0023)
  test "isolates every page from other origins" do
    for path <- ["/", "/api/session", "/health"] do
      conn = get(build_conn(), path)
      assert get_resp_header(conn, "cross-origin-opener-policy") == ["same-origin"]
      assert get_resp_header(conn, "cross-origin-embedder-policy") == ["require-corp"]
    end
  end

  test "an identity not on the allowlist, or unverified, is refused" do
    for code <- ["eve@example.com", "ada@example.com:unverified"] do
      assert html_response(google(code), 403) =~ "isn't invited"
    end

    # the fake sign-in answers in JSON
    assert json_response(post(build_conn(), "/auth/dev", %{email: "eve@example.com"}), 403) ==
             %{"error" => "not admitted"}
  end

  test "a callback without the session that started sign-in fails" do
    conn = get(build_conn(), "/auth/google/callback", %{"code" => "ada@example.com"})
    assert json_response(conn, 401)
  end

  test "the API needs a signed-in session" do
    assert json_response(get(build_conn(), "/api/session"), 401) == %{"error" => "not_signed_in"}
    assert json_response(post(build_conn(), "/api/character", %{name: "Ada"}), 401)
  end

  test "an Account makes one Character, with a public name" do
    conn = post(build_conn(), "/auth/dev", %{email: "bob@example.com"})
    assert %{"account" => _} = json_response(conn, 200)

    # not an admin
    assert %{"email" => "bob@example.com", "admin" => false} =
             json_response(get(recycle(conn), "/api/session"), 200)

    created = post(recycle(conn), "/api/character", %{name: "Bob"})

    id =
      case created.status do
        201 -> json_response(created, 201)["id"]
        # the Channel tests may have made Bob's already
        409 -> nil
      end

    again = post(recycle(conn), "/api/character", %{name: "Bobby"})
    assert json_response(again, 409) == %{"error" => "already_has_character"}

    %{"characters" => [%{"name" => "Bob"} = bob]} =
      json_response(get(recycle(conn), "/api/session"), 200)

    if id, do: assert(bob["id"] == id)
  end

  test "signing out drops the session" do
    conn = post(build_conn(), "/auth/dev", %{email: "ada@example.com"})
    conn = delete(recycle(conn), "/auth")
    assert json_response(get(recycle(conn), "/api/session"), 401)
  end

  test "the fake sign-in still checks the allowlist" do
    assert json_response(post(build_conn(), "/auth/dev", %{email: "eve@example.com"}), 403)
  end

  test "keeps the session in an HttpOnly, SameSite=Lax cookie" do
    conn = post(build_conn(), "/auth/dev", %{email: "ada@example.com"})
    [cookie] = get_resp_header(conn, "set-cookie")
    assert cookie =~ "HttpOnly"
    assert cookie =~ ~r/SameSite=Lax/i
  end
end
