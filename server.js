const fs = require("node:fs/promises");
const { constants } = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { buildPlan, parseMetadata, renderTemplate } = require("./lib/routing");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT) || 4173;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.resolve(process.env.FILE_ROUTER_DATA_DIR || path.join(ROOT, ".file-router-data"));
const CONFIG_PATH = path.join(DATA_DIR, "config.json");
const MANIFEST_PATH = path.join(DATA_DIR, "manifest.json");
const DEFAULT_CONFIG = {
  inputDir: path.join(ROOT, "file_router", "input"),
  organizedDir: path.join(ROOT, "file_router", "organized"),
  archiveDir: path.join(ROOT, "file_router", "archive"),
  folderTemplate: "{Project}/{Type}/{year}/{month}",
  archiveFolderTemplate: "{Project}/{Type}/{year}/{month}",
  nameTemplate: "{Date}_{Project}_{Document-ID}_{Title}",
  archiveDate: ""
};

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function loadConfig() {
  return { ...DEFAULT_CONFIG, ...(await readJson(CONFIG_PATH, {})) };
}

async function saveConfig(config) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

async function loadManifest() {
  return readJson(MANIFEST_PATH, []);
}

async function saveManifest(manifest) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function cleanConfig(input) {
  const config = {};
  for (const key of ["inputDir", "organizedDir", "archiveDir"]) {
    if (typeof input[key] !== "string" || !input[key].trim()) throw new Error(`${key} is required`);
    config[key] = path.resolve(input[key].trim());
  }
  for (const key of ["folderTemplate", "archiveFolderTemplate", "nameTemplate"]) {
    if (typeof input[key] !== "string" || !input[key].trim()) throw new Error(`${key} is required`);
    config[key] = input[key].trim();
  }
  config.archiveDate = input.archiveDate || "";
  if (config.archiveDate && !validDate(config.archiveDate)) throw new Error("Archive date must use YYYY-MM-DD format");

  const locations = [config.inputDir, config.organizedDir, config.archiveDir];
  if (new Set(locations.map((location) => process.platform === "win32" ? location.toLowerCase() : location)).size !== 3) {
    throw new Error("Input, organized, and archive folders must be different");
  }
  for (let left = 0; left < locations.length; left += 1) {
    for (let right = left + 1; right < locations.length; right += 1) {
      const first = process.platform === "win32" ? locations[left].toLowerCase() : locations[left];
      const second = process.platform === "win32" ? locations[right].toLowerCase() : locations[right];
      if (first.startsWith(`${second}${path.sep}`) || second.startsWith(`${first}${path.sep}`)) {
        throw new Error("Input, organized, and archive folders cannot contain one another");
      }
    }
  }
  return config;
}

function localDate() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
}

async function scan(config) {
  const entries = await fs.readdir(config.inputDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries.filter((item) => item.isFile()).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = { name: entry.name };
    try {
      const metadata = parseMetadata(await fs.readFile(path.join(config.inputDir, entry.name), "utf8"));
      const plan = buildPlan({ name: entry.name, metadata, settings: config });
      renderTemplate(config.archiveFolderTemplate, templateValues(metadata));
      files.push({ ...file, metadata, ...plan, valid: true });
    } catch (error) {
      files.push({ ...file, valid: false, error: error.message });
    }
  }
  return files;
}

function inside(root, relativePath) {
  const target = path.resolve(root, relativePath);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error("Resolved path is outside its destination folder");
  return target;
}

async function moveFile(source, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination, constants.COPYFILE_EXCL);
  await fs.unlink(source);
}

