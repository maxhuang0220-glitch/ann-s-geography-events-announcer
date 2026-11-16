let worldData = {};
let countriesData = [];
let eventsData = [];
let transportData = [];
let diplomacyData = { relations: [], organizations: [] };

// 帳號與權限狀態
let currentUser = null; // { username, role: 'ADMIN' | 'PLAYER' }
let registeredPlayers = []; // [{ username, password, banned: false }]

// Flow Time 與地圖繪圖狀態（現實 30 分鐘 = 1,800,000 毫秒 = 虛擬 1 天）
const MS_PER_SIM_DAY = 30 * 60 * 1000;
let simDate = { year: 2028, month: 1, day: 1, dayProgress: 0 };
let flowSpeed = 1;
let flowTimer = null;
let lastTickTime = Date.now();
let currentMapLayer = 'political';
let isDrawMode = false;
let tempPolygonPoints = [];
let currentDrawerCountryId = null;

const KEYS = {
  COUNTRIES: 'vw_v2_countries',
  EVENTS: 'vw_v2_events',
  TRANSPORT: 'vw_v2_transport',
  DIPLOMACY: 'vw_v2_diplomacy',
  PLAYERS: 'vw_v2_players',
  SESSION: 'vw_v2_session',
  DATE: 'vw_v2_date'
};

// 初始化系統
async function initWorld() {
  try {
    const [wRes, cRes, eRes, tRes, dRes] = await Promise.all([
      fetch('data/world.json'),
      fetch('data/countries.json'),
      fetch('data/events.json').catch(() => ({ json: async () => [] })),
      fetch('data/transport.json').catch(() => ({ json: async () => [] })),
      fetch('data/diplomacy.json').catch(() => ({ json: async () => ({ relations: [], organizations: [] }) }))
    ]);

    worldData = await wRes.json();
    const defCountries = await cRes.json();
    const defEvents = await eRes.json();
    const defTransport = await tRes.json();
    const defDiplomacy = await dRes.json();

    countriesData = JSON.parse(localStorage.getItem(KEYS.COUNTRIES)) || defCountries;
    eventsData = JSON.parse(localStorage.getItem(KEYS.EVENTS)) || defEvents;
    transportData = JSON.parse(localStorage.getItem(KEYS.TRANSPORT)) || defTransport;
    diplomacyData = JSON.parse(localStorage.getItem(KEYS.DIPLOMACY)) || defDiplomacy;
    registeredPlayers = JSON.parse(localStorage.getItem(KEYS.PLAYERS)) || [
      { username: 'Captain Huang', password: '123', banned: false },
      { username: 'Elena', password: '123', banned: false }
    ];
    currentUser = JSON.parse(localStorage.getItem(KEYS.SESSION)) || null;
    simDate = JSON.parse(localStorage.getItem(KEYS.DATE)) || worldData.currentDate;

    updateUserUI();
    refreshAllViews();
    setupEventListeners();
    startFlowTimeLoop();
  } catch (err) {
    console.error("初始化失敗：", err);
  }
}

function saveAll() {
  localStorage.setItem(KEYS.COUNTRIES, JSON.stringify(countriesData));
  localStorage.setItem(KEYS.EVENTS, JSON.stringify(eventsData));
  localStorage.setItem(KEYS.TRANSPORT, JSON.stringify(transportData));
  localStorage.setItem(KEYS.DIPLOMACY, JSON.stringify(diplomacyData));
  localStorage.setItem(KEYS.PLAYERS, JSON.stringify(registeredPlayers));
  localStorage.setItem(KEYS.DATE, JSON.stringify(simDate));
  refreshAllViews();
}

function refreshAllViews() {
  renderDashboard();
  renderEventsFeed(document.getElementById('event-filter-type').value || 'ALL');
  renderMap();
  renderCountriesGrid(countriesData);
  renderTransport();
  renderDiplomacy();
  populateCountryDropdowns();
  renderAdminPanel();
  document.getElementById('json-output-box').textContent = JSON.stringify(countriesData, null, 2);
}

function switchView(viewName) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const btn = document.querySelector(`.nav-btn[data-view="${viewName}"]`);
  if (btn) btn.classList.add('active');
  document.getElementById(`view-${viewName}`).classList.add('active');
}

// ==========================================
// 1. 自動 Flow Time 與自動地理通播 / 世界新聞引擎
// ==========================================
function startFlowTimeLoop() {
  if (flowTimer) clearInterval(flowTimer);
  lastTickTime = Date.now();

  flowTimer = setInterval(() => {
    const now = Date.now();
    const deltaMs = now - lastTickTime;
    lastTickTime = now;

    if (flowSpeed === 0) return;

    simDate.dayProgress = (simDate.dayProgress || 0) + (deltaMs * flowSpeed) / MS_PER_SIM_DAY;

    let dayChanged = false;
    while (simDate.dayProgress >= 1) {
      simDate.dayProgress -= 1;
      simDate.day += 1;
      dayChanged = true;

      while (simDate.day > 30) {
        simDate.day -= 30;
        simDate.month += 1;
        onNewMonthTick();
      }
      while (simDate.month > 12) {
        simDate.month -= 12;
        simDate.year += 1;
        onNewYearTick();
      }
    }

    updateClockUI();
    if (dayChanged) {
      localStorage.setItem(KEYS.DATE, JSON.stringify(simDate));
    }
  }, 1000);
}

