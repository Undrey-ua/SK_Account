// === Глобальна змінна для сирих продажів ===
let rawSalesData = [];
let rawMonthlyPlansData = [];

// === Apps Script endpoint (читання/запис) ===
const APPS_SCRIPT_BASE_URL = 'https://script.google.com/macros/s/AKfycbwXd7RfsKj_0K9GRixoU0tSjo_23BtaCD048-epyzjLMG7hJ4N5ZtYFAJcfk0XfZ4rA/exec';
const MONTHLY_PLAN_SHEET_NAME = 'План продажів';

// === Аналітика: утиліти дат/періодів ===
function parseSaleDateUTC(value) {
  if (!value) return null;

  // Already a Date
  if (value instanceof Date) {
    return isNaN(value) ? null : value;
  }

  // Numeric timestamp
  if (typeof value === 'number') {
    const d = new Date(value);
    return isNaN(d) ? null : d;
  }

  const s = String(value).trim();
  if (!s) return null;

  // ISO date-only: YYYY-MM-DD (force UTC midnight)
  const isoDateOnly = /^(\d{4})-(\d{2})-(\d{2})$/;
  const mIso = s.match(isoDateOnly);
  if (mIso) {
    const y = Number(mIso[1]);
    const m = Number(mIso[2]);
    const d = Number(mIso[3]);
    const dt = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
    return isNaN(dt) ? null : dt;
  }

  // UA/EU date: DD.MM.YYYY (force UTC midnight)
  const uaDate = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
  const mUa = s.match(uaDate);
  if (mUa) {
    const d = Number(mUa[1]);
    const m = Number(mUa[2]);
    const y = Number(mUa[3]);
    const dt = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
    return isNaN(dt) ? null : dt;
  }

  // Fallback (may include time/timezone). If it's valid, use it.
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function getQuarterForMonth(month1to12) {
  return Math.floor((month1to12 - 1) / 3) + 1;
}

function getRangeForMonth(month, year) {
  // UTC boundaries [start, end)
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  return { start, end, label: `${pad2(month)}.${year}` };
}

function getRangeForQuarter(quarter, year) {
  const startMonth = (quarter - 1) * 3 + 1;
  const start = new Date(Date.UTC(year, startMonth - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, startMonth - 1 + 3, 1, 0, 0, 0));
  return { start, end, label: `Q${quarter} ${year}` };
}

function getRangeForYear(year) {
  const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0));
  return { start, end, label: `${year}` };
}

function getRollingRangeMonthsBack(includingCurrentMonthCount) {
  // Напр., 3 => поточний місяць + 2 попередні (від 1-го числа)
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0..11
  const startMonthIndex = m - (includingCurrentMonthCount - 1);
  const start = new Date(Date.UTC(y, startMonthIndex, 1, 0, 0, 0));
  const end = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0));
  const label = `останні ${includingCurrentMonthCount} міс.`;
  return { start, end, label };
}

function inRangeUTC(d, range) {
  return d && d >= range.start && d < range.end;
}

function formatRangeLabel(range) {
  return range?.label || '';
}

function numberOrZero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function managerIdToName(managerId) {
  const map = { andrii: 'Андрій', roman: 'Роман', pavlo: 'Павло' };
  return map[managerId] || managerId;
}

function managerNameToId(managerName) {
  const map = { 'Андрій': 'andrii', 'Роман': 'roman', 'Павло': 'pavlo' };
  return map[managerName] || managerName;
}

function getSelectedAnalyticsManagerId() {
  const sel = document.getElementById('analytics-manager');
  return sel ? sel.value : 'all';
}

function normalizeManagerListFromFilter(managerFilter) {
  const allManagers = ['andrii', 'roman', 'pavlo'];
  if (!managerFilter || managerFilter === 'all') return allManagers;
  return allManagers.includes(managerFilter) ? [managerFilter] : allManagers;
}

function cleanStandsMatrixRows(data) {
  if (!Array.isArray(data)) return [];
  return data.filter(row => {
    const shop = String(row?.['Назва ТТ'] ?? '').trim();
    if (!shop) return false; // прибрати підсумкові/порожні рядки
    // інколи можуть бути службові рядки типу "Разом"
    if (shop.toLowerCase() === 'разом' || shop.toLowerCase() === 'итого') return false;
    return true;
  });
}