async function applyFiles(payload) {
  const config = cleanConfig(payload.config || {});
  await saveConfig(config);
  const selected = new Map((payload.files || []).map((file) => [file.name, file.archiveDate]));
  const current = await scan(config);
  const manifest = await loadManifest();
  const occupied = new Set();
  const results = [];

  for (const file of current.filter((item) => selected.has(item.name))) {
    if (!file.valid) {
      results.push({ name: file.name, ok: false, error: file.error });
      continue;
    }
    const archiveDate = selected.get(file.name) || file.archiveDate;
    if (!validDate(archiveDate)) {
      results.push({ name: file.name, ok: false, error: "Set a valid archive date before applying" });
      continue;
    }
    const relative = path.join(file.folder, file.fileName);
    const destination = inside(config.organizedDir, relative);
    const identity = process.platform === "win32" ? destination.toLowerCase() : destination;
    if (occupied.has(identity) || await fs.access(destination).then(() => true, () => false)) {
      results.push({ name: file.name, ok: false, error: "Destination already exists; no file was overwritten" });
      continue;
    }
    occupied.add(identity);
    try {
      const sourcePath = path.join(config.inputDir, file.name);
      await moveFile(sourcePath, destination);
      const record = {
        id: `${file.metadata["Document-ID"]}:${Date.now()}:${Math.random().toString(16).slice(2, 8)}`,
        sourceName: file.name,
        fileName: file.fileName,
        organizedPath: destination,
        archiveDate,
        metadata: file.metadata,
        status: "organized",
        organizedAt: new Date().toISOString(),
        archivedAt: ""
      };
      manifest.push(record);
      await saveManifest(manifest);
      results.push({ name: file.name, ok: true, fileName: file.fileName, archiveDate });
    } catch (error) {
      results.push({ name: file.name, ok: false, error: error.message });
    }
  }
  return results;
}

function templateValues(metadata) {
  const [year, month, day] = metadata.Date.split("-");
  return { ...metadata, year, month, day };
}

async function archiveDue() {
  const config = await loadConfig();
  const manifest = await loadManifest();
  const archived = [];
  for (const record of manifest.filter((item) => item.status === "organized" && item.archiveDate <= localDate())) {
    try {
      const folder = renderTemplate(config.archiveFolderTemplate, templateValues(record.metadata));
      const destination = inside(config.archiveDir, path.join(folder, path.basename(record.organizedPath)));
      if (await fs.access(destination).then(() => true, () => false)) {
        record.error = "Archive destination already exists; no file was overwritten";
        await saveManifest(manifest);
        archived.push({ id: record.id, ok: false, error: record.error });
        continue;
      }
      await moveFile(record.organizedPath, destination);
      record.status = "archived";
      record.archivePath = destination;
      record.archivedAt = new Date().toISOString();
      delete record.error;
      archived.push({ id: record.id, ok: true, fileName: record.fileName });
      await saveManifest(manifest);
    } catch (error) {
      record.error = error.message;
      await saveManifest(manifest);
      archived.push({ id: record.id, ok: false, error: error.message });
    }
  }
  return archived;
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error("Request body is too large");
  }
  return body ? JSON.parse(body) : {};
}

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

async function serveStatic(request, response) {
  const pathname = decodeURIComponent(new URL(request.url, `http://${HOST}`).pathname);
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(PUBLIC_DIR, relative);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) return sendJson(response, 404, { error: "Not found" });
  try {
    const body = await fs.readFile(filePath);
    const type = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" }[path.extname(filePath)] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-cache" });
    response.end(body);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${HOST}`);
    if (request.method === "GET" && url.pathname === "/api/config") {
      const [config, manifest] = await Promise.all([loadConfig(), loadManifest()]);
      return sendJson(response, 200, { config, manifest });
    }
    if (request.method === "POST" && url.pathname === "/api/config") {
      const config = cleanConfig((await readBody(request)).config || {});
      await saveConfig(config);
      return sendJson(response, 200, { config });
    }
    if (request.method === "POST" && url.pathname === "/api/scan") {
      const config = cleanConfig((await readBody(request)).config || {});
      return sendJson(response, 200, { files: await scan(config) });
    }
    if (request.method === "POST" && url.pathname === "/api/apply") {
      return sendJson(response, 200, { results: await applyFiles(await readBody(request)) });
    }
    if (request.method === "POST" && url.pathname === "/api/archive-due") {
      return sendJson(response, 200, { results: await archiveDue() });
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/")) return sendJson(response, 404, { error: "Not found" });
    if (request.method !== "GET") return sendJson(response, 405, { error: "Method not allowed" });
    return serveStatic(request, response);
  } catch (error) {
    return sendJson(response, 400, { error: error.message || "Request failed" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`File Router running at http://${HOST}:${PORT}`);
  archiveDue().catch((error) => console.error("Archive scheduler error:", error.message));
});
setInterval(() => archiveDue().catch((error) => console.error("Archive scheduler error:", error.message)), 60_000).unref();