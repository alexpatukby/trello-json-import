/* global TrelloPowerUp, Papa */

// 1) Set your Trello REST API key here.
// Get it from: https://trello.com/power-ups/admin (Power-Up settings) or https://trello.com/app-key
const APP_KEY = window.TRELLO_IMPORT_APP_KEY || 'YOUR_TRELLO_API_KEY';
// Token lifetime: shorter is safer. Options include: "1hour", "1day", "30days", "never".
const TOKEN_EXPIRATION = window.TRELLO_IMPORT_TOKEN_EXPIRATION || 'never';

// License configuration
const FREE_IMPORT_LIMIT = 5;
// TODO: Replace with your LemonSqueezy checkout URL after creating a product
const LEMONSQUEEZY_CHECKOUT_URL = window.TRELLO_IMPORT_CHECKOUT_URL || 'https://lemonsqueezy.com';
const LICENSE_PRICE = '$9';

const t = TrelloPowerUp.iframe({ appKey: APP_KEY, appName: 'JSON/CSV Importer' });

const $ = (id) => document.getElementById(id);

const authBtn = $('authBtn');
const authStatus = $('authStatus');
const authRow = $('authRow');

const dropzone = $('dropzone');
const pickFileLink = $('pickFileLink');
const fileInput = $('fileInput');
const fileMeta = $('fileMeta');

const mappingPanel = $('mappingPanel');
const titleColSel = $('titleCol');
const listColSel = $('listCol');
const defaultListSel = $('defaultList');
const descColSel = $('descCol');
const extraColsWrap = $('extraCols');
const createMissingListsChk = $('createMissingLists');

const importBtn = $('importBtn');
const resetBtn = $('resetBtn');
const rowCount = $('rowCount');

const progressWrap = $('progress');
const progressFill = $('progressFill');
const progressText = $('progressText');
const resultBox = $('result');

const licensePanel = $('licensePanel');
const buyLicenseBtn = $('buyLicenseBtn');
const licenseKeyInput = $('licenseKeyInput');
const activateLicenseBtn = $('activateLicenseBtn');
const licenseStatusEl = $('licenseStatus');

const state = {
  boardId: null,
  lists: [],
  listIdByNameKey: new Map(),
  columns: [],
  rows: [],
  fileName: null,
  token: null,
};

function nameKey(name) {
  return String(name || '').trim().toLowerCase();
}

function setHidden(el, hidden) {
  el.classList.toggle('hidden', !!hidden);
}

function setResult(text) {
  resultBox.textContent = text;
  setHidden(resultBox, !text);
  t.sizeTo('body');
}

function setProgress(pct, text) {
  setHidden(progressWrap, false);
  progressFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  progressText.textContent = text || '';
  t.sizeTo('body');
}

function clearProgress() {
  setHidden(progressWrap, true);
  progressFill.style.width = '0%';
  progressText.textContent = '';
}

async function getBoardId() {
  const ctx = await t.getContext();
  return ctx.board || ctx.boardId || (ctx.board && ctx.board.id) || null;
}

async function getStoredToken() {
  return (await t.get('member', 'private', 'trelloImportToken')) || null;
}

async function storeToken(token) {
  await t.set('member', 'private', 'trelloImportToken', token);
}

async function clearStoredToken() {
  await t.remove('member', 'private', 'trelloImportToken');
}

// License and import count functions
async function getImportCount() {
  const count = await t.get('member', 'private', 'importCount');
  return parseInt(count, 10) || 0;
}

async function incrementImportCount() {
  const current = await getImportCount();
  const newCount = current + 1;
  await t.set('member', 'private', 'importCount', newCount);
  return newCount;
}

async function getLicenseKey() {
  return (await t.get('member', 'private', 'licenseKey')) || null;
}

async function setLicenseKey(key) {
  await t.set('member', 'private', 'licenseKey', key);
}

function isValidLicenseKeyFormat(key) {
  // LemonSqueezy license keys are typically in format: XXXXX-XXXXX-XXXXX-XXXXX
  // Adjust this regex based on your actual license key format
  if (!key || typeof key !== 'string') return false;
  const trimmed = key.trim();
  // Accept keys that are at least 16 chars and contain alphanumeric + dashes
  return trimmed.length >= 16 && /^[A-Za-z0-9-]+$/.test(trimmed);
}

async function checkLicenseStatus() {
  const licenseKey = await getLicenseKey();
  if (licenseKey && isValidLicenseKeyFormat(licenseKey)) {
    return { licensed: true, key: licenseKey };
  }
  
  const importCount = await getImportCount();
  const remaining = Math.max(0, FREE_IMPORT_LIMIT - importCount);
  
  return {
    licensed: false,
    importCount,
    remaining,
    limitReached: remaining <= 0,
  };
}

