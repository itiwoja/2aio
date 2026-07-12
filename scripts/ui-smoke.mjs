#!/usr/bin/env node
// 2AIO ui-smoke — 2aio-qa / 2aio-devops 共有のブラウザ実機スモーク (Issue #6)。
// 合否: 未捕捉例外 (pageerror) が 1 件でもあれば Fail ＝ブロック。
//       console error は consoleErrorsNonBlocking に記録するのみで合否に使わない（非ブロック）。
// exit: 0=pass / 1=fail / 2=usage / 3=TOOL_MISSING (playwright 未導入 → 呼び出し側は curl スモークで degraded 続行)

import { createServer } from "node:http";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_SELECTOR = "main, #app, #root, h1";
const DEFAULT_OUT_DIR = "screenshots";
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
};

function usage(message) {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write("Usage: node scripts/ui-smoke.mjs <url|dir> [--selector <css>] [--out <screenshot-dir>]\n");
  return 2;
}

function parseArguments(args) {
  let target;
  let selector = DEFAULT_SELECTOR;
  let outDir = DEFAULT_OUT_DIR;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--selector" || arg === "--out") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        return { error: `Missing value for ${arg}` };
      }
      if (arg === "--selector") selector = value;
      else outDir = value;
      index += 1;
    } else if (arg.startsWith("--")) {
      return { error: `Unknown option: ${arg}` };
    } else if (target) {
      return { error: "Only one <url|dir> may be supplied" };
    } else {
      target = arg;
    }
  }

  if (!target) return { error: "Missing <url|dir>" };
  return { target, selector, outDir };
}

function shortDetail(error) {
  const value = error instanceof Error ? error.message : String(error);
  return value.slice(0, 300);
}

function result({ url, selector, selectorVisible = false, uncaughtErrors = [], consoleErrorsNonBlocking = [], screenshots = [], ...extra }) {
  return {
    pass: false,
    url,
    selector,
    selectorVisible,
    uncaughtErrors,
    consoleErrorsNonBlocking,
    screenshots,
    ...extra,
  };
}

async function directoryTarget(target) {
  try {
    return (await stat(target)).isDirectory() ? path.resolve(target) : undefined;
  } catch {
    return undefined;
  }
}

function createStaticServer(root) {
  const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;

  return createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      let requestPath = decodeURIComponent(requestUrl.pathname);
      if (requestPath === "/") requestPath = "/index.html";
      const filePath = path.resolve(root, `.${requestPath}`);

      if (filePath !== root && !filePath.startsWith(rootPrefix)) {
        response.writeHead(403).end("Forbidden");
        return;
      }

      const file = await readFile(filePath);
      response.writeHead(200, {
        "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(file);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
}

async function startServer(root) {
  const server = createStaticServer(root);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not determine static server port");
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

async function stopServer(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(() => resolve()));
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.error) return usage(parsed.error);

  const localDirectory = await directoryTarget(parsed.target);
  let url = parsed.target;
  let server;

  if (localDirectory) {
    try {
      ({ server, url } = await startServer(localDirectory));
    } catch (error) {
      process.stdout.write(`${JSON.stringify(result({ url, selector: parsed.selector, reason: "SERVER_FAILED", detail: shortDetail(error) }))}\n`);
      return 1;
    }
  } else {
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") throw new Error("URL must use http or https");
    } catch (error) {
      await stopServer(server);
      return usage(`Invalid <url|dir>: ${shortDetail(error)}`);
    }
  }

  let playwright;
  try {
    playwright = await import("playwright");
  } catch (error) {
    await stopServer(server);
    process.stdout.write(`${JSON.stringify(result({ url, selector: parsed.selector, reason: "TOOL_MISSING", detail: `Playwright is required: ${shortDetail(error)}` }))}\n`);
    return 3;
  }

  let browser;
  const uncaughtErrors = [];
  const consoleErrorsNonBlocking = [];
  const screenshots = [];
  let selectorVisible = false;

  try {
    browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on("pageerror", (error) => uncaughtErrors.push(shortDetail(error)));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrorsNonBlocking.push(message.text().slice(0, 300));
    });

    try {
      await page.goto(url, { waitUntil: "load", timeout: 30_000 });
      await page.waitForTimeout(1_500);
    } catch (error) {
      process.stdout.write(`${JSON.stringify(result({ url, selector: parsed.selector, uncaughtErrors, consoleErrorsNonBlocking, screenshots, reason: "NAVIGATION_FAILED", detail: shortDetail(error) }))}\n`);
      return 1;
    }

    try {
      selectorVisible = await page.locator(parsed.selector).first().isVisible();
    } catch (error) {
      process.stdout.write(`${JSON.stringify(result({ url, selector: parsed.selector, uncaughtErrors, consoleErrorsNonBlocking, screenshots, reason: "SELECTOR_CHECK_FAILED", detail: shortDetail(error) }))}\n`);
      return 1;
    }

    try {
      await mkdir(parsed.outDir, { recursive: true });
      for (const width of [320, 1440]) {
        const screenshotPath = path.join(parsed.outDir, `smoke-${width}.png`);
        await page.setViewportSize({ width, height: 900 });
        await page.screenshot({ path: screenshotPath });
        screenshots.push(screenshotPath);
      }
    } catch (error) {
      process.stdout.write(`${JSON.stringify(result({ url, selector: parsed.selector, selectorVisible, uncaughtErrors, consoleErrorsNonBlocking, screenshots, reason: "SCREENSHOT_FAILED", detail: shortDetail(error) }))}\n`);
      return 1;
    }

    const pass = uncaughtErrors.length === 0 && selectorVisible;
    process.stdout.write(`${JSON.stringify({ pass, url, selector: parsed.selector, selectorVisible, uncaughtErrors, consoleErrorsNonBlocking, screenshots })}\n`);
    return pass ? 0 : 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify(result({ url, selector: parsed.selector, selectorVisible, uncaughtErrors, consoleErrorsNonBlocking, screenshots, reason: "BROWSER_FAILED", detail: shortDetail(error) }))}\n`);
    return 1;
  } finally {
    await browser?.close();
    await stopServer(server);
  }
}

process.exitCode = await main();
