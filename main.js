// === Глобальна змінна для сирих продажів ===
let rawSalesData = [];
let rawMonthlyPlansData = [];

// === Apps Script endpoint (читання/запис) ===
const APPS_SCRIPT_BASE_URL = 'https://script.google.com/macros/s/AKfycbxXOu6h3KboPxrCOBFzcKuLDt8DYO34IRBAOeQrZQ5hMm0k4wX_u9ikrjr5MYQDLkNV/exec';
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

function getSelectedCompareManagerId() {
  const sel = document.getElementById('compare-manager');
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
    const standHeaders = headers.filter(h => !['Назва ТТ', 'Адреса', 'Місто', 'Область', 'Коментар'].includes(h));
    data.forEach(row => {
      const shop = String(row?.['Назва ТТ'] ?? '').trim();
      const address = row['Адреса'] || '';
      const city = row['Місто'] || '';
      const oblast = row['Область'] || '';
      if (!shop) return;
      standHeaders.forEach(standTypeRaw => {
        const standType = String(standTypeRaw ?? '').trim();
        if (!standType) return;
        const installed = numberOrZero(row[standTypeRaw]);
        if (installed > 0) {
          placements.push({
            manager,
            shop,
            address,
            city,
            oblast,
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

function buildShopOblastIndex(managerFilter = 'all') {
  const managers = normalizeManagerListFromFilter(managerFilter);
  const idx = new Map(); // shop -> oblast
  managers.forEach(manager => {
    const raw = window.standsMatrixData?.[manager] || [];
    const data = cleanStandsMatrixRows(raw);
    data.forEach(row => {
      const shop = String(row?.['Назва ТТ'] ?? '').trim();
      if (!shop) return;
      const oblast = String(row?.['Область'] ?? '').trim();
      if (!oblast) return;
      if (!idx.has(shop)) idx.set(shop, oblast);
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

function getOblastForShopFromStandsMatrix(shop, managerId = null) {
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
        const oblast = String(row?.['Область'] ?? '').trim();
        if (oblast) return oblast;
      }
    }
  }
  return '';
}

function buildSalesIndexByShopStand(range, managerFilter = 'all') {
  const idx = new Map(); // key: shop||stand => qty
  getSalesInRange(range, managerFilter).forEach(row => {
    const shop = row['Торгова точка'];
    const stand = normalizeTrademarkFromSaleRow(row);
    if (!shop || !stand) return;
    const key = `${shop}||${stand}`;
    idx.set(key, (idx.get(key) || 0) + numberOrZero(row['Кількість']));
  });
  return idx;
}

function isBerryAllocBigStand(standValue) {
  const s = String(standValue ?? '').trim().toLowerCase();
  // «BIG: Carmelita» тощо з довідника «Стенди» — вже конкретна ТМ, не агрегат BIG
  if (s.startsWith('big:')) return false;
  // Матриця Роман/Павло (і частина Києва): окремий стовпець «BIG»
  if (s === 'big') return true;
  return (
    s === 'berryalloc (big)' ||
    s === 'berryalloc big' ||
    (s.includes('berryalloc') && s.includes('big'))
  );
}

function normalizeTrademarkFromSaleRow(row) {
  const stand = String(row?.['Стенд'] ?? '').trim();
  if (!stand) return '';

  // Нові записи будемо зберігати як "BerryAlloc: Carmelita/PurLoc40/Novocore"
  if (stand.toLowerCase().startsWith('berryalloc:')) return stand;

  // Довідник «Стенди» (актуально): BIG: Carmelita / BIG: Pureloc40 / BIG: Novocore Legacy
  if (/^big\s*:/i.test(stand)) {
    const rest = stand.replace(/^big\s*:\s*/i, '').trim().toLowerCase();
    if (rest.includes('carmelita')) return 'BerryAlloc: Carmelita';
    if (
      rest.includes('pureloc') ||
      rest.includes('pur loc') ||
      rest.includes('pur-loc') ||
      rest.includes('purloc40')
    ) {
      return 'BerryAlloc: PurLoc40';
    }
    if (rest.includes('novocore')) return 'BerryAlloc: Novocore';
    return 'BerryAlloc (BIG) — невизначено';
  }

  // Старі записи "BerryAlloc (BIG)" або стовпець «BIG» у матриці — з коментаря
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

/** Лейбл для звітів: показує BIG-лінійки як "BIG: ..." замість "BerryAlloc: ...". */
function reportTrademarkLabelFromNormalized(tmNormalized) {
  const t = String(tmNormalized ?? '').trim();
  if (t === 'BerryAlloc: Carmelita') return 'BIG: Carmelita';
  if (t === 'BerryAlloc: PurLoc40') return 'BIG: PurLoc40';
  if (t === 'BerryAlloc: Novocore') return 'BIG: Novocore';
  if (t === 'BerryAlloc (BIG) — невизначено') return 'BIG: невизначено';
  return t;
}

function reportTrademarkLabelFromSaleRow(row) {
  return reportTrademarkLabelFromNormalized(normalizeTrademarkFromSaleRow(row));
}

/** Три лінії всередині одного стенду BIG у матриці обліку (не BerryAlloc: Smartline тощо). */
function isBerryAllocBigProductLineNormalized(tm) {
  const t = String(tm ?? '').trim();
  return (
    t === 'BerryAlloc: Carmelita' ||
    t === 'BerryAlloc: PurLoc40' ||
    t === 'BerryAlloc: Novocore' ||
    t === 'BerryAlloc (BIG) — невизначено'
  );
}

/** Колонка матриці продажів: одна «BIG» замість трьох підмарок. */
function salesMatrixColumnKeyFromNormalizedTrademark(normalizedTm) {
  return isBerryAllocBigProductLineNormalized(normalizedTm) ? 'BIG' : normalizedTm;
}

/**
 * Чи один і той самий логічний стовпчик матриці (різні написи в продажах vs заголовок колонки).
 * Без цього конверсія падає в 0%, якщо в одному рядку «IVC: Solida», в іншому — «Solida».
 */
function matrixSalesColumnKeysMatch(saleColKey, headerColKey) {
  const a = String(saleColKey ?? '').trim();
  const b = String(headerColKey ?? '').trim();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.toLowerCase() === b.toLowerCase()) return true;
  if (a === 'BIG' && b === 'BIG') return true;
  if (a === 'BIG' || b === 'BIG') {
    const other = a === 'BIG' ? b : a;
    if (other === 'BIG') return true;
    return isBerryAllocBigProductLineNormalized(other);
  }
  return standTokensComparableForMatrix(a, b);
}

/** Однаковий ключ для зіставлення назв ТТ між «Продажами» і матрицею обліку. */
function normalizeComparableShopKey(shop) {
  return String(shop ?? '')
    .normalize('NFC')
    .replace(/[\u2019\u2018`]/g, "'")
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** «IVC: Solida» vs «Solida», «IVC: Divino» vs «Divino» тощо — без хибних збігів по префіксу. */
function standTokensComparableForMatrix(a, b) {
  const norm = s =>
    String(s ?? '')
      .normalize('NFC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const tail = s => {
    const i = s.lastIndexOf(':');
    return i < 0 ? s : s.slice(i + 1).trim();
  };
  const tx = tail(x);
  const ty = tail(y);
  if (tx === y || x === ty || ty === x || y === tx) return true;
  if (tx && ty && tx === ty) return true;
  return false;
}

function matrixStandKeyMatchesNormalizedTrademark(matrixStand, normalizedTm) {
  const ms = String(matrixStand ?? '').trim();
  const nt = String(normalizedTm ?? '').trim();
  if (!ms || !nt) return false;
  if (ms === nt) return true;
  if (ms.toLowerCase() === nt.toLowerCase()) return true;
  if (isBerryAllocBigStand(ms)) {
    return isBerryAllocBigProductLineNormalized(nt);
  }
  if (standTokensComparableForMatrix(ms, nt)) return true;
  return false;
}

/** Розміщення з матриці обліку відповідає колонці матриці продажів (ті самі правила, що «Стенди у менеджерів»). */
function placementStandMatchesSalesMatrixColumn(matrixStand, salesColumnKey) {
  const ms = String(matrixStand ?? '').trim();
  const c = String(salesColumnKey ?? '').trim();
  if (!ms || !c) return false;
  return (
    matrixStandKeyMatchesNormalizedTrademark(ms, c) ||
    matrixStandKeyMatchesNormalizedTrademark(c, ms)
  );
}

function matrixColumnKeyFromSaleRow(row) {
  return salesMatrixColumnKeyFromNormalizedTrademark(normalizeTrademarkFromSaleRow(row));
}

/** Чи є в цієї ТТ за період хоча б один продаж у цьому стовпчику матриці (як у клітинках таблиці). */
function shopHasSaleForMatrixColumn(shop, salesRows, colStr) {
  const shopKey = normalizeComparableShopKey(shop);
  const c = String(colStr ?? '').trim();
  return salesRows.some(row => {
    if (numberOrZero(row['Кількість']) <= 0) return false;
    if (normalizeComparableShopKey(row['Торгова точка']) !== shopKey) return false;
    return matrixSalesColumnKeysMatch(matrixColumnKeyFromSaleRow(row), c);
  });
}

function shopHasBigLineSale(shop, salesRows) {
  const shopKey = normalizeComparableShopKey(shop);
  return salesRows.some(row => {
    if (numberOrZero(row['Кількість']) <= 0) return false;
    if (normalizeComparableShopKey(row['Торгова точка']) !== shopKey) return false;
    const tm = normalizeTrademarkFromSaleRow(row);
    return isBerryAllocBigProductLineNormalized(tm);
  });
}

/**
 * По кожній ТМ: сума стендів з матриці обліку / сума тих, де за період був продаж по цій марці (одиниці обліку).
 */
function computeStandTotalsForMatrix(managerFilter, stands, salesRows) {
  const placements = getAllStandPlacements(managerFilter);
  const stats = new Map();
  stands.forEach(col => stats.set(col, { totalUnits: 0, workedUnits: 0 }));

  stands.forEach(col => {
    const colStr = String(col ?? '').trim();
    placements.forEach(p => {
      if (colStr === 'BIG') {
        if (!isBerryAllocBigStand(p.stand)) return;
      } else if (!placementStandMatchesSalesMatrixColumn(p.stand, colStr)) {
        return;
      }
      const inst = numberOrZero(p.installed);
      stats.get(col).totalUnits += inst;
      const had =
        colStr === 'BIG'
          ? shopHasBigLineSale(p.shop, salesRows)
          : shopHasSaleForMatrixColumn(p.shop, salesRows, colStr);
      if (had) stats.get(col).workedUnits += inst;
    });
  });
  return stats;
}

function formatStandHeaderMeta(stand, standStats) {
  const s = standStats.get(stand) || { totalUnits: 0, workedUnits: 0 };
  const { totalUnits, workedUnits } = s;
  if (totalUnits > 0) {
    const pct = Math.round((workedUnits / totalUnits) * 1000) / 10;
    return `${totalUnits.toFixed(0)} ст. всього · ${workedUnits.toFixed(0)} спрацювало · ${pct}%`;
  }
  return 'немає в обліку стендів';
}

function buildSalesMatrixHtmlFromRows(salesRows, titleText, managerFilter = 'all') {
  const matrix = {};
  const standsSet = new Set();
  const shopsSet = new Set();
  salesRows.forEach(row => {
    const shop = String(row?.['Торгова точка'] ?? '').trim();
    const standNorm = normalizeTrademarkFromSaleRow(row);
    if (!shop || !standNorm) return;
    const standCol = salesMatrixColumnKeyFromNormalizedTrademark(standNorm);
    shopsSet.add(shop);
    standsSet.add(standCol);
    if (!matrix[shop]) matrix[shop] = {};
    matrix[shop][standCol] = (matrix[shop][standCol] || 0) + numberOrZero(row['Кількість']);
  });
  const shops = [...shopsSet].sort((a, b) => a.localeCompare(b, 'uk'));
  const stands = [...standsSet].sort((a, b) => a.localeCompare(b, 'uk'));
  const standStats = computeStandTotalsForMatrix(managerFilter, stands, salesRows);
  const title = titleText
    ? `<p style="margin: 10px 0 0 0; font-weight: 700; color:#2c3e50;">${escapeHtml(titleText)}</p>`
    : '';
  if (!shops.length) {
    return `${title}<p style="color:#777; margin-top: 8px;">Немає даних</p>`;
  }
  let html = '<table class="data-table"><thead><tr><th>Торгова точка</th>';
  stands.forEach(stand => {
    const meta = escapeHtml(formatStandHeaderMeta(stand, standStats));
    html += `<th>${escapeHtml(stand)}<br><span class="sales-matrix-th-meta">${meta}</span></th>`;
  });
  html += '</tr></thead><tbody>';
  shops.forEach(shop => {
    html += `<tr><td>${escapeHtml(shop)}</td>`;
    stands.forEach(stand => {
      const v = matrix[shop][stand];
      html += `<td>${v ? numberOrZero(v).toFixed(3) : ''}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  return `${title}<div class="table-scroll sales-matrix">${html}</div>`;
}

function renderAnalyticsSalesMatrix() {
  const el = document.getElementById('analytics-sales-matrix');
  if (!el) return;
  const managerFilter = getSelectedAnalyticsManagerId();
  const range = getSalesReportRangeFromUI();
  const sales = getSalesInRange(range, managerFilter);
  const title = `Продажі (матриця) — ${formatRangeLabel(range)} (${managerFilter === 'all' ? 'всі' : managerIdToName(managerFilter)})`;
  el.innerHTML = buildSalesMatrixHtmlFromRows(sales, title, managerFilter);
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
      // Оновити області й список ТТ для цього менеджера
      fillOblastSelect(document.getElementById('sale-oblast-select'), managerId);
      fillShopSelect(document.getElementById('sale-shop-select'), managerId, '');
    } else {
      fillOblastSelect(document.getElementById('sale-oblast-select'), null);
      fillShopSelect(document.getElementById('sale-shop-select'), null, '');
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
  const saleModal = document.getElementById('addSaleModal');
  if (saleModal && event.target === saleModal) closeAddSaleForm();
  const clientModal = document.getElementById('clientStandModal');
  if (clientModal && event.target === clientModal) closeClientStandForm();
});

// Закриття модального вікна при натисканні Escape
document.addEventListener('keydown', function(event) {
  if (event.key !== 'Escape') return;
  const clientModal = document.getElementById('clientStandModal');
  if (clientModal && clientModal.style.display === 'flex') {
    closeClientStandForm();
    return;
  }
  closeAddSaleForm();
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
  const selectedOblast = String(formData.get('oblast') ?? '').trim();
  const cityValue =
    getCityForShopFromStandsMatrix(shopValue, ['andrii', 'roman', 'pavlo'].includes(managerId) ? managerId : null) ||
    '';
  const oblastValue =
    selectedOblast ||
    getOblastForShopFromStandsMatrix(shopValue, ['andrii', 'roman', 'pavlo'].includes(managerId) ? managerId : null) ||
    '';

  const saleData = {
    'Торгова точка': shopValue,
    'Стенд': standValue,
    'Кількість': formData.get('quantity'),
    'Дата': formData.get('date'),
    'Місто': cityValue,
    'Область': oblastValue,
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
      const activeTab = document.querySelector('.tab-content.active');
      if (activeTab) {
        const managerId = activeTab.id;
        if (['andrii', 'roman', 'pavlo'].includes(managerId)) {
          renderSalesTableForManager(managerId);
          updateManagerStats(managerId);
        }
      }
      renderAllNewAnalyticsBlocks();
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

// === Клієнт (ТТ) і матриця стендів: форма + запис у Google Sheet ===
// Очікуваний контракт для Apps Script (query до того ж APPS_SCRIPT_BASE_URL):
//   ?sheet=Облік стендів(Андрій|Роман|Павло)&standsWrite=1&standsAction=upsert|delete|move
//   Для upsert: опційно &standsMatchShop=... (назва ДО зміни; порожньо = новий рядок).
//   Тіло POST: JSON як text/plain (як у продажах), для upsert — об'єкт рядка матриці;
//   для delete — {} або той самий рядок; для move — див. postStandsMatrixMove().
const STANDS_MATRIX_META_KEYS = ['Назва ТТ', 'Адреса', 'Місто', 'Область', 'Коментар'];

function standsMatrixSheetTitle(managerId) {
  return `Облік стендів(${managerIdToName(managerId)})`;
}

function getStandTypeKeysFromRow(sampleRow) {
  if (!sampleRow || typeof sampleRow !== 'object') return [];
  return Object.keys(sampleRow).filter(k => !STANDS_MATRIX_META_KEYS.includes(k));
}

function cloneStandsRowStructure(sampleRow) {
  const row = {};
  Object.keys(sampleRow).forEach(k => {
    if (STANDS_MATRIX_META_KEYS.includes(k)) row[k] = '';
    else row[k] = 0;
  });
  return row;
}

function getBlankStandsDataRow(managerId) {
  const raw = window.standsMatrixData?.[managerId] || [];
  const sample = raw[0];
  if (sample) return cloneStandsRowStructure(sample);
  return null;
}

function findStandsRowIndexByShop(managerId, shopName) {
  const key = String(shopName ?? '').trim();
  const list = window.standsMatrixData?.[managerId];
  if (!Array.isArray(list) || !key) return -1;
  return list.findIndex(r => String(r?.['Назва ТТ'] ?? '').trim() === key);
}

function paintStandsMatrixForManager(managerId) {
  const el = document.getElementById(`${managerId}-stands-matrix`);
  if (!el) return;
  const data = window.standsMatrixData?.[managerId] || [];
  el.innerHTML = buildStandsMatrix(data.length ? data : []);
}

async function postStandsMatrixOp(managerId, action, bodyObj, matchShop = '') {
  const sheet = standsMatrixSheetTitle(managerId);
  const params = new URLSearchParams({
    sheet,
    standsWrite: '1',
    standsAction: action
  });
  const m = String(matchShop ?? '').trim();
  if (m) params.set('standsMatchShop', m);
  const url = `${APPS_SCRIPT_BASE_URL}?${params.toString()}`;
  await fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    body: JSON.stringify(bodyObj ?? {})
  });
}

async function postStandsMatrixMove(managerId, payload) {
  const sheet = standsMatrixSheetTitle(managerId);
  const params = new URLSearchParams({ sheet, standsWrite: '1', standsAction: 'move' });
  const url = `${APPS_SCRIPT_BASE_URL}?${params.toString()}`;
  await fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    body: JSON.stringify(payload)
  });
}

function applyStandsUpsertLocal(managerId, matchShop, row) {
  if (!window.standsMatrixData) window.standsMatrixData = {};
  const list = Array.isArray(window.standsMatrixData[managerId])
    ? window.standsMatrixData[managerId]
    : [];
  const m = String(matchShop ?? '').trim();
  const name = String(row['Назва ТТ'] ?? '').trim();
  if (!name) return;
  let idx = m ? findStandsRowIndexByShop(managerId, m) : -1;
  if (idx < 0) idx = findStandsRowIndexByShop(managerId, name);
  if (idx >= 0) list[idx] = { ...list[idx], ...row };
  else list.push({ ...row });
  window.standsMatrixData[managerId] = list;
}

function applyStandsDeleteLocal(managerId, shopName) {
  const key = String(shopName ?? '').trim();
  if (!key || !window.standsMatrixData?.[managerId]) return;
  window.standsMatrixData[managerId] = window.standsMatrixData[managerId].filter(
    r => String(r?.['Назва ТТ'] ?? '').trim() !== key
  );
}

function applyStandsMoveLocal(managerId, fromShop, toShop, stand, qty, newRecipientMeta) {
  const norm = s => String(s ?? '').trim();
  const from = norm(fromShop);
  const to = norm(toShop);
  const q = Math.floor(Number(qty)) || 0;
  if (!from || !to || from === to || q < 1) return { ok: false, message: 'Перевірте клієнтів і кількість.' };
  const list = window.standsMatrixData?.[managerId];
  if (!Array.isArray(list) || !list.length) return { ok: false, message: 'Немає даних матриці.' };

  const iFrom = findStandsRowIndexByShop(managerId, from);
  if (iFrom < 0) return { ok: false, message: 'Не знайдено клієнта-відправника.' };
  const available = numberOrZero(list[iFrom][stand]);
  if (available < q) return { ok: false, message: 'Недостатньо стендів у відправника.' };

  let iTo = findStandsRowIndexByShop(managerId, to);
  if (iTo < 0) {
    const base = cloneStandsRowStructure(list[iFrom]);
    const nr = {
      ...base,
      'Назва ТТ': to,
      'Адреса': newRecipientMeta?.address ?? '',
      'Місто': newRecipientMeta?.city ?? '',
      'Область': newRecipientMeta?.oblast ?? '',
      'Коментар': newRecipientMeta?.comment ?? ''
    };
    nr[stand] = q;
    list.push(nr);
  } else {
    list[iFrom][stand] = available - q;
    list[iTo][stand] = numberOrZero(list[iTo][stand]) + q;
    return { ok: true };
  }
  list[iFrom][stand] = available - q;
  return { ok: true };
}

async function refreshStandsAfterWrite(managerId) {
  await new Promise(r => setTimeout(r, 700));
  window.standsMatrixData[managerId] = await loadStandsMatrix(managerId);
  paintStandsMatrixForManager(managerId);
  renderAllNewAnalyticsBlocks();
  updateManagerStats(managerId);
}

function collectRowFromClientStandForm() {
  const row = {
    'Назва ТТ': String(document.getElementById('csf-shop-name')?.value ?? '').trim(),
    'Адреса': String(document.getElementById('csf-address')?.value ?? '').trim(),
    'Місто': String(document.getElementById('csf-city')?.value ?? '').trim(),
    'Область': String(document.getElementById('csf-oblast')?.value ?? '').trim(),
    'Коментар': String(document.getElementById('csf-comment')?.value ?? '').trim()
  };
  document.querySelectorAll('#csf-stand-grid input[data-stand-col]').forEach(inp => {
    const col = inp.getAttribute('data-stand-col');
    if (!col) return;
    row[col] = numberOrZero(inp.value);
  });
  return row;
}

function renderClientStandGridFromRow(row) {
  const grid = document.getElementById('csf-stand-grid');
  if (!grid || !row) {
    if (grid) grid.innerHTML = '<p class="csf-hint">Немає колонок стендів. Завантажте матрицю або вкладку «Стенди».</p>';
    return;
  }
  const keys = getStandTypeKeysFromRow(row);
  if (!keys.length) {
    grid.innerHTML = '<p class="csf-hint">У матриці ще немає колонок стендів.</p>';
    return;
  }
  grid.innerHTML = keys.map((k, i) => {
    const id = `csf-s-${i}`;
    const v = numberOrZero(row[k]);
    return `<label for="${id}">${escapeHtml(k)}</label><input type="number" id="${id}" min="0" step="1" data-stand-col="${escapeHtml(k)}" value="${v}" />`;
  }).join('');

  const moveStand = document.getElementById('csf-move-stand');
  if (moveStand) {
    moveStand.innerHTML = keys.map(k => `<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`).join('');
  }
}

function getShopsForManager(managerId, oblast = '') {
  const data = cleanStandsMatrixRows(window.standsMatrixData?.[managerId] || []);
  const shops = [...new Set(
    data
      .filter(r => {
        if (!oblast) return true;
        return String(r?.['Область'] ?? '').trim() === oblast;
      })
      .map(r => String(r['Назва ТТ'] ?? '').trim())
      .filter(Boolean)
  )];
  return shops.sort((a, b) => a.localeCompare(b, 'uk'));
}

function getOblastsForManager(managerId) {
  const data = cleanStandsMatrixRows(window.standsMatrixData?.[managerId] || []);
  const oblasts = [...new Set(
    data.map(r => String(r?.['Область'] ?? '').trim()).filter(Boolean)
  )];
  return oblasts.sort((a, b) => a.localeCompare(b, 'uk'));
}

function fillClientStandOblastPick(managerId, selectedOblast = '') {
  const sel = document.getElementById('csf-oblast-pick');
  if (!sel) return;
  const oblasts = getOblastsForManager(managerId);
  sel.innerHTML = '<option value="">Всі області</option>' +
    oblasts.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
  if (selectedOblast && oblasts.includes(selectedOblast)) sel.value = selectedOblast;
  else sel.value = '';
}

function fillClientStandShopPick(managerId, selectedShop = '', oblast = '') {
  const sel = document.getElementById('csf-shop-pick');
  if (!sel) return;
  const shops = getShopsForManager(managerId, oblast);
  if (!shops.length) {
    sel.innerHTML = '<option value="">Немає клієнтів у матриці</option>';
    return;
  }
  sel.innerHTML = shops.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  if (selectedShop && shops.includes(selectedShop)) sel.value = selectedShop;
  else sel.value = shops[0];
}

function fillClientStandMoveSelects(managerId) {
  const shops = getShopsForManager(managerId);
  const fromSel = document.getElementById('csf-move-from');
  const toSel = document.getElementById('csf-move-target-shop');
  const standSel = document.getElementById('csf-move-stand');
  if (!fromSel || !toSel || !standSel) return;

  if (!shops.length) {
    fromSel.innerHTML = '<option value="">Немає клієнтів</option>';
    toSel.innerHTML = '<option value="">Немає клієнтів</option>';
    return;
  }

  fromSel.innerHTML = shops.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  toSel.innerHTML = shops.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');

  const sample = (window.standsMatrixData?.[managerId] || [])[0];
  let standKeys = getStandTypeKeysFromRow(sample);
  if (!standKeys.length) {
    standKeys = [...document.querySelectorAll('#csf-stand-grid input[data-stand-col]')]
      .map(inp => inp.getAttribute('data-stand-col'))
      .filter(Boolean);
  }
  if (standKeys.length) {
    standSel.innerHTML = standKeys.map(k => `<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`).join('');
  }
}

function syncClientStandModeUi() {
  const mode = document.getElementById('csf-mode')?.value || 'new';
  const wrap = document.getElementById('csf-shop-pick-wrap');
  const obWrap = document.getElementById('csf-oblast-pick-wrap');
  const delBtn = document.getElementById('csf-delete-btn');
  const orig = document.getElementById('csf-original-shop');
  if (wrap) wrap.style.display = mode === 'edit' ? '' : 'none';
  if (obWrap) obWrap.style.display = mode === 'edit' ? '' : 'none';
  if (delBtn) delBtn.style.display = mode === 'edit' ? '' : 'none';
  if (mode === 'new' && orig) orig.value = '';
}

function loadClientStandEditorFromShop(managerId, shopName) {
  const key = String(shopName ?? '').trim();
  if (!key) return;
  const idx = findStandsRowIndexByShop(managerId, key);
  const row = idx >= 0 ? window.standsMatrixData[managerId][idx] : null;
  const orig = document.getElementById('csf-original-shop');
  if (orig) orig.value = key;
  if (!row) return;
  document.getElementById('csf-shop-name').value = String(row['Назва ТТ'] ?? '');
  document.getElementById('csf-address').value = String(row['Адреса'] ?? '');
  document.getElementById('csf-city').value = String(row['Місто'] ?? '');
  document.getElementById('csf-oblast').value = String(row['Область'] ?? '');
  document.getElementById('csf-comment').value = String(row['Коментар'] ?? '');
  renderClientStandGridFromRow(row);
}

async function ensureClientStandTemplate(managerId) {
  let raw = window.standsMatrixData?.[managerId];
  if (!raw?.length) {
    raw = await loadStandsMatrix(managerId);
    if (!window.standsMatrixData) window.standsMatrixData = {};
    window.standsMatrixData[managerId] = raw;
  }
  if (raw?.length) return getBlankStandsDataRow(managerId);
  const stands = await loadStandsList();
  const row = { 'Назва ТТ': '', 'Адреса': '', 'Місто': '', 'Область': '', 'Коментар': '' };
  stands.forEach(name => {
    if (name) row[String(name)] = 0;
  });
  return row;
}

async function openClientStandForm(managerId = 'andrii') {
  const modal = document.getElementById('clientStandModal');
  if (!modal) return;
  modal.style.display = 'flex';

  const mid = ['andrii', 'roman', 'pavlo'].includes(managerId) ? managerId : 'andrii';
  const mgrSel = document.getElementById('csf-manager');
  if (mgrSel) mgrSel.value = mid;

  const modeSel = document.getElementById('csf-mode');
  if (modeSel) modeSel.value = 'new';
  syncClientStandModeUi();

  const blank = await ensureClientStandTemplate(mid);
  document.getElementById('csf-shop-name').value = '';
  document.getElementById('csf-address').value = '';
  document.getElementById('csf-city').value = '';
  document.getElementById('csf-oblast').value = '';
  document.getElementById('csf-comment').value = '';
  renderClientStandGridFromRow(blank);

  fillClientStandOblastPick(mid);
  fillClientStandShopPick(mid);
  fillClientStandMoveSelects(mid);
}

function closeClientStandForm() {
  const modal = document.getElementById('clientStandModal');
  if (modal) modal.style.display = 'none';
  const form = document.getElementById('clientStandForm');
  if (form) form.reset();
  syncClientStandModeUi();
}

async function submitClientStandForm(event) {
  event.preventDefault();
  const managerId = document.getElementById('csf-manager')?.value;
  const mode = document.getElementById('csf-mode')?.value || 'new';
  if (!['andrii', 'roman', 'pavlo'].includes(managerId)) return;

  const row = collectRowFromClientStandForm();
  if (!row['Назва ТТ']) {
    showNotification('Вкажіть назву ТТ.', 'error');
    return;
  }

  const original = String(document.getElementById('csf-original-shop')?.value ?? '').trim();
  const matchShop = mode === 'edit' ? original : '';

  if (mode === 'edit' && !matchShop) {
    showNotification('Оберіть клієнта для редагування.', 'error');
    return;
  }

  try {
    await postStandsMatrixOp(managerId, 'upsert', row, matchShop);
    applyStandsUpsertLocal(managerId, matchShop, row);
    paintStandsMatrixForManager(managerId);
    renderAllNewAnalyticsBlocks();
    updateManagerStats(managerId);
    showNotification('Запит на збереження клієнта відправлено.', 'success');
    await refreshStandsAfterWrite(managerId);
    fillShopSelect(document.getElementById('sale-shop-select'), managerId);
    closeClientStandForm();
  } catch (e) {
    console.error(e);
    showNotification(`Помилка: ${e.message || e}`, 'error');
  }
}

async function onClientStandDelete() {
  const managerId = document.getElementById('csf-manager')?.value;
  const mode = document.getElementById('csf-mode')?.value;
  const original = String(document.getElementById('csf-original-shop')?.value ?? '').trim();
  if (mode !== 'edit' || !original) return;
  if (!confirm(`Видалити клієнта «${original}» з матриці?`)) return;
  try {
    await postStandsMatrixOp(managerId, 'delete', { 'Назва ТТ': original }, original);
    applyStandsDeleteLocal(managerId, original);
    paintStandsMatrixForManager(managerId);
    renderAllNewAnalyticsBlocks();
    updateManagerStats(managerId);
    showNotification('Запит на видалення відправлено.', 'success');
    await refreshStandsAfterWrite(managerId);
    fillShopSelect(document.getElementById('sale-shop-select'), managerId);
    closeClientStandForm();
  } catch (e) {
    console.error(e);
    showNotification(`Помилка: ${e.message || e}`, 'error');
  }
}

async function onClientStandMoveClick() {
  const managerId = document.getElementById('csf-manager')?.value;
  if (!['andrii', 'roman', 'pavlo'].includes(managerId)) return;

  const fromShop = String(document.getElementById('csf-move-from')?.value ?? '').trim();
  const stand = String(document.getElementById('csf-move-stand')?.value ?? '').trim();
  const qty = Math.floor(Number(document.getElementById('csf-move-qty')?.value ?? '0'));
  const kind = document.getElementById('csf-move-target-kind')?.value || 'existing';

  let toShop = '';
  let newMeta = null;
  if (kind === 'existing') {
    toShop = String(document.getElementById('csf-move-target-shop')?.value ?? '').trim();
  } else {
    toShop = String(document.getElementById('csf-move-new-name')?.value ?? '').trim();
    newMeta = {
      address: String(document.getElementById('csf-move-new-address')?.value ?? '').trim(),
      city: String(document.getElementById('csf-move-new-city')?.value ?? '').trim(),
      oblast: String(document.getElementById('csf-move-new-oblast')?.value ?? '').trim(),
      comment: ''
    };
    if (!toShop) {
      showNotification('Вкажіть назву нової ТТ.', 'error');
      return;
    }
  }

  if (!fromShop || !stand || qty < 1) {
    showNotification('Заповніть поля переміщення.', 'error');
    return;
  }
  if (fromShop === toShop) {
    showNotification('Відправник і отримувач не повинні збігатися.', 'error');
    return;
  }

  const movePayload = {
    fromShop,
    toShop,
    stand,
    quantity: qty,
    toIsNew: kind === 'new',
    toRow: newMeta
      ? { 'Адреса': newMeta.address, 'Місто': newMeta.city, 'Область': newMeta.oblast, 'Коментар': newMeta.comment }
      : undefined
  };

  const local = applyStandsMoveLocal(managerId, fromShop, toShop, stand, qty, newMeta);
  if (!local.ok) {
    showNotification(local.message || 'Не вдалося перемістити', 'error');
    return;
  }

  try {
    await postStandsMatrixMove(managerId, movePayload);
    paintStandsMatrixForManager(managerId);
    renderAllNewAnalyticsBlocks();
    updateManagerStats(managerId);
    showNotification('Переміщення застосовано локально; запит на запис відправлено.', 'success');
    await refreshStandsAfterWrite(managerId);
    fillClientStandShopPick(managerId);
    fillClientStandMoveSelects(managerId);
    fillShopSelect(document.getElementById('sale-shop-select'), managerId);
  } catch (e) {
    console.error(e);
    showNotification(`Помилка: ${e.message || e}`, 'error');
  }
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

async function loadShopsList(manager, oblast = '') {
  // Повертає список ТТ лише для конкретного менеджера (опційно фільтр по області)
  const data = await loadStandsMatrix(manager);
  const shops = new Set();
  data.forEach(row => {
    const shop = String(row['Назва ТТ'] ?? '').trim();
    if (!shop) return;
    const ob = String(row?.['Область'] ?? '').trim();
    if (oblast && ob !== oblast) return;
    shops.add(shop);
  });
  return Array.from(shops).sort();
}

async function loadOblastList(manager) {
  const data = await loadStandsMatrix(manager);
  const set = new Set();
  data.forEach(row => {
    const ob = String(row?.['Область'] ?? '').trim();
    if (ob) set.add(ob);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'uk'));
}

async function fillOblastSelect(selectElement, manager) {
  try {
    if (!selectElement) return;
    if (!manager || !['andrii', 'roman', 'pavlo'].includes(manager)) {
      selectElement.innerHTML = '<option value="">Оберіть менеджера</option>';
      return;
    }
    const oblasts = await loadOblastList(manager);
    selectElement.innerHTML =
      '<option value="">Оберіть область</option>' +
      oblasts.map(ob => `<option value="${escapeHtml(ob)}">${escapeHtml(ob)}</option>`).join('');
  } catch (error) {
    console.error('Помилка завантаження областей:', error);
    if (selectElement) selectElement.innerHTML = '<option value="">Помилка завантаження</option>';
  }
}

async function fillShopSelect(selectElement, manager, oblast = '') {
  try {
    const shops = await loadShopsList(manager, oblast);
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
  if (tabName === 'analytics') {
    renderAnalyticsTable();
    renderAllNewAnalyticsBlocks();
  }
  if (tabName === 'compare') {
    toggleComparePeriodUI('a');
    toggleComparePeriodUI('b');
    renderComparePeriodTable();
  }
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
  const mainCols = ['Назва ТТ', 'Адреса', 'Місто', 'Область'];
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
  renderManagerConversions(manager);
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
  renderManagerConversions(manager);
}

function getSelectedMonthYearForManager(manager) {
  const monthSel = document.querySelector(`.month-select[data-manager="${manager}"]`);
  const yearSel = document.querySelector(`.year-select[data-manager="${manager}"]`);
  const month = monthSel ? Number(monthSel.value) : (new Date().getMonth() + 1);
  const year = yearSel ? Number(yearSel.value) : (new Date().getFullYear());
  return { month, year };
}

function getManagerSalesInMonth(managerId, month, year) {
  const range = getRangeForMonth(month, year);
  return getSalesInRange(range, managerId);
}

async function loadStandChangeLog() {
  const data = await fetchSheet('Лог змін стендів');
  window.standsChangeLog = Array.isArray(data) ? data : [];
  return window.standsChangeLog;
}

function parseChangeLogTimestampMs(v) {
  const d = new Date(String(v ?? '').trim());
  const t = d.getTime();
  return Number.isFinite(t) ? t : NaN;
}

function buildCurrentStandsStateFromMatrix(managerId) {
  const raw = window.standsMatrixData?.[managerId] || [];
  const data = cleanStandsMatrixRows(raw);
  if (!data.length) return new Map();
  const headers = Object.keys(data[0] || {});
  const standKeys = headers.filter(h => !['Назва ТТ', 'Адреса', 'Місто', 'Область', 'Коментар'].includes(h));
  const state = new Map(); // shopKey -> Map(stand -> qty)
  data.forEach(row => {
    const shop = String(row?.['Назва ТТ'] ?? '').trim();
    if (!shop) return;
    const shopKey = normalizeComparableShopKey(shop);
    if (!shopKey) return;
    if (!state.has(shopKey)) state.set(shopKey, new Map());
    const m = state.get(shopKey);
    standKeys.forEach(k => {
      const stand = String(k ?? '').trim();
      if (!stand) return;
      const n = numberOrZero(row[k]);
      if (n > 0) m.set(stand, n);
    });
  });
  return state;
}

function stateApplyDelta(state, shopKey, stand, delta) {
  if (!shopKey || !stand) return;
  if (!state.has(shopKey)) state.set(shopKey, new Map());
  const m = state.get(shopKey);
  const cur = numberOrZero(m.get(stand));
  const next = cur + numberOrZero(delta);
  if (next > 0) m.set(stand, next);
  else m.delete(stand);
  if (m.size === 0) state.delete(shopKey);
}

function buildStandsStateAsOfEndMonth(managerId, month, year) {
  // Беремо поточний стан матриці і "відкочуємо" зміни, які сталися після кінця місяця.
  const cutoff = getRangeForMonth(month, year).end.getTime(); // end of month [start,end)
  const state = buildCurrentStandsStateFromMatrix(managerId);
  const log = Array.isArray(window.standsChangeLog) ? window.standsChangeLog : [];
  log.forEach(ev => {
    const mid = String(ev?.ManagerId ?? '').trim();
    if (mid && mid !== managerId) return;
    const ts = parseChangeLogTimestampMs(ev?.Timestamp);
    if (!Number.isFinite(ts)) return;
    if (ts <= cutoff) return; // зміни ДО або в межах місяця лишаємо
    const shopKey = normalizeComparableShopKey(ev?.Shop);
    const stand = String(ev?.Stand ?? '').trim();
    const delta = numberOrZero(ev?.Delta);
    // reverse apply
    stateApplyDelta(state, shopKey, stand, -delta);
  });
  return state;
}

function placementsFromState(state) {
  const placements = [];
  for (const [shopKey, m] of state.entries()) {
    for (const stand of m.keys()) {
      placements.push({ shopKey, stand });
    }
  }
  return placements;
}

function renderManagerConversions(managerId) {
  const el = document.getElementById(`${managerId}-conversions`);
  if (!el) return;

  const { month, year } = getSelectedMonthYearForManager(managerId);
  const sales = getManagerSalesInMonth(managerId, month, year);

  const state = buildStandsStateAsOfEndMonth(managerId, month, year);
  const totalTT = state.size;

  const workedTT = new Set(
    sales
      .map(r => normalizeComparableShopKey(r?.['Торгова точка']))
      .filter(Boolean)
  ).size;

  const placements = placementsFromState(state);
  const totalStands = placements.length;

  const salesByShop = new Map(); // shopKey -> [saleRow...]
  sales.forEach(r => {
    const k = normalizeComparableShopKey(r?.['Торгова точка']);
    if (!k) return;
    if (!salesByShop.has(k)) salesByShop.set(k, []);
    salesByShop.get(k).push(r);
  });

  const placementWorked = (p) => {
    const shopKey = String(p?.shopKey ?? '').trim();
    if (!shopKey) return false;
    const rows = salesByShop.get(shopKey) || [];
    if (!rows.length) return false;
    // BIG: якщо будь-яка з ліній Carmelita/PurLoc40/Novocore/невизначено має продаж
    if (isBerryAllocBigStand(p.stand)) {
      return rows.some(r => isBerryAllocBigProductLineNormalized(normalizeTrademarkFromSaleRow(r)));
    }
    // Інші: продаж має відповідати цьому стенду з матриці обліку
    return rows.some(r => {
      const tm = normalizeTrademarkFromSaleRow(r);
      return matrixStandKeyMatchesNormalizedTrademark(p.stand, tm) || matrixStandKeyMatchesNormalizedTrademark(tm, p.stand);
    });
  };

  const workedStands = placements.reduce((sum, p) => (placementWorked(p) ? sum + 1 : sum), 0);

  const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);
  const pctTT = pct(workedTT, totalTT);
  const pctStands = pct(workedStands, totalStands);

  const bar = v => `style="width:${Math.max(0, Math.min(100, v)).toFixed(1)}%"`;

  el.innerHTML = `
    <div class="conversion-grid">
      <div class="conversion-card">
        <div class="conversion-title">Конверсія ТТ за місяць</div>
        <div class="conversion-numbers">
          <div class="conversion-main">${workedTT} / ${totalTT || 0}</div>
          <div class="conversion-sub">${pctTT.toFixed(1)}%</div>
        </div>
        <div class="conversion-bar"><div ${bar(pctTT)}></div></div>
        <div class="conversion-hint">Спрацювало (є продажі) / Всього торгових точок</div>
      </div>
      <div class="conversion-card">
        <div class="conversion-title">Конверсія стендів за місяць</div>
        <div class="conversion-numbers">
          <div class="conversion-main">${workedStands.toFixed(0)} / ${totalStands.toFixed(0)}</div>
          <div class="conversion-sub">${pctStands.toFixed(1)}%</div>
        </div>
        <div class="conversion-bar"><div ${bar(pctStands)}></div></div>
        <div class="conversion-hint">Спрацювало (стенд мав продажі) / Всього стендів у матриці</div>
      </div>
    </div>
  `;
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
      const standTypes = headers.filter(h => !['Назва ТТ', 'Адреса', 'Місто', 'Область', 'Коментар'].includes(h));
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

function safePct(delta, prev) {
  const p = Number(prev);
  if (!Number.isFinite(p) || p === 0) return null;
  return (Number(delta) / p) * 100;
}

function fillComparePeriodSelectors() {
  const now = new Date();
  const months = [
    'Січень','Лютий','Березень','Квітень','Травень','Червень',
    'Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'
  ];

  const aMonth = document.getElementById('compare-a-month');
  const aQuarter = document.getElementById('compare-a-quarter');
  const aYear = document.getElementById('compare-a-year');
  const bMonth = document.getElementById('compare-b-month');
  const bQuarter = document.getElementById('compare-b-quarter');
  const bYear = document.getElementById('compare-b-year');
  if (!aMonth || !aQuarter || !aYear || !bMonth || !bQuarter || !bYear) return;

  const monthOptions = months.map((m, i) =>
    `<option value="${i + 1}" ${i === now.getUTCMonth() ? 'selected' : ''}>${m}</option>`
  ).join('');
  aMonth.innerHTML = monthOptions;
  bMonth.innerHTML = monthOptions;

  const thisYear = now.getUTCFullYear();
  const yearsHtml = [thisYear - 3, thisYear - 2, thisYear - 1, thisYear, thisYear + 1].map(y =>
    `<option value="${y}" ${y === thisYear ? 'selected' : ''}>${y}</option>`
  ).join('');
  aYear.innerHTML = yearsHtml;
  bYear.innerHTML = yearsHtml;

  aQuarter.value = String(getQuarterForMonth(now.getUTCMonth() + 1));
  bQuarter.value = String(getQuarterForMonth(now.getUTCMonth() + 1));
}

function toggleComparePeriodUI(side) {
  const kind = document.getElementById('compare-kind')?.value || 'month';
  const monthLabel = document.getElementById(`compare-${side}-month-label`);
  const quarterLabel = document.getElementById(`compare-${side}-quarter-label`);
  if (!monthLabel || !quarterLabel) return;
  if (kind === 'month') {
    monthLabel.style.display = '';
    quarterLabel.style.display = 'none';
  } else if (kind === 'quarter') {
    monthLabel.style.display = 'none';
    quarterLabel.style.display = '';
  } else {
    monthLabel.style.display = 'none';
    quarterLabel.style.display = 'none';
  }
}

function getCompareRangeFromUI(side) {
  const kind = document.getElementById('compare-kind')?.value || 'month';
  const month = Number(document.getElementById(`compare-${side}-month`)?.value || (new Date().getUTCMonth() + 1));
  const quarter = Number(document.getElementById(`compare-${side}-quarter`)?.value || getQuarterForMonth(month));
  const year = Number(document.getElementById(`compare-${side}-year`)?.value || new Date().getUTCFullYear());
  if (kind === 'quarter') return getRangeForQuarter(quarter, year);
  if (kind === 'year') return getRangeForYear(year);
  return getRangeForMonth(month, year);
}

function renderComparePeriodTable() {
  const managerFilter = getSelectedCompareManagerId();
  const rangeA = getCompareRangeFromUI('a');
  const rangeB = getCompareRangeFromUI('b');

  const managerIds = normalizeManagerListFromFilter(managerFilter);
  const rows = managerIds.map(mid => {
    const aSales = getSalesInRange(rangeA, mid);
    const bSales = getSalesInRange(rangeB, mid);
    const aQty = aSales.reduce((s, r) => s + numberOrZero(r['Кількість']), 0);
    const bQty = bSales.reduce((s, r) => s + numberOrZero(r['Кількість']), 0);
    const delta = aQty - bQty;
    const pct = safePct(delta, bQty);
    return {
      manager: managerIdToName(mid),
      a: aQty,
      b: bQty,
      delta,
      pct: pct == null ? '' : pct
    };
  });

  const totalA = rows.reduce((s, r) => s + numberOrZero(r.a), 0);
  const totalB = rows.reduce((s, r) => s + numberOrZero(r.b), 0);
  const totalDelta = totalA - totalB;
  const totalPct = safePct(totalDelta, totalB);
  rows.push({
    manager: 'Разом',
    a: totalA,
    b: totalB,
    delta: totalDelta,
    pct: totalPct == null ? '' : totalPct
  });

  buildSimpleTable(
    'compare-period-table',
    [
      { key: 'manager', label: 'Менеджер' },
      { key: 'b', label: `Період B (${formatRangeLabel(rangeB)})`, format: v => numberOrZero(v).toFixed(3) },
      { key: 'a', label: `Період A (${formatRangeLabel(rangeA)})`, format: v => numberOrZero(v).toFixed(3) },
      { key: 'delta', label: 'A − B, кв м', format: v => numberOrZero(v).toFixed(3) },
      { key: 'pct', label: 'Δ, %', format: v => (v === '' ? '' : `${numberOrZero(v).toFixed(1)}%`) }
    ],
    rows,
    { title: `Порівняння продажів: ${formatRangeLabel(rangeA)} vs ${formatRangeLabel(rangeB)}` }
  );
}

function renderSalesReports() {
  const managerFilter = getSelectedAnalyticsManagerId();
  const range = getSalesReportRangeFromUI();
  const sales = getSalesInRange(range, managerFilter);
  const shopToCity = buildShopCityIndex(managerFilter);
  const shopToOblast = buildShopOblastIndex(managerFilter);

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
    const trademark = reportTrademarkLabelFromSaleRow(row);
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

    const tm = reportTrademarkLabelFromSaleRow(row);
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

  // По областях
  const byOblast = new Map(); // oblast -> qty
  const oblastTrademarkQty = new Map(); // oblast -> Map(trademark -> qty)
  sales.forEach(row => {
    const shop = String(row?.['Торгова точка'] ?? '').trim();
    if (!shop) return;
    const oblast =
      String(row?.['Область'] ?? '').trim() ||
      String(shopToOblast.get(shop) || '').trim() ||
      'Невідомо';
    byOblast.set(oblast, (byOblast.get(oblast) || 0) + numberOrZero(row['Кількість']));

    const tm = reportTrademarkLabelFromSaleRow(row);
    if (tm) {
      if (!oblastTrademarkQty.has(oblast)) oblastTrademarkQty.set(oblast, new Map());
      const m = oblastTrademarkQty.get(oblast);
      m.set(tm, (m.get(tm) || 0) + numberOrZero(row['Кількість']));
    }
  });
  const byOblastRows = [...byOblast.entries()]
    .map(([oblast, qty]) => ({ oblast, qty }))
    .sort((a, b) => b.qty - a.qty);

  const oblastTrademarkRows = [...oblastTrademarkQty.entries()]
    .flatMap(([oblast, m]) =>
      [...m.entries()].map(([stand, qty]) => ({ oblast, stand, qty }))
    )
    .sort((a, b) => {
      const o = a.oblast.localeCompare(b.oblast);
      if (o !== 0) return o;
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

  renderAnalyticsSalesMatrix();

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

  buildSimpleTable(
    'sales-report-by-oblast',
    [
      { key: 'oblast', label: 'Область' },
      { key: 'qty', label: 'Продано, кв м', format: v => numberOrZero(v).toFixed(3) }
    ],
    byOblastRows,
    { title: `По областях — ${formatRangeLabel(range)} (${managerFilter === 'all' ? 'всі' : managerIdToName(managerFilter)})` }
  );

  buildSimpleTable(
    'sales-report-oblast-trademarks',
    [
      { key: 'oblast', label: 'Область' },
      { key: 'stand', label: 'Торгова марка' },
      { key: 'qty', label: 'Продано, кв м', format: v => numberOrZero(v).toFixed(3) }
    ],
    oblastTrademarkRows,
    { title: `Торгові марки по областях — ${formatRangeLabel(range)} (${managerFilter === 'all' ? 'всі' : managerIdToName(managerFilter)})` }
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
    const stand = reportTrademarkLabelFromSaleRow(row);
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

  // Загалом по області
  const byOblastTotal = new Map(); // oblast -> installed
  placements.forEach(p => {
    const oblast = String(p?.oblast ?? '').trim() || 'Невідомо';
    byOblastTotal.set(oblast, (byOblastTotal.get(oblast) || 0) + numberOrZero(p.installed));
  });
  const byOblastTotalRows = [...byOblastTotal.entries()]
    .map(([oblast, installed]) => ({ oblast, installed }))
    .sort((a, b) => b.installed - a.installed);

  // По області × стенд
  const byOblastStand = new Map(); // key oblast||stand => installed
  placements.forEach(p => {
    const oblast = String(p?.oblast ?? '').trim() || 'Невідомо';
    const stand = String(p?.stand ?? '').trim();
    if (!stand) return;
    const key = `${oblast}||${stand}`;
    byOblastStand.set(key, (byOblastStand.get(key) || 0) + numberOrZero(p.installed));
  });
  const byOblastRows = [...byOblastStand.entries()]
    .map(([key, installed]) => {
      const [oblast, stand] = key.split('||');
      return { oblast, stand, installed };
    })
    .sort((a, b) => {
      const o = a.oblast.localeCompare(b.oblast);
      if (o !== 0) return o;
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

  buildSimpleTable(
    'stands-installed-total-by-oblast',
    [
      { key: 'oblast', label: 'Область' },
      { key: 'installed', label: 'Загальна к-сть встановлених', format: v => numberOrZero(v).toFixed(0) }
    ],
    byOblastTotalRows,
    { title: `Всього стендів по областях — (${who})` }
  );

  buildSimpleTable(
    'stands-installed-by-oblast',
    [
      { key: 'oblast', label: 'Область' },
      { key: 'stand', label: 'Стенд (торгова марка)' },
      { key: 'installed', label: 'К-сть встановлених', format: v => numberOrZero(v).toFixed(0) }
    ],
    byOblastRows,
    { title: `Стенди по областях — (${who})` }
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

  const compareBtn = document.createElement('button');
  compareBtn.className = 'tab-btn';
  compareBtn.textContent = 'Порівняння періодів';
  compareBtn.dataset.tab = 'compare';
  compareBtn.onclick = () => showTab('compare');
  tabsContainer.appendChild(compareBtn);

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

  (async function initSalesMatrices() {
    await loadRawSales();
    await loadMonthlyPlans();
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
      updateManagerStats(manager);
    });
    document.querySelector(`.year-select[data-manager="${manager}"]`).addEventListener('change', () => {
      renderSalesTableForManager(manager);
      updateManagerStats(manager);
    });
  });
  fillMonthYearSelects();
  fillAnalyticsMonthYearSelects();
  fillSalesReportSelectors();
  fillComparePeriodSelectors();

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

  await loadStandChangeLog();

  managers.forEach(m => renderManagerConversions(m));

  renderAnalyticsTable();
  renderAllNewAnalyticsBlocks();
  toggleComparePeriodUI('a');
  toggleComparePeriodUI('b');
  renderComparePeriodTable();

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

  const compareManagerSel = document.getElementById('compare-manager');
  const compareKindSel = document.getElementById('compare-kind');
  const compareAMonthSel = document.getElementById('compare-a-month');
  const compareAQuarterSel = document.getElementById('compare-a-quarter');
  const compareAYearSel = document.getElementById('compare-a-year');
  const compareBMonthSel = document.getElementById('compare-b-month');
  const compareBQuarterSel = document.getElementById('compare-b-quarter');
  const compareBYearSel = document.getElementById('compare-b-year');

  if (compareKindSel) {
    compareKindSel.addEventListener('change', () => {
      toggleComparePeriodUI('a');
      toggleComparePeriodUI('b');
      renderComparePeriodTable();
    });
  }

  [
    compareManagerSel,
    compareAMonthSel, compareAQuarterSel, compareAYearSel,
    compareBMonthSel, compareBQuarterSel, compareBYearSel
  ].forEach(el => {
    if (!el) return;
    el.addEventListener('change', () => {
      renderComparePeriodTable();
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
  const saleOblastSel = document.getElementById('sale-oblast-select');
  if (saleManagerSel && saleShopSel && saleOblastSel) {
    saleManagerSel.addEventListener('change', () => {
      const selectedName = String(saleManagerSel.value || '').trim();
      const id = managerNameToId(selectedName);
      const mid = ['andrii', 'roman', 'pavlo'].includes(id) ? id : null;
      fillOblastSelect(saleOblastSel, mid);
      saleOblastSel.value = '';
      fillShopSelect(saleShopSel, mid, '');
    });

    saleOblastSel.addEventListener('change', () => {
      const selectedName = String(saleManagerSel.value || '').trim();
      const id = managerNameToId(selectedName);
      const mid = ['andrii', 'roman', 'pavlo'].includes(id) ? id : null;
      const ob = String(saleOblastSel.value || '').trim();
      fillShopSelect(saleShopSel, mid, ob);
    });
  }

  const csfMode = document.getElementById('csf-mode');
  const csfManager = document.getElementById('csf-manager');
  const csfShopPick = document.getElementById('csf-shop-pick');
  const csfMoveKind = document.getElementById('csf-move-target-kind');
  const csfMoveBtn = document.getElementById('csf-move-btn');
  const csfDeleteBtn = document.getElementById('csf-delete-btn');

  const syncMoveTargetVisibility = () => {
    const isNew = csfMoveKind && csfMoveKind.value === 'new';
    const ew = document.getElementById('csf-move-target-existing-wrap');
    const nw = document.getElementById('csf-move-target-new-wrap');
    if (ew) ew.style.display = isNew ? 'none' : '';
    if (nw) nw.style.display = isNew ? '' : 'none';
  };

  if (csfMoveKind) csfMoveKind.addEventListener('change', syncMoveTargetVisibility);
  syncMoveTargetVisibility();

  if (csfMode) {
    csfMode.addEventListener('change', async () => {
      syncClientStandModeUi();
      const mid = csfManager?.value || 'andrii';
      if (csfMode.value === 'edit') {
        await ensureClientStandTemplate(mid);
        fillClientStandOblastPick(mid);
        const ob = String(document.getElementById('csf-oblast-pick')?.value ?? '').trim();
        fillClientStandShopPick(mid, '', ob);
        const first = document.getElementById('csf-shop-pick')?.value;
        if (first) loadClientStandEditorFromShop(mid, first);
        else document.getElementById('csf-original-shop').value = '';
      } else {
        const blank = await ensureClientStandTemplate(mid);
        document.getElementById('csf-original-shop').value = '';
        document.getElementById('csf-shop-name').value = '';
        document.getElementById('csf-address').value = '';
        document.getElementById('csf-city').value = '';
        document.getElementById('csf-oblast').value = '';
        document.getElementById('csf-comment').value = '';
        renderClientStandGridFromRow(blank);
      }
    });
  }

  if (csfManager) {
    csfManager.addEventListener('change', async () => {
      const mid = csfManager.value;
      await ensureClientStandTemplate(mid);
      if (csfMode?.value === 'edit') {
        fillClientStandOblastPick(mid);
        const ob = String(document.getElementById('csf-oblast-pick')?.value ?? '').trim();
        fillClientStandShopPick(mid, '', ob);
        const first = document.getElementById('csf-shop-pick')?.value;
        if (first) loadClientStandEditorFromShop(mid, first);
      } else {
        document.getElementById('csf-original-shop').value = '';
        document.getElementById('csf-shop-name').value = '';
        document.getElementById('csf-address').value = '';
        document.getElementById('csf-city').value = '';
        document.getElementById('csf-oblast').value = '';
        document.getElementById('csf-comment').value = '';
        const templateRow = (await ensureClientStandTemplate(mid)) || {};
        renderClientStandGridFromRow(templateRow);
      }
      fillClientStandMoveSelects(mid);
    });
  }

  const csfOblastPick = document.getElementById('csf-oblast-pick');
  if (csfOblastPick) {
    csfOblastPick.addEventListener('change', () => {
      const mid = csfManager?.value || 'andrii';
      const ob = String(csfOblastPick.value || '').trim();
      fillClientStandShopPick(mid, '', ob);
      const first = document.getElementById('csf-shop-pick')?.value;
      if (first) loadClientStandEditorFromShop(mid, first);
      else document.getElementById('csf-original-shop').value = '';
    });
  }

  if (csfShopPick) {
    csfShopPick.addEventListener('change', () => {
      const mid = csfManager?.value || 'andrii';
      loadClientStandEditorFromShop(mid, csfShopPick.value);
    });
  }

  if (csfMoveBtn) csfMoveBtn.addEventListener('click', () => onClientStandMoveClick());
  if (csfDeleteBtn) csfDeleteBtn.addEventListener('click', () => onClientStandDelete());

  applyTabFromUrlOrDefault();
  window.addEventListener('hashchange', () => applyTabFromUrlOrDefault());
}); 
