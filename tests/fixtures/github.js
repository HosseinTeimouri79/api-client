// A stand-in for the GitHub API: one repository whose latest release has agent installers and their index.json.
import http from "node:http";

export const RELEASE_FILES = [
  { platform: "linux", arch: "x64", kind: "deb", file: "api-client-agent_9.9.9_amd64.deb", size: 30104828, sha256: "a".repeat(64) },
  { platform: "linux", arch: "x64", kind: "tar.gz", file: "api-client-agent-9.9.9-linux-x64.tar.gz", size: 44123297, sha256: "b".repeat(64) },
  { platform: "win32", arch: "x64", kind: "exe", file: "api-client-agent-setup-9.9.9-windows-x64.exe", size: 97100000, sha256: "c".repeat(64) },
  { platform: "darwin", arch: "arm64", kind: "zip", file: "api-client-agent-9.9.9-macos-arm64.zip", size: 40200000, sha256: "d".repeat(64) },
];
export const DOWNLOAD = "https://github.com/owner/repo/releases/download/v9.9.9/";

/** { url, hits, close }: `hits` counts the calls for the release. */
export async function fakeGitHub({ files = RELEASE_FILES, extra = [] } = {}) {
  const state = { hits: 0 };
  const srv = http.createServer((req, res) => {
    const json = (v) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(v));
    if (req.url === "/repos/owner/repo/releases/latest") {
      state.hits++;
      return json({
        tag_name: "v9.9.9",
        html_url: "https://github.com/owner/repo/releases/tag/v9.9.9",
        assets: [
          ...files.map((f) => ({ name: f.file, size: f.size, browser_download_url: DOWNLOAD + f.file })),
          { name: "index.json", size: 1, browser_download_url: `${state.url}/assets/index.json` },
          ...extra,
        ],
      });
    }
    if (req.url === "/assets/index.json") return json({ version: "9.9.9", files: [...files, ...extra.map((a) => ({ platform: "linux", arch: "x64", kind: "deb", file: a.name, size: 1, sha256: "e".repeat(64) }))] });
    res.writeHead(404).end();
  }).listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  state.url = `http://127.0.0.1:${srv.address().port}`;
  state.close = () => srv.close();
  return state;
}
