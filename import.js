/* global TrelloPowerUp, Papa */

// 1) Set your Trello REST API key here.
// Get it from: https://trello.com/power-ups/admin (Power-Up settings) or https://trello.com/app-key
const APP_KEY = window.TRELLO_IMPORT_APP_KEY || 'YOUR_TRELLO_API_KEY';
// Token lifetime: shorter is safer. Options include: "1hour", "1day", "30days", "never".
const TOKEN_EXPIRATION = window.TRELLO_IMPORT_TOKEN_EXPIRATION || 'never';

// License configuration
const FREE_IMPORT_LIMIT = 3;
// TODO: Replace with your LemonSqueezy checkout URL after creating a product
const LEMONSQUEEZY_CHECKOUT_URL = window.TRELLO_IMPORT_CHECKOUT_URL || 'https://lemonsqueezy.com';
const LICENSE_PRICE = '$9';

const t = TrelloPowerUp.iframe({ appKey: APP_KEY, appName: 'JSON/CSV Importer' });

const $ = (id) => document.getElementById(id);

const authBtn = $('authBtn');
const authStatus = $('authStatus');
const authRow = $('authRow');
const authWarning = $('authWarning');
const dropzoneAuthHint = $('dropzoneAuthHint');

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
const appVersionEl = $('appVersion');

const state = {
  boardId: null,
  lists: [],
  listIdByNameKey: new Map(),
  columns: [],
  rows: [],
  /** @type {{ name: string, pos: number }[] | null} From Trello-style JSON `lists` (empty columns + order). */
  explicitBackupLists: null,
  /** True when JSON had lists but zero cards — import only creates missing lists. */
  importListsOnly: false,
  fileName: null,
  fileType: 'unknown',
  token: null,
};

let powerupOpenFired = false;

function nameKey(name) {
  return String(name || '').trim().toLowerCase();
}

/**
 * Lists from a Trello backup/export (open lists only, stable order by `pos`).
 * Skips closed/archived lists and duplicate names (first wins).
 */
