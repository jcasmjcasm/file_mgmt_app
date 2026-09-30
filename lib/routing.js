const path = require("node:path");

const REQUIRED_FIELDS = ["Document-ID", "Project", "Type", "Date", "Status", "Title"];

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseMetadata(content) {
  const metadata = {};
  for (const line of content.split(/\r?\n/).slice(0, 20)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (REQUIRED_FIELDS.includes(key) && value) metadata[key] = value;
  }

  const missing = REQUIRED_FIELDS.filter((field) => !metadata[field]);
  if (missing.length) throw new Error(`Missing metadata: ${missing.join(", ")}`);
  if (!isValidDate(metadata.Date)) {
    throw new Error("Date must use YYYY-MM-DD format");
  }
  return metadata;
}

function safePart(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "untitled";
}

function renderTemplate(template, values, { fileName = false } = {}) {
  const rendered = template.replace(/\{([a-zA-Z-]+)\}/g, (match, key) => {
    if (!(key in values)) throw new Error(`Unknown template field: ${key}`);
    return safePart(values[key]);
  });
  if (/[{}]/.test(rendered)) throw new Error("Template contains an invalid placeholder");

  const normalized = rendered.replace(/[\\/]+/g, path.sep);
  const segments = normalized.split(path.sep).filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Template must resolve to a safe relative path");
  }
  if (fileName && segments.length !== 1) throw new Error("Filename template cannot include folders");
  return segments.join(path.sep);
}

function buildPlan({ name, metadata, settings, archiveDate }) {
  const dateParts = metadata.Date.split("-");
  const values = {
    ...metadata,
    year: dateParts[0],
    month: dateParts[1],
    day: dateParts[2]
  };
  const folder = renderTemplate(settings.folderTemplate, values);
  const extension = path.extname(name) || ".txt";
  const baseName = renderTemplate(settings.nameTemplate, values, { fileName: true });
  return {
    folder,
    fileName: path.extname(baseName) ? baseName : `${baseName}${extension}`,
    archiveDate: archiveDate || settings.archiveDate || ""
  };
}

module.exports = { buildPlan, parseMetadata, renderTemplate };