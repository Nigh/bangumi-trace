import { validData } from "./validation"
import { compressionWindow, saveParents } from "./history"

type Session = { login: string; token: string; expiresAt: number }
type OAuthState = { state: string; verifier: string; expiresAt: number }
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const apiHeaders = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "bangumi-trace" }

const json = (value: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } })
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const fromBase64url = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0))
const toBase64 = (bytes: Uint8Array) => {
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 32_768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768))
  return btoa(binary)
}
const getCookie = (request: Request, name: string) => request.headers.get("cookie")?.split(/;\s*/).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1)
const cookie = (name: string, value: string, maxAge: number) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAge}`
const frontendUrl = (env: Env) => env.FRONTEND_ORIGIN.endsWith("/") ? env.FRONTEND_ORIGIN.slice(0, -1) : env.FRONTEND_ORIGIN
const frontendOrigin = (env: Env) => new URL(frontendUrl(env)).origin

async function key(env: Env) {
  const bytes = Uint8Array.from(atob(env.SESSION_SECRET), (char) => char.charCodeAt(0))
  if (bytes.length !== 32) throw new Error("SESSION_SECRET must be 32 bytes in base64")
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"])
}
async function seal(env: Env, value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(env), encoder.encode(JSON.stringify(value)))
  return `${base64url(iv)}.${base64url(new Uint8Array(encrypted))}`
}
async function open<T>(env: Env, value?: string): Promise<T | null> {
  if (!value) return null
  try {
    const [iv, encrypted] = value.split(".")
    return JSON.parse(decoder.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64url(iv) }, await key(env), fromBase64url(encrypted)))) as T
  } catch { return null }
}
async function challenge(verifier: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))))
}
function cors(env: Env, request: Request) {
  const origin = request.headers.get("origin")
  return origin === frontendOrigin(env) ? { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET, PUT, POST, OPTIONS", vary: "Origin" } : null
}
function assertWriteRequest(env: Env, request: Request) {
  if (request.headers.get("origin") !== frontendOrigin(env)) throw new Response("Forbidden", { status: 403 })
  if (request.method === "PUT" && !request.headers.get("content-type")?.startsWith("application/json")) throw new Response("Unsupported media type", { status: 415 })
}
async function session(env: Env, request: Request) {
  const value = await open<Session>(env, getCookie(request, "bt_session"))
  return value && value.expiresAt > Date.now() ? value : null
}
async function github(token: string, path: string, init?: RequestInit) {
  return fetch(`https://api.github.com${path}`, { ...init, headers: { ...apiHeaders, Authorization: `Bearer ${token}`, ...init?.headers } })
}
const repoPath = (owner: string, dataPath: string) => "/repos/" + encodeURIComponent(owner) + "/bangumi-trace-data/contents/" + dataPath.split("/").map(encodeURIComponent).join("/")
const repoBase = (owner: string) => "/repos/" + encodeURIComponent(owner) + "/bangumi-trace-data"
const refPath = (branch: string) => "/git/refs/heads/" + branch.split("/").map(encodeURIComponent).join("/")

type GitCommit = {
  sha: string
  commit: {
    message: string
    tree: { sha: string }
    author: { name: string; email: string; date: string }
    committer: { name: string; email: string; date: string }
  }
}

async function githubJson<T>(token: string, path: string, init?: RequestInit) {
  const response = await github(token, path, init)
  if (!response.ok) throw Object.assign(new Error(`GitHub API ${response.status}`), { status: response.status })
  return response.json() as Promise<T>
}

async function repositoryAvailable(auth: Session) {
  const response = await github(auth.token, repoBase(auth.login))
  return response.ok ? true : response.status === 404 ? false : null
}