async function canImport() {
  const status = await checkLicenseStatus();
  return status.licensed || !status.limitReached;
}

async function ensureAuthorized(interactive) {
  if (state.token) return state.token;

  const existing = await getStoredToken();
  if (existing) {
    state.token = existing;
    return existing;
  }

  if (!interactive) return null;

  if (!APP_KEY || APP_KEY === 'YOUR_TRELLO_API_KEY') {
    throw new Error(
      'Missing Trello API key. Set window.TRELLO_IMPORT_APP_KEY (or edit import.js) before authorizing.'
    );
  }

  // Use manual OAuth popup with postMessage callback
  const token = await new Promise((resolve, reject) => {
    const width = 580;
    const height = 680;
    const left = window.screenX + (window.innerWidth - width) / 2;
    const top = window.screenY + (window.innerHeight - height) / 2;
    
    const origin = window.location.origin;
    const authUrl = `https://trello.com/1/authorize?expiration=${TOKEN_EXPIRATION}&name=JSON%2FCSV%20Importer&scope=read,write&response_type=token&key=${APP_KEY}&callback_method=postMessage&return_url=${encodeURIComponent(origin)}`;
    
    let authWindow = null;
    let resolved = false;
    
    const messageHandler = (event) => {
      // Accept messages from Trello
      if (event.origin !== 'https://trello.com') return;
      
      const token = event.data;
      if (typeof token === 'string' && token.length > 0) {
        resolved = true;
        window.removeEventListener('message', messageHandler);
        if (authWindow && !authWindow.closed) {
          authWindow.close();
        }
        resolve(token);
      }
    };
    
    window.addEventListener('message', messageHandler);
    
    authWindow = window.open(
      authUrl,
      'TrelloAuth',
      `width=${width},height=${height},left=${left},top=${top}`
    );
    
    if (!authWindow) {
      window.removeEventListener('message', messageHandler);
      reject(new Error('Popup blocked. Please allow popups for this site.'));
      return;
    }
    
    // Check if popup was closed without auth
    const checkClosed = setInterval(() => {
      if (authWindow.closed && !resolved) {
        clearInterval(checkClosed);
        window.removeEventListener('message', messageHandler);
        reject(new Error('Authorization cancelled.'));
      }
    }, 500);
    
    // Timeout after 5 minutes
    setTimeout(() => {
      if (!resolved) {
        clearInterval(checkClosed);
        window.removeEventListener('message', messageHandler);
        if (authWindow && !authWindow.closed) {
          authWindow.close();
        }
        reject(new Error('Authorization timed out.'));
      }
    }, 5 * 60 * 1000);
  });

  await storeToken(token);
  state.token = token;
  return token;
}