function updateClockUI() {
  const m = String(simDate.month).padStart(2, '0');
  const d = String(simDate.day).padStart(2, '0');
  const pct = Math.floor((simDate.dayProgress || 0) * 100);
  document.getElementById('world-clock-display').textContent = `${simDate.year}年 ${m}月 ${d}日 (${pct}%)`;
}

function updateClockUI() {
  const m = String(simDate.month).padStart(2, '0');
  const d = String(simDate.day).padStart(2, '0');
  document.getElementById('world-clock-display').textContent = `${simDate.year}年 ${m}月 ${d}日`;
}

// 每過一個虛擬月，機率觸發自動地理災害或自動世界新聞
function onNewMonthTick() {
  if (Math.random() < 0.45) {
    generateAutoDisasterOrNews();
  }
}

// 每過一個虛擬年，世界人口與 GDP 自然微幅成長
function onNewYearTick() {
  countriesData.forEach(c => {
    c.population = Math.round(Number(c.population) * 1.012);
    c.gdp = Math.round(Number(c.gdp) * 1.025);
  });
  saveAll();
}

// 自動地理通播（颱風等基礎事件）+ 自動世界新聞生成器
function generateAutoDisasterOrNews() {
  if (countriesData.length === 0) return;
  const targetCountry = countriesData[Math.floor(Math.random() * countriesData.length)];
  const lat = targetCountry.coords?.lat ?? 10;
  const lon = targetCountry.coords?.lon ?? 20;
  const coordStr = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;

  const isDisaster = Math.random() < 0.5;
  if (isDisaster) {
    const disasters = [
      { type: '自然災害', sev: '緊急', title: `強烈颱風逼近${targetCountry.name}沿海`, content: `氣象衛星在 (${coordStr}) 觀測到熱帶氣旋增強為強烈颱風，預計影響${targetCountry.capital}周邊港口與航線。` },
      { type: '地理變動', sev: '重大', title: `${targetCountry.name}境內發生規模 6.4 地震`, content: `震央位於 (${coordStr}) 深度 18 公里處，${targetCountry.name}地質局已發布餘震警戒。` },
      { type: '自然災害', sev: '一般', title: `${targetCountry.name}迎來季節性季風豪雨`, content: `受低壓帶影響，${targetCountry.capital}及周邊農產區降下豐沛雨量，水庫蓄水量大幅回升。` }
    ];
    const pick = disasters[Math.floor(Math.random() * disasters.length)];
    eventsData.unshift({
      id: `auto-${Date.now()}`,
      year: simDate.year,
      dateStr: `${simDate.year}/${simDate.month}/${simDate.day}`,
      type: pick.type,
      severity: pick.sev,
      region: `${targetCountry.flag} ${targetCountry.name} (${coordStr})`,
      title: `[自動地理通播] ${pick.title}`,
      content: pick.content
    });
  } else {
    // 自動世界新聞（結合國家數據與近期事件）
    const latestGeo = eventsData.find(e => e.type === '自然災害' || e.type === '地理變動');
    const newsTemplates = [
      {
        title: `${targetCountry.name}公布年度經濟報告，GDP 突破 $${(targetCountry.gdp / 1e8).toFixed(0)} 億`,
        content: `【世界財經新聞】由 ${targetCountry.leader} 領導的${targetCountry.officialName}今日在首都${targetCountry.capital}發表經濟白皮書，展現強勁成長動能。`
      },
      {
        title: `各國關注${targetCountry.name}科技與城市現代化進展`,
        content: `【國際觀察新聞】隨著人口達到 ${(targetCountry.population / 10000).toFixed(0)} 萬人，${targetCountry.name}宣布擴大對外交通與文化交流。`
      }
    ];
    if (latestGeo) {
      newsTemplates.push({
        title: `國際救援組織針對「${latestGeo.title.replace('[自動地理通播] ', '')}」召開緊急會議`,
        content: `【世界頭條新聞】因應近期發生的地理事件（${latestGeo.region}），${targetCountry.name}與多國代表正在協調防災物資與航線改道方案。`
      });
    }
    const newsPick = newsTemplates[Math.floor(Math.random() * newsTemplates.length)];
    eventsData.unshift({
      id: `news-${Date.now()}`,
      year: simDate.year,
      dateStr: `${simDate.year}/${simDate.month}/${simDate.day}`,
      type: '新聞',
      severity: '一般',
      region: `${targetCountry.flag} ${targetCountry.name}`,
      title: `📰 ${newsPick.title}`,
      content: newsPick.content
    });
  }

  if (eventsData.length > 50) eventsData.pop();
  saveAll();
}

// ==========================================
// 2. 帳號與權限控制（系統綁定管理員 vs 玩家）
// ==========================================
function isAdmin() {
  return currentUser && currentUser.role === 'ADMIN';
}

function canEditCountry(country) {
  if (!currentUser) return false;
  if (isAdmin()) return true;
  return country.owner === currentUser.username;
}

