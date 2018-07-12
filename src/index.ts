import fs from "fs"

import { promisify } from "util"
import http, { RequestOptions } from "https"
import { IncomingMessage } from "http"
import DEBUG from "debug"
import PATH from "path"

const debug = DEBUG("github-token-store")

export type GitHubAuthHost = Required<
  Pick<RequestOptions, "protocol" | "hostname">
>

export interface GitHubAuthOpt {
  /// array	A list of scopes that this authorization is in.
  scopes?: string[]
  /// Required. A note to remind you what the OAuth token is for. Tokens not associated with a specific OAuth application (i.e. personal access tokens) must have a unique note.
  note: string
  /// A URL to remind you what app the OAuth token is for.
  note_url?: string
  /// The 20 character OAuth app client key for which to create the token.
  client_id?: string
  /// The 40 character OAuth app client secret for which to create the token.
  client_secret?: string
  /// A unique string to distinguish an authorization from others created for the same client ID and user.
  fingerprint?: string
}

const defaultAuthHost: GitHubAuthHost = {
  protocol: "https:",
  hostname: "api.github.com",
}

const AUTH_PATH = "/authorizations"

const request = (
  options: RequestOptions,
  body: string,
): Promise<{
  statusCode: number
  headers: IncomingMessage["headers"]
  data: string
}> =>
  new Promise((resolve, reject) => {
    debug("> Request", options, body)
    const req = http.request(options, resp => {
      debug("< Response statusCode", resp.statusCode)
      debug("< Response headers", JSON.stringify(resp.headers))
      resp.setEncoding("utf8")
      let chunk = ""
      resp.on("data", c => (chunk += c))

      resp.on("end", () => {
        if (typeof resp.statusCode !== "number") {
          return reject(new Error("No status code in response"))
        }
        const response = {
          headers: resp.headers,
          statusCode: resp.statusCode,
        }
        if (resp.statusCode < 300) {
          resolve({ ...response, data: chunk })
        } else {
          reject(new Error(`Invalid status code: ${resp.statusCode}: ${chunk}`))
        }
      })

      resp.on("error", error => {
        debug("< Response error", error)
        reject(error)
      })
    })

    req.on("error", reject)
    req.write(body)
    req.end()
  })

const mkdir = async (path: string) => {
  const dirname = PATH.dirname(path)
  debug("check ", dirname)
  const paths = dirname.split(PATH.sep)

  const statp = promisify(fs.stat)
  const mkdirp = promisify(fs.mkdir)
  let dir = "/"
  for (const p of paths) {
    dir = PATH.join(dir, p)
    if (fs.existsSync(dir)) {
      debug("exists dir", dir)
      continue
    }
    debug("not exists dir", dir)
    const stat = await statp(dir).catch(async e => {
      if (e.code === "ENOENT") {
        await mkdirp(dir)
        debug("create dir:", dir)
      }
    })
    if (stat && !stat.isDirectory()) {
      await mkdirp(dir)
      debug("create dir:", dir)
    }
  }
}

const requsetAuth = (
  username: string,
  password: string,
  authHost: GitHubAuthHost,
  authOpt: GitHubAuthOpt,
) => {
  const body = JSON.stringify(authOpt)
  return request(
    {
      ...authHost,
      auth: `${username}:${password}`,
      method: "POST",
      path: AUTH_PATH,
      headers: {
        // Accept: "application/vnd.github.v3+json",
        "User-Agent": "github-token-store",
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body, "utf8"),
      },
    },
    body,
  )
}

export class GitHubTokenStore {
  constructor(
    public readonly storePath: string,
    public authHost: GitHubAuthHost = defaultAuthHost,
  ) {
    if (!PATH.isAbsolute(storePath)) {
      this.storePath = PATH.resolve(storePath)
    }
  }

  public exists(): boolean {
    return fs.existsSync(this.storePath)
  }

  public async authenticate(
    username: string,
    password: string,
    authOpt: GitHubAuthOpt,
  ) {
    const response = await requsetAuth(
      username,
      password,
      this.authHost,
      authOpt,
    )

    const { token } = JSON.parse(response.data) as { token?: string }
    if (!token) {
      throw new Error(`Response has no tokens: ${JSON.stringify(response)}`)
    }

    await mkdir(this.storePath)

    return promisify(fs.writeFile)(this.storePath, token, { encoding: "utf8" })
  }

  public async readToken(): Promise<string | undefined> {
    return promisify(fs.readFile)(this.storePath, { encoding: "utf8" }).catch(
      error => {
        debug("Error in readToken:", error)
        return Promise.resolve(undefined)
      },
    )
  }
}
