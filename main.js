// === Глобальна змінна для сирих продажів ===
let rawSalesData = [];

async function fetchSheet(sheet) {
    const API_URL = 'https://script.google.com/macros/s/AKfycbyD_dJbcm96wvVONAIPsECRba6dqtK4nPVBjaApc5knf8WsrO05d4buEZfZKuTgnBAL/exec';
    const url = `${API_URL}?sheet=${encodeURIComponent(sheet)}`;
    const res = await fetch(url);
    return await res.json();
}

async function loadRawSales() {
  rawSalesData = await fetchSheet('Продажі');
  console.log('rawSalesData:', rawSalesData);
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
  return `<div class="table-scroll">${html}</div>`;
}

function renderSalesMatrixForManager(manager) {
  const monthSel = document.querySelector(`.month-select[data-manager="${manager}"]`);
  const yearSel = document.querySelector(`.year-select[data-manager="${manager}"]`);
  const month = monthSel ? Number(monthSel.value) : (new Date().getMonth() + 1);
  const year = yearSel ? Number(yearSel.value) : (new Date().getFullYear());
  document.getElementById(`${manager}-sales-matrix`).innerHTML = buildSalesMatrix(manager, month, year);
}

function showTab(tabName) {
  // Сховати всі вкладки
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  document.getElementById(tabName).classList.add('active');
  // Зняти активний клас з усіх кнопок
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  // Додати активний клас до поточної кнопки
  const btn = document.querySelector(`.tab-btn[onclick*="showTab('${tabName}'"]`);
  if (btn) btn.classList.add('active');
  if (tabName === 'andrii') renderSalesTableForManager('andrii');
  if (tabName === 'roman') renderSalesTableForManager('roman');
  if (tabName === 'pavlo') renderSalesTableForManager('pavlo');
  if (tabName === 'andrii') updateManagerStats('andrii');
  if (tabName === 'roman') updateManagerStats('roman');
  if (tabName === 'pavlo') updateManagerStats('pavlo');
  if (tabName === 'analytics') renderAnalyticsTable();
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
  const mainCols = ['Назва ТТ', 'Адреса'];
  const standTypes = headers.filter(h => !mainCols.includes(h));
  let html = '<table class="data-table"><thead><tr>';
  mainCols.forEach(col => html += `<th>${col}</th>`);
  standTypes.forEach(type => html += `<th>${type}</th>`);
  html += '</tr></thead><tbody>';
  data.forEach(row => {
    html += '<tr>';
    mainCols.forEach(col => {
      if (col === 'Адреса') {
        html += `<td class="address-cell">${row[col] || ''}</td>`;
      } else {
        html += `<td>${row[col] || ''}</td>`;
      }
    });
    standTypes.forEach(type => {
      html += `<td>${row[type] || ''}</td>`;
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
    const data = window.standsMatrixData[manager];
    uniqueShopsCount = new Set(data.map(row => row['Назва ТТ'])).size;
  }
  const avgSales = uniqueShopsCount ? (totalSales / uniqueShopsCount) : 0;

  document.getElementById(`${manager}-sales`).textContent = totalSales.toFixed(2);
  document.getElementById(`${manager}-avg`).textContent = avgSales.toFixed(2);
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
      const data = window.standsMatrixData[manager];
      // Якщо у вас у матриці стендів є колонка "Назва ТТ"
      uniqueShopsCount = new Set(data.map(row => row['Назва ТТ'])).size;
    }
    // Кількість стендів (по матриці стендів)
    // Для цього треба отримати дані з обліку стендів для кожного менеджера
    // Припустимо, ви вже зберігаєте їх у standsMatrixData[manager]
    let standsCount = 0;
    if (window.standsMatrixData && window.standsMatrixData[manager]) {
      // Підрахунок всіх стендів (сума по всіх клітинках, крім Назва ТТ і Адреса)
      const data = window.standsMatrixData[manager];
      const headers = Object.keys(data[0] || {});
      const standTypes = headers.filter(h => !['Назва ТТ', 'Адреса'].includes(h));
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

document.addEventListener('DOMContentLoaded', function() {
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
    renderSalesMatrixForManager('andrii');
    renderSalesMatrixForManager('roman');
    renderSalesMatrixForManager('pavlo');
    ['andrii', 'roman', 'pavlo'].forEach(manager => {
      renderSalesTableForManager(manager);
      updateManagerStats(manager);
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

  document.getElementById('analytics-month').addEventListener('change', renderAnalyticsTable);
  document.getElementById('analytics-year').addEventListener('change', renderAnalyticsTable);

  window.standsMatrixData = {};
  ['andrii', 'roman', 'pavlo'].forEach(async manager => {
    window.standsMatrixData[manager] = await loadStandsMatrix(manager);
  });
  renderAnalyticsTable();
}); 