function buildSimpleTable(containerId, columns, rows, options = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!rows || !rows.length) {
    el.innerHTML = '<p style="color:#777; margin-top: 8px;">Немає даних</p>';
    return;
  }
  const thead = `<thead><tr>${columns.map(c => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead>`;
  const tbody = `<tbody>${rows.map(r => `<tr>${columns.map(c => `<td>${c.format ? c.format(r[c.key], r) : escapeHtml(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody>`;
  const title = options.title ? `<p style="margin: 10px 0 0 0; font-weight: 700; color:#2c3e50;">${escapeHtml(options.title)}</p>` : '';
  el.innerHTML = `${title}<div class="table-scroll"><table class="data-table">${thead}${tbody}</table></div>`;
}

function getAllStandPlacements(managerFilter = 'all') {
  // placements based on stands matrix (installed stands per shop)
  const placements = [];
  const managers = normalizeManagerListFromFilter(managerFilter);
  managers.forEach(manager => {
    const raw = window.standsMatrixData?.[manager] || [];
    const data = cleanStandsMatrixRows(raw);
    if (!data.length) return;
    const headers = Object.keys(data[0] || {});
    const standTypes = headers.filter(h => !['Назва ТТ', 'Адреса', 'Місто', 'Коментар'].includes(h));
    data.forEach(row => {
      const shop = row['Назва ТТ'];
      const address = row['Адреса'] || '';
      const city = row['Місто'] || '';
      if (!shop) return;
      standTypes.forEach(standType => {
        const installed = numberOrZero(row[standType]);
        if (installed > 0) {
          placements.push({
            manager,
            shop,
            address,
            city,
            stand: standType,
            installed
          });
        }
      });
    });
  });
  return placements;
}

function buildShopCityIndex(managerFilter = 'all') {
  const managers = normalizeManagerListFromFilter(managerFilter);
  const idx = new Map(); // shop -> city
  managers.forEach(manager => {
    const raw = window.standsMatrixData?.[manager] || [];
    const data = cleanStandsMatrixRows(raw);
    data.forEach(row => {
      const shop = String(row?.['Назва ТТ'] ?? '').trim();
      if (!shop) return;
      const city = String(row?.['Місто'] ?? '').trim();
      if (!city) return;
      if (!idx.has(shop)) idx.set(shop, city);
    });
  });
  return idx;
}

function getSalesInRange(range, managerFilter = 'all') {
  const managerNameFilter = managerFilter === 'all' ? null : managerIdToName(managerFilter);
  return rawSalesData.filter(row => {
    const d = parseSaleDateUTC(row['Дата']);
    if (!d) return false;
    if (!inRangeUTC(d, range)) return false;
    if (managerNameFilter && row['Менеджер'] !== managerNameFilter) return false;
    return true;
  });
}

function getCityForShopFromStandsMatrix(shop, managerId = null) {
  const targetShop = String(shop ?? '').trim();
  if (!targetShop) return '';

  const managers = managerId ? [managerId] : ['andrii', 'roman', 'pavlo'];
  for (const m of managers) {
    const raw = window.standsMatrixData?.[m] || [];
    const data = cleanStandsMatrixRows(raw);
    for (const row of data) {
      const s = String(row?.['Назва ТТ'] ?? '').trim();
      if (!s) continue;
      if (s === targetShop) {
        const city = String(row?.['Місто'] ?? '').trim();
        if (city) return city;
      }
    }
  }
  return '';
}

function buildSalesIndexByShopStand(range, managerFilter = 'all') {
  const idx = new Map(); // key: shop||stand => qty
  getSalesInRange(range, managerFilter).forEach(row => {
    const shop = row['Торгова точка'];
    const stand = row['Стенд'];
    if (!shop || !stand) return;
    const key = `${shop}||${stand}`;
    idx.set(key, (idx.get(key) || 0) + numberOrZero(row['Кількість']));
  });
  return idx;
}

function isBerryAllocBigStand(standValue) {
  const s = String(standValue ?? '').trim().toLowerCase();
  return s === 'berryalloc (big)' || s === 'berryalloc big' || s.includes('berryalloc') && s.includes('big');
}

function normalizeTrademarkFromSaleRow(row) {
  const stand = String(row?.['Стенд'] ?? '').trim();
  if (!stand) return '';

  // Нові записи будемо зберігати як "BerryAlloc: Carmelita/PurLoc40/Novocore"
  if (stand.toLowerCase().startsWith('berryalloc:')) return stand;

  // Старі записи "BerryAlloc (BIG)" — намагаємось визначити з коментаря
  if (isBerryAllocBigStand(stand)) {
    const comment = String(row?.['Коментар'] ?? '').toLowerCase();
    if (comment.includes('carmelita')) return 'BerryAlloc: Carmelita';
    if (comment.includes('purloc40') || comment.includes('pur loc') || comment.includes('pur-loc')) return 'BerryAlloc: PurLoc40';
    if (comment.includes('novocore') || comment.includes('novo core')) return 'BerryAlloc: Novocore';
    return 'BerryAlloc (BIG) — невизначено';
  }

  // Для всіх інших: стенд == торгова марка
  return stand;
}

function normalizeRawSaleRow(row) {
  // Відновлення рядків, які були записані в неправильні колонки через appendRow з "не тим" порядком.
  // Приклад зсуву:
  // Дата="TriPlanki", Менеджер="Tarkett: Express", Торгова точка=100, Стенд="2026-04-07...", Коментар="Андрій", Кількість=""
  const d1 = parseSaleDateUTC(row?.['Дата']);
  const d2 = parseSaleDateUTC(row?.['Стенд']);
  const managerCandidate = String(row?.['Коментар'] ?? '').trim(); // часто тут опиняється менеджер

  const looksShifted =
    !d1 &&
    !!d2 &&
    typeof row?.['Торгова точка'] === 'number' &&
    (managerCandidate === 'Андрій' || managerCandidate === 'Роман' || managerCandidate === 'Павло');

  if (!looksShifted) return row;

  return {
    ...row,
    'Торгова точка': row['Дата'],
    'Стенд': row['Менеджер'],
    'Кількість': row['Торгова точка'],
    'Дата': row['Стенд'],
    'Коментар': row['Кількість'],
    'Менеджер': row['Коментар']
  };
}

// === Функції для модального вікна додавання продажів ===
function openAddSaleForm(managerId = null) {
  const modal = document.getElementById('addSaleModal');
  if (modal) {
    modal.style.display = 'flex';
    
    // Встановити поточну дату
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('sale-date').value = today;
    
    // Встановити менеджера, якщо передано
    if (managerId) {
      const managerMap = { andrii: 'Андрій', roman: 'Роман', pavlo: 'Павло' };
      const managerSelect = document.getElementById('sale-manager-select');
      if (managerSelect && managerMap[managerId]) {
        managerSelect.value = managerMap[managerId];
      }
      // Оновити список ТТ для цього менеджера
      fillShopSelect(document.getElementById('sale-shop-select'), managerId);
    } else {
      fillShopSelect(document.getElementById('sale-shop-select'), null);
    }
    
    // Заповнити селекти
    fillStandSelect(document.getElementById('sale-stand-select'));
  }
}

function updateBigBrandUI() {
  const standSel = document.getElementById('sale-stand-select');
  const group = document.getElementById('sale-big-brand-group');
  const brandSel = document.getElementById('sale-big-brand-select');
  if (!standSel || !group || !brandSel) return;

  if (isBerryAllocBigStand(standSel.value)) {
    group.style.display = '';
    brandSel.required = true;
  } else {
    group.style.display = 'none';
    brandSel.required = false;
    brandSel.value = '';
  }
}

function closeAddSaleForm() {
  const modal = document.getElementById('addSaleModal');
  if (modal) {
    modal.style.display = 'none';
    // Очистити форму
    document.getElementById('addSaleForm').reset();
    updateBigBrandUI();
  }
}

// Закриття модального вікна при кліку поза ним
document.addEventListener('click', function(event) {
  const modal = document.getElementById('addSaleModal');
  if (modal && event.target === modal) {
    closeAddSaleForm();
  }
});

// Закриття модального вікна при натисканні Escape
document.addEventListener('keydown', function(event) {
  if (event.key === 'Escape') {
    closeAddSaleForm();
  }
});

async function submitAddSaleForm(event) {
  event.preventDefault();

  const formData = new FormData(event.target);
  let standValue = formData.get('stand');
  const bigBrand = formData.get('big_brand');
  if (isBerryAllocBigStand(standValue)) {
    // Для звітів зберігаємо окрему ТМ прямо в полі "Стенд"
    standValue = bigBrand || standValue;
  }

  const shopValue = String(formData.get('shop') ?? '').trim();
  const managerName = String(formData.get('manager') ?? '').trim();
  const managerId = managerNameToId(managerName);
  const cityValue =
    getCityForShopFromStandsMatrix(shopValue, ['andrii', 'roman', 'pavlo'].includes(managerId) ? managerId : null) ||
    '';

  const saleData = {
    'Торгова точка': shopValue,
    'Стенд': standValue,
    'Кількість': formData.get('quantity'),
    'Дата': formData.get('date'),
    'Місто': cityValue,
    'Коментар': formData.get('comment'),
    'Менеджер': managerName
  };

  try {
    // "Failed to fetch" зазвичай означає CORS/preflight на application/json.
    // Надсилаємо JSON як text/plain (simple request, без preflight), щоб Apps Script міг JSON.parse.
    const WRITE_URLS = [
      `${APPS_SCRIPT_BASE_URL}?sheet=${encodeURIComponent('Продажі')}`
    ];

    const bodyJson = JSON.stringify(saleData);

    let lastError = null;
    let lastResponse = null;
    for (const url of WRITE_URLS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          // На GitHub Pages CORS блокує читання відповіді від Apps Script.
          // В no-cors запит пройде, але відповідь буде opaque (її не прочитати) — це ок,
          // бо ми й так перезавантажуємо дані після запису.
          mode: 'no-cors',
          body: bodyJson
        });
        lastResponse = res;
        if (res) {
          lastError = null;
          break;
        }
      } catch (e) {
        lastError = e;
      }
    }

    if (lastError) throw lastError;

      closeAddSaleForm();
      // Дамо Apps Script трохи часу записати рядок
      await new Promise(r => setTimeout(r, 800));
      await loadRawSales();
      // Оновити відображення для поточного менеджера
      const activeTab = document.querySelector('.tab-content.active');
      if (activeTab) {
        const managerId = activeTab.id;
        if (['andrii', 'roman', 'pavlo'].includes(managerId)) {
          renderSalesTableForManager(managerId);
          renderSalesMatrixForManager(managerId);
          updateManagerStats(managerId);
        }
      }
      showNotification('Запит на додавання продажу відправлено. Зачекайте трохи ;).', 'success');
  } catch (error) {
    console.error('Помилка при додаванні продажу:', error);
    showNotification(`Помилка при додаванні продажу: ${error.message || error}`, 'error');
  }
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  
  document.body.appendChild(notification);
  
  // Показати повідомлення
  setTimeout(() => notification.classList.add('show'), 100);
  
  // Приховати через 3 секунди
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// === Функції для завантаження списків ===
async function loadStandsList() {
  const data = await fetchSheet('Стенди');
  console.log('Стенди:', data);
  // Якщо [{Стенд: "..."}]
  if (data.length && data[0]['Стенд']) {
    return data.map(row => row['Стенд']);
  }
  // Якщо [{назва: "..."}]
  if (data.length && typeof Object.values(data[0])[0] === 'string') {
    return data.map(row => Object.values(row)[0]);
  }
  // Якщо просто масив назв
  if (Array.isArray(data) && typeof data[0] === 'string') {
    return data;
  }
  return [];
}