function updateUserUI() {
  const info = document.getElementById('current-user-info');
  if (!currentUser) {
    info.innerHTML = `👤 訪客模式 <small style="color:var(--warning)">(登入後可建國)</small>`;
  } else if (isAdmin()) {
    info.innerHTML = `👑 <strong>${worldData.adminAccount?.displayName || 'admin'}</strong> <span style="color:var(--danger)">[最高管理員]</span>`;
  } else {
    info.innerHTML = `🎮 玩家：<strong>${currentUser.username}</strong>`;
  }
}

function renderAdminPanel() {
  const container = document.getElementById('admin-panel-content');
  if (!isAdmin()) {
    container.innerHTML = `<p class="hint">⚠️ 此區塊僅限系統綁定管理員（帳號 <code>admin</code>）登入後操作踢服與玩家權限。</p>`;
    return;
  }

  container.innerHTML = `
    <p style="color:var(--success); font-size:0.88rem; margin-bottom:12px;">✅ 已驗證系統管理員身份，你可管理所有玩家與國家：</p>
    <div class="events-feed">
      ${registeredPlayers.map(p => `
        <div class="ranking-item" style="align-items:center;">
          <div>
            <strong>🎮 ${p.username}</strong>
            <span style="font-size:0.78rem; margin-left:8px; color:${p.banned ? 'var(--danger)' : 'var(--success)'}">
              ${p.banned ? '🚫 已踢除/封鎖' : '🟢 正常連線'}
            </span>
          </div>
          <button class="${p.banned ? 'btn-secondary' : 'btn-danger'}" onclick="toggleKickPlayer('${p.username}')">
            ${p.banned ? '解除封鎖' : '👢 踢出伺服器'}
          </button>
        </div>
      `).join('')}
    </div>
  `;
}

function toggleKickPlayer(username) {
  if (!isAdmin()) return;
  const target = registeredPlayers.find(p => p.username === username);
  if (!target) return;
  target.banned = !target.banned;

  eventsData.unshift({
    id: `admin-${Date.now()}`,
    year: simDate.year,
    type: '新聞',
    severity: '重大',
    region: '世界管理中樞',
    title: target.banned ? `🚨 玩家「${username}」已被世界管理員踢出伺服器` : `✅ 玩家「${username}」已恢復連線權限`,
    content: `系統綁定管理員（${worldData.administrator}）執行了帳號權限變更。`
  });

  saveAll();
  alert(target.banned ? `👢 已將玩家 ${username} 踢出並封鎖登入！` : `✅ 已解除 ${username} 的封鎖！`);
}

// ==========================================
// 3. 經緯度地圖 & 有限手繪國土面積引擎
// ==========================================
function latLonToPercent(lat, lon) {
  const x = ((Number(lon) + 180) / 360) * 100;
  const y = ((90 - Number(lat)) / 180) * 100;
  return { x: Math.max(2, Math.min(98, x)), y: Math.max(3, Math.min(97, y)) };
}

function percentToLatLon(xPct, yPct) {
  const lon = ((xPct / 100) * 360 - 180).toFixed(1);
  const lat = (90 - (yPct / 100) * 180).toFixed(1);
  return { lat: Number(lat), lon: Number(lon) };
}

