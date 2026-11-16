let worldData = {};
let countriesData = [];
let eventsData = [];
let currentDrawerCountryId = null;

const STORAGE_KEYS = {
  COUNTRIES: 'vw_countries_data_v1',
  EVENTS: 'vw_events_data_v1'
};

// 初始化載入資料（優先讀取玩家本地修改，若無則讀取 GitHub JSON）
async function initWorld() {
  try {
    const [worldRes, countriesRes, eventsRes] = await Promise.all([
      fetch('data/world.json'),
      fetch('data/countries.json'),
      fetch('data/events.json').catch(() => ({ json: async () => [] }))
    ]);

    worldData = await worldRes.json();
    const remoteCountries = await countriesRes.json();
    const remoteEvents = await eventsRes.json();

    const savedCountries = localStorage.getItem(STORAGE_KEYS.COUNTRIES);
    const savedEvents = localStorage.getItem(STORAGE_KEYS.EVENTS);

    countriesData = savedCountries ? JSON.parse(savedCountries) : remoteCountries;
    eventsData = savedEvents ? JSON.parse(savedEvents) : remoteEvents;

    refreshAllViews();
    setupEventListeners();
  } catch (err) {
    console.error("資料載入失敗：", err);
  }
}

// 儲存到瀏覽器並重新渲染所有畫面
function saveAndRefresh() {
  localStorage.setItem(STORAGE_KEYS.COUNTRIES, JSON.stringify(countriesData));
  localStorage.setItem(STORAGE_KEYS.EVENTS, JSON.stringify(eventsData));
  refreshAllViews();
}

function refreshAllViews() {
  renderDashboard();
  renderEventsFeed('ALL');
  renderMap('political');
  renderCountriesGrid(countriesData);
  populateEditSelector();
  updateJsonExportBoxes();
}

// 切換分頁輔助函式
function switchView(viewName) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const targetBtn = document.querySelector(`.nav-btn[data-view="${viewName}"]`);
  if (targetBtn) targetBtn.classList.add('active');
  document.getElementById(`view-${viewName}`).classList.add('active');
}

// 渲染世界總覽 Dashboard 與頂部跑馬燈
function renderDashboard() {
  document.getElementById('world-title').textContent = worldData.worldName;
  document.getElementById('world-year').textContent = `紀元 ${worldData.currentYear} 年`;
  document.getElementById('world-admin').textContent = worldData.administrator;

  const totalPop = countriesData.reduce((sum, c) => sum + Number(c.population), 0);
  const totalGDP = countriesData.reduce((sum, c) => sum + Number(c.gdp), 0);

  document.getElementById('stat-countries').textContent = `${countriesData.length} 國`;
  document.getElementById('stat-pop').textContent = `${(totalPop / 10000).toLocaleString()} 萬`;
  document.getElementById('stat-gdp').textContent = `$${(totalGDP / 1e12).toFixed(2)} 兆`;
  document.getElementById('stat-events').textContent = `${eventsData.length} 則`;

  // 頂部最新地理通播橫幅
  if (eventsData.length > 0) {
    const latest = eventsData[0];
    document.getElementById('banner-event-text').innerHTML =
      `<strong>[${latest.type}] ${latest.region}：</strong>${latest.title}`;
  }

  // GDP 排名
  const sortedByGDP = [...countriesData].sort((a, b) => b.gdp - a.gdp);
  document.getElementById('gdp-ranking-list').innerHTML = sortedByGDP.map((c, idx) => `
    <div class="ranking-item">
      <span>#${idx + 1} ${c.flag} <strong>${c.name}</strong></span>
      <span>$${(c.gdp / 1e8).toLocaleString()} 億</span>
    </div>
  `).join('');

  // Dashboard 最新 3 則事件
  document.getElementById('dashboard-events-list').innerHTML = eventsData.slice(0, 3).map(ev => `
    <div class="event-card sev-${ev.severity}" style="margin-bottom: 10px; padding: 12px;">
      <div class="event-meta">
        <span class="event-tag">${ev.type}</span>
        <span>${ev.year}年 · ${ev.region}</span>
      </div>
      <h4>${ev.title}</h4>
    </div>
  `).join('');

  // 世界歷史時間線
  if (worldData.timeline) {
    document.getElementById('full-timeline').innerHTML = worldData.timeline.map(item => `
      <li><span class="timeline-year">${item.year}</span>${item.event}</li>
    `).join('');
  }
}

