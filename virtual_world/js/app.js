let worldData = {};
let countriesData = [];

// 初始化載入 JSON 資料
async function initWorld() {
  try {
    const [worldRes, countriesRes] = await Promise.all([
      fetch('data/world.json'),
      fetch('data/countries.json')
    ]);
    worldData = await worldRes.json();
    countriesData = await countriesRes.json();

    renderDashboard();
    renderMap('political');
    renderCountriesGrid(countriesData);
    setupEventListeners();
  } catch (err) {
    console.error("資料載入失敗，請確認是否透過 Local Server (如 Live Server) 開啟網頁：", err);
  }
}

// 渲染世界總覽 Dashboard
function renderDashboard() {
  document.getElementById('world-title').textContent = worldData.worldName;
  document.getElementById('world-year').textContent = `紀元 ${worldData.currentYear} 年`;
  document.getElementById('world-admin').textContent = worldData.administrator;

  const totalPop = countriesData.reduce((sum, c) => sum + c.population, 0);
  const totalGDP = countriesData.reduce((sum, c) => sum + c.gdp, 0);

  document.getElementById('stat-countries').textContent = `${countriesData.length} 國`;
  document.getElementById('stat-pop').textContent = `${(totalPop / 10000).toLocaleString()} 萬`;
  document.getElementById('stat-gdp').textContent = `$${(totalGDP / 1e12).toFixed(2)} 兆`;
  document.getElementById('stat-era').textContent = `${worldData.currentYear} 年`;

  // GDP 排名
  const sortedByGDP = [...countriesData].sort((a, b) => b.gdp - a.gdp);
  document.getElementById('gdp-ranking-list').innerHTML = sortedByGDP.map((c, idx) => `
    <div class="ranking-item">
      <span>#${idx + 1} ${c.flag} <strong>${c.name}</strong></span>
      <span>$${(c.gdp / 1e8).toLocaleString()} 億</span>
    </div>
  `).join('');

  // 時間線
  const timelineHTML = worldData.timeline.map(item => `
    <li><span class="timeline-year">${item.year}</span>${item.event}</li>
  `).join('');
  document.getElementById('dashboard-timeline').innerHTML = timelineHTML;
  document.getElementById('full-timeline').innerHTML = timelineHTML;
}

// 渲染互動地圖與圖層切換
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

// 渲染國家百科卡片
function renderCountriesGrid(list) {
  const grid = document.getElementById('countries-grid');
  grid.innerHTML = list.map(c => `
    <div class="country-card" onclick="openCountryWiki('${c.id}')">
      <h3>${c.flag} ${c.name} <small style="color:var(--text-muted)">(${c.code})</small></h3>
      <p style="margin: 10px 0; color: var(--text-muted); font-size: 0.9rem;">${c.description}</p>
      <div>${c.tags.map(t => `<span class="tag">#${t}</span>`).join('')}</div>
    </div>
  `).join('');
}

// 開啟國家 Wiki 抽屜
function openCountryWiki(countryId) {
  const c = countriesData.find(item => item.id === countryId);
  if (!c) return;

  document.getElementById('drawer-body').innerHTML = `
    <h2 style="font-size: 1.8rem;">${c.flag} ${c.name}</h2>
    <p style="color: var(--accent); margin-bottom: 16px;">${c.officialName}</p>
    <p style="line-height: 1.6; margin-bottom: 20px;">${c.description}</p>
    <table class="wiki-table">
      <tr><td>國家代碼</td><td>${c.code}</td></tr>
      <tr><td>首都</td><td>${c.capital}</td></tr>
      <tr><td>政體</td><td>${c.government}</td></tr>
      <tr><td>領導人 / 管理員</td><td>${c.leader}</td></tr>
      <tr><td>總人口</td><td>${c.population.toLocaleString()} 人</td></tr>
      <tr><td>國內生產毛額 (GDP)</td><td>$${c.gdp.toLocaleString()}</td></tr>
      <tr><td>貨幣</td><td>${c.currency}</td></tr>
      <tr><td>官方語言</td><td>${c.language}</td></tr>
      <tr><td>宗教信仰</td><td>${c.religion}</td></tr>
      <tr><td>主要城市</td><td>${c.cities.join('、')}</td></tr>
    </table>
    <div>${c.tags.map(t => `<span class="tag">#${t}</span>`).join('')}</div>
  `;
  document.getElementById('country-drawer').classList.remove('hidden');
}

// 事件監聽器設定
function setupEventListeners() {
  // 側邊欄分頁切換
  document.querySelectorAll('.nav-btn:not(.disabled)').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`view-${btn.dataset.view}`).classList.add('active');
    });
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
      c.capital.toLowerCase().includes(kw) ||
      c.language.toLowerCase().includes(kw) ||
      c.tags.some(t => t.toLowerCase().includes(kw))
    );
    renderCountriesGrid(filtered);
    // 自動切換到國家列表顯示搜尋結果
    document.querySelector('[data-view="countries"]').click();
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
}

initWorld();