async function login(env: Env) {
  const state = base64url(crypto.getRandomValues(new Uint8Array(24)))
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const saved = await seal(env, { state, verifier, expiresAt: Date.now() + 10 * 60_000 } satisfies OAuthState)
  const query = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, state, code_challenge: await challenge(verifier), code_challenge_method: "S256" })
  return new Response(null, { status: 302, headers: { location: `https://github.com/login/oauth/authorize?${query}`, "set-cookie": cookie("bt_oauth", saved, 600) } })
}
async function callback(env: Env, request: Request) {
  const url = new URL(request.url)
  const saved = await open<OAuthState>(env, getCookie(request, "bt_oauth"))
  if (!saved || saved.expiresAt < Date.now() || saved.state !== url.searchParams.get("state")) return json({ error: "OAuth state 无效或已过期" }, 400)
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "content-type": "application/json", "User-Agent": "bangumi-trace" }, body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code: url.searchParams.get("code"), code_verifier: saved.verifier }) })
  const token = await tokenResponse.json() as { access_token?: string; expires_in?: number; error_description?: string }
  if (!token.access_token) return json({ error: token.error_description || "GitHub 登录失败" }, 401)
  const userResponse = await github(token.access_token, "/user")
  const user = await userResponse.json() as { login?: string }
  if (!user.login) return json({ error: "无法读取 GitHub 用户信息" }, 502)
  const maxAge = Math.min(token.expires_in ?? 28_800, 28_800)
  const value = await seal(env, { login: user.login, token: token.access_token, expiresAt: Date.now() + maxAge * 1000 } satisfies Session)
  const headers = new Headers({ location: frontendUrl(env) + "/#settings" })
  headers.append("set-cookie", cookie("bt_session", value, maxAge))
  headers.append("set-cookie", cookie("bt_oauth", "", 0))
  return new Response(null, { status: 302, headers })
}
async function getData(env: Env, auth: Session) {
  const available = await repositoryAvailable(auth)
  if (available === false) return json({ error: "找不到可用的 bangumi-trace-data 仓库", code: "DATA_REPOSITORY_UNAVAILABLE" }, 404)
  if (available === null) return json({ error: "检查 GitHub 数据仓库失败" }, 502)
  const response = await github(auth.token, `${repoPath(auth.login, env.GITHUB_DATA_PATH)}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`)
  if (response.status === 404) return json({ data: null, sha: null })
  if (!response.ok) return json({ error: "读取 GitHub 数据失败" }, response.status)
  const file = await response.json() as { content: string; sha: string }
  try { return json({ data: JSON.parse(decoder.decode(Uint8Array.from(atob(file.content.replace(/\n/g, "")), (char) => char.charCodeAt(0)))), sha: file.sha }) }
  catch { return json({ error: "远端 JSON 无效" }, 502) }
}

async function createGitObject<T>(auth: Session, path: string, body: unknown) {
  return githubJson<T>(auth.token, `${repoBase(auth.login)}/git/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
}

async function currentHead(env: Env, auth: Session) {
  return githubJson<{ object: { sha: string } }>(auth.token, `${repoBase(auth.login)}${refPath(env.GITHUB_BRANCH)}`)
}

async function updateHead(env: Env, auth: Session, expected: string, sha: string, force: boolean) {
  const latest = await currentHead(env, auth)
  if (latest.object.sha !== expected) throw Object.assign(new Error("远端数据已更新"), { status: 409 })
  const response = await github(auth.token, `${repoBase(auth.login)}${refPath(env.GITHUB_BRANCH)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ sha, force }) })
  if (!response.ok) throw Object.assign(new Error("更新 GitHub 分支失败"), { status: response.status === 422 ? 409 : response.status })
}

async function compactHistory(env: Env, auth: Session, expectedHead: string) {
  const commits = await githubJson<GitCommit[]>(auth.token, `${repoBase(auth.login)}/commits?sha=${encodeURIComponent(env.GITHUB_BRANCH)}&per_page=100`)
  const window = compressionWindow(commits)
  if (!window) return
  const { recent, cutoff } = window
  const baseline = await createGitObject<{ sha: string }>(auth, "commits", { message: "Compressed bangumi history", tree: cutoff.commit.tree.sha, parents: [] })
  let parent = baseline.sha
  for (const item of recent.reverse()) {
    const recreated = await createGitObject<{ sha: string }>(auth, "commits", { message: item.commit.message, tree: item.commit.tree.sha, parents: [parent], author: item.commit.author, committer: item.commit.committer })
    parent = recreated.sha
  }
  await updateHead(env, auth, expectedHead, parent, true)
}