async function loadShopsList(manager) {
  // Повертає список ТТ лише для конкретного менеджера
  const data = await loadStandsMatrix(manager);
  const shops = new Set();
  data.forEach(row => {
    const shop = String(row['Назва ТТ'] ?? '').trim();
    if (shop) shops.add(shop);
  });
  return Array.from(shops).sort();
}

async function fillShopSelect(selectElement, manager) {
  try {
    const shops = await loadShopsList(manager);
    selectElement.innerHTML = '<option value="">Оберіть торгову точку</option>' +
      shops.map(shop => `<option value="${shop}">${shop}</option>`).join('');
  } catch (error) {
    console.error('Помилка завантаження торгових точок:', error);
    selectElement.innerHTML = '<option value="">Помилка завантаження</option>';
  }
}

async function fetchSheet(sheet) {
    const url = `${APPS_SCRIPT_BASE_URL}?sheet=${encodeURIComponent(sheet)}`;
    const res = await fetch(url);
    return await res.json();
}

async function loadRawSales() {
  const data = await fetchSheet('Продажі');
  rawSalesData = Array.isArray(data) ? data.map(normalizeRawSaleRow) : [];
  console.log('rawSalesData:', rawSalesData);
}

async function loadMonthlyPlans() {
  const data = await fetchSheet(MONTHLY_PLAN_SHEET_NAME);
  rawMonthlyPlansData = Array.isArray(data) ? data : [];
  console.log('rawMonthlyPlansData:', rawMonthlyPlansData);
}