function buildExplicitBackupListsFromTrelloLists(listArray) {
  if (!Array.isArray(listArray) || listArray.length === 0) return null;
  const seen = new Set();
  const out = [];
  let fallbackOrder = 0;
  for (const list of listArray) {
    if (!list || typeof list !== 'object') continue;
    if (list.closed === true) continue;
    const name = String(list.name ?? '').trim();
    if (!name) continue;
    const nk = nameKey(name);
    if (seen.has(nk)) continue;
    seen.add(nk);
    const pos =
      typeof list.pos === 'number' && Number.isFinite(list.pos) ? list.pos : fallbackOrder;
    out.push({ name, pos, order: fallbackOrder });
    fallbackOrder += 1;
  }
  if (!out.length) return null;
  out.sort((a, b) => (a.pos !== b.pos ? a.pos - b.pos : a.order - b.order));
  return out.map(({ name, pos }) => ({ name, pos }));
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

async function getTrelloContext() {
  const ctx = await t.getContext();
  const boardId = ctx.board || ctx.boardId || (ctx.board && ctx.board.id) || null;
  const memberId = ctx.member || ctx.memberId || (ctx.member && ctx.member.id) || null;
  return { boardId, memberId };
}

async function getGaEventParams(extra) {
  if (typeof window.trackEvent !== 'function') return extra || {};
  try {
    const ctx = await getTrelloContext();
    const board_id_hash = ctx.boardId && window.hashId ? await window.hashId(ctx.boardId) : undefined;
    const member_id_hash = ctx.memberId && window.hashId ? await window.hashId(ctx.memberId) : undefined;
    return Object.assign({ free_limit: FREE_IMPORT_LIMIT, board_id_hash, member_id_hash }, extra || {});
  } catch (_) {
    return Object.assign({ free_limit: FREE_IMPORT_LIMIT }, extra || {});
  }
}

/** GA4: when the license / paywall panel is shown. Fallback params if storage/context calls fail. */
function notifyPaywallShown() {
  if (typeof window.trackEvent !== 'function') return;
  getImportCount()
    .then(function (n) {
      return getGaEventParams({ import_number: n });
    })
    .then(function (p) {
      window.trackEvent('paywall_shown', p);
    })
    .catch(function () {
      window.trackEvent('paywall_shown', { free_limit: FREE_IMPORT_LIMIT });
    });
}

/** Returns 'validation' (do not send import_failed) or a specific error_code for real failures. No PII. */
function getImportErrorCode(message) {
  const msg = (message || '').trim();
  if (/please select a card title column/i.test(msg)) return 'validation';
  if (/please select a default trello list/i.test(msg)) return 'validation';
  if (/no rows to import/i.test(msg)) return 'validation';
  if (/authoriz/i.test(msg)) return 'auth_required';
  if (/license|free trial ended|limit/i.test(msg)) return 'limit_reached';
  if (/\b401\b/.test(msg)) return 'api_401';
  if (/\b403\b/.test(msg)) return 'api_403';
  if (/\b404\b/.test(msg)) return 'api_404';
  if (/\b5\d{2}\b/.test(msg)) return 'api_5xx';
  if (/fetch|network|failed to load/i.test(msg)) return 'network_error';
  return 'api_error';
}

/** Returns safe parse-error details for GA (no PII, no raw message). */
function getParseErrorDetail(message) {
  const msg = (message || '').trim();
  const out = {};
  if (/unexpected token/i.test(msg)) out.parse_error_type = 'unexpected_token';
  else if (/unexpected end|end of json/i.test(msg)) out.parse_error_type = 'unexpected_end';
  else if (/not valid json|invalid json/i.test(msg)) out.parse_error_type = 'invalid_json';
  else if (/quoted field|delimiter|csv|parse/i.test(msg)) out.parse_error_type = 'invalid_csv';
  else out.parse_error_type = 'other';
  const posMatch = msg.match(/position\s*(\d+)/i);
  if (posMatch) out.parse_error_position = parseInt(posMatch[1], 10);
  return out;
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
  if (!token) {
    await maybeRefreshAuthUI(); // Update UI to show auth is needed
    throw new Error('⚠️ Authorization required. Please click "Authorize Trello" button at the top of the page to grant access to your Trello account.');
  }

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
  let explicitBackupLists = null;

  // Check if this is a nested format: { lists: [ { name, cards: [...] }, ... ] }
  if (json && Array.isArray(json.lists) && json.lists.length > 0 && json.lists[0].cards) {
    explicitBackupLists = buildExplicitBackupListsFromTrelloLists(json.lists);
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
    explicitBackupLists = buildExplicitBackupListsFromTrelloLists(json.lists);
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
  return { rows, columns, explicitBackupLists };
}

async function parseFile(file) {
  const name = file.name || 'file';
  const lower = name.toLowerCase();
  const text = await file.text();

  if (lower.endsWith('.json') || file.type.includes('json')) {
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      const hint = e.message ? ` (${e.message})` : '';
      throw new Error(`Invalid JSON. The file could not be parsed. Please check that your file contains valid JSON.${hint}`);
    }
    return normalizeRowsFromJson(json);
  }

  // Default: treat as CSV (uses csv-parser.js)
  const csv = window.parseCSV(text);
  return { rows: csv.rows, columns: csv.columns, explicitBackupLists: null };
}

function renderListOnlyImportPanel() {
  state.columns = [];
  state.rows = [];
  state.importListsOnly = true;

  titleColSel.disabled = true;
  listColSel.disabled = true;
  descColSel.disabled = true;

  setSelectOptions(titleColSel, [], { allowEmpty: true, emptyLabel: '(no cards in file)' });
  titleColSel.value = '';
  setSelectOptions(listColSel, [], { allowEmpty: true, emptyLabel: '(not used)' });
  listColSel.value = '';
  setSelectOptions(descColSel, [], { allowEmpty: true, emptyLabel: '(not used)' });
  descColSel.value = '';

  extraColsWrap.innerHTML = '';
  rowCount.textContent = `${state.explicitBackupLists.length} list column(s) in backup; no cards. Import creates missing lists only.`;
  if (!createMissingListsChk.checked) {
    rowCount.textContent += ' Turn on "Create missing lists" below.';
  }

  setHidden(mappingPanel, false);
  t.sizeTo('body');
}

function renderMapping(columns, rows) {
  state.importListsOnly = false;
  titleColSel.disabled = false;
  listColSel.disabled = false;
  descColSel.disabled = false;

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
      authStatus.textContent = '✓ Authorized';
      authStatus.style.color = '#00875a';
      authBtn.textContent = 'Re-authorize';
      authBtn.className = 'btn btn-secondary';
      setHidden(authWarning, true);
      setHidden(dropzoneAuthHint, true);
      dropzone.classList.remove('dropzone-disabled');
      return true;
    }
  } catch (_) {
    // ignore
  }
  authStatus.textContent = 'Not authorized';
  authStatus.style.color = '';
  authBtn.textContent = 'Authorize Trello';
  authBtn.className = 'btn btn-primary';
  setHidden(authWarning, false);
  setHidden(dropzoneAuthHint, false);
  dropzone.classList.add('dropzone-disabled');
  return false;
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

