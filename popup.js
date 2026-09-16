const engineEl = document.getElementById('engine');
const assistantEl = document.getElementById('assistant');
const savedEl = document.getElementById('saved');
let savedTimer = 0;

function fill(select, providers) {
  for (const [key, { label }] of Object.entries(providers)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = label;
    select.appendChild(opt);
  }
}
fill(engineEl, SNIPBAR_ENGINES);
fill(assistantEl, SNIPBAR_ASSISTANTS);

chrome.storage.sync.get(SNIPBAR_DEFAULTS, (stored) => {
  engineEl.value = SNIPBAR_ENGINES[stored.engine] ? stored.engine : SNIPBAR_DEFAULTS.engine;
  assistantEl.value = SNIPBAR_ASSISTANTS[stored.assistant] ? stored.assistant : SNIPBAR_DEFAULTS.assistant;
});

function save() {
  chrome.storage.sync.set({ engine: engineEl.value, assistant: assistantEl.value }, () => {
    savedEl.classList.add('on');
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => savedEl.classList.remove('on'), 1200);
  });
}
engineEl.addEventListener('change', save);
assistantEl.addEventListener('change', save);

document.getElementById('version').textContent = `v${chrome.runtime.getManifest().version}`;
