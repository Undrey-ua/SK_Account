// === Глобальна змінна для сирих продажів ===
let rawSalesData = [];

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

function closeAddSaleForm() {
  const modal = document.getElementById('addSaleModal');
  if (modal) {
    modal.style.display = 'none';
    // Очистити форму
    document.getElementById('addSaleForm').reset();
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
  const saleData = {
    'Торгова точка': formData.get('shop'),
    'Стенд': formData.get('stand'),
    'Кількість': formData.get('quantity'),
    'Дата': formData.get('date'),
    'Коментар': formData.get('comment'),
    'Менеджер': formData.get('manager')
  };

  try {
    // ВАШ Apps Script endpoint
    const API_URL = 'https://script.google.com/macros/s/AKfycbyD_dJbcm96wvVONAIPsECRba6dqtK4nPVBjaApc5knf8WsrO05d4buEZfZKuTgnBAL/exec?sheet=Продажі';

    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify(saleData),
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const result = await res.json();
    if (result.result === 'success') {
      closeAddSaleForm();
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
      showNotification('Продаж успішно додано!', 'success');
    } else {
      throw new Error('Не вдалося додати продаж');
    }
  } catch (error) {
    console.error('Помилка при додаванні продажу:', error);
    showNotification('Помилка при додаванні продажу', 'error');
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
    if (row['Назва ТТ']) shops.add(row['Назва ТТ']);
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
    const API_URL = 'https://script.google.com/macros/s/AKfycbwI3cOLFrcmESn0ajoEuSMtHP3HOj1yGSsr3WxNUDq0fzduJYCBL3odEVRC1ki0co0h/exec';
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
  return `<div class="table-scroll sales-matrix">${html}</div>`;
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
  // Показати потрібну вкладку, якщо вона існує
  const tabDiv = document.getElementById(tabName);
  if (tabDiv) tabDiv.classList.add('active');
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
    btn.textContent = `👨‍💼 ${manager['Імʼя']} (${manager['Регіон']})`;
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
  analyticsBtn.textContent = '📊 Порівняльна аналітика';
  analyticsBtn.onclick = () => showTab('analytics');
  tabsContainer.appendChild(analyticsBtn);

  const plansBtn = document.createElement('button');
  plansBtn.className = 'tab-btn';
  plansBtn.textContent = '🎯 Цілі та плани';
  plansBtn.onclick = () => showTab('plans');
  tabsContainer.appendChild(plansBtn);
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

  document.getElementById('analytics-month').addEventListener('change', renderAnalyticsTable);
  document.getElementById('analytics-year').addEventListener('change', renderAnalyticsTable);

  window.standsMatrixData = {};
  ['andrii', 'roman', 'pavlo'].forEach(async manager => {
    window.standsMatrixData[manager] = await loadStandsMatrix(manager);
  });
  renderAnalyticsTable();
}); 