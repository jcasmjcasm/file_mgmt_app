const byId = (id) => document.getElementById(id);
const configInputs = {
  inputDir: "input-dir",
  organizedDir: "organized-dir",
  archiveDir: "archive-dir",
  folderTemplate: "folder-template",
  nameTemplate: "name-template",
  archiveFolderTemplate: "archive-folder-template",
  archiveDate: "archive-date"
};

let config = {};
let files = [];
let manifest = [];
const selected = new Set();

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed");
  return result;
}

function readConfigForm() {
  return Object.fromEntries(Object.entries(configInputs).map(([key, id]) => [key, byId(id).value.trim()]));
}

function fillConfigForm(value) {
  config = { ...value };
  for (const [key, id] of Object.entries(configInputs)) byId(id).value = config[key] || "";
}

function showNotice(message, error = false) {
  const notice = byId("notice");
  notice.textContent = message;
  notice.hidden = !message;
  notice.classList.toggle("error", error);
}

function makeCell(className, text) {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  if (text !== undefined) cell.textContent = text;
  return cell;
}

function renderQueue() {
  const body = byId("file-rows");
  body.replaceChildren();
  byId("queue-count").textContent = `${files.length} FILE${files.length === 1 ? "" : "S"}`;

  if (!files.length) {
    const row = document.createElement("tr");
    const cell = makeCell("empty-state", "No files found in this folder.");
    cell.colSpan = 6;
    row.append(cell);
    body.append(row);
  }

  for (const file of files) {
    const row = document.createElement("tr");
    const checkCell = makeCell("check-column");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selected.has(file.name);
    checkbox.disabled = !file.valid;
    checkbox.setAttribute("aria-label", `Select ${file.name}`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selected.add(file.name);
      else selected.delete(file.name);
      updateSelection();
    });
    checkCell.append(checkbox);
    row.append(checkCell);

    const sourceCell = makeCell();
    const sourceName = document.createElement("span");
    sourceName.className = "source-name";
    sourceName.textContent = file.name;
    sourceCell.append(sourceName);
    if (file.metadata) {
      const sourceDate = document.createElement("span");
      sourceDate.className = "subline";
      sourceDate.textContent = file.metadata.Date;
      sourceCell.append(sourceDate);
    }
    row.append(sourceCell);

    const documentCell = makeCell("doc-cell");
    if (file.metadata) {
      const title = document.createElement("span");
      title.className = "doc-title";
      title.textContent = file.metadata.Title;
      const tags = document.createElement("span");
      tags.className = "tag-row";
      for (const value of [file.metadata.Type, file.metadata.Status]) {
        const tag = document.createElement("span");
        tag.className = `tag${value === "DRAFT" ? " status-draft" : ""}`;
        tag.textContent = value;
        tags.append(tag);
      }
      documentCell.append(title, tags);
    } else {
      documentCell.textContent = "Unreadable metadata";
    }
    row.append(documentCell);

    row.append(makeCell("destination", file.valid ? `${file.folder}/${file.fileName}` : file.error));

    const dateCell = makeCell();
    const date = document.createElement("input");
    date.type = "date";
    date.className = "date-input";
    date.value = file.archiveDate || "";
    date.disabled = !file.valid;
    date.setAttribute("aria-label", `Archive date for ${file.name}`);
    date.addEventListener("change", () => {
      file.archiveDate = date.value;
      updateSelection();
    });
    dateCell.append(date);
    row.append(dateCell);

    const stateCell = makeCell();
    const state = document.createElement("span");
    state.className = `state-pill${file.valid ? "" : " invalid"}`;
    state.textContent = file.valid ? (file.archiveDate ? "READY" : "DATE NEEDED") : "CHECK FILE";
    stateCell.append(state);
    row.append(stateCell);
    body.append(row);
  }

  byId("select-all").checked = files.filter((file) => file.valid).length > 0 && files.filter((file) => file.valid).every((file) => selected.has(file.name));
  updateSelection();
  updateMetrics();
}

function updateSelection() {
  const ready = [...selected].filter((name) => files.some((file) => file.name === name && file.valid));
  byId("selection-count").textContent = `${ready.length} selected`;
  byId("apply-button").disabled = ready.length === 0;
}

function updateMetrics() {
  byId("metric-input").textContent = files.length;
  byId("metric-ready").textContent = files.filter((file) => file.valid).length;
  byId("metric-scheduled").textContent = manifest.filter((record) => record.status === "organized").length;
  byId("metric-archived").textContent = manifest.filter((record) => record.status === "archived").length;
}