function buildSalesMatrix(manager, month, year) {
  const managerMap = { andrii: 'Андрій', roman: 'Роман', pavlo: 'Павло' };
  const filtered = rawSalesData.filter(row => {
    if (!row['Дата'] || !row['Менеджер'] || !row['Торгова точка'] || !row['Стенд']) return false;
    let d = new Date(row['Дата']);
    if (isNaN(d)) return false; // пропустити некоректні дати
    return (
      d.getUTCMonth() + 1 === month &&
      d.getUTCFullYear() === year &&
      row['Менеджер'] === managerMap[manager]
    );
  });

  const shops = [...new Set(filtered.map(s => s['Торгова точка']))];
  const stands = [...new Set(filtered.map(s => s['Стенд']))];

  let matrix = {};
  shops.forEach(shop => {
    matrix[shop] = {};
    stands.forEach(stand => {
      matrix[shop][stand] = 0;
    });
  });

  filtered.forEach(row => {
    matrix[row['Торгова точка']][row['Стенд']] += Number(row['Кількість']) || 0;
  });

  let html = '<table class="data-table"><thead><tr><th>Торгова точка</th>';
  stands.forEach(stand => html += `<th>${stand}</th>`);
  html += '</tr></thead><tbody>';
  shops.forEach(shop => {
    html += `<tr><td>${shop}</td>`;
    stands.forEach(stand => {
      html += `<td>${matrix[shop][stand] ? matrix[shop][stand].toFixed(3) : ''}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  return `<div class="table-scroll sales-matrix">${html}</div>`;
}

function renderSalesMatrixForManager(manager) {
  const monthSel = document.querySelector(`.month-select[data-manager="${manager}"]`);
  const yearSel = document.querySelector(`.year-select[data-manager="${manager}"]`);
  const month = monthSel ? Number(monthSel.value) : (new Date().getMonth() + 1);
  const year = yearSel ? Number(yearSel.value) : (new Date().getFullYear());
  document.getElementById(`${manager}-sales-matrix`).innerHTML = buildSalesMatrix(manager, month, year);
}

function setActiveTabButton(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  const btn = document.querySelector(`.tab-btn[data-tab="${CSS.escape(tabName)}"]`);
  if (btn) btn.classList.add('active');
}

function getTabFromLocationHash() {
  const raw = String(window.location.hash || '').replace(/^#/, '').trim();
  return raw || null;
}

function showTab(tabName, options = {}) {
  const { updateHash = true } = options;
  // Сховати всі вкладки
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  // Показати потрібну вкладку, якщо вона існує
  const tabDiv = document.getElementById(tabName);
  if (tabDiv) tabDiv.classList.add('active');
  setActiveTabButton(tabName);

  if (updateHash) {
    const current = getTabFromLocationHash();
    if (current !== tabName) window.location.hash = `#${tabName}`;
  }
  if (tabName === 'andrii') renderSalesTableForManager('andrii');
  if (tabName === 'roman') renderSalesTableForManager('roman');
  if (tabName === 'pavlo') renderSalesTableForManager('pavlo');
  if (tabName === 'andrii') updateManagerStats('andrii');
  if (tabName === 'roman') updateManagerStats('roman');
  if (tabName === 'pavlo') updateManagerStats('pavlo');
  if (tabName === 'analytics') renderAnalyticsTable();
  if (tabName === 'reserves') showReservesTab();
};

async function loadStandsMatrix(manager) {
  // Назва вкладки у Google Sheets
  const sheetName = `Облік стендів(${manager})`;
  // Для API: "Облік стендів(Андрій)", "Облік стендів(Роман)", "Облік стендів(Павло)"
  // Але у вашому JS manager = andrii/roman/pavlo, тому треба мапу:
  const managerMap = {
    andrii: 'Андрій',
    roman: 'Роман',
    pavlo: 'Павло'
  };
  const data = await fetchSheet(`Облік стендів(${managerMap[manager]})`);
  return data;
}

function buildStandsMatrix(data) {
  if (!data || !data.length) return '<p>Немає даних</p>';
  // Визначаємо всі заголовки
  const headers = Object.keys(data[0]);
  // Перші два — це "Назва ТТ" і "Адреса", решта — стенди
  const mainCols = ['Назва ТТ', 'Адреса', 'Місто'];
  const standTypes = headers.filter(h => !mainCols.includes(h));
  let html = '<table class="data-table"><thead><tr>';
  mainCols.forEach(col => html += `<th>${col}</th>`);
  standTypes.forEach(type => html += `<th>${type}</th>`);
  html += '</tr></thead><tbody>';
  data.forEach(row => {
    html += '<tr>';
    mainCols.forEach(col => {
      if (col === 'Адреса') {
        html += `<td class="address-cell">${row[col] ? row[col] : '&nbsp;'}</td>`;
      } else if (col === 'Назва ТТ') {
        html += `<td class="shop-name">${row[col] ? row[col] : '&nbsp;'}</td>`;
      } else {
        html += `<td>${row[col] ? row[col] : '&nbsp;'}</td>`;
      }
    });
    standTypes.forEach(type => {
      html += `<td>${row[type] ? row[type] : '&nbsp;'}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  return `<div class="table-scroll">${html}</div>`;
}

async function renderStandsMatrixForManager(manager) {
  const data = await loadStandsMatrix(manager);
  console.log('stands data for', manager, data); // <-- Додайте це
  document.getElementById(`${manager}-stands-matrix`).innerHTML = buildStandsMatrix(data);
}

function buildSalesTable(data) {
  if (!data || !data.length) return '<tr><td colspan="5">Немає даних</td></tr>';
  return data.map(row => `
    <tr>
      <td>${row['Торгова точка'] || ''}</td>
      <td>${row['Стенд'] || ''}</td>
      <td>${row['Кількість'] || ''}</td>
      <td>${row['Дата'] ? new Date(row['Дата']).toLocaleDateString('uk-UA') : ''}</td>
      <td>${row['Коментар'] || ''}</td>
    </tr>
  `).join('');
}

function renderSalesTableForManager(manager) {
  const managerMap = { andrii: 'Андрій', roman: 'Роман', pavlo: 'Павло' };
  const monthSel = document.querySelector(`.month-select[data-manager="${manager}"]`);
  const yearSel = document.querySelector(`.year-select[data-manager="${manager}"]`);
  const month = monthSel ? Number(monthSel.value) : (new Date().getMonth() + 1);
  const year = yearSel ? Number(yearSel.value) : (new Date().getFullYear());

  console.log('manager:', manager, 'month:', month, 'year:', year);
  rawSalesData.forEach(row => {
    let d = new Date(row['Дата']);
    console.log(
      'row:', row,
      'rowMonth:', d.getUTCMonth() + 1,
      'rowYear:', d.getUTCFullYear(),
      'rowManager:', row['Менеджер']
    );
  });

  const filtered = rawSalesData.filter(row => {
    if (!row['Дата'] || !row['Менеджер']) return false;
    let d = new Date(row['Дата']);
    if (isNaN(d)) return false; // пропустити некоректні дати
    return (
      d.getUTCMonth() + 1 === month &&
      d.getUTCFullYear() === year &&
      row['Менеджер'] === managerMap[manager]
    );
  });

  console.log('filtered:', filtered);
  document.querySelector(`#${manager}-table tbody`).innerHTML = buildSalesTable(filtered);
}

function fillMonthYearSelects() {
  const now = new Date();
  const months = [
    'Січень','Лютий','Березень','Квітень','Травень','Червень',
    'Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'
  ];
  ['andrii', 'roman', 'pavlo'].forEach(manager => {
    const monthSel = document.querySelector(`.month-select[data-manager="${manager}"]`);
    const yearSel = document.querySelector(`.year-select[data-manager="${manager}"]`);
    if (monthSel && yearSel) {
      monthSel.innerHTML = months.map((m, i) =>
        `<option value="${i+1}" ${i+1 === now.getMonth()+1 ? 'selected' : ''}>${m}</option>`
      ).join('');
      const thisYear = now.getFullYear();
      yearSel.innerHTML = [thisYear-1, thisYear, thisYear+1].map(y =>
        `<option value="${y}" ${y === thisYear ? 'selected' : ''}>${y}</option>`
      ).join('');
    }
  });
}

function updateManagerStats(manager) {
  const managerMap = { andrii: 'Андрій', roman: 'Роман', pavlo: 'Павло' };
  const monthSel = document.querySelector(`.month-select[data-manager="${manager}"]`);
  const yearSel = document.querySelector(`.year-select[data-manager="${manager}"]`);
  const month = monthSel ? Number(monthSel.value) : (new Date().getMonth() + 1);
  const year = yearSel ? Number(yearSel.value) : (new Date().getFullYear());

  // Фільтруємо продажі по менеджеру, місяцю, року
  const filtered = rawSalesData.filter(row => {
    if (!row['Дата'] || !row['Менеджер']) return false;
    let d = new Date(row['Дата']);
    if (isNaN(d)) return false;
    return (
      d.getUTCMonth() + 1 === month &&
      d.getUTCFullYear() === year &&
      row['Менеджер'] === managerMap[manager]
    );
  });

  // Загальна кількість продажів (сума)
  const totalSales = filtered.reduce((sum, row) => sum + Number(row['Кількість'] || 0), 0);

  // Загальна кількість торгових точок з матриці стендів
  let uniqueShopsCount = 0;
  if (window.standsMatrixData && window.standsMatrixData[manager]) {
    const data = cleanStandsMatrixRows(window.standsMatrixData[manager]);
    uniqueShopsCount = new Set(data.map(row => String(row['Назва ТТ'] ?? '').trim()).filter(Boolean)).size;
  }
  const avgSales = uniqueShopsCount ? (totalSales / uniqueShopsCount) : 0;

  document.getElementById(`${manager}-sales`).textContent = totalSales.toFixed(2);
  document.getElementById(`${manager}-avg`).textContent = avgSales.toFixed(2);

  // Синхронізуємо "Цілі на поточний місяць" з обраним періодом і фактом продажів
  renderMonthlyGoalsForManager(manager);
}

function getSelectedMonthYearForManager(manager) {
  const monthSel = document.querySelector(`.month-select[data-manager="${manager}"]`);
  const yearSel = document.querySelector(`.year-select[data-manager="${manager}"]`);
  const month = monthSel ? Number(monthSel.value) : (new Date().getMonth() + 1);
  const year = yearSel ? Number(yearSel.value) : (new Date().getFullYear());
  return { month, year };
}

function getMonthlySalesTotalSqm(manager, month, year) {
  const managerMap = { andrii: 'Андрій', roman: 'Роман', pavlo: 'Павло' };
  const managerName = managerMap[manager] || manager;
  const filtered = rawSalesData.filter(row => {
    if (!row['Дата'] || !row['Менеджер']) return false;
    const d = new Date(row['Дата']);
    if (isNaN(d)) return false;
    return (
      (d.getUTCMonth() + 1) === month &&
      d.getUTCFullYear() === year &&
      row['Менеджер'] === managerName
    );
  });
  return filtered.reduce((sum, row) => sum + Number(row['Кількість'] || 0), 0);
}

function loadMonthlyPlanSqm(manager, month, year) {
  const managerMap = { andrii: 'Андрій', roman: 'Роман', pavlo: 'Павло' };
  const managerName = managerMap[manager] || manager;
  if (!Array.isArray(rawMonthlyPlansData) || !rawMonthlyPlansData.length) return 0;

  // Беремо останній запис (внизу таблиці), якщо дублікати
  for (let i = rawMonthlyPlansData.length - 1; i >= 0; i--) {
    const row = rawMonthlyPlansData[i] || {};
    const rowManager = String(row['Менеджер'] ?? '').trim();
    const rowMonth = Number(row['Місяць'] ?? row['Month'] ?? '');
    const rowYear = Number(row['Рік'] ?? row['Year'] ?? '');
    if (rowManager !== managerName) continue;
    if (rowMonth !== month) continue;
    if (rowYear !== year) continue;
    const n = Number(row['План (кв м)'] ?? row['План'] ?? row['PlanSqm'] ?? 0);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }
  return 0;
}

async function saveMonthlyPlanSqm(manager, month, year, value) {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(n) || n < 0) return;
  const managerMap = { andrii: 'Андрій', roman: 'Роман', pavlo: 'Павло' };
  const managerName = managerMap[manager] || manager;

  const payload = {
    'Менеджер': managerName,
    'Місяць': month,
    'Рік': year,
    'План (кв м)': n,
    'Оновлено': new Date().toISOString()
  };

  // Оптимістично оновлюємо локальний кеш, щоб UI не "скакав"
  rawMonthlyPlansData = Array.isArray(rawMonthlyPlansData) ? rawMonthlyPlansData : [];
  rawMonthlyPlansData.push(payload);

  try {
    const url = `${APPS_SCRIPT_BASE_URL}?sheet=${encodeURIComponent(MONTHLY_PLAN_SHEET_NAME)}`;
    const bodyJson = JSON.stringify(payload);
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      body: bodyJson
    });
    // Дамо час на запис і перезавантажимо плани для консистентності
    await new Promise(r => setTimeout(r, 600));
    await loadMonthlyPlans();
  } catch (e) {
    console.error('Помилка при збереженні плану:', e);
    showNotification(`Помилка при збереженні плану: ${e.message || e}`, 'error');
  }
}

function renderMonthlyGoalsForManager(manager) {
  const container = document.getElementById(`${manager}-goals`);
  if (!container) return;

  const { month, year } = getSelectedMonthYearForManager(manager);
  const plan = loadMonthlyPlanSqm(manager, month, year);
  const fact = getMonthlySalesTotalSqm(manager, month, year);
  const percent = plan > 0 ? (fact / plan) * 100 : 0;
  const percentClamped = Math.max(0, Math.min(100, percent));
  const progressClass = percent >= 100 ? 'progress-fill done' : (percent >= 80 ? 'progress-fill near' : 'progress-fill');

  container.innerHTML = `
    <div class="goal-card">
      <div class="goal-title">План продажів (кв м)</div>
      <div class="goal-row">
        <label class="goal-label" for="${manager}-monthly-plan-input">План:</label>
        <input
          id="${manager}-monthly-plan-input"
          class="goal-input"
          type="number"
          inputmode="numeric"
          min="0"
          step="1"
          value="${Number.isFinite(plan) && plan > 0 ? String(Math.trunc(plan)) : ''}"
          placeholder="Напр., 120"
          data-manager="${manager}"
          data-month="${month}"
          data-year="${year}"
          data-original="${Number.isFinite(plan) ? String(Math.trunc(plan)) : ''}"
        />
        <button
          type="button"
          class="goal-save-btn"
          data-manager="${manager}"
          data-month="${month}"
          data-year="${year}"
          disabled
        >Зберегти</button>
      </div>
      <div class="progress-bar" role="progressbar" aria-valuenow="${Math.round(percent)}" aria-valuemin="0" aria-valuemax="100">
        <div class="${progressClass}" style="width: ${percentClamped.toFixed(1)}%">${plan > 0 ? `${Math.round(percent)}%` : ''}</div>
      </div>
      <div class="goal-meta">
        <span>Факт: <b>${fact.toFixed(2)}</b></span>
        <span>План: <b>${plan ? plan.toFixed(2) : '—'}</b></span>
        <span>Виконання: <b>${plan > 0 ? `${Math.round(percent)}%` : '—'}</b></span>
      </div>
    </div>
  `;

  const input = container.querySelector('input.goal-input');
  const saveBtn = container.querySelector('button.goal-save-btn');
  if (input) {
    const normalizeIntString = (v) => {
      const s = String(v ?? '').trim();
      if (!s) return '';
      // allow only digits
      const digits = s.replace(/[^\d]/g, '');
      if (!digits) return '';
      // trim leading zeros but keep single zero
      return digits.replace(/^0+(?=\d)/, '');
    };

    const syncSaveState = () => {
      if (!saveBtn) return;
      const original = String(input.getAttribute('data-original') || '');
      const current = normalizeIntString(input.value);
      const changed = current !== original;
      const valid = current !== '';
      saveBtn.disabled = !(changed && valid);
    };

    input.addEventListener('input', () => {
      const norm = normalizeIntString(input.value);
      if (input.value !== norm) input.value = norm;
      syncSaveState();
    }, { passive: true });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && saveBtn && !saveBtn.disabled) {
        e.preventDefault();
        saveBtn.click();
      }
    });

    syncSaveState();
  }

  if (saveBtn && input) {
    saveBtn.addEventListener('click', async () => {
      const m = String(saveBtn.getAttribute('data-manager') || '').trim();
      const mm = Number(saveBtn.getAttribute('data-month'));
      const yy = Number(saveBtn.getAttribute('data-year'));
      saveBtn.disabled = true;
      input.disabled = true;
      await saveMonthlyPlanSqm(m, mm, yy, input.value);
      input.disabled = false;
      // Перерендер з актуальним планом з бекенду
      renderMonthlyGoalsForManager(m);
      showNotification('План продажів збережено.', 'success');
    });
  }
}

function renderAnalyticsTable() {
  const month = Number(document.getElementById('analytics-month').value);
  const year = Number(document.getElementById('analytics-year').value);
  const managerMap = { andrii: 'Андрій', roman: 'Роман', pavlo: 'Павло' };
  const managers = Object.keys(managerMap);

  // Підрахунок по кожному менеджеру
  const rows = managers.map(manager => {
    // Фільтруємо продажі по місяцю/року/менеджеру
    const sales = rawSalesData.filter(row => {
      if (!row['Дата'] || !row['Менеджер']) return false;
      let d = new Date(row['Дата']);
      if (isNaN(d)) return false;
      return (
        d.getUTCMonth() + 1 === month &&
        d.getUTCFullYear() === year &&
        row['Менеджер'] === managerMap[manager]
      );
    });
    // Кількість торгових точок
    let uniqueShopsCount = 0;
    if (window.standsMatrixData && window.standsMatrixData[manager]) {
      const data = cleanStandsMatrixRows(window.standsMatrixData[manager]);
      // Якщо у вас у матриці стендів є колонка "Назва ТТ"
      uniqueShopsCount = new Set(data.map(row => String(row['Назва ТТ'] ?? '').trim()).filter(Boolean)).size;
    }
    // Кількість стендів (по матриці стендів)
    // Для цього треба отримати дані з обліку стендів для кожного менеджера
    // Припустимо, ви вже зберігаєте їх у standsMatrixData[manager]
    let standsCount = 0;
    if (window.standsMatrixData && window.standsMatrixData[manager]) {
      // Підрахунок всіх стендів (сума по всіх клітинках, крім Назва ТТ і Адреса)
      const data = cleanStandsMatrixRows(window.standsMatrixData[manager]);
      const headers = Object.keys(data[0] || {});
      const standTypes = headers.filter(h => !['Назва ТТ', 'Адреса', 'Місто', 'Коментар'].includes(h));
      standsCount = data.reduce((sum, row) => {
        return sum + standTypes.reduce((s, type) => s + (Number(row[type]) || 0), 0);
      }, 0);
    }
    // Загальна кількість продажів (кв.м)
    const totalSales = sales.reduce((sum, row) => sum + Number(row['Кількість'] || 0), 0);
    const avgSales = uniqueShopsCount ? (totalSales / uniqueShopsCount) : 0;

    return {
      manager: managerMap[manager],
      totalSales,
      uniqueShops: uniqueShopsCount,
      standsCount,
      avgSales
    };
  });

  // Рендеримо таблицю
  let html = `<table class="data-table">
    <thead>
      <tr>
        <th>Менеджер</th>
        <th>Продажі (кв м)</th>
        <th>Кількість ТТ</th>
        <th>Кількість стендів</th>
        <th>Середня ТТ</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(r => `
        <tr>
          <td>${r.manager}</td>
          <td>${r.totalSales.toFixed(2)}</td>
          <td>${r.uniqueShops}</td>
          <td>${r.standsCount}</td>
          <td>${r.avgSales.toFixed(2)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>`;
  document.getElementById('analytics-table').innerHTML = `<div class="table-scroll">${html}</div>`;
}

function renderAnalyticsSummary() {
  const tbody = document.getElementById('analytics-summary');
  if (!tbody) return;

  const managerFilter = getSelectedAnalyticsManagerId();
  const placements = getAllStandPlacements(managerFilter);
  const totalStands = placements.reduce((sum, p) => sum + numberOrZero(p.installed), 0);
  const totalPlacements = placements.length;
  const uniqueClients = new Set(placements.map(p => p.shop)).size;
  const who = managerFilter === 'all' ? 'Всі менеджери' : `Менеджер: ${managerIdToName(managerFilter)}`;

  tbody.innerHTML = `
    <tr><td>Фільтр</td><td><b>${escapeHtml(who)}</b></td></tr>
    <tr><td>Загальна кількість стендів (сума встановлених)</td><td><b>${totalStands.toFixed(0)}</b></td></tr>
    <tr><td>Кількість активних “клієнт × торгова марка” (розміщень)</td><td><b>${totalPlacements}</b></td></tr>
    <tr><td>Кількість клієнтів з матриць стендів</td><td><b>${uniqueClients}</b></td></tr>
  `;
}

function fillSalesReportSelectors() {
  const now = new Date();
  const months = [
    'Січень','Лютий','Березень','Квітень','Травень','Червень',
    'Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'
  ];
  const periodSel = document.getElementById('sales-report-period');
  const monthSel = document.getElementById('sales-report-month');
  const quarterSel = document.getElementById('sales-report-quarter');
  const yearSel = document.getElementById('sales-report-year');
  if (!periodSel || !monthSel || !quarterSel || !yearSel) return;

  monthSel.innerHTML = months.map((m, i) =>
    `<option value="${i + 1}" ${i === now.getUTCMonth() ? 'selected' : ''}>${m}</option>`
  ).join('');

  const thisYear = now.getUTCFullYear();
  yearSel.innerHTML = [thisYear - 1, thisYear, thisYear + 1].map(y =>
    `<option value="${y}" ${y === thisYear ? 'selected' : ''}>${y}</option>`
  ).join('');

  quarterSel.value = String(getQuarterForMonth(now.getUTCMonth() + 1));
}

function getSalesReportRangeFromUI() {
  const period = document.getElementById('sales-report-period')?.value || 'month';
  const month = Number(document.getElementById('sales-report-month')?.value || (new Date().getUTCMonth() + 1));
  const quarter = Number(document.getElementById('sales-report-quarter')?.value || getQuarterForMonth(month));
  const year = Number(document.getElementById('sales-report-year')?.value || new Date().getUTCFullYear());
  if (period === 'quarter') return getRangeForQuarter(quarter, year);
  if (period === 'year') return getRangeForYear(year);
  return getRangeForMonth(month, year);
}

function toggleSalesReportUI() {
  const period = document.getElementById('sales-report-period')?.value || 'month';
  const monthLabel = document.getElementById('sales-report-month-label');
  const quarterLabel = document.getElementById('sales-report-quarter-label');
  if (!monthLabel || !quarterLabel) return;
  if (period === 'month') {
    monthLabel.style.display = '';
    quarterLabel.style.display = 'none';
  } else if (period === 'quarter') {
    monthLabel.style.display = 'none';
    quarterLabel.style.display = '';
  } else {
    monthLabel.style.display = 'none';
    quarterLabel.style.display = 'none';
  }
}

function renderSalesReports() {
  const managerFilter = getSelectedAnalyticsManagerId();
  const range = getSalesReportRangeFromUI();
  const sales = getSalesInRange(range, managerFilter);
  const shopToCity = buildShopCityIndex(managerFilter);

  // По клієнтам (торгова точка)
  const byClient = new Map();
  sales.forEach(row => {
    const shop = row['Торгова точка'];
    if (!shop) return;
    byClient.set(shop, (byClient.get(shop) || 0) + numberOrZero(row['Кількість']));
  });
  const byClientRows = [...byClient.entries()]
    .map(([shop, qty]) => ({ shop, qty }))
    .sort((a, b) => b.qty - a.qty);

  // По стендам (торгова марка)
  const byStand = new Map();
  sales.forEach(row => {
    const trademark = normalizeTrademarkFromSaleRow(row);
    if (!trademark) return;
    byStand.set(trademark, (byStand.get(trademark) || 0) + numberOrZero(row['Кількість']));
  });
  const byStandRows = [...byStand.entries()]
    .map(([stand, qty]) => ({ stand, qty }))
    .sort((a, b) => b.qty - a.qty);

  // По містах
  const byCity = new Map(); // city -> qty
  const cityTrademarkQty = new Map(); // city -> Map(trademark -> qty)
  sales.forEach(row => {
    const shop = String(row?.['Торгова точка'] ?? '').trim();
    if (!shop) return;
    const city =
      String(row?.['Місто'] ?? '').trim() ||
      String(shopToCity.get(shop) || '').trim() ||
      'Невідомо';
    byCity.set(city, (byCity.get(city) || 0) + numberOrZero(row['Кількість']));

    const tm = normalizeTrademarkFromSaleRow(row);
    if (tm) {
      if (!cityTrademarkQty.has(city)) cityTrademarkQty.set(city, new Map());
      const m = cityTrademarkQty.get(city);
      m.set(tm, (m.get(tm) || 0) + numberOrZero(row['Кількість']));
    }
  });
  const byCityRows = [...byCity.entries()]
    .map(([city, qty]) => ({ city, qty }))
    .sort((a, b) => b.qty - a.qty);

  const cityTrademarkRows = [...cityTrademarkQty.entries()]
    .flatMap(([city, m]) =>
      [...m.entries()].map(([stand, qty]) => ({ city, stand, qty }))
    )
    .sort((a, b) => {
      const c = a.city.localeCompare(b.city);
      if (c !== 0) return c;
      return b.qty - a.qty;
    });

  buildSimpleTable(
    'sales-report-by-client',
    [
      { key: 'shop', label: 'Клієнт (ТТ)' },
      { key: 'qty', label: 'Продано, кв м', format: v => numberOrZero(v).toFixed(3) }
    ],
    byClientRows
    ,
    { title: `По клієнтам — ${formatRangeLabel(range)} (${managerFilter === 'all' ? 'всі' : managerIdToName(managerFilter)})` }
  );

  buildSimpleTable(
    'sales-report-by-stand',
    [
      { key: 'stand', label: 'Стенд (торгова марка)' },
      { key: 'qty', label: 'Продано, кв м', format: v => numberOrZero(v).toFixed(3) }
    ],
    byStandRows
    ,
    { title: `По стендам (торговим маркам) — ${formatRangeLabel(range)} (${managerFilter === 'all' ? 'всі' : managerIdToName(managerFilter)})` }
  );

  buildSimpleTable(
    'sales-report-by-city',
    [
      { key: 'city', label: 'Місто' },
      { key: 'qty', label: 'Продано, кв м', format: v => numberOrZero(v).toFixed(3) }
    ],
    byCityRows,
    { title: `По містах — ${formatRangeLabel(range)} (${managerFilter === 'all' ? 'всі' : managerIdToName(managerFilter)})` }
  );

  buildSimpleTable(
    'sales-report-city-trademarks',
    [
      { key: 'city', label: 'Місто' },
      { key: 'stand', label: 'Торгова марка' },
      { key: 'qty', label: 'Продано, кв м', format: v => numberOrZero(v).toFixed(3) }
    ],
    cityTrademarkRows,
    { title: `Торгові марки по містах — ${formatRangeLabel(range)} (${managerFilter === 'all' ? 'всі' : managerIdToName(managerFilter)})` }
  );
}

function renderWorkedStandsCurrentMonth() {
  const managerFilter = getSelectedAnalyticsManagerId();
  const now = new Date();
  const range = getRangeForMonth(now.getUTCMonth() + 1, now.getUTCFullYear());
  const sales = getSalesInRange(range, managerFilter);
  const grouped = new Map(); // key manager||shop||stand => qty
  sales.forEach(row => {
    const shop = row['Торгова точка'];
    const stand = normalizeTrademarkFromSaleRow(row);
    const managerName = row['Менеджер'];
    if (!shop || !stand) return;
    const manager = managerNameToId(managerName) || managerName || '';
    const key = `${manager}||${shop}||${stand}`;
    grouped.set(key, (grouped.get(key) || 0) + numberOrZero(row['Кількість']));
  });
  const rows = [...grouped.entries()]
    .map(([key, qty]) => {
      const [manager, shop, stand] = key.split('||');
      return { manager, shop, stand, qty };
    })
    .sort((a, b) => b.qty - a.qty);

  buildSimpleTable(
    'stands-worked-current-month',
    [
      { key: 'stand', label: 'Торгова марка' },
      { key: 'shop', label: 'Клієнт (ТТ)' },
      { key: 'qty', label: 'Продано, кв м', format: v => numberOrZero(v).toFixed(3) },
      { key: 'manager', label: 'Менеджер' }
    ],
    rows,
    { title: `Період: ${formatRangeLabel(range)}` }
  );
}

function renderNotWorkedStands() {
  const managerFilter = getSelectedAnalyticsManagerId();
  const placements = getAllStandPlacements(managerFilter);
  const range3 = getRollingRangeMonthsBack(3);
  const range6 = getRollingRangeMonthsBack(6);

  const idx3 = buildSalesIndexByShopStand(range3, managerFilter);
  const idx6 = buildSalesIndexByShopStand(range6, managerFilter);

  const notWorked3 = placements
    .filter(p => (idx3.get(`${p.shop}||${p.stand}`) || 0) <= 0)
    .map(p => ({ ...p, period: range3.label }));

  const notWorked6 = placements
    .filter(p => (idx6.get(`${p.shop}||${p.stand}`) || 0) <= 0)
    .map(p => ({ ...p, period: range6.label }));

  const rows = [
    ...notWorked3.map(p => ({ period: p.period, stand: p.stand, shop: p.shop, installed: p.installed, manager: p.manager })),
    ...notWorked6.map(p => ({ period: p.period, stand: p.stand, shop: p.shop, installed: p.installed, manager: p.manager }))
  ].sort((a, b) => {
    if (a.period !== b.period) return a.period.localeCompare(b.period);
    const s = a.stand.localeCompare(b.stand);
    if (s !== 0) return s;
    return a.shop.localeCompare(b.shop);
  });

  buildSimpleTable(
    'stands-not-worked',
    [
      { key: 'period', label: 'Період' },
      { key: 'stand', label: 'Торгова марка' },
      { key: 'shop', label: 'Клієнт (ТТ)' },
      { key: 'installed', label: 'К-сть стендів', format: v => numberOrZero(v).toFixed(0) },
      { key: 'manager', label: 'Менеджер' }
    ],
    rows
  );
}

function renderInstalledStandsReports() {
  const managerFilter = getSelectedAnalyticsManagerId();
  const placements = getAllStandPlacements(managerFilter);

  // Загалом по менеджеру
  const byManagerTotal = new Map(); // managerId -> installed
  placements.forEach(p => {
    const managerId = String(p?.manager ?? '').trim();
    if (!managerId) return;
    byManagerTotal.set(managerId, (byManagerTotal.get(managerId) || 0) + numberOrZero(p.installed));
  });
  const byManagerTotalRows = [...byManagerTotal.entries()]
    .map(([managerId, installed]) => ({ manager: managerIdToName(managerId), installed }))
    .sort((a, b) => b.installed - a.installed);

  // По менеджеру × стенд
  const byManagerStand = new Map(); // key managerId||stand => installed
  placements.forEach(p => {
    const managerId = String(p?.manager ?? '').trim();
    const stand = String(p?.stand ?? '').trim();
    if (!managerId || !stand) return;
    const key = `${managerId}||${stand}`;
    byManagerStand.set(key, (byManagerStand.get(key) || 0) + numberOrZero(p.installed));
  });
  const byManagerRows = [...byManagerStand.entries()]
    .map(([key, installed]) => {
      const [managerId, stand] = key.split('||');
      return { manager: managerIdToName(managerId), stand, installed };
    })
    .sort((a, b) => {
      const m = a.manager.localeCompare(b.manager);
      if (m !== 0) return m;
      return b.installed - a.installed;
    });

  // Загалом по місту
  const byCityTotal = new Map(); // city -> installed
  placements.forEach(p => {
    const city = String(p?.city ?? '').trim() || 'Невідомо';
    byCityTotal.set(city, (byCityTotal.get(city) || 0) + numberOrZero(p.installed));
  });
  const byCityTotalRows = [...byCityTotal.entries()]
    .map(([city, installed]) => ({ city, installed }))
    .sort((a, b) => b.installed - a.installed);

  // По місту × стенд
  const byCityStand = new Map(); // key city||stand => installed
  placements.forEach(p => {
    const city = String(p?.city ?? '').trim() || 'Невідомо';
    const stand = String(p?.stand ?? '').trim();
    if (!stand) return;
    const key = `${city}||${stand}`;
    byCityStand.set(key, (byCityStand.get(key) || 0) + numberOrZero(p.installed));
  });
  const byCityRows = [...byCityStand.entries()]
    .map(([key, installed]) => {
      const [city, stand] = key.split('||');
      return { city, stand, installed };
    })
    .sort((a, b) => {
      const c = a.city.localeCompare(b.city);
      if (c !== 0) return c;
      return b.installed - a.installed;
    });

  const who = managerFilter === 'all' ? 'всі' : managerIdToName(managerFilter);

  buildSimpleTable(
    'stands-installed-total-by-manager',
    [
      { key: 'manager', label: 'Менеджер' },
      { key: 'installed', label: 'Загальна к-сть встановлених', format: v => numberOrZero(v).toFixed(0) }
    ],
    byManagerTotalRows,
    { title: `Всього стендів по менеджеру — (${who})` }
  );

  buildSimpleTable(
    'stands-installed-by-manager',
    [
      { key: 'manager', label: 'Менеджер' },
      { key: 'stand', label: 'Стенд (торгова марка)' },
      { key: 'installed', label: 'К-сть встановлених', format: v => numberOrZero(v).toFixed(0) }
    ],
    byManagerRows,
    { title: `Стенди у менеджерів — (${who})` }
  );

  buildSimpleTable(
    'stands-installed-total-by-city',
    [
      { key: 'city', label: 'Місто' },
      { key: 'installed', label: 'Загальна к-сть встановлених', format: v => numberOrZero(v).toFixed(0) }
    ],
    byCityTotalRows,
    { title: `Всього стендів по містах — (${who})` }
  );

  buildSimpleTable(
    'stands-installed-by-city',
    [
      { key: 'city', label: 'Місто' },
      { key: 'stand', label: 'Стенд (торгова марка)' },
      { key: 'installed', label: 'К-сть встановлених', format: v => numberOrZero(v).toFixed(0) }
    ],
    byCityRows,
    { title: `Стенди по містах — (${who})` }
  );
}

function renderAllNewAnalyticsBlocks() {
  renderAnalyticsSummary();
  renderInstalledStandsReports();
  toggleSalesReportUI();
  renderSalesReports();
  renderWorkedStandsCurrentMonth();
  renderNotWorkedStands();
}

function fillAnalyticsMonthYearSelects() {
  const now = new Date();
  const months = [
    'Січень','Лютий','Березень','Квітень','Травень','Червень',
    'Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'
  ];
  const monthSel = document.getElementById('analytics-month');
  const yearSel = document.getElementById('analytics-year');
  if (monthSel && yearSel) {
    monthSel.innerHTML = months.map((m, i) =>
      `<option value="${i+1}" ${i+1 === now.getMonth()+1 ? 'selected' : ''}>${m}</option>`
    ).join('');
    const thisYear = now.getFullYear();
    yearSel.innerHTML = [thisYear-1, thisYear, thisYear+1].map(y =>
      `<option value="${y}" ${y === thisYear ? 'selected' : ''}>${y}</option>`
    ).join('');
  }
}

async function loadManagersList() {
  // Повертає масив об'єктів [{ID: ..., Ім'я: ..., Регіон: ...}, ...]
  return await fetchSheet('Менеджери');
}

async function renderManagerTabs() {
  const managers = await loadManagersList();
  const tabsContainer = document.querySelector('.tabs');
  tabsContainer.innerHTML = ''; // Очищаємо старі вкладки

  managers.forEach((manager, idx) => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (idx === 0 ? ' active' : '');
    btn.textContent = `${manager['Імʼя']} (${manager['Регіон']})`;
    btn.dataset.tab = manager['ID'];
    btn.onclick = () => showTab(manager['ID']);
    tabsContainer.appendChild(btn);

    // Додаємо контент для менеджера, якщо ще не існує
    if (!document.getElementById(manager['ID'])) {
      const contentDiv = document.createElement('div');
      contentDiv.id = manager['ID'];
      contentDiv.className = 'tab-content' + (idx === 0 ? ' active' : '');
      contentDiv.innerHTML = `<h2>${manager['Імʼя']}</h2>
        <!-- Тут буде контент менеджера -->`;
      document.querySelector('.container').appendChild(contentDiv);
    }
  });

  // Додаємо інші вкладки (аналітика, плани)
  const analyticsBtn = document.createElement('button');
  analyticsBtn.className = 'tab-btn';
  analyticsBtn.textContent = 'Порівняльна аналітика';
  analyticsBtn.dataset.tab = 'analytics';
  analyticsBtn.onclick = () => showTab('analytics');
  tabsContainer.appendChild(analyticsBtn);

  const reservesBtn = document.createElement('button');
  reservesBtn.className = 'tab-btn';
  reservesBtn.textContent = 'Резерви';
  reservesBtn.dataset.tab = 'reserves';
  reservesBtn.onclick = () => showTab('reserves');
  tabsContainer.appendChild(reservesBtn);
}

function applyTabFromUrlOrDefault() {
  const fromHash = getTabFromLocationHash();
  if (fromHash && document.getElementById(fromHash)) {
    showTab(fromHash, { updateHash: false });
    return;
  }

  // keep current active if any, otherwise fallback to first tab button
  const activeContent = document.querySelector('.tab-content.active')?.id;
  if (activeContent && document.getElementById(activeContent)) {
    setActiveTabButton(activeContent);
    return;
  }

  const first = document.querySelector('.tab-btn[data-tab]')?.dataset?.tab;
  if (first && document.getElementById(first)) showTab(first, { updateHash: false });
}

async function fillStandSelect(selectElement) {
  try {
    const stands = await loadStandsList();
    selectElement.innerHTML = '<option value="">Оберіть стенд</option>' + 
      stands.map(stand => `<option value="${stand}">${stand}</option>`).join('');
  } catch (error) {
    console.error('Помилка завантаження стендів:', error);
    selectElement.innerHTML = '<option value="">Помилка завантаження</option>';
  }
}

// === РЕЗЕРВИ ===
async function loadReserves() {
  // Вкажіть актуальний шлях до reserves.json на вашому сервері
  const url = 'https://raw.githubusercontent.com/Undrey-ua/SK_Account/main/reserves.json';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Не вдалося завантажити reserves.json');
    return await res.json();
  } catch (e) {
    console.error('Помилка завантаження резервів:', e);
    return [];
  }
}

function renderReservesTable(reserves) {
  const tbody = document.querySelector('#reserves-table tbody');
  if (!tbody) return;
  if (!reserves.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#888;">Немає резервів</td></tr>';
    return;
  }
  tbody.innerHTML = reserves.map(r => `
    <tr>
      <td>${r.shop || ''}</td>
      <td>${r.product || r.sku || ''}</td>
      <td>${r.amount || ''}</td>
      <td>${r.phone_last4 || ''}</td>
      <td>${r.buyer_name || ''}</td>
      <td>${r.reserve_date || ''}</td>
      <td>${r.expires_at || ''}</td>
    </tr>
  `).join('');
}

async function showReservesTab() {
  const reserves = await loadReserves();
  console.log('reserves:', reserves); // Додайте цей рядок
  renderReservesTable(reserves);
}

document.addEventListener('DOMContentLoaded', async function() {
  await renderManagerTabs();
  ['andrii', 'roman', 'pavlo'].forEach(manager => {
    const monthSel = document.querySelector(`.month-select[data-manager="${manager}"]`);
    const yearSel = document.querySelector(`.year-select[data-manager="${manager}"]`);
    if (monthSel && yearSel) {
      monthSel.addEventListener('change', () => {
        renderSalesMatrixForManager(manager);
        updateManagerStats(manager);
      });
      yearSel.addEventListener('change', () => {
        renderSalesMatrixForManager(manager);
        updateManagerStats(manager);
      });
    }
  });

  (async function initSalesMatrices() {
    await loadRawSales();
    await loadMonthlyPlans();
    renderSalesMatrixForManager('andrii');
    renderSalesMatrixForManager('roman');
    renderSalesMatrixForManager('pavlo');
    ['andrii', 'roman', 'pavlo'].forEach(manager => {
      renderSalesTableForManager(manager);
      updateManagerStats(manager); // <-- це є!
    });
  })();

  ['andrii', 'roman', 'pavlo'].forEach(manager => {
    renderStandsMatrixForManager(manager);
  });

  ['andrii', 'roman', 'pavlo'].forEach(manager => {
    document.querySelector(`.month-select[data-manager="${manager}"]`).addEventListener('change', () => {
      renderSalesTableForManager(manager);
      renderSalesMatrixForManager(manager);
      updateManagerStats(manager);
    });
    document.querySelector(`.year-select[data-manager="${manager}"]`).addEventListener('change', () => {
      renderSalesTableForManager(manager);
      renderSalesMatrixForManager(manager);
      updateManagerStats(manager);
    });
  });
  fillMonthYearSelects();
  fillAnalyticsMonthYearSelects();
  fillSalesReportSelectors();

  document.getElementById('analytics-month').addEventListener('change', () => {
    renderAnalyticsTable();
    renderAllNewAnalyticsBlocks();
  });
  document.getElementById('analytics-year').addEventListener('change', () => {
    renderAnalyticsTable();
    renderAllNewAnalyticsBlocks();
  });

  window.standsMatrixData = {};
  const managers = ['andrii', 'roman', 'pavlo'];
  await Promise.all(managers.map(async manager => {
    window.standsMatrixData[manager] = await loadStandsMatrix(manager);
  }));

  renderAnalyticsTable();
  renderAllNewAnalyticsBlocks();

  // Додаємо виклик showReservesTab при відкритті вкладки 'Резерви'
  // const origShowTab = window.showTab; // Це було перевизначення, яке видалено
  // window.showTab = function(tabName) { // Це було перевизначення, яке видалено
  //   origShowTab.call(this, tabName); // Це було перевизначення, яке видалено
  //   if (tabName === 'reserves') { // Це було перевизначення, яке видалено
  //     showReservesTab(); // Це було перевизначення, яке видалено
  //   } // Це було перевизначення, яке видалено
  // }; // Це було перевизначення, яке видалено

  const salesPeriodSel = document.getElementById('sales-report-period');
  const salesMonthSel = document.getElementById('sales-report-month');
  const salesQuarterSel = document.getElementById('sales-report-quarter');
  const salesYearSel = document.getElementById('sales-report-year');
  [salesPeriodSel, salesMonthSel, salesQuarterSel, salesYearSel].forEach(el => {
    if (!el) return;
    el.addEventListener('change', () => {
      toggleSalesReportUI();
      renderSalesReports();
    });
  });

  const analyticsManagerSel = document.getElementById('analytics-manager');
  if (analyticsManagerSel) {
    analyticsManagerSel.addEventListener('change', () => {
      renderAllNewAnalyticsBlocks();
    });
  }

  const standSel = document.getElementById('sale-stand-select');
  if (standSel) {
    standSel.addEventListener('change', updateBigBrandUI);
    updateBigBrandUI();
  }

  const saleManagerSel = document.getElementById('sale-manager-select');
  const saleShopSel = document.getElementById('sale-shop-select');
  if (saleManagerSel && saleShopSel) {
    saleManagerSel.addEventListener('change', () => {
      const selectedName = String(saleManagerSel.value || '').trim();
      const id = managerNameToId(selectedName);
      fillShopSelect(saleShopSel, ['andrii', 'roman', 'pavlo'].includes(id) ? id : null);
    });
  }

  applyTabFromUrlOrDefault();
  window.addEventListener('hashchange', () => applyTabFromUrlOrDefault());
}); 
