import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./config.js";

const RELEASE_BASE =
  "https://github.com/cloudflare/cloudflared/releases/latest/download";

/** Where a downloaded binary is cached. Gitignored. */
export const CACHE_DIR = join(ROOT, ".cache", "cloudflared");

// cloudflared logs its own control endpoint (api.trycloudflare.com) while it
// registers, before it prints the assigned hostname. Match only the latter,
// which is always a multi-word slug.
const QUICK_TUNNEL_RE =
  /https:\/\/(?!api\.)[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/i;

/**
 * Release asset for this machine. Windows and Linux ship a bare binary;
 * macOS ships a tarball we have to unpack.
 */
function assetFor(platform = process.platform, arch = process.arch) {
  const cpu = arch === "arm64" ? "arm64" : arch === "x64" ? "amd64" : null;
  if (!cpu) {
    throw new Error(
      `No cloudflared build for ${platform}/${arch}. Install it yourself and set CLOUDFLARED_BIN.`,
    );
  }
  if (platform === "win32") {
    return { name: `cloudflared-windows-${cpu}.exe`, archive: false, bin: "cloudflared.exe" };
  }
  if (platform === "linux") {
    return { name: `cloudflared-linux-${cpu}`, archive: false, bin: "cloudflared" };
  }
  if (platform === "darwin") {
    return { name: `cloudflared-darwin-${cpu}.tgz`, archive: true, bin: "cloudflared" };
  }
  throw new Error(
    `No cloudflared build for ${platform}/${arch}. Install it yourself and set CLOUDFLARED_BIN.`,
  );
}

/** True when the path answers `--version`, i.e. it is a working cloudflared. */
function isWorking(bin) {
  try {
    const probe = spawnSync(bin, ["--version"], { stdio: "ignore", timeout: 15000 });
    return probe.status === 0;
  } catch {
    return false;
  }
}

async function downloadCloudflared({ onProgress } = {}) {
  const asset = assetFor();
  const target = join(CACHE_DIR, asset.bin);
  mkdirSync(CACHE_DIR, { recursive: true });

  onProgress?.(`Downloading cloudflared (~35 MB, one time) -> ${target}`);

  const res = await fetch(`${RELEASE_BASE}/${asset.name}`, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(
      `Could not download cloudflared (HTTP ${res.status}). Install it manually ` +
        `(winget install --id Cloudflare.cloudflared) and re-run.`,
    );
  }
  const bytes = Buffer.from(await res.arrayBuffer());

  // Write beside the target first so an interrupted download never leaves a
  // half-written binary that later runs would treat as cached.
  const tmp = join(CACHE_DIR, `${asset.name}.tmp`);
  writeFileSync(tmp, bytes);

  if (asset.archive) {
    const untar = spawnSync("tar", ["-xzf", tmp, "-C", CACHE_DIR], { stdio: "ignore" });
    rmSync(tmp, { force: true });
    if (untar.status !== 0 || !existsSync(target)) {
      throw new Error("Could not unpack the cloudflared tarball.");
    }
  } else {
    renameSync(tmp, target);
  }

  if (process.platform !== "win32") chmodSync(target, 0o755);
  return target;
}

/**
 * Find a usable cloudflared: explicit override, then PATH, then our cache,
 * then download one. Returns an absolute path or bare command name.
 */
export async function resolveCloudflared({ onProgress } = {}) {
  const override = process.env.CLOUDFLARED_BIN?.trim();
  if (override) {
    if (!isWorking(override)) {
      throw new Error(`CLOUDFLARED_BIN is set to ${override}, but it does not run.`);
    }
    return override;
  }

  if (isWorking("cloudflared")) return "cloudflared";

  const cached = join(CACHE_DIR, process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
  if (existsSync(cached) && isWorking(cached)) return cached;

  const downloaded = await downloadCloudflared({ onProgress });
  if (!isWorking(downloaded)) {
    throw new Error(`Downloaded cloudflared to ${downloaded} but it does not run.`);
  }
  return downloaded;
}

/** Tail of cloudflared's own log, so a failure says why instead of just failing. */
function lastLines(output, count = 3) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-count);
  return lines.length ? `cloudflared said:\n  ${lines.join("\n  ")}` : "";
}

/**
 * Start a free quick tunnel to a local port. No Cloudflare account needed.
 * Resolves once cloudflared prints the public hostname (it uses stderr).
 */
export function startTunnel({ bin, port, timeoutMs = 45000 }) {
  const child = spawn(
    bin,
    ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  let stopped = false;
  const kill = () => {
    if (stopped) return;
    stopped = true;
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  };
  // A crash must not leave the tunnel running and pointing at a dead port.
  process.once("exit", kill);

  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      kill();
      reject(
        new Error(
          `cloudflared did not report a public URL within ${Math.round(timeoutMs / 1000)}s.\n` +
            `${lastLines(output)}\n` +
            `Retry, or re-run with --no-tunnel and set CONNECT_HOOK_PUBLIC_URL to your own tunnel origin.`,
        ),
      );
    }, timeoutMs);

    const scan = (chunk) => {
      if (settled) return;
      output += chunk.toString();
      const match = output.match(QUICK_TUNNEL_RE);
      if (!match) return;
      settled = true;
      clearTimeout(timer);
      resolve({ url: match[0].replace(/\/+$/, ""), stop: kill, process: child });
    };

    child.stderr.on("data", scan);
    child.stdout.on("data", scan);

    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Could not start cloudflared: ${err.message}`));
    });

    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new Error(
          `cloudflared exited with code ${code} before opening a tunnel.\n${lastLines(output)}`,
        ),
      );
    });
  });
}