// 渲染地理事件通播牆
function renderEventsFeed(filterType) {
  const list = filterType === 'ALL'
    ? eventsData
    : eventsData.filter(e => e.type === filterType);

  document.getElementById('events-feed-list').innerHTML = list.map(ev => `
    <div class="event-card sev-${ev.severity}">
      <div class="event-meta">
        <span class="event-tag">${ev.type}</span>
        <span class="event-tag">${ev.severity}</span>
        <span>📅 ${ev.year} 年</span>
        <span>📍 ${ev.region}</span>
      </div>
      <h4>${ev.title}</h4>
      <p>${ev.content}</p>
    </div>
  `).join('');
}

// 渲染互動地圖
function renderMap(layer) {
  const container = document.getElementById('map-pins-container');
  container.innerHTML = countriesData.map(c => {
    let badgeText = `${c.flag} ${c.name}`;
    if (layer === 'population') badgeText = `${c.flag} ${c.name} (${(c.population / 10000).toFixed(0)}萬人)`;
    if (layer === 'economy') badgeText = `${c.flag} ${c.name} ($${(c.gdp / 1e8).toFixed(0)}億)`;

    return `
      <div class="map-pin" style="left: ${c.mapCoords.x}%; top: ${c.mapCoords.y}%;" onclick="openCountryWiki('${c.id}')">
        ${badgeText}
      </div>
    `;
  }).join('');
}

