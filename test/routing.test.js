const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { buildPlan, parseMetadata, renderTemplate } = require("../lib/routing");

const sample = [
  "Document-ID: A001",
  "Project: ATLAS",
  "Type: ADMIN",
  "Date: 2026-08-08",
  "Status: FINAL",
  "Title: Stakeholder List",
  "",
  "Body text must not influence routing."
].join("\n");

test("parses only the declared header fields", () => {
  assert.deepEqual(parseMetadata(sample), {
    "Document-ID": "A001",
    Project: "ATLAS",
    Type: "ADMIN",
    Date: "2026-08-08",
    Status: "FINAL",
    Title: "Stakeholder List"
  });
});

test("builds a safe folder, filename, and configurable archive date", () => {
  const plan = buildPlan({
    name: "file_001.txt",
    metadata: parseMetadata(sample),
    settings: {
      folderTemplate: "{Project}/{Type}/{year}/{month}",
      nameTemplate: "{Date}_{Project}_{Document-ID}_{Title}",
      archiveDate: "2026-10-15"
    }
  });
  assert.deepEqual(plan, {
    folder: path.join("ATLAS", "ADMIN", "2026", "08"),
    fileName: "2026-08-08_ATLAS_A001_Stakeholder-List.txt",
    archiveDate: "2026-10-15"
  });
});

test("rejects missing metadata, invalid dates, and traversal templates", () => {
  assert.throws(() => parseMetadata("Project: ATLAS"), /Missing metadata/);
  assert.throws(() => parseMetadata(sample.replace("2026-08-08", "not-a-date")), /YYYY-MM-DD/);
  assert.throws(() => parseMetadata(sample.replace("2026-08-08", "2026-02-31")), /YYYY-MM-DD/);
  assert.throws(() => renderTemplate("../{Project}", { Project: "ATLAS" }), /safe relative path/);
});