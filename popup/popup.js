/* global SWIFTBLOCK_DEFAULTS */
const { DEFAULT_KEYWORDS, STORAGE_KEYS } = globalThis.SWIFTBLOCK_DEFAULTS;

const enabledInput = document.getElementById("enabled");
const enabledLabel = document.getElementById("enabled-label");
const keywordList = document.getElementById("keyword-list");
const addForm = document.getElementById("add-form");
const newKeywordInput = document.getElementById("new-keyword");
const resetBtn = document.getElementById("reset-defaults");
const statusEl = document.getElementById("status");

/** @type {string[]} */
let keywords = [];

function showStatus(message) {
  statusEl.hidden = !message;
  statusEl.textContent = message || "";
  if (message) {
    window.clearTimeout(showStatus._timer);
    showStatus._timer = window.setTimeout(() => {
      statusEl.hidden = true;
    }, 1800);
  }
}

function normalizeKeyword(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function setEnabledUi(on) {
  enabledInput.checked = on;
  enabledLabel.textContent = on ? "On" : "Off";
}

function renderKeywords() {
  keywordList.replaceChildren();

  if (keywords.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No keywords — nothing will be hidden.";
    keywordList.appendChild(empty);
    return;
  }

  const sorted = [...keywords].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  for (const keyword of sorted) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = keyword;
    label.title = keyword;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      keywords = keywords.filter((k) => k.toLowerCase() !== keyword.toLowerCase());
      await saveKeywords();
      renderKeywords();
      showStatus("Removed");
    });

    li.append(label, remove);
    keywordList.appendChild(li);
  }
}

async function saveKeywords() {
  await chrome.storage.sync.set({ [STORAGE_KEYS.keywords]: keywords });
}

async function load() {
  const data = await chrome.storage.sync.get({
    [STORAGE_KEYS.enabled]: true,
    [STORAGE_KEYS.keywords]: [...DEFAULT_KEYWORDS]
  });

  const on = data[STORAGE_KEYS.enabled] !== false;
  setEnabledUi(on);

  if (data[STORAGE_KEYS.keywords] === undefined) {
    keywords = [...DEFAULT_KEYWORDS];
    await saveKeywords();
  } else if (Array.isArray(data[STORAGE_KEYS.keywords])) {
    keywords = data[STORAGE_KEYS.keywords].map(normalizeKeyword).filter(Boolean);
  } else {
    keywords = [...DEFAULT_KEYWORDS];
    await saveKeywords();
  }

  renderKeywords();
}

enabledInput.addEventListener("change", async () => {
  const on = enabledInput.checked;
  setEnabledUi(on);
  await chrome.storage.sync.set({ [STORAGE_KEYS.enabled]: on });
  showStatus(on ? "Filtering on" : "Filtering off");
});

addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = normalizeKeyword(newKeywordInput.value);
  if (!value) return;

  const exists = keywords.some((k) => k.toLowerCase() === value.toLowerCase());
  if (exists) {
    showStatus("Already in the list");
    return;
  }

  keywords.push(value);
  newKeywordInput.value = "";
  await saveKeywords();
  renderKeywords();
  showStatus("Added");
});

resetBtn.addEventListener("click", async () => {
  keywords = [...DEFAULT_KEYWORDS];
  await saveKeywords();
  renderKeywords();
  showStatus("Defaults restored");
});

load();