// 渲染國家百科卡片（附帶直接編輯按鈕）
function renderCountriesGrid(list) {
  const grid = document.getElementById('countries-grid');
  grid.innerHTML = list.map(c => `
    <div class="country-card">
      <div onclick="openCountryWiki('${c.id}')" style="cursor:pointer;">
        <h3>${c.flag} ${c.name} <small style="color:var(--text-muted)">(${c.code})</small></h3>
        <p style="margin: 6px 0; font-size: 0.82rem; color: var(--accent);">👤 管理員：${c.leader}</p>
        <p style="margin: 10px 0; color: var(--text-muted); font-size: 0.9rem;">${c.description}</p>
        <div>${c.tags.map(t => `<span class="tag">#${t}</span>`).join('')}</div>
      </div>
      <div class="card-actions">
        <button class="btn-secondary" style="flex:1;" onclick="openCountryWiki('${c.id}')">📖 查看 Wiki</button>
        <button class="btn-secondary" style="flex:1;" onclick="editCountry('${c.id}')">✏️ 編輯國家</button>
      </div>
    </div>
  `).join('');
}

// 開啟國家 Wiki 抽屜
function openCountryWiki(countryId) {
  const c = countriesData.find(item => item.id === countryId);
  if (!c) return;
  currentDrawerCountryId = countryId;

  document.getElementById('drawer-body').innerHTML = `
    <h2 style="font-size: 1.8rem;">${c.flag} ${c.name}</h2>
    <p style="color: var(--accent); margin-bottom: 16px;">${c.officialName}</p>
    <p style="line-height: 1.6; margin-bottom: 20px;">${c.description}</p>
    <table class="wiki-table">
      <tr><td>國家代碼</td><td>${c.code}</td></tr>
      <tr><td>首都</td><td>${c.capital}</td></tr>
      <tr><td>政體</td><td>${c.government}</td></tr>
      <tr><td>領導人 / 玩家管理員</td><td>${c.leader}</td></tr>
      <tr><td>總人口</td><td>${Number(c.population).toLocaleString()} 人</td></tr>
      <tr><td>國內生產毛額 (GDP)</td><td>$${Number(c.gdp).toLocaleString()}</td></tr>
      <tr><td>貨幣</td><td>${c.currency}</td></tr>
      <tr><td>官方語言</td><td>${c.language}</td></tr>
      <tr><td>宗教信仰</td><td>${c.religion}</td></tr>
      <tr><td>主要城市</td><td>${c.cities.join('、')}</td></tr>
    </table>
    <div>${c.tags.map(t => `<span class="tag">#${t}</span>`).join('')}</div>
  `;
  document.getElementById('country-drawer').classList.remove('hidden');
}

// 填充「快速選擇國家編輯」下拉選單
function populateEditSelector() {
  const selector = document.getElementById('edit-country-selector');
  selector.innerHTML = `<option value="NEW">➕ 建立全新國家...</option>` +
    countriesData.map(c => `<option value="${c.id}">✏️ 編輯：${c.flag} ${c.name} (${c.leader})</option>`).join('');
}

// 切換到「創建新國家」模式
function openBuilderForNew() {
  document.getElementById('country-builder-form').reset();
  document.getElementById('b-id').value = '';
  document.getElementById('b-x').value = 50;
  document.getElementById('b-y').value = 30;
  document.getElementById('builder-pin').style.left = '50%';
  document.getElementById('builder-pin').style.top = '30%';
  document.getElementById('builder-mode-title').textContent = '🏴 創建新國家';
  document.getElementById('builder-submit-btn').textContent = '✨ 創建並發布新國家';
  document.getElementById('delete-country-btn').classList.add('hidden');
  document.getElementById('edit-country-selector').value = 'NEW';
  switchView('builder');
}

// 載入指定國家資料進入編輯表單
function editCountry(countryId) {
  const c = countriesData.find(item => item.id === countryId);
  if (!c) return;

  document.getElementById('country-drawer').classList.add('hidden');
  document.getElementById('b-id').value = c.id;
  document.getElementById('b-name').value = c.name;
  document.getElementById('b-official').value = c.officialName;
  document.getElementById('b-code').value = c.code;
  document.getElementById('b-flag').value = c.flag;
  document.getElementById('b-capital').value = c.capital;
  document.getElementById('b-gov').value = c.government;
  document.getElementById('b-leader').value = c.leader;
  document.getElementById('b-pop').value = c.population;
  document.getElementById('b-gdp').value = c.gdp;
  document.getElementById('b-currency').value = c.currency;
  document.getElementById('b-lang').value = c.language;
  document.getElementById('b-religion').value = c.religion;
  document.getElementById('b-cities').value = c.cities.join('、');
  document.getElementById('b-tags').value = c.tags.join(', ');
  document.getElementById('b-x').value = c.mapCoords.x;
  document.getElementById('b-y').value = c.mapCoords.y;
  document.getElementById('b-desc').value = c.description;

  document.getElementById('builder-pin').style.left = `${c.mapCoords.x}%`;
  document.getElementById('builder-pin').style.top = `${c.mapCoords.y}%`;
  document.getElementById('builder-mode-title').textContent = `✏️ 編輯國家：${c.flag} ${c.name}`;
  document.getElementById('builder-submit-btn').textContent = '💾 儲存國家修改';
  document.getElementById('delete-country-btn').classList.remove('hidden');
  document.getElementById('edit-country-selector').value = c.id;

  switchView('builder');
}

// 更新右側 JSON 匯出框
function updateJsonExportBoxes() {
  document.getElementById('json-output-box').textContent = JSON.stringify(countriesData, null, 2);
  document.getElementById('events-json-box').textContent = JSON.stringify(eventsData, null, 2);
}

// 事件監聽器設定
function setupEventListeners() {
  // 側邊欄分頁切換
  document.querySelectorAll('.nav-btn:not(.disabled)').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.view === 'builder') openBuilderForNew();
      else switchView(btn.dataset.view);
    });
  });

  // 抽屜裡的編輯按鈕
  document.getElementById('drawer-edit-btn').addEventListener('click', () => {
    if (currentDrawerCountryId) editCountry(currentDrawerCountryId);
  });

  // 下拉選單切換編輯對象
  document.getElementById('edit-country-selector').addEventListener('change', (e) => {
    if (e.target.value === 'NEW') openBuilderForNew();
    else editCountry(e.target.value);
  });

  // 刪除國家按鈕
  document.getElementById('delete-country-btn').addEventListener('click', () => {
    const id = document.getElementById('b-id').value;
    const target = countriesData.find(c => c.id === id);
    if (!target) return;
    if (confirm(`確定要刪除「${target.flag} ${target.name}」嗎？`)) {
      countriesData = countriesData.filter(c => c.id !== id);
      saveAndRefresh();
      openBuilderForNew();
      alert('🗑️ 該國家已刪除！');
    }
  });

  // 地圖圖層切換
  document.querySelectorAll('.layer-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderMap(btn.dataset.layer);
    });
  });

  // 搜尋功能
  document.getElementById('search-input').addEventListener('input', (e) => {
    const kw = e.target.value.toLowerCase();
    const filtered = countriesData.filter(c =>
      c.name.toLowerCase().includes(kw) ||
      c.leader.toLowerCase().includes(kw) ||
      c.capital.toLowerCase().includes(kw) ||
      c.tags.some(t => t.toLowerCase().includes(kw))
    );
    renderCountriesGrid(filtered);
    switchView('countries');
  });

  // 隨機探索國家
  document.getElementById('random-country-btn').addEventListener('click', () => {
    const random = countriesData[Math.floor(Math.random() * countriesData.length)];
    openCountryWiki(random.id);
  });

  // 關閉抽屜
  document.getElementById('close-drawer').addEventListener('click', () => {
    document.getElementById('country-drawer').classList.add('hidden');
  });

  // 迷你地圖點擊定位
  const miniMap = document.getElementById('builder-mini-map');
  const miniPin = document.getElementById('builder-pin');
  const inputX = document.getElementById('b-x');
  const inputY = document.getElementById('b-y');

  miniMap.addEventListener('click', (e) => {
    const rect = miniMap.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 100);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 100);
    inputX.value = x;
    inputY.value = y;
    miniPin.style.left = `${x}%`;
    miniPin.style.top = `${y}%`;
  });

  // 提交國家創建 / 編輯表單
  document.getElementById('country-builder-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const existingId = document.getElementById('b-id').value;
    const code = document.getElementById('b-code').value.trim().toUpperCase();
    const name = document.getElementById('b-name').value.trim();
    const flag = document.getElementById('b-flag').value.trim();
    const leader = document.getElementById('b-leader').value.trim();

    const countryObj = {
      id: existingId || `${code.toLowerCase()}-${Date.now().toString().slice(-4)}`,
      name,
      officialName: document.getElementById('b-official').value.trim(),
      code,
      flag,
      capital: document.getElementById('b-capital').value.trim(),
      government: document.getElementById('b-gov').value.trim(),
      leader,
      population: Number(document.getElementById('b-pop').value),
      gdp: Number(document.getElementById('b-gdp').value),
      currency: document.getElementById('b-currency').value.trim(),
      language: document.getElementById('b-lang').value.trim(),
      religion: document.getElementById('b-religion').value.trim(),
      tags: document.getElementById('b-tags').value.split(',').map(t => t.trim()).filter(Boolean),
      mapCoords: { x: Number(inputX.value), y: Number(inputY.value) },
      description: document.getElementById('b-desc').value.trim(),
      cities: document.getElementById('b-cities').value.split('、').map(c => c.trim()).filter(Boolean)
    };

    if (existingId) {
      const idx = countriesData.findIndex(c => c.id === existingId);
      if (idx !== -1) countriesData[idx] = countryObj;
      // 自動發一則國家動態通播
      eventsData.unshift({
        id: `evt-${Date.now()}`,
        year: worldData.currentYear || 2028,
        type: '國家動態',
        severity: '一般',
        region: `${flag} ${name}`,
        title: `${name} 更新了國家官方檔案`,
        content: `國家管理員 ${leader} 修訂了「${countryObj.officialName}」的國政與地理資料。`
      });
      alert(`✅ 「${flag} ${name}」資料已更新！`);
    } else {
      countriesData.push(countryObj);
      // 新國家成立自動登上地理事件通播
      eventsData.unshift({
        id: `evt-${Date.now()}`,
        year: worldData.currentYear || 2028,
        type: '國家動態',
        severity: '重大',
        region: `${flag} ${name} (首都：${countryObj.capital})`,
        title: `新主權國家「${countryObj.officialName}」正式成立！`,
        content: `由 ${leader} 領導的「${flag} ${name}」宣布建國，定都 ${countryObj.capital}，政體為${countryObj.government}。`
      });
      alert(`🎉 新國家「${flag} ${name}」已創建並自動發布建國通播！`);
    }

    saveAndRefresh();
    editCountry(countryObj.id);
  });

  // 提交地理事件通播表單
  document.getElementById('event-publish-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const newEvent = {
      id: `evt-${Date.now()}`,
      year: Number(document.getElementById('e-year').value),
      type: document.getElementById('e-type').value,
      severity: document.getElementById('e-severity').value,
      region: document.getElementById('e-region').value.trim(),
      title: document.getElementById('e-title').value.trim(),
      content: document.getElementById('e-content').value.trim()
    };

    eventsData.unshift(newEvent);
    saveAndRefresh();
    document.getElementById('event-publish-form').reset();
    document.getElementById('e-year').value = worldData.currentYear || 2028;
    alert('📡 地理事件已發布至全網通播牆與頂部跑馬燈！');
  });

  // 事件類型篩選
  document.getElementById('event-filter-type').addEventListener('change', (e) => {
    renderEventsFeed(e.target.value);
  });

  // 複製 JSON 按鈕
  document.getElementById('copy-json-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('json-output-box').textContent);
    alert('✅ 完整 countries.json 已複製！貼入 GitHub 覆蓋原檔即可全體同步。');
  });

  document.getElementById('copy-events-json-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('events-json-box').textContent);
    alert('✅ 完整 events.json 已複製！貼入 GitHub 覆蓋原檔即可全體同步。');
  });

  // 重置本地快取按鈕
  document.getElementById('reset-local-btn').addEventListener('click', () => {
    if (confirm('確定要清除你瀏覽器的本地修改，重新載入 GitHub 上的最新官方資料嗎？')) {
      localStorage.removeItem(STORAGE_KEYS.COUNTRIES);
      localStorage.removeItem(STORAGE_KEYS.EVENTS);
      location.reload();
    }
  });
}

initWorld();