// 使用 Shoelace 公式計算多邊形近似領土面積 (km²)
function calculatePolygonAreaKm2(points) {
  if (!points || points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.round(Math.abs(area / 2) * 85); // 比例尺換算為 km²
}

function renderMap() {
  const svg = document.getElementById('map-svg-layer');
  const pinsContainer = document.getElementById('map-pins-container');
  let svgHTML = '';

  // 1. 繪製各國手繪領土多邊形
  countriesData.forEach(c => {
    const pts = (isDrawMode && document.getElementById('draw-target-country').value === c.id && tempPolygonPoints.length > 0)
      ? tempPolygonPoints
      : (c.territoryPoints || []);

    if (pts.length >= 2) {
      const pointStr = pts.map(p => `${p.x},${p.y}`).join(' ');
      const color = c.color || '#38bdf8';
      if (pts.length >= 3) {
        svgHTML += `<polygon points="${pointStr}" fill="${color}" fill-opacity="0.28" stroke="${color}" stroke-width="0.45" />`;
      } else {
        svgHTML += `<polyline points="${pointStr}" fill="none" stroke="${color}" stroke-width="0.45" stroke-dasharray="1,1" />`;
      }
      pts.forEach(p => {
        svgHTML += `<circle cx="${p.x}" cy="${p.y}" r="0.6" fill="#fff" />`;
      });
    }
  });

  // 2. 若切換至交通航線圖層，繪製跨國連線
  if (currentMapLayer === 'transport') {
    transportData.forEach(tr => {
      const c1 = countriesData.find(c => c.id === tr.fromCountryId);
      const c2 = countriesData.find(c => c.id === tr.toCountryId);
      if (c1 && c2) {
        const p1 = latLonToPercent(c1.coords.lat, c1.coords.lon);
        const p2 = latLonToPercent(c2.coords.lat, c2.coords.lon);
        svgHTML += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="#f43f5e" stroke-width="0.5" stroke-dasharray="1.5,1" />`;
      }
    });
  }

  svg.innerHTML = svgHTML;

  // 3. 繪製首都與經緯度圖釘
  pinsContainer.innerHTML = countriesData.map(c => {
    const pos = latLonToPercent(c.coords?.lat ?? 0, c.coords?.lon ?? 0);
    let label = `${c.flag} ${c.name}`;
    if (currentMapLayer === 'population') label += ` (${(c.population / 10000).toFixed(0)}萬)`;

    return `
      <div class="map-pin" style="left:${pos.x}%; top:${pos.y}%; border-color:${c.color || 'var(--accent)'}"
           onclick="if(!isDrawMode) openCountryWiki('${c.id}')">
        ${label}
      </div>
    `;
  }).join('');
}

function updateDrawAreaHUD() {
  const targetId = document.getElementById('draw-target-country').value;
  const country = countriesData.find(c => c.id === targetId);
  if (!country) return;
  const maxArea = country.maxTerritoryArea || 10000;
  const currentPts = tempPolygonPoints.length > 0 ? tempPolygonPoints : (country.territoryPoints || []);
  const usedArea = calculatePolygonAreaKm2(currentPts);

  document.getElementById('draw-max-area').textContent = maxArea.toLocaleString();
  const usedEl = document.getElementById('draw-used-area');
  usedEl.textContent = usedArea.toLocaleString();
  usedEl.style.color = usedArea > maxArea ? 'var(--danger)' : 'var(--accent)';
}

// ==========================================
// 4. 其他視圖渲染 (Dashboard / 通播 / 百科 / 交通 / 外交)
// ==========================================
function renderDashboard() {
  document.getElementById('world-title').textContent = worldData.worldName;
  updateClockUI();

  const totalPop = countriesData.reduce((s, c) => s + Number(c.population), 0);
  const totalGDP = countriesData.reduce((s, c) => s + Number(c.gdp), 0);

  document.getElementById('stat-countries').textContent = `${countriesData.length} 國`;
  document.getElementById('stat-pop').textContent = `${(totalPop / 10000).toLocaleString()} 萬`;
  document.getElementById('stat-gdp').textContent = `$${(totalGDP / 1e12).toFixed(2)} 兆`;
  document.getElementById('stat-transport').textContent = `${transportData.length} 條`;

  if (eventsData.length > 0) {
    const latest = eventsData[0];
    document.getElementById('banner-event-text').innerHTML = `<strong>[${latest.type}]</strong> ${latest.title}`;
  }

  const sortedByGDP = [...countriesData].sort((a, b) => b.gdp - a.gdp);
  document.getElementById('gdp-ranking-list').innerHTML = sortedByGDP.map((c, i) => `
    <div class="ranking-item">
      <span>#${i + 1} ${c.flag} <strong>${c.name}</strong> <small style="color:var(--text-muted)">(${c.owner})</small></span>
      <span>$${(c.gdp / 1e8).toLocaleString()} 億</span>
    </div>
  `).join('');

  document.getElementById('dashboard-events-list').innerHTML = eventsData.slice(0, 4).map(ev => `
    <div class="event-card type-${ev.type} sev-${ev.severity}" style="margin-bottom:8px; padding:10px;">
      <div class="event-meta">
        <span class="event-tag">${ev.type}</span>
        <span>${ev.dateStr || ev.year + '年'} · ${ev.region}</span>
      </div>
      <h4 style="font-size:0.92rem;">${ev.title}</h4>
    </div>
  `).join('');

  if (worldData.timeline) {
    document.getElementById('full-timeline').innerHTML = worldData.timeline.map(t => `
      <li><span class="timeline-year">${t.year}</span>${t.event}</li>
    `).join('');
  }
}

function renderEventsFeed(filterType) {
  const list = filterType === 'ALL' ? eventsData : eventsData.filter(e => e.type === filterType);
  document.getElementById('events-feed-list').innerHTML = list.map(ev => `
    <div class="event-card type-${ev.type} sev-${ev.severity}">
      <div class="event-meta">
        <span class="event-tag">${ev.type}</span>
        <span class="event-tag">${ev.severity}</span>
        <span>📅 ${ev.dateStr || ev.year + '年'}</span>
        <span>📍 ${ev.region}</span>
      </div>
      <h4>${ev.title}</h4>
      <p>${ev.content}</p>
    </div>
  `).join('');
}

function renderCountriesGrid(list) {
  document.getElementById('countries-grid').innerHTML = list.map(c => {
    const editable = canEditCountry(c);
    const area = calculatePolygonAreaKm2(c.territoryPoints);
    return `
      <div class="country-card">
        <div>
          <h3>${c.flag} ${c.name} <small style="color:var(--text-muted)">(${c.code})</small></h3>
          <p style="font-size:0.8rem; color:var(--accent); margin:4px 0;">
            👤 玩家：${c.owner} | 📍 ${c.coords?.lat ?? 0}°, ${c.coords?.lon ?? 0}°
          </p>
          <p style="font-size:0.78rem; color:var(--text-muted);">🗺️ 領土面積：${area.toLocaleString()} / ${(c.maxTerritoryArea || 10000).toLocaleString()} km²</p>
          <p style="margin:8px 0; color:var(--text-muted); font-size:0.88rem;">${c.description}</p>
          <div>${c.tags.map(t => `<span class="tag">#${t}</span>`).join('')}</div>
        </div>
        <div class="card-actions">
          <button class="btn-secondary" style="flex:1;" onclick="openCountryWiki('${c.id}')">📖 Wiki</button>
          ${editable ? `<button class="btn-primary" style="flex:1; padding:6px;" onclick="editCountry('${c.id}')">✏️ 管理國家</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function renderTransport() {
  document.getElementById('transport-list').innerHTML = transportData.map(tr => {
    const c1 = countriesData.find(c => c.id === tr.fromCountryId)?.name || '未知';
    const c2 = countriesData.find(c => c.id === tr.toCountryId)?.name || '未知';
    return `
      <div class="event-card">
        <div class="event-meta">
          <span class="event-tag">${tr.type}</span>
          <span>${c1} ⇄ ${c2}</span>
        </div>
        <h4>${tr.name}</h4>
        <p>樞紐站點：${tr.hubs} ｜ 運量：${tr.capacity}</p>
      </div>
    `;
  }).join('');
}

function renderDiplomacy() {
  document.getElementById('diplomacy-relations-list').innerHTML = diplomacyData.relations.map(r => {
    const cA = countriesData.find(c => c.id === r.countryA);
    const cB = countriesData.find(c => c.id === r.countryB);
    return `
      <div class="event-card">
        <div class="event-meta"><span class="event-tag">${r.status}</span></div>
        <h4>${cA ? cA.flag + cA.name : '未知'} ⇄ ${cB ? cB.flag + cB.name : '未知'}</h4>
        <p>${r.note}</p>
      </div>
    `;
  }).join('');

  document.getElementById('diplomacy-orgs-list').innerHTML = diplomacyData.organizations.map(org => `
    <div class="event-card" style="border-left-color:var(--success);">
      <div class="event-meta"><span class="event-tag">總部：${org.hq}</span></div>
      <h4>${org.name}</h4>
      <p>宗旨：${org.purpose}<br/>成員國：${org.members.join('、')}</p>
    </div>
  `).join('');
}

function populateCountryDropdowns() {
  const allOptions = countriesData.map(c => `<option value="${c.id}">${c.flag} ${c.name}</option>`).join('');
  ['t-from', 't-to', 'd-country-a', 'd-country-b'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = allOptions;
  });

  // 國家編輯下拉選單（只列出玩家有權限編輯的國家）
  const editableCountries = countriesData.filter(c => canEditCountry(c));
  document.getElementById('edit-country-selector').innerHTML =
    `<option value="NEW">➕ 建立全新國家...</option>` +
    editableCountries.map(c => `<option value="${c.id}">✏️ 編輯：${c.flag} ${c.name}</option>`).join('');

  document.getElementById('draw-target-country').innerHTML =
    editableCountries.map(c => `<option value="${c.id}">${c.flag} ${c.name}</option>`).join('');
}

function openCountryWiki(countryId) {
  const c = countriesData.find(item => item.id === countryId);
  if (!c) return;
  currentDrawerCountryId = countryId;

  const editBtn = document.getElementById('drawer-edit-btn');
  if (canEditCountry(c)) editBtn.classList.remove('hidden');
  else editBtn.classList.add('hidden');

  const area = calculatePolygonAreaKm2(c.territoryPoints);
  document.getElementById('drawer-body').innerHTML = `
    <h2 style="font-size: 1.7rem;">${c.flag} ${c.name}</h2>
    <p style="color: var(--accent); margin-bottom: 14px;">${c.officialName}</p>
    <p style="line-height: 1.6; margin-bottom: 16px;">${c.description}</p>
    <table class="wiki-table">
      <tr><td>玩家擁有者</td><td>${c.owner}</td></tr>
      <tr><td>國家代碼</td><td>${c.code}</td></tr>
      <tr><td>首都與經緯度</td><td>${c.capital} (${c.coords?.lat ?? 0}°, ${c.coords?.lon ?? 0}°)</td></tr>
      <tr><td>已繪製領土面積</td><td>${area.toLocaleString()} / ${(c.maxTerritoryArea || 10000).toLocaleString()} km²</td></tr>
      <tr><td>政體 / 元首</td><td>${c.government} / ${c.leader}</td></tr>
      <tr><td>總人口</td><td>${Number(c.population).toLocaleString()} 人</td></tr>
      <tr><td>GDP</td><td>$${Number(c.gdp).toLocaleString()}</td></tr>
      <tr><td>貨幣 / 語言</td><td>${c.currency} / ${c.language}</td></tr>
      <tr><td>宗教信仰</td><td>${c.religion}</td></tr>
      <tr><td>主要城市</td><td>${c.cities.join('、')}</td></tr>
    </table>
  `;
  document.getElementById('country-drawer').classList.remove('hidden');
}

function openBuilderForNew() {
  if (!currentUser) {
    alert('🔑 請先登入或註冊玩家帳號，才能創建自己的國家！');
    switchView('accounts');
    return;
  }
  document.getElementById('country-builder-form').reset();
  document.getElementById('b-id').value = '';
  document.getElementById('builder-mode-title').textContent = '🏴 創建我的新國家';
  document.getElementById('delete-country-btn').classList.add('hidden');
  document.getElementById('permission-notice').textContent = `🎮 目前以「${currentUser.username}」身份建立國家，建立後將綁定為你的專屬領土。`;
  switchView('builder');
}

function editCountry(countryId) {
  const c = countriesData.find(item => item.id === countryId);
  if (!c || !canEditCountry(c)) {
    alert('⛔ 你沒有權限編輯此國家（僅限該國玩家本人或系統管理員）。');
    return;
  }
  document.getElementById('country-drawer').classList.add('hidden');
  document.getElementById('b-id').value = c.id;
  document.getElementById('b-name').value = c.name;
  document.getElementById('b-official').value = c.officialName;
  document.getElementById('b-code').value = c.code;
  document.getElementById('b-flag').value = c.flag;
  document.getElementById('b-color').value = c.color || '#38bdf8';
  document.getElementById('b-capital').value = c.capital;
  document.getElementById('b-gov').value = c.government;
  document.getElementById('b-leader').value = c.leader;
  document.getElementById('b-pop').value = c.population;
  document.getElementById('b-gdp').value = c.gdp;
  document.getElementById('b-lat').value = c.coords?.lat ?? 0;
  document.getElementById('b-lon').value = c.coords?.lon ?? 0;
  document.getElementById('b-currency').value = c.currency;
  document.getElementById('b-lang').value = c.language;
  document.getElementById('b-religion').value = c.religion;
  document.getElementById('b-cities').value = c.cities.join('、');
  document.getElementById('b-tags').value = c.tags.join(', ');
  document.getElementById('b-desc').value = c.description;

  document.getElementById('builder-mode-title').textContent = `✏️ 管理國家：${c.flag} ${c.name}`;
  document.getElementById('delete-country-btn').classList.remove('hidden');
  document.getElementById('edit-country-selector').value = c.id;
  switchView('builder');
}

// ==========================================
// 5. 事件監聽器
// ==========================================
function setupEventListeners() {
  // 導覽切換
  document.querySelectorAll('.nav-btn:not(.disabled)').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.view === 'builder') openBuilderForNew();
      else switchView(btn.dataset.view);
    });
  });

  // Flow Time 流速控制
  document.querySelectorAll('.flow-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.flow-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      flowSpeed = Number(btn.dataset.speed);
      document.getElementById('flow-status-badge').textContent = flowSpeed === 0 ? '已暫停' : `運行中 (${flowSpeed}x)`;
    });
  });

  // 帳號登入 / 註冊
  document.getElementById('auth-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const u = document.getElementById('auth-username').value.trim();
    const p = document.getElementById('auth-password').value.trim();

    // 1. 檢查是否為系統綁定世界管理員
    if (u === (worldData.adminAccount?.username || 'admin')) {
      if (p === (worldData.adminAccount?.password || '2026')) {
        currentUser = { username: u, role: 'ADMIN' };
        localStorage.setItem(KEYS.SESSION, JSON.stringify(currentUser));
        updateUserUI();
        refreshAllViews();
        alert(`👑 歡迎回來，世界管理員 ${worldData.administrator}！已解鎖最高控制權限。`);
        return;
      } else {
        alert('❌ 管理員密碼錯誤！');
        return;
      }
    }

    // 2. 一般玩家登入或自動註冊
    let player = registeredPlayers.find(pl => pl.username === u);
    if (player) {
      if (player.banned) {
        alert('🚫 你的帳號已被世界管理員踢出並封鎖，無法登入！');
        return;
      }
      if (player.password !== p) {
        alert('❌ 玩家密碼錯誤！');
        return;
      }
    } else {
      player = { username: u, password: p, banned: false };
      registeredPlayers.push(player);
      alert(`🎉 新玩家帳號「${u}」註冊成功！你現在可以創建並管理自己的國家了。`);
    }

    currentUser = { username: u, role: 'PLAYER' };
    localStorage.setItem(KEYS.SESSION, JSON.stringify(currentUser));
    saveAll();
    updateUserUI();
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    currentUser = null;
    localStorage.removeItem(KEYS.SESSION);
    updateUserUI();
    refreshAllViews();
    alert('🚪 已登出帳號。');
  });

  // 地圖滑鼠經緯度即時顯示 & 手繪國土點擊
  const mapCanvas = document.getElementById('world-map-canvas');
  mapCanvas.addEventListener('mousemove', (e) => {
    const rect = mapCanvas.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    const { lat, lon } = percentToLatLon(xPct, yPct);
    document.getElementById('cursor-coord-hud').textContent =
      `經緯度：${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
  });

  mapCanvas.addEventListener('click', (e) => {
    if (!isDrawMode) return;
    const targetId = document.getElementById('draw-target-country').value;
    const country = countriesData.find(c => c.id === targetId);
    if (!country || !canEditCountry(country)) {
      alert('⛔ 你沒有權限繪製此國家的領土！');
      return;
    }

    const rect = mapCanvas.getBoundingClientRect();
    const x = Number((((e.clientX - rect.left) / rect.width) * 100).toFixed(1));
    const y = Number((((e.clientY - rect.top) / rect.height) * 100).toFixed(1));

    const candidatePoints = [...tempPolygonPoints, { x, y }];
    const newArea = calculatePolygonAreaKm2(candidatePoints);
    const maxArea = country.maxTerritoryArea || 10000;

    if (newArea > maxArea) {
      alert(`⚠️ 領土面積上限警告！\n此頂點將使領土達到 ${newArea.toLocaleString()} km²，超過貴國上限 (${maxArea.toLocaleString()} km²)！`);
      return;
    }

    tempPolygonPoints = candidatePoints;
    updateDrawAreaHUD();
    renderMap();
  });

  // 開關手繪國土模式
  document.getElementById('toggle-draw-mode-btn').addEventListener('click', () => {
    if (!currentUser) {
      alert('🔑 請先登入帳號再繪製領土！');
      switchView('accounts');
      return;
    }
    isDrawMode = !isDrawMode;
    tempPolygonPoints = [];
    document.getElementById('territory-draw-toolbar').classList.toggle('hidden', !isDrawMode);
    mapCanvas.classList.toggle('drawing-mode', isDrawMode);
    updateDrawAreaHUD();
    renderMap();
  });

  document.getElementById('clear-territory-btn').addEventListener('click', () => {
    tempPolygonPoints = [];
    updateDrawAreaHUD();
    renderMap();
  });

  document.getElementById('save-territory-btn').addEventListener('click', () => {
    const targetId = document.getElementById('draw-target-country').value;
    const country = countriesData.find(c => c.id === targetId);
    if (!country || tempPolygonPoints.length < 3) {
      alert('⚠️ 請至少在地圖上點擊 3 個頂點形成多邊形領土！');
      return;
    }
    country.territoryPoints = [...tempPolygonPoints];
    const area = calculatePolygonAreaKm2(country.territoryPoints);
    eventsData.unshift({
      id: `terr-${Date.now()}`,
      year: simDate.year,
      type: '國家動態',
      severity: '一般',
      region: `${country.flag} ${country.name}`,
      title: `${country.name} 劃定最新官方領土疆界`,
      content: `${country.name} 在經緯度地圖上確認了 ${area.toLocaleString()} km² 的主權領土範圍。`
    });
    tempPolygonPoints = [];
    saveAll();
    alert(`✅ 領土邊界已儲存！總面積：${area.toLocaleString()} km²`);
  });

  // 地圖圖層切換
  document.querySelectorAll('.layer-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentMapLayer = btn.dataset.layer;
      renderMap();
    });
  });

  // 國家表單提交
  document.getElementById('country-builder-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const existingId = document.getElementById('b-id').value;
    const code = document.getElementById('b-code').value.trim().toUpperCase();
    const name = document.getElementById('b-name').value.trim();
    const flag = document.getElementById('b-flag').value.trim();
    const lat = Number(document.getElementById('b-lat').value);
    const lon = Number(document.getElementById('b-lon').value);

    if (existingId) {
      const target = countriesData.find(c => c.id === existingId);
      if (!target || !canEditCountry(target)) return;
      Object.assign(target, {
        name,
        officialName: document.getElementById('b-official').value.trim(),
        code,
        flag,
        color: document.getElementById('b-color').value,
        capital: document.getElementById('b-capital').value.trim(),
        government: document.getElementById('b-gov').value.trim(),
        leader: document.getElementById('b-leader').value.trim(),
        population: Number(document.getElementById('b-pop').value),
        gdp: Number(document.getElementById('b-gdp').value),
        coords: { lat, lon },
        currency: document.getElementById('b-currency').value.trim(),
        language: document.getElementById('b-lang').value.trim(),
        religion: document.getElementById('b-religion').value.trim(),
        cities: document.getElementById('b-cities').value.split('、').map(s => s.trim()).filter(Boolean),
        tags: document.getElementById('b-tags').value.split(',').map(s => s.trim()).filter(Boolean),
        description: document.getElementById('b-desc').value.trim()
      });
      alert(`✅ 「${flag} ${name}」資料已更新！`);
    } else {
      const pos = latLonToPercent(lat, lon);
      const newC = {
        id: `${code.toLowerCase()}-${Date.now().toString().slice(-4)}`,
        owner: currentUser.username,
        name,
        officialName: document.getElementById('b-official').value.trim(),
        code,
        flag,
        color: document.getElementById('b-color').value,
        capital: document.getElementById('b-capital').value.trim(),
        government: document.getElementById('b-gov').value.trim(),
        leader: document.getElementById('b-leader').value.trim(),
        population: Number(document.getElementById('b-pop').value),
        gdp: Number(document.getElementById('b-gdp').value),
        coords: { lat, lon },
        maxTerritoryArea: 10000,
        territoryPoints: [
          { x: Math.max(5, pos.x - 4), y: Math.max(5, pos.y - 4) },
          { x: Math.min(95, pos.x + 4), y: Math.max(5, pos.y - 4) },
          { x: Math.min(95, pos.x + 4), y: Math.min(95, pos.y + 4) },
          { x: Math.max(5, pos.x - 4), y: Math.min(95, pos.y + 4) }
        ],
        currency: document.getElementById('b-currency').value.trim(),
        language: document.getElementById('b-lang').value.trim(),
        religion: document.getElementById('b-religion').value.trim(),
        cities: document.getElementById('b-cities').value.split('、').map(s => s.trim()).filter(Boolean),
        tags: document.getElementById('b-tags').value.split(',').map(s => s.trim()).filter(Boolean),
        description: document.getElementById('b-desc').value.trim()
      };
      countriesData.push(newC);
      eventsData.unshift({
        id: `evt-${Date.now()}`,
        year: simDate.year,
        type: '新聞',
        severity: '重大',
        region: `${flag} ${name}`,
        title: `📰 新國家「${newC.officialName}」宣布建國！`,
        content: `玩家 ${currentUser.username} 在 (${lat}°, ${lon}°) 建立新國家，定都 ${newC.capital}。`
      });
      alert(`🎉 國家「${flag} ${name}」創建成功！`);
    }
    saveAll();
  });

  // 交通航線表單
  document.getElementById('transport-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const newTr = {
      id: `tr-${Date.now()}`,
      type: document.getElementById('t-type').value,
      name: document.getElementById('t-name').value.trim(),
      fromCountryId: document.getElementById('t-from').value,
      toCountryId: document.getElementById('t-to').value,
      hubs: document.getElementById('t-hubs').value.trim(),
      capacity: document.getElementById('t-cap').value.trim()
    };
    transportData.push(newTr);
    eventsData.unshift({
      id: `tr-evt-${Date.now()}`,
      year: simDate.year,
      type: '外交條約',
      severity: '一般',
      region: newTr.hubs,
      title: `🚆 新交通幹線「${newTr.name}」正式開通`,
      content: `類型：${newTr.type}，設計運量：${newTr.capacity}。`
    });
    saveAll();
    document.getElementById('transport-form').reset();
    alert('🚆 交通路線已開通並同步顯示於地圖交通圖層！');
  });

  // 外交表單
  document.getElementById('diplomacy-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const cA = document.getElementById('d-country-a').value;
    const cB = document.getElementById('d-country-b').value;
    if (cA === cB) return alert('⚠️ 請選擇兩個不同的國家！');
    const status = document.getElementById('d-status').value;
    const note = document.getElementById('d-note').value.trim();

    diplomacyData.relations.unshift({ id: `rel-${Date.now()}`, countryA: cA, countryB: cB, status, note });
    const nameA = countriesData.find(c => c.id === cA)?.name;
    const nameB = countriesData.find(c => c.id === cB)?.name;
    eventsData.unshift({
      id: `dip-${Date.now()}`,
      year: simDate.year,
      type: '外交條約',
      severity: '重大',
      region: `${nameA} — ${nameB}`,
      title: `🕊️ ${nameA} 與 ${nameB} 進入「${status}」`,
      content: note
    });
    saveAll();
    document.getElementById('diplomacy-form').reset();
    alert('📜 外交公報已發布！');
  });

  // 事件篩選、手動通播與模擬播報
  document.getElementById('event-filter-type').addEventListener('change', (e) => renderEventsFeed(e.target.value));
  document.getElementById('trigger-auto-event-btn').addEventListener('click', () => {
    generateAutoDisasterOrNews();
    alert('⚡ 已模擬觸發一則最新自動地理通播 / 世界新聞！');
  });

  document.getElementById('event-publish-form').addEventListener('submit', (e) => {
    e.preventDefault();
    eventsData.unshift({
      id: `evt-${Date.now()}`,
      year: simDate.year,
      dateStr: `${simDate.year}/${simDate.month}/${simDate.day}`,
      type: document.getElementById('e-type').value,
      severity: document.getElementById('e-severity').value,
      region: document.getElementById('e-region').value.trim(),
      title: document.getElementById('e-title').value.trim(),
      content: document.getElementById('e-content').value.trim()
    });
    saveAll();
    document.getElementById('event-publish-form').reset();
    alert('📡 通播已發布！');
  });

  // 其他輔助按鈕
  document.getElementById('drawer-edit-btn').addEventListener('click', () => { if (currentDrawerCountryId) editCountry(currentDrawerCountryId); });
  document.getElementById('edit-country-selector').addEventListener('change', (e) => {
    if (e.target.value === 'NEW') openBuilderForNew();
    else editCountry(e.target.value);
  });
  document.getElementById('delete-country-btn').addEventListener('click', () => {
    const id = document.getElementById('b-id').value;
    if (confirm('確定要刪除此國家嗎？')) {
      countriesData = countriesData.filter(c => c.id !== id);
      saveAll();
      openBuilderForNew();
    }
  });
  document.getElementById('close-drawer').addEventListener('click', () => document.getElementById('country-drawer').classList.add('hidden'));
  document.getElementById('random-country-btn').addEventListener('click', () => {
    const r = countriesData[Math.floor(Math.random() * countriesData.length)];
    if (r) openCountryWiki(r.id);
  });
  document.getElementById('search-input').addEventListener('input', (e) => {
    const kw = e.target.value.toLowerCase();
    renderCountriesGrid(countriesData.filter(c =>
      c.name.toLowerCase().includes(kw) || c.owner.toLowerCase().includes(kw) || c.tags.some(t => t.toLowerCase().includes(kw))
    ));
    switchView('countries');
  });
  document.getElementById('copy-json-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('json-output-box').textContent);
    alert('✅ 已複製完整 countries.json！');
  });
  document.getElementById('reset-local-btn').addEventListener('click', () => {
    if (confirm('確定要清除本地暫存並恢復為 GitHub 雲端原始資料嗎？')) {
      Object.values(KEYS).forEach(k => localStorage.removeItem(k));
      location.reload();
    }
  });
}

initWorld();