async function trelloRequest(path, { method = 'GET', query = {}, body = null } = {}) {
  const token = await ensureAuthorized(false);
  if (!token) throw new Error('Not authorized. Click "Authorize Trello" first.');

  const url = new URL(`https://api.trello.com/1${path}`);
  url.searchParams.set('key', APP_KEY);
  url.searchParams.set('token', token);
  Object.entries(query || {}).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    url.searchParams.set(k, String(v));
  });

  const res = await fetch(url.toString(), {
    method,
    headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } : undefined,
    body: body ? new URLSearchParams(body) : null,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Trello API error ${res.status}: ${text || res.statusText}`);
  }
  return await res.json();
}

async function loadLists() {
  state.boardId = await getBoardId();
  if (!state.boardId) throw new Error('Could not determine board id from Power-Up context.');

  const lists = await trelloRequest(`/boards/${state.boardId}/lists`, {
    query: { fields: 'name', filter: 'open' },
  });

  state.lists = lists || [];
  state.listIdByNameKey = new Map();
  for (const l of state.lists) {
    state.listIdByNameKey.set(nameKey(l.name), l.id);
  }

  defaultListSel.innerHTML = '';
  for (const l of state.lists) {
    const opt = document.createElement('option');
    opt.value = l.name;
    opt.textContent = l.name;
    defaultListSel.appendChild(opt);
  }
}

function guessColumn(columns, candidates) {
  const set = new Set(columns.map((c) => nameKey(c)));
  for (const cand of candidates) {
    const key = nameKey(cand);
    for (const c of columns) {
      if (nameKey(c) === key) return c;
    }
  }
  // partial match
  for (const cand of candidates) {
    const key = nameKey(cand);
    for (const c of columns) {
      const ck = nameKey(c);
      if (ck.includes(key) || key.includes(ck)) return c;
    }
  }
  return columns[0] || '';
}

function setSelectOptions(sel, columns, { allowEmpty = false, emptyLabel = '(none)' } = {}) {
  sel.innerHTML = '';
  if (allowEmpty) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = emptyLabel;
    sel.appendChild(opt);
  }
  for (const c of columns) {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  }
}

function renderExtraCols(columns, excluded) {
  extraColsWrap.innerHTML = '';
  const excludedSet = new Set(excluded.filter(Boolean));
  for (const c of columns) {
    if (excludedSet.has(c)) continue;
    const label = document.createElement('label');
    label.className = 'chip';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = c;

    const span = document.createElement('span');
    span.textContent = c;

    label.appendChild(input);
    label.appendChild(span);
    extraColsWrap.appendChild(label);
  }
}

function getSelectedExtraCols() {
  const inputs = extraColsWrap.querySelectorAll('input[type="checkbox"]');
  return Array.from(inputs)
    .filter((i) => i.checked)
    .map((i) => i.value);
}

function normalizeRowsFromJson(json) {
  let arr = null;
  let listIdToName = null;

  // Check if this is a nested format: { lists: [ { name, cards: [...] }, ... ] }
  if (json && Array.isArray(json.lists) && json.lists.length > 0 && json.lists[0].cards) {
    // Flatten cards from all lists, adding listName to each card
    arr = [];
    for (const list of json.lists) {
      const listName = list.name || 'Unknown List';
      if (Array.isArray(list.cards)) {
        for (const card of list.cards) {
          arr.push({ ...card, listName });
        }
      }
    }
  }
  // Check if this is a Trello board export (has both cards and lists arrays at root)
  else if (json && Array.isArray(json.cards) && Array.isArray(json.lists)) {
    arr = json.cards;
    // Build a map of list IDs to list names
    listIdToName = new Map();
    for (const list of json.lists) {
      if (list.id && list.name) {
        listIdToName.set(list.id, list.name);
      }
    }
  } else if (Array.isArray(json)) {
    arr = json;
  } else if (json && Array.isArray(json.items)) {
    arr = json.items;
  } else if (json && Array.isArray(json.data)) {
    arr = json.data;
  } else if (json && Array.isArray(json.cards)) {
    arr = json.cards;
  } else if (json && Array.isArray(json.rows)) {
    arr = json.rows;
  }

  if (!arr) throw new Error('JSON must be an array of objects, or contain an array field like items/data/cards/rows.');

  const rows = arr
    .filter((x) => x !== null && x !== undefined)
    .map((x) => {
      if (typeof x !== 'object' || Array.isArray(x)) {
        return { value: x };
      }
      const row = { ...x };
      // If this is a Trello export, convert idList to listName
      if (listIdToName && row.idList && !row.listName) {
        row.listName = listIdToName.get(row.idList) || row.idList;
      }
      return row;
    });

  const colSet = new Set();
  for (const r of rows) {
    for (const k of Object.keys(r)) colSet.add(k);
  }
  const columns = Array.from(colSet);
  return { rows, columns };
}

async function parseFile(file) {
  const name = file.name || 'file';
  const lower = name.toLowerCase();
  const text = await file.text();

  if (lower.endsWith('.json') || file.type.includes('json')) {
    const json = JSON.parse(text);
    return normalizeRowsFromJson(json);
  }

  // Default: treat as CSV (uses csv-parser.js)
  return window.parseCSV(text);
}

function renderMapping(columns, rows) {
  state.columns = columns;
  state.rows = rows;

  setSelectOptions(titleColSel, columns);
  setSelectOptions(listColSel, columns, { allowEmpty: true, emptyLabel: '(no list column)' });
  setSelectOptions(descColSel, columns, { allowEmpty: true, emptyLabel: '(no description column)' });

  titleColSel.value = guessColumn(columns, ['title', 'name', 'card', 'card title', 'summary']);
  listColSel.value = guessColumn(columns, ['listName', 'list', 'column', 'status', 'lane', 'stage']);
  // If we guessed something that isn't a real list-like column, allow empty by default.
  if (!nameKey(listColSel.value).match(/list|column|status|lane|stage|listname/)) listColSel.value = '';

  descColSel.value = guessColumn(columns, ['description', 'desc', 'details', 'notes']);
  if (!nameKey(descColSel.value).match(/description|desc|detail|note/)) descColSel.value = '';

  renderExtraCols(columns, [titleColSel.value, listColSel.value, descColSel.value]);
  rowCount.textContent = `${rows.length} rows detected`;

  setHidden(mappingPanel, false);
  t.sizeTo('body');
}

async function maybeRefreshAuthUI() {
  try {
    const token = await ensureAuthorized(false);
    if (token) {
      authStatus.textContent = 'Authorized';
      authBtn.textContent = 'Re-authorize';
      return;
    }
  } catch (_) {
    // ignore
  }
  authStatus.textContent = 'Not authorized';
  authBtn.textContent = 'Authorize Trello';
}

async function createListIfMissing(listName) {
  const key = nameKey(listName);
  const existing = state.listIdByNameKey.get(key);
  if (existing) return existing;

  const created = await trelloRequest('/lists', {
    method: 'POST',
    body: { name: String(listName).trim(), idBoard: state.boardId, pos: 'bottom' },
  });

  state.listIdByNameKey.set(key, created.id);
  state.lists.push(created);
  return created.id;
}

function buildDesc(row, { descCol, extraCols, excludeCols }) {
  const base = descCol ? String(row[descCol] ?? '').trim() : '';
  const lines = [];
  for (const c of extraCols) {
    if (excludeCols.has(c)) continue;
    const v = row[c];
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (!s) continue;
    lines.push(`- **${c}**: ${s}`);
  }

  if (!lines.length) return base;

  const extraBlock = ['---', '**Imported fields:**', ...lines].join('\n');
  if (!base) return extraBlock;
  return `${base}\n\n${extraBlock}`;
}

async function doImport() {
  setResult('');
  clearProgress();

  // Check license/usage before importing
  const usageStatus = await checkLicenseStatus();
  if (!usageStatus.licensed && usageStatus.limitReached) {
    showLicensePanel();
    throw new Error('Free trial ended. Please purchase a license to continue importing.');
  }

  const titleCol = titleColSel.value;
  const listCol = listColSel.value;
  const descCol = descColSel.value;
  const defaultListName = defaultListSel.value;
  const createMissing = !!createMissingListsChk.checked;
  const extraCols = getSelectedExtraCols();

  if (!titleCol) throw new Error('Please select a card title column.');
  if (!listCol && !defaultListName) throw new Error('Please select a default Trello list (or provide a list column).');
  if (!state.rows.length) throw new Error('No rows to import.');

  await ensureAuthorized(true);
  await loadLists();

  const excludeCols = new Set([titleCol, listCol, descCol].filter(Boolean));

  let created = 0;
  let skipped = 0;
  const errors = [];

  const total = state.rows.length;
  for (let i = 0; i < total; i++) {
    const row = state.rows[i];
    const pct = Math.round(((i + 1) / total) * 100);
    setProgress(pct, `Importing ${i + 1} / ${total}...`);

    try {
      const rawTitle = row[titleCol];
      const title = String(rawTitle ?? '').trim();
      if (!title) {
        skipped++;
        continue;
      }

      let targetListName = defaultListName;
      if (listCol) {
        const v = row[listCol];
        const s = String(v ?? '').trim();
        if (s) targetListName = s;
      }

      if (!targetListName) {
        skipped++;
        continue;
      }

      const key = nameKey(targetListName);
      let listId = state.listIdByNameKey.get(key);

      if (!listId) {
        if (!createMissing) {
          skipped++;
          continue;
        }
        listId = await createListIfMissing(targetListName);
      }

      const desc = buildDesc(row, { descCol, extraCols, excludeCols });

      await trelloRequest('/cards', {
        method: 'POST',
        body: { idList: listId, name: title, desc },
      });
      created++;
    } catch (e) {
      skipped++;
      if (errors.length < 30) errors.push(`Row ${i + 1}: ${e.message || String(e)}`);
    }
  }

  clearProgress();
  
  // Increment import count if not licensed
  const currentStatus = await checkLicenseStatus();
  if (!currentStatus.licensed) {
    await incrementImportCount();
  }
  
  setResult(
    [
      `Done.`,
      `Created cards: ${created}`,
      `Skipped rows: ${skipped}`,
      errors.length ? `\nErrors (first ${errors.length}):\n${errors.join('\n')}` : '',
    ].join('\n')
  );
}

function resetAll() {
  state.columns = [];
  state.rows = [];
  state.fileName = null;
  fileMeta.textContent = '';

  setHidden(mappingPanel, true);
  setHidden(progressWrap, true);
  setHidden(resultBox, true);
  clearProgress();
  setResult('');
}

async function handleFile(file) {
  resetAll();
  state.fileName = file.name;
  fileMeta.textContent = `Selected: ${file.name} (${Math.round((file.size || 0) / 1024)} KB)`;

  let rows, columns;
  try {
    const parsed = await parseFile(file);
    rows = parsed.rows;
    columns = parsed.columns;
  } catch (err) {
    setResult(`Error parsing file: ${err.message || err}`);
    return;
  }
  
  if (!rows || rows.length === 0) {
    setResult('No data rows found in the file.');
    return;
  }
  
  if (!columns || columns.length === 0) {
    setResult('No columns/fields found in the file.');
    return;
  }
  
  // Load Trello lists (requires auth)
  try {
    await ensureAuthorized(true);
    await loadLists();
  } catch (err) {
    setResult(`Error loading Trello lists: ${err.message || err}`);
    return;
  }
  
  renderMapping(columns, rows);
}

function wireDropzone() {
  const stop = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  ['dragenter', 'dragover'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      stop(e);
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      stop(e);
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', async (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    try {
      await handleFile(f);
    } catch (err) {
      setResult(err.message || String(err));
    }
  });

  dropzone.addEventListener('click', () => fileInput.click());
  pickFileLink.addEventListener('click', (e) => {
    e.preventDefault();
    fileInput.click();
  });

  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    try {
      await handleFile(f);
    } catch (err) {
      setResult(err.message || String(err));
    }
  });
}

function wireMappingInteractions() {
  const rerenderExtras = () => {
    renderExtraCols(state.columns, [titleColSel.value, listColSel.value, descColSel.value]);
    t.sizeTo('body');
  };

  titleColSel.addEventListener('change', rerenderExtras);
  listColSel.addEventListener('change', rerenderExtras);
  descColSel.addEventListener('change', rerenderExtras);
}

function showLicensePanel() {
  setHidden(licensePanel, false);
  setHidden(mappingPanel, true);
  buyLicenseBtn.href = LEMONSQUEEZY_CHECKOUT_URL;
  buyLicenseBtn.textContent = `Buy License (${LICENSE_PRICE})`;
  t.sizeTo('body');
}

function hideLicensePanel() {
  setHidden(licensePanel, true);
  t.sizeTo('body');
}

async function activateLicense() {
  const key = licenseKeyInput.value.trim();
  
  if (!key) {
    licenseStatusEl.textContent = 'Please enter a license key.';
    licenseStatusEl.style.color = '#de350b';
    return;
  }
  
  if (!isValidLicenseKeyFormat(key)) {
    licenseStatusEl.textContent = 'Invalid license key format.';
    licenseStatusEl.style.color = '#de350b';
    return;
  }
  
  // TODO: For production, validate with LemonSqueezy API via your backend
  // For now, we accept valid-format keys
  await setLicenseKey(key);
  
  licenseStatusEl.textContent = 'License activated. You now have unlimited imports.';
  licenseStatusEl.style.color = '#00875a';
  
  // Hide license panel and show mapping panel if we have data
  setTimeout(() => {
    hideLicensePanel();
    if (state.rows.length > 0) {
      setHidden(mappingPanel, false);
    }
    t.sizeTo('body');
  }, 1500);
}

function wireLicensePanel() {
  activateLicenseBtn.addEventListener('click', activateLicense);
  
  licenseKeyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      activateLicense();
    }
  });
}

async function init() {
  resetAll();
  wireDropzone();
  wireMappingInteractions();
  wireLicensePanel();

  authBtn.addEventListener('click', async () => {
    try {
      // Allow re-auth: clear and re-authorize if user clicks again.
      await clearStoredToken();
      state.token = null;
      await ensureAuthorized(true);
      await maybeRefreshAuthUI();
      setResult('');
    } catch (e) {
      setResult(e.message || String(e));
    }
  });

  importBtn.addEventListener('click', async () => {
    importBtn.disabled = true;
    try {
      await doImport();
    } catch (e) {
      clearProgress();
      setResult(e.message || String(e));
    } finally {
      importBtn.disabled = false;
    }
  });

  resetBtn.addEventListener('click', resetAll);

  // Initial auth + lists fetch (non-interactive).
  await maybeRefreshAuthUI();
  try {
    if (await ensureAuthorized(false)) {
      await loadLists();
    }
  } catch (_) {
    // ignore (user can authorize later)
  }

  // Hide auth row if we don't have app key configured; otherwise user can try to authorize.
  if (!APP_KEY || APP_KEY === 'YOUR_TRELLO_API_KEY') {
    authStatus.textContent = 'Set API key first (see README)';
  }

  t.sizeTo('body');
}

init().catch((e) => {
  setResult(e.message || String(e));
  setHidden(authRow, false);
});