function renderHistory() {
  const list = byId("history-list");
  list.replaceChildren();
  const recent = [...manifest].sort((a, b) => (b.archivedAt || b.organizedAt || "").localeCompare(a.archivedAt || a.organizedAt || "")).slice(0, 8);
  if (!recent.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "No file moves yet.";
    list.append(empty);
    return;
  }
  for (const record of recent) {
    const row = document.createElement("div");
    row.className = "history-row";
    const file = document.createElement("span");
    file.className = "history-file";
    file.textContent = record.fileName;
    const destination = document.createElement("span");
    destination.className = "history-path";
    destination.textContent = record.archivePath || record.organizedPath;
    destination.title = destination.textContent;
    const date = document.createElement("span");
    date.className = "history-date";
    date.textContent = record.status === "archived" ? `Archived ${record.archiveDate}` : `Archive ${record.archiveDate}`;
    const state = document.createElement("span");
    state.className = `history-state${record.error ? " error" : ""}`;
    state.textContent = record.error ? "Needs attention" : record.status === "archived" ? "ARCHIVED" : "SCHEDULED";
    row.append(file, destination, date, state);
    list.append(row);
  }
}

async function refreshConfig() {
  const response = await api("/api/config");
  fillConfigForm(response.config);
  manifest = response.manifest;
  renderHistory();
  updateMetrics();
}

async function scanFolder(message = "") {
  try {
    const response = await api("/api/scan", { method: "POST", body: JSON.stringify({ config: readConfigForm() }) });
    files = response.files;
    for (const file of files) if (!file.archiveDate) file.archiveDate = byId("archive-date").value;
    for (const name of selected) if (!files.some((file) => file.name === name && file.valid)) selected.delete(name);
    renderQueue();
    showNotice(message || `Scanned ${files.length} file${files.length === 1 ? "" : "s"}. Review the previews, then apply selected changes.`);
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function saveRules() {
  try {
    config = await api("/api/config", { method: "POST", body: JSON.stringify({ config: readConfigForm() }) }).then((value) => value.config);
    fillConfigForm(config);
    await scanFolder("Routing rules saved. Previews have been refreshed.");
  } catch (error) {
    showNotice(error.message, true);
  }
}

byId("scan-button").addEventListener("click", () => scanFolder());
byId("save-rules").addEventListener("click", saveRules);
byId("select-all").addEventListener("change", (event) => {
  for (const file of files) {
    if (!file.valid) continue;
    if (event.target.checked) selected.add(file.name);
    else selected.delete(file.name);
  }
  renderQueue();
});

byId("archive-date").addEventListener("change", (event) => {
  for (const file of files) file.archiveDate = event.target.value;
  renderQueue();
});

byId("apply-button").addEventListener("click", async () => {
  const chosen = files.filter((file) => selected.has(file.name) && file.valid);
  if (!chosen.length) return;
  byId("apply-button").disabled = true;
  try {
    const result = await api("/api/apply", {
      method: "POST",
      body: JSON.stringify({ config: readConfigForm(), files: chosen.map((file) => ({ name: file.name, archiveDate: file.archiveDate })) })
    });
    const successful = result.results.filter((item) => item.ok).length;
    const failed = result.results.length - successful;
    for (const item of result.results) selected.delete(item.name);
    await refreshConfig();
    await scanFolder(`${successful} file${successful === 1 ? "" : "s"} organized${failed ? ` · ${failed} need attention` : " and scheduled for archive"}.`);
    if (failed) showNotice(`${successful} organized · ${failed} not moved: ${result.results.filter((item) => !item.ok).map((item) => `${item.name}: ${item.error}`).join("; ")}`, true);
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    updateSelection();
  }
});

byId("archive-now").addEventListener("click", async () => {
  try {
    const result = await api("/api/archive-due", { method: "POST", body: "{}" });
    const count = result.results.filter((item) => item.ok).length;
    await refreshConfig();
    showNotice(count ? `Archived ${count} due file${count === 1 ? "" : "s"}.` : "No scheduled files are due yet.");
  } catch (error) {
    showNotice(error.message, true);
  }
});

document.querySelectorAll(".nav-link").forEach((link) => link.addEventListener("click", () => {
  document.querySelectorAll(".nav-link").forEach((item) => item.classList.toggle("active", item === link));
}));

(async function start() {
  try {
    await refreshConfig();
    await scanFolder();
  } catch (error) {
    showNotice(error.message, true);
  }
})();