async function ensureExplicitBackupListsMissingOnly(createMissing) {
  let created = 0;
  if (!createMissing || !state.explicitBackupLists || !state.explicitBackupLists.length) return created;
  for (const entry of state.explicitBackupLists) {
    const key = nameKey(entry.name);
    if (!state.listIdByNameKey.has(key)) {
      await createListIfMissing(entry.name);
      created++;
    }
  }
  return created;
}

async function doImport() {
  setResult('');
  clearProgress();
  const importStartTime = Date.now();

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

  if (state.importListsOnly) {
    if (!state.explicitBackupLists || !state.explicitBackupLists.length) {
      throw new Error('No lists to import from this file.');
    }
    if (!createMissing) {
      throw new Error('Turn on "Create missing Trello lists if they don\'t exist" to add columns from this backup.');
    }

    const importNumberBefore = await getImportCount();
    if (typeof window.trackEvent === 'function') {
      getGaEventParams({
        file_type: state.fileType || 'unknown',
        import_number: importNumberBefore,
        import_lists_only: true,
      }).then(function (p) {
        window.trackEvent('import_started', p);
      });
    }

    await ensureAuthorized(true);
    await loadLists();

    let listsCreated = 0;
    const errors = [];
    const totalLists = state.explicitBackupLists.length;

    for (let i = 0; i < totalLists; i++) {
      const entry = state.explicitBackupLists[i];
      const pct = Math.round(((i + 1) / totalLists) * 100);
      setProgress(pct, `Creating lists ${i + 1} / ${totalLists}...`);
      try {
        const key = nameKey(entry.name);
        if (!state.listIdByNameKey.has(key)) {
          await createListIfMissing(entry.name);
          listsCreated++;
        }
      } catch (e) {
        if (errors.length < 30) errors.push(`List "${entry.name}": ${e.message || String(e)}`);
      }
    }

    clearProgress();

    const currentStatus = await checkLicenseStatus();
    if (!currentStatus.licensed) {
      await incrementImportCount();
    }
    const importNumberAfter = await getImportCount();
    const durationMs = Date.now() - importStartTime;

    if (typeof window.trackEvent === 'function') {
      getGaEventParams({
        file_type: state.fileType || 'unknown',
        cards_imported: 0,
        import_lists_only: true,
        lists_created: listsCreated,
        duration_ms: durationMs,
        import_number: importNumberAfter,
      }).then(function (p) {
        window.trackEvent('import_success', p);
      });
    }

    setResult(
      [
        `Done.`,
        `Created lists: ${listsCreated}`,
        errors.length ? `\nErrors (first ${errors.length}):\n${errors.join('\n')}` : '',
      ].join('\n')
    );
    return;
  }

  if (!titleCol) throw new Error('Please select a card title column.');
  if (!listCol && !defaultListName) throw new Error('Please select a default Trello list (or provide a list column).');
  if (!state.rows.length) throw new Error('No rows to import.');

  const importNumberBefore = await getImportCount();
  if (typeof window.trackEvent === 'function') {
    getGaEventParams({ file_type: state.fileType || 'unknown', import_number: importNumberBefore }).then(function (p) {
      window.trackEvent('import_started', p);
    });
  }

  await ensureAuthorized(true);
  await loadLists();

  let listsCreated = 0;
  listsCreated += await ensureExplicitBackupListsMissingOnly(createMissing);

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
        listsCreated++;
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
  const importNumberAfter = await getImportCount();
  const durationMs = Date.now() - importStartTime;

  if (typeof window.trackEvent === 'function') {
    getGaEventParams({
      file_type: state.fileType || 'unknown',
      cards_imported: created,
      lists_created: listsCreated,
      duration_ms: durationMs,
      import_number: importNumberAfter,
    }).then(function (p) {
      window.trackEvent('import_success', p);
    });
  }

  setResult(
    [
      `Done.`,
      listsCreated ? `New lists: ${listsCreated}` : null,
      `Created cards: ${created}`,
      `Skipped rows: ${skipped}`,
      errors.length ? `\nErrors (first ${errors.length}):\n${errors.join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  );
}

function resetAll() {
  state.columns = [];
  state.rows = [];
  state.explicitBackupLists = null;
  state.importListsOnly = false;
  state.fileName = null;
  state.fileType = 'unknown';
  fileMeta.textContent = '';

  titleColSel.disabled = false;
  listColSel.disabled = false;
  descColSel.disabled = false;

  setHidden(mappingPanel, true);
  setHidden(progressWrap, true);
  setHidden(resultBox, true);
  clearProgress();
  setResult('');
  fileMeta.style.color = '';
}

async function handleFile(file) {
  resetAll();
  state.fileName = file.name;
  fileMeta.style.color = '';
  fileMeta.textContent = `Selected: ${file.name} (${Math.round((file.size || 0) / 1024)} KB)`;

  // Check authorization BEFORE parsing file
  const isAuthorized = await maybeRefreshAuthUI();
  if (!isAuthorized) {
    setResult('⚠️ Please authorize Trello access first by clicking the "Authorize Trello" button above. This is required to import cards to your board.');
    return;
  }

  let rows, columns;
  const fileTypeFromName = (file.name || '').toLowerCase().endsWith('.json') ? 'json' : ((file.name || '').toLowerCase().endsWith('.csv') ? 'csv' : 'unknown');
  try {
    const parsed = await parseFile(file);
    rows = parsed.rows;
    columns = parsed.columns;
    state.explicitBackupLists = parsed.explicitBackupLists || null;
    state.fileType = fileTypeFromName;
  } catch (err) {
    const msg = err.message || String(err);
    setResult(msg);
    fileMeta.textContent = `${file.name} — Invalid file. ${msg}`;
    fileMeta.style.color = '#de350b';
    t.sizeTo('body');
    if (typeof window.trackEvent === 'function') {
      const parseDetail = getParseErrorDetail(msg);
      const payload = {
        file_type: fileTypeFromName,
        error_code: 'parse_error',
        duration_ms: 0,
        parse_error_type: parseDetail.parse_error_type,
      };
      if (parseDetail.parse_error_position !== undefined) payload.parse_error_position = parseDetail.parse_error_position;
      getGaEventParams(payload).then(function (p) {
        window.trackEvent('import_failed', p);
      });
    }
    return;
  }
  
  const listOnlyOk =
    state.explicitBackupLists &&
    state.explicitBackupLists.length > 0 &&
    (!rows || rows.length === 0);

  if (!rows || rows.length === 0) {
    if (!listOnlyOk) {
      setResult('No data rows found in the file.');
      return;
    }
  }

  if ((!columns || columns.length === 0) && !listOnlyOk) {
    setResult('No columns/fields found in the file.');
    return;
  }

  // Load Trello lists (should already be authorized, but double-check)
  try {
    await ensureAuthorized(true);
    await loadLists();
  } catch (err) {
    const errorMsg = err.message || String(err);
    if (errorMsg.includes('authorized') || errorMsg.includes('authorize')) {
      setResult('⚠️ Authorization is required. Please click "Authorize Trello" above to continue. If you just authorized, try uploading the file again.');
    } else {
      setResult(`Error loading Trello lists: ${errorMsg}`);
    }
    await maybeRefreshAuthUI(); // Update UI to show auth is needed
    return;
  }

  if (listOnlyOk) {
    renderListOnlyImportPanel();
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
    dropzone.addEventListener(evt, async (e) => {
      stop(e);
      // Check auth before allowing drop
      const isAuthorized = await maybeRefreshAuthUI();
      if (isAuthorized) {
        dropzone.classList.add('dragover');
      } else {
        setResult('⚠️ Please authorize Trello access first. Click "Authorize Trello" above.');
      }
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

  dropzone.addEventListener('click', () => {
    // Check auth synchronously first (using cached state.token) to preserve user activation
    if (!state.token) {
      maybeRefreshAuthUI().then(() => {
        setResult('⚠️ Please authorize Trello access first. Click "Authorize Trello" above.');
        authBtn.focus();
      });
      return;
    }
    // Only call click if already authorized (synchronous check preserves user activation)
    fileInput.click();
  });
  
  pickFileLink.addEventListener('click', (e) => {
    e.preventDefault();
    // Check auth synchronously first (using cached state.token) to preserve user activation
    if (!state.token) {
      maybeRefreshAuthUI().then(() => {
        setResult('⚠️ Please authorize Trello access first. Click "Authorize Trello" above.');
        authBtn.focus();
      });
      return;
    }
    // Only call click if already authorized (synchronous check preserves user activation)
    fileInput.click();
  });

  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      // Check auth synchronously first (using cached state.token) to preserve user activation
      if (!state.token) {
        maybeRefreshAuthUI().then(() => {
          setResult('⚠️ Please authorize Trello access first. Click "Authorize Trello" above.');
          authBtn.focus();
        });
        return;
      }
      // Only call click if already authorized (synchronous check preserves user activation)
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
  buyLicenseBtn.textContent = `Buy Lifetime License – ${LICENSE_PRICE}`;
  t.sizeTo('body');
  notifyPaywallShown();
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
    if (typeof window.trackEvent === 'function') {
      getGaEventParams({ license_key_reason: 'empty' }).then(function (p) {
        window.trackEvent('license_key_invalid', p);
      });
    }
    return;
  }

  if (!isValidLicenseKeyFormat(key)) {
    licenseStatusEl.textContent = 'Invalid license key. Please check and try again.';
    licenseStatusEl.style.color = '#de350b';
    if (typeof window.trackEvent === 'function') {
      getGaEventParams({ license_key_reason: 'invalid_format' }).then(function (p) {
        window.trackEvent('license_key_invalid', p);
      });
    }
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
    if (state.rows.length > 0 || state.importListsOnly) {
      setHidden(mappingPanel, false);
    }
    t.sizeTo('body');
  }, 1500);
}

function wireLicensePanel() {
  buyLicenseBtn.addEventListener('click', function () {
    if (typeof window.trackEvent === 'function') {
      getGaEventParams({ plan: 'lifetime_9' }).then(function (p) {
        window.trackEvent('upgrade_clicked', p);
      });
    }
  });

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
      authBtn.disabled = true;
      authBtn.textContent = 'Authorizing...';
      authStatus.textContent = 'Opening authorization window...';
      
      // Allow re-auth: clear and re-authorize if user clicks again.
      await clearStoredToken();
      state.token = null;
      await ensureAuthorized(true);
      await maybeRefreshAuthUI();
      setResult('✓ Authorization successful! You can now upload and import files.');
      
      // If we have a file already loaded, try to reload lists
      if (state.rows.length > 0 || state.importListsOnly) {
        try {
          await loadLists();
        } catch (err) {
          // Ignore - user can try importing again
        }
      }
    } catch (e) {
      const errorMsg = e.message || String(e);
      if (errorMsg.includes('blocked')) {
        setResult('⚠️ Popup was blocked. Please allow popups for this site and try again.');
      } else if (errorMsg.includes('cancelled')) {
        setResult('⚠️ Authorization was cancelled. Please try again when ready.');
      } else {
        setResult(`⚠️ Authorization failed: ${errorMsg}`);
      }
      await maybeRefreshAuthUI();
    } finally {
      authBtn.disabled = false;
    }
  });

  importBtn.addEventListener('click', async () => {
    importBtn.disabled = true;
    const importStartTime = Date.now();
    try {
      await doImport();
    } catch (e) {
      clearProgress();
      setResult(e.message || String(e));
      const errorCode = getImportErrorCode(e.message || String(e));
      if (errorCode !== 'validation' && typeof window.trackEvent === 'function') {
        getGaEventParams({
          file_type: state.fileType || 'unknown',
          error_code: errorCode,
          duration_ms: Date.now() - importStartTime,
          import_number: await getImportCount(),
        }).then(function (p) {
          window.trackEvent('import_failed', p);
        });
      }
    } finally {
      importBtn.disabled = false;
    }
  });

  resetBtn.addEventListener('click', resetAll);

  // Initial auth + lists fetch (non-interactive).
  const isAuthorized = await maybeRefreshAuthUI();
  try {
    if (isAuthorized) {
      await loadLists();
    }
  } catch (_) {
    // ignore (user can authorize later)
  }

  // Hide auth row if we don't have app key configured; otherwise user can try to authorize.
  if (!APP_KEY || APP_KEY === 'YOUR_TRELLO_API_KEY') {
    authStatus.textContent = 'Set API key first (see README)';
    authStatus.style.color = '#de350b';
  }

  if (!powerupOpenFired && typeof window.trackEvent === 'function') {
    powerupOpenFired = true;
    getGaEventParams({}).then(function (p) {
      window.trackEvent('powerup_open', p);
    });
  }

  if (appVersionEl) {
    const v = window.TRELLO_IMPORT_APP_VERSION || '';
    appVersionEl.textContent = v ? `Version ${v}` : '';
  }

  t.sizeTo('body');
}

init().catch((e) => {
  setResult(e.message || String(e));
  setHidden(authRow, false);
});