async function putData(env: Env, request: Request, auth: Session) {
  if (Number(request.headers.get("content-length") ?? 0) > 2_000_000) return json({ error: "数据文件过大" }, 413)
  const body = await request.json().catch(() => null) as { data?: unknown; sha?: unknown } | null
  if (!body || !validData(body.data) || (body.sha !== null && typeof body.sha !== "string")) return json({ error: "数据格式无效" }, 400)
  const content = JSON.stringify(body.data, null, 2) + "\n"
  if (content.length > 2_000_000) return json({ error: "数据文件过大" }, 413)
  const available = await repositoryAvailable(auth)
  if (available === false) return json({ error: "找不到可用的 bangumi-trace-data 仓库", code: "DATA_REPOSITORY_UNAVAILABLE" }, 404)
  if (available === null) return json({ error: "检查 GitHub 数据仓库失败" }, 502)
  const fileResponse = await github(auth.token, `${repoPath(auth.login, env.GITHUB_DATA_PATH)}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`)
  if (fileResponse.status !== 404) {
    if (!fileResponse.ok) return json({ error: "读取 GitHub 数据失败" }, fileResponse.status)
    const file = await fileResponse.json() as { sha: string }
    if (file.sha !== body.sha) return json({ error: "远端数据已更新" }, 409)
  } else if (body.sha !== null) return json({ error: "远端数据已更新" }, 409)

  try {
    const head = await currentHead(env, auth)
    const commit = await githubJson<{ tree: { sha: string }; parents: { sha: string }[]; committer: { date: string } }>(auth.token, `${repoBase(auth.login)}/git/commits/${head.object.sha}`)
    const blob = await createGitObject<{ sha: string }>(auth, "blobs", { content: toBase64(encoder.encode(content)), encoding: "base64" })
    const tree = await createGitObject<{ sha: string }>(auth, "trees", { base_tree: commit.tree.sha, tree: [{ path: env.GITHUB_DATA_PATH, mode: "100644", type: "blob", sha: blob.sha }] })
    const { amend, parents } = saveParents(head.object.sha, commit.parents.map((parent) => parent.sha), commit.committer.date, new Date().toISOString())
    const created = await createGitObject<{ sha: string }>(auth, "commits", { message: "Update bangumi data", tree: tree.sha, parents })
    await updateHead(env, auth, head.object.sha, created.sha, amend)
    await compactHistory(env, auth, created.sha)
    return json({ sha: blob.sha })
  } catch (error) {
    const status = (error as { status?: number }).status
    return status === 409 ? json({ error: "远端数据已更新" }, 409) : json({ error: "保存 GitHub 数据失败" }, status && status >= 400 && status < 600 ? status : 502)
  }
}
async function search(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim()
  if (!query || query.length > 100) return json({ error: "搜索词无效" }, 400)
  const response = await fetch("https://api.bgm.tv/v0/search/subjects?limit=10&offset=0", { method: "POST", headers: { "content-type": "application/json", "User-Agent": "bangumi-trace/1.0" }, body: JSON.stringify({ keyword: query, filter: { type: [2] } }) })
  return response.ok ? new Response(response.body, { headers: { "content-type": "application/json" } }) : json({ error: "Bangumi 搜索暂不可用" }, 502)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url), headers = cors(env, request)
    try {
      if (request.method === "OPTIONS") return headers ? new Response(null, { status: 204, headers }) : new Response(null, { status: 403 })
      if (url.pathname === "/auth/login" && request.method === "GET") return login(env)
      if (url.pathname === "/auth/callback" && request.method === "GET") return callback(env, request)
      if (url.pathname === "/auth/logout" && request.method === "POST") { assertWriteRequest(env, request); return new Response(null, { status: 204, headers: { ...headers!, "set-cookie": cookie("bt_session", "", 0) } }) }
      if (!headers) return json({ error: "Origin 不允许" }, 403)
      const auth = await session(env, request)
      if (!auth) return json({ error: "未登录" }, 401, headers)
      let response: Response
      if (url.pathname === "/api/data" && request.method === "GET") response = await getData(env, auth)
      else if (url.pathname === "/api/data" && request.method === "PUT") { assertWriteRequest(env, request); response = await putData(env, request, auth) }
      else if (url.pathname === "/api/bangumi/search" && request.method === "GET") response = await search(request)
      else response = json({ error: "Not found" }, 404)
      Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value))
      return response
    } catch (error) {
      if (error instanceof Response) return error
      console.error(JSON.stringify({ level: "error", path: url.pathname, requestId: request.headers.get("cf-ray"), type: error instanceof Error ? error.name : "UnknownError" }))
      return json({ error: "服务暂不可用" }, 500, headers ?? undefined)
    }
  },
} satisfies ExportedHandler<Env>
