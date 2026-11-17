let worldData = {};
let countriesData = [];
let eventsData = [];
let transportData = [];
let diplomacyData = { relations: [], organizations: [] };

// 股票市場與玩家資金狀態
let stocksData = []; // [{ ticker, name, countryId, price, prevPrice, volume }]
let stockLogs = [];
let playerPortfolio = { cash: 100000, holdings: {} };

// 聯合國大會聊天室 & 決議案狀態
let unMessages = [];
let unProposals = [];

// 帳號與權限狀態
let currentUser = null;
let registeredPlayers = [];

// Flow Time (現實 30 分鐘 = 1,800,000 毫秒 = 虛擬 1 天) & 0.5分鐘自動新聞台
const MS_PER_SIM_DAY = 30 * 60 * 1000;
const AUTO_NEWS_INTERVAL_MS = 30 * 1000; // 0.5 分鐘 = 30 秒刷新一則新聞
let simDate = { year: 2028, month: 1, day: 1, dayProgress: 0 };
let flowSpeed = 1;
let flowTimer = null;
let newsTimer = null;
let aiMarketTimer = null;
let lastTickTime = Date.now();

let currentMapLayer = 'political';
let isDrawMode = false;
let tempPolygonPoints = [];
let currentDrawerCountryId = null;

const KEYS = {
  COUNTRIES: 'vw_v3_countries',
  EVENTS: 'vw_v3_events',
  TRANSPORT: 'vw_v3_transport',
  DIPLOMACY: 'vw_v3_diplomacy',
  STOCKS: 'vw_v3_stocks',
  PORTFOLIO: 'vw_v3_portfolio',
  UN_MSG: 'vw_v3_un_msg',
  UN_PROP: 'vw_v3_un_prop',
  PLAYERS: 'vw_v3_players',
  SESSION: 'vw_v3_session',
  DATE: 'vw_v3_date'
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

    // 確保每個國家都有專屬官網預設資料
    countriesData.forEach(c => {
      if (!c.website) {
        c.website = {
          theme: 'cyber',
          slogan: `歡迎來到${c.officialName} — 榮耀與繁榮之地`,
          notice: `${c.capital}市政廳發布最新年度發展白皮書。`,
          culture: `${c.name}擁有獨特的${c.language}文化傳統與壯麗自然景觀，誠摯歡迎世界各國使節與旅客造訪。`
        };
      }
    });

    // 初始化股票市場
    stocksData = JSON.parse(localStorage.getItem(KEYS.STOCKS)) || generateInitialStocks();
    syncStocksWithCountries();
    playerPortfolio = JSON.parse(localStorage.getItem(KEYS.PORTFOLIO)) || { cash: 100000, holdings: {} };

    // 初始化聯合國大會聊天室與決議案
    unMessages = JSON.parse(localStorage.getItem(KEYS.UN_MSG)) || [
      { sender: '👑 秘書長 (蔡幸恩)', text: '歡迎各國代表進入聯合國大會堂！請在此進行外交協商或提出全球決議案。', time: '2028/01/01', isAdmin: true }
    ];
    unProposals = JSON.parse(localStorage.getItem(KEYS.UN_PROP)) || [
      { id: 'prop-1', title: '第 1 號決議：全球領海與跨國航線自由通行公約', desc: '保障所有主權國家民用航空與商船在公海的和平通行權。', author: '星辰聯邦', yes: 2, no: 0 }
    ];

    registeredPlayers = JSON.parse(localStorage.getItem(KEYS.PLAYERS)) || [
      { username: 'Captain Huang', password: '123', banned: false },
      { username: 'Elena', password: '123', banned: false }
    ];
    currentUser = JSON.parse(localStorage.getItem(KEYS.SESSION)) || null;
    simDate = JSON.parse(localStorage.getItem(KEYS.DATE)) || { ...worldData.currentDate, dayProgress: 0 };

    updateUserUI();
    refreshAllViews();
    setupEventListeners();
    startFlowTimeLoop();
    startAutoNewsLoop();
    startVirtualBuyersLoop();
  } catch (err) {
    console.error("初始化失敗：", err);
  }
}

function saveAll() {
  localStorage.setItem(KEYS.COUNTRIES, JSON.stringify(countriesData));
  localStorage.setItem(KEYS.EVENTS, JSON.stringify(eventsData));
  localStorage.setItem(KEYS.TRANSPORT, JSON.stringify(transportData));
  localStorage.setItem(KEYS.DIPLOMACY, JSON.stringify(diplomacyData));
  localStorage.setItem(KEYS.STOCKS, JSON.stringify(stocksData));
  localStorage.setItem(KEYS.PORTFOLIO, JSON.stringify(playerPortfolio));
  localStorage.setItem(KEYS.UN_MSG, JSON.stringify(unMessages));
  localStorage.setItem(KEYS.UN_PROP, JSON.stringify(unProposals));
  localStorage.setItem(KEYS.PLAYERS, JSON.stringify(registeredPlayers));
  localStorage.setItem(KEYS.DATE, JSON.stringify(simDate));
  refreshAllViews();
}

function refreshAllViews() {
  renderDashboard();
  renderEventsFeed(document.getElementById('event-filter-type').value || 'ALL');
  renderStocksMarket();
  renderUNChamber();
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
// 1. Flow Time (30m=1d) & 每 0.5 分鐘自動新聞台 (有好有壞、連動股價)
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
      }
      while (simDate.month > 12) {
        simDate.month -= 12;
        simDate.year += 1;
        countriesData.forEach(c => {
          c.population = Math.round(Number(c.population) * 1.012);
          c.gdp = Math.round(Number(c.gdp) * 1.025);
        });
      }
    }

    updateClockUI();
    if (dayChanged) saveAll();
  }, 1000);
}

// 獨立定時器：每 0.5 分鐘（30 秒）自動刷新一則新聞
function startAutoNewsLoop() {
  if (newsTimer) clearInterval(newsTimer);
  newsTimer = setInterval(() => {
    if (flowSpeed === 0) return; // 暫停時間時不刷新新聞
    triggerAutoNewsStation();
  }, AUTO_NEWS_INTERVAL_MS);
}

function updateClockUI() {
  const m = String(simDate.month).padStart(2, '0');
  const d = String(simDate.day).padStart(2, '0');
  const pct = Math.floor((simDate.dayProgress || 0) * 100);
  document.getElementById('world-clock-display').textContent = `${simDate.year}年 ${m}月 ${d}日 (${pct}%)`;
}

// 24H 自動新聞台：好壞消息均衡，直接連動影響該國股價
function triggerAutoNewsStation() {
  if (countriesData.length === 0) return;
  const target = countriesData[Math.floor(Math.random() * countriesData.length)];
  const stock = stocksData.find(s => s.countryId === target.id);
  const lat = target.coords?.lat ?? 10;
  const lon = target.coords?.lon ?? 20;
  const coordStr = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;

  // 50% 好消息（利多）、50% 壞消息（利空）
  const isGoodNews = Math.random() < 0.5;
  let picked = null;
  let impactPct = 0;

  if (isGoodNews) {
    const goodPool = [
      {
        type: '新聞',
        sev: '重大',
        minImp: 0.05, maxImp: 0.08,
        title: `🚀 【利多】${target.name}發表新一代量子能源與航太技術突破！`,
        content: `【GNN 科技頭條】${target.name}科研團隊在${target.capital}展示最新研發成果，全球資本湧入搶購，帶動該國企業股價強勢飆漲！`
      },
      {
        type: '新聞',
        sev: '一般',
        minImp: 0.025, maxImp: 0.045,
        title: `📈 【利多】${target.name}季度出口順差與觀光收益雙雙刷新紀錄`,
        content: `【GNN 財經快報】受惠於跨國航線暢旺與內需消費熱絡，${target.officialName}經濟表現大幅優於市場預期。`
      },
      {
        type: '外交條約',
        sev: '一般',
        minImp: 0.02, maxImp: 0.04,
        title: `🤝 【利多】${target.name}宣布擴大外資減稅與自由貿易優惠`,
        content: `【GNN 政經報導】由 ${target.leader} 領導的政府推出全新招商政策，吸引多家跨國機構加碼投資${target.capital}金融市場。`
      },
      {
        type: '新聞',
        sev: '一般',
        minImp: 0.015, maxImp: 0.035,
        title: `🎉 【利多】${target.name}舉辦國際博覽會，帶動國內產業訂單滿載`,
        content: `【GNN 民生商業】各國採購團齊聚${target.capital}，帶動${target.name}製造業與服務業營收穩健攀升。`
      }
    ];
    picked = goodPool[Math.floor(Math.random() * goodPool.length)];
    impactPct = picked.minImp + Math.random() * (picked.maxImp - picked.minImp);
  } else {
    const badPool = [
      {
        type: '自然災害',
        sev: '緊急',
        minImp: -0.085, maxImp: -0.05,
        title: `🌪️ 【利空】強烈熱帶氣旋逼近${target.name}，主要港口與工業區停擺`,
        content: `【GNN 氣象警報】氣象衛星在 (${coordStr}) 觀測到強颱暴風圈籠罩${target.capital}周邊，供應鏈中斷引發市場拋售潮！`
      },
      {
        type: '地理變動',
        sev: '重大',
        minImp: -0.07, maxImp: -0.04,
        title: `🌋 【利空】${target.name}近海發生規模 6.5 強震，基礎設施啟動檢修`,
        content: `【GNN 地質快訊】震央位於 (${coordStr})，${target.name}交通與能源管線暫時降載運行，投資人紛紛避險減碼。`
      },
      {
        type: '新聞',
        sev: '一般',
        minImp: -0.045, maxImp: -0.02,
        title: `📉 【利空】${target.name}央行釋出緊縮訊號，外資機構大舉獲利了結`,
        content: `【GNN 金融市場】市場擔憂${target.currency}流動性收緊，短線賣壓湧現導致${target.name}代表股走弱。`
      },
      {
        type: '新聞',
        sev: '一般',
        minImp: -0.04, maxImp: -0.018,
        title: `⚠️ 【利空】${target.name}部分製造業傳出原物料短缺與罷工協商`,
        content: `【GNN 產業動態】${target.capital}工會與資方就薪資調整展開談判，部分產線暫緩出貨，影響本季獲利預估。`
      }
    ];
    picked = badPool[Math.floor(Math.random() * badPool.length)];
    impactPct = picked.minImp + Math.random() * (picked.maxImp - picked.minImp);
  }

  let stockNote = '';
  if (stock) {
    stock.prevPrice = stock.price;
    stock.price = Math.max(5, Number((stock.price * (1 + impactPct)).toFixed(2)));
    const sign = impactPct > 0 ? '+' : '';
    const pctStr = `${sign}${(impactPct * 100).toFixed(2)}%`;
    stockNote = `（股市即時反應：${stock.ticker} ${pctStr} ➔ $${stock.price.toFixed(2)}）`;

    // 同步記錄到交易所明細
    stockLogs.unshift({
      time: new Date().toLocaleTimeString(),
      actor: isGoodNews ? '📰 利多新聞買盤' : '📰 利空新聞賣壓',
      action: isGoodNews ? '買進' : '賣出',
      ticker: stock.ticker,
      shares: Math.floor(Math.random() * 150) + 50,
      price: stock.price
    });
    if (stockLogs.length > 25) stockLogs.pop();
  }

  eventsData.unshift({
    id: `gnn-${Date.now()}`,
    year: simDate.year,
    dateStr: `${simDate.year}/${simDate.month}/${simDate.day} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`,
    type: picked.type,
    severity: picked.sev,
    region: `${target.flag} ${target.name}`,
    title: picked.title,
    content: picked.content + stockNote
  });

  if (eventsData.length > 60) eventsData.pop();
  saveAll();
}

// ==========================================
// 2. 全球股票系統 (玩家買賣 + 系統虛擬買家 AI)
// ==========================================
function generateInitialStocks() {
  return countriesData.map(c => ({
    ticker: `${c.code}.WSE`,
    name: `${c.name}國家控股集團`,
    countryId: c.id,
    price: Number((80 + Math.random() * 120).toFixed(2)),
    prevPrice: 100,
    volume: 15000
  }));
}

function syncStocksWithCountries() {
  countriesData.forEach(c => {
    if (!stocksData.some(s => s.countryId === c.id)) {
      stocksData.push({
        ticker: `${c.code}.WSE`,
        name: `${c.name}國家開發集團`,
        countryId: c.id,
        price: 100.00,
        prevPrice: 100.00,
        volume: 5000
      });
    }
  });
}

// 系統虛擬買家 AI（每 4 秒自動撮合買賣）
function startVirtualBuyersLoop() {
  if (aiMarketTimer) clearInterval(aiMarketTimer);
  aiMarketTimer = setInterval(() => {
    if (stocksData.length === 0 || flowSpeed === 0) return;

    const targetStock = stocksData[Math.floor(Math.random() * stocksData.length)];
    const virtualFunds = ['🤖 星際主權基金', '🤖 量子避險資本', '🤖 遠洋貿易銀行', '🤖 散戶自動交易程式', '🤖 皇家退休基金'];
    const buyerName = virtualFunds[Math.floor(Math.random() * virtualFunds.length)];
    const isBuy = Math.random() < 0.5;
    const shares = Math.floor(Math.random() * 80) + 10;

    const deltaPct = (isBuy ? 1 : -1) * (0.002 + Math.random() * 0.01);
    targetStock.prevPrice = targetStock.price;
    targetStock.price = Math.max(5, Number((targetStock.price * (1 + deltaPct)).toFixed(2)));
    targetStock.volume += shares;

    stockLogs.unshift({
      time: new Date().toLocaleTimeString(),
      actor: buyerName,
      action: isBuy ? '買進' : '賣出',
      ticker: targetStock.ticker,
      shares,
      price: targetStock.price
    });
    if (stockLogs.length > 25) stockLogs.pop();

    localStorage.setItem(KEYS.STOCKS, JSON.stringify(stocksData));
    renderStocksMarket();
    renderDashboard();
  }, 4000);
}

function renderStocksMarket() {
  const listEl = document.getElementById('stocks-market-list');
  if (!listEl) return;

  listEl.innerHTML = stocksData.map(st => {
    const c = countriesData.find(item => item.id === st.countryId);
    const diff = st.price - st.prevPrice;
    const pct = st.prevPrice ? ((diff / st.prevPrice) * 100).toFixed(2) : '0.00';
    const isUp = diff >= 0;

    return `
      <div class="stock-row">
        <div>
          <strong>${c ? c.flag : '🏢'} ${st.name}</strong>
          <span class="event-tag" style="margin-left:6px;">${st.ticker}</span>
          <div style="font-size:0.78rem; color:var(--text-muted); margin-top:4px;">成交量：${st.volume.toLocaleString()} 股</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:1.15rem; font-weight:bold;">$${st.price.toFixed(2)}</div>
          <div class="${isUp ? 'price-up' : 'price-down'}" style="font-size:0.82rem;">
            ${isUp ? '▲' : '▼'} ${Math.abs(diff).toFixed(2)} (${isUp ? '+' : ''}${pct}%)
          </div>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('player-cash').textContent = `$${playerPortfolio.cash.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  let portVal = 0;
  const holdingEntries = Object.entries(playerPortfolio.holdings).filter(([, qty]) => qty > 0);

  if (holdingEntries.length === 0) {
    document.getElementById('my-holdings-list').textContent = '尚未持有任何股票';
  } else {
    document.getElementById('my-holdings-list').innerHTML = holdingEntries.map(([ticker, qty]) => {
      const st = stocksData.find(s => s.ticker === ticker);
      const val = st ? st.price * qty : 0;
      portVal += val;
      return `<div>• <strong>${ticker}</strong>：${qty} 股（市值 $${val.toLocaleString(undefined, { maximumFractionDigits: 2 })}）</div>`;
    }).join('');
  }
  document.getElementById('player-portfolio-val').textContent = `$${portVal.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  document.getElementById('stock-ticker-log').innerHTML = stockLogs.map(log => `
    <div style="font-size:0.8rem; padding:6px 0; border-bottom:1px solid var(--border); display:flex; justify-content:space-between;">
      <span>[${log.time}] <strong>${log.actor}</strong> <span class="${log.action === '買進' ? 'price-up' : 'price-down'}">${log.action}</span> ${log.ticker} × ${log.shares}</span>
      <span>@$${log.price.toFixed(2)}</span>
    </div>
  `).join('');
}

// ==========================================
// 3. 聯合國大會制度 (議事聊天室 + 決議案投票)
// ==========================================
function getSpeakerIdentity() {
  if (!currentUser) return '👤 訪客觀察員';
  if (isAdmin()) return `👑 聯合國秘書長 (${worldData.administrator})`;
  const myCountry = countriesData.find(c => c.owner === currentUser.username);
  return myCountry ? `${myCountry.flag} ${myCountry.name}代表 (${currentUser.username})` : `🎮 無領土代表 (${currentUser.username})`;
}

function renderUNChamber() {
  document.getElementById('un-speaker-badge').textContent = `發言身份：${getSpeakerIdentity()}`;
  const chatBox = document.getElementById('un-chat-messages');
  chatBox.innerHTML = unMessages.map(m => `
    <div class="chat-msg ${m.isAdmin ? 'admin-msg' : ''}">
      <div class="chat-header">
        <span>${m.sender}</span>
        <span style="color:var(--text-muted); font-weight:normal;">${m.time}</span>
      </div>
      <div style="font-size:0.9rem; line-height:1.45;">${m.text}</div>
    </div>
  `).join('');
  chatBox.scrollTop = chatBox.scrollHeight;

  document.getElementById('un-proposals-list').innerHTML = unProposals.map(p => `
    <div class="event-card">
      <div class="event-meta">
        <span class="event-tag">提案國：${p.author}</span>
        <span style="color:var(--success)">👍 贊成：${p.yes}</span>
        <span style="color:var(--danger)">👎 反對：${p.no}</span>
      </div>
      <h4>${p.title}</h4>
      <p style="margin-bottom:10px;">${p.desc}</p>
      <div style="display:flex; gap:8px;">
        <button class="btn-secondary" onclick="voteUNProposal('${p.id}', 'yes')">👍 投贊成票</button>
        <button class="btn-secondary" onclick="voteUNProposal('${p.id}', 'no')">👎 投反對票</button>
      </div>
    </div>
  `).join('');
}

function voteUNProposal(propId, choice) {
  if (!currentUser) return alert('🔑 請先登入帳號才能代表國家參與聯合國投票！');
  const prop = unProposals.find(p => p.id === propId);
  if (!prop) return;
  if (choice === 'yes') prop.yes += 1;
  else prop.no += 1;

  unMessages.push({
    sender: '🏛️ 大會計票系統',
    text: `${getSpeakerIdentity()} 對「${prop.title}」投下了【${choice === 'yes' ? '贊成' : '反對'}】票！`,
    time: `${simDate.year}/${simDate.month}/${simDate.day}`,
    isAdmin: false
  });
  saveAll();
}

// ==========================================
// 4. 國家獨特官方網站 (National Portal) 渲染
// ==========================================
function openNationalPortal(countryId) {
  const c = countriesData.find(item => item.id === countryId);
  if (!c) return;
  const web = c.website || { theme: 'cyber', slogan: c.officialName, notice: '歡迎造訪！', culture: c.description };
  const themeClass = `theme-${web.theme || 'cyber'}`;
  const stock = stocksData.find(s => s.countryId === c.id);

  document.getElementById('national-portal-container').className = `portal-window ${themeClass}`;
  document.getElementById('national-portal-container').innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.2); padding-bottom:16px; margin-bottom:24px;">
      <div style="display:flex; align-items:center; gap:14px;">
        <span style="font-size:3rem;">${c.flag}</span>
        <div>
          <h1 style="font-size:1.8rem;">${c.officialName} 官方入口網站</h1>
          <p style="opacity:0.85; font-style:italic;">「${web.slogan}」</p>
        </div>
      </div>
      <button class="close-btn" onclick="document.getElementById('national-portal-modal').classList.add('hidden')">✕ 離開官網</button>
    </div>

    <div style="background:rgba(0,0,0,0.25); padding:14px 18px; border-radius:10px; margin-bottom:20px; border-left:4px solid ${c.color || '#38bdf8'};">
      <strong>📢 國家最新頭條公告：</strong> ${web.notice}
    </div>

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:20px;">
      <div style="background:rgba(255,255,255,0.06); padding:18px; border-radius:12px;">
        <h3 style="margin-bottom:10px;">🏛️ 國家基本國情</h3>
        <p>• <strong>首都：</strong>${c.capital} (${c.coords?.lat ?? 0}°, ${c.coords?.lon ?? 0}°)</p>
        <p>• <strong>政治體制：</strong>${c.government}</p>
        <p>• <strong>國家元首：</strong>${c.leader}</p>
        <p>• <strong>官方語言：</strong>${c.language}</p>
        <p>• <strong>法定貨幣：</strong>${c.currency}</p>
        <p>• <strong>總人口：</strong>${Number(c.population).toLocaleString()} 人</p>
      </div>

      <div style="background:rgba(255,255,255,0.06); padding:18px; border-radius:12px;">
        <h3 style="margin-bottom:10px;">🎭 文化特色與觀光指南</h3>
        <p style="line-height:1.6;">${web.culture}</p>
        <p style="margin-top:12px;"><strong>🏙️ 推薦造訪城市：</strong>${c.cities.join('、')}</p>
        ${stock ? `<p style="margin-top:8px;"><strong>📈 國家代表股：</strong>${stock.ticker} ($${stock.price.toFixed(2)})</p>` : ''}
      </div>
    </div>
  `;
  document.getElementById('national-portal-modal').classList.remove('hidden');
}

// ==========================================
// 5. 權限、地圖與基礎視圖渲染
// ==========================================
function isAdmin() { return currentUser && currentUser.role === 'ADMIN'; }
function canEditCountry(country) {
  if (!currentUser) return false;
  return isAdmin() || country.owner === currentUser.username;
}

function updateUserUI() {
  const info = document.getElementById('current-user-info');
  if (!currentUser) info.innerHTML = `👤 訪客模式 <small style="color:var(--warning)">(登入可交易/發言)</small>`;
  else if (isAdmin()) info.innerHTML = `👑 <strong>${worldData.adminAccount?.displayName || 'admin'}</strong> <span style="color:var(--danger)">[最高管理員]</span>`;
  else info.innerHTML = `🎮 玩家：<strong>${currentUser.username}</strong>`;
}

function renderAdminPanel() {
  const container = document.getElementById('admin-panel-content');
  if (!isAdmin()) {
    container.innerHTML = `<p class="hint">⚠️ 此區塊僅限系統綁定管理員（帳號 <code>admin</code>）登入後操作踢服與玩家權限。</p>`;
    return;
  }
  container.innerHTML = `
    <p style="color:var(--success); font-size:0.86rem; margin-bottom:12px;">✅ 已驗證系統管理員身份，你可踢除違規玩家：</p>
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
  saveAll();
}

function latLonToPercent(lat, lon) {
  return {
    x: Math.max(2, Math.min(98, ((Number(lon) + 180) / 360) * 100)),
    y: Math.max(3, Math.min(97, ((90 - Number(lat)) / 180) * 100))
  };
}
function percentToLatLon(xPct, yPct) {
  return {
    lat: Number((90 - (yPct / 100) * 180).toFixed(1)),
    lon: Number(((xPct / 100) * 360 - 180).toFixed(1))
  };
}
function calculatePolygonAreaKm2(points) {
  if (!points || points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return Math.round(Math.abs(area / 2) * 85);
}

function renderMap() {
  const svg = document.getElementById('map-svg-layer');
  const pinsContainer = document.getElementById('map-pins-container');
  let svgHTML = '';

  countriesData.forEach(c => {
    const pts = (isDrawMode && document.getElementById('draw-target-country').value === c.id && tempPolygonPoints.length > 0)
      ? tempPolygonPoints : (c.territoryPoints || []);
    if (pts.length >= 2) {
      const pointStr = pts.map(p => `${p.x},${p.y}`).join(' ');
      const color = c.color || '#38bdf8';
      svgHTML += pts.length >= 3
        ? `<polygon points="${pointStr}" fill="${color}" fill-opacity="0.28" stroke="${color}" stroke-width="0.45" />`
        : `<polyline points="${pointStr}" fill="none" stroke="${color}" stroke-width="0.45" stroke-dasharray="1,1" />`;
    }
  });

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

  pinsContainer.innerHTML = countriesData.map(c => {
    const pos = latLonToPercent(c.coords?.lat ?? 0, c.coords?.lon ?? 0);
    let label = `${c.flag} ${c.name}`;
    if (currentMapLayer === 'population') label += ` (${(c.population / 10000).toFixed(0)}萬)`;
    return `<div class="map-pin" style="left:${pos.x}%; top:${pos.y}%; border-color:${c.color || 'var(--accent)'}" onclick="if(!isDrawMode) openCountryWiki('${c.id}')">${label}</div>`;
  }).join('');
}

function renderDashboard() {
  document.getElementById('world-title').textContent = worldData.worldName;
  updateClockUI();

  const totalPop = countriesData.reduce((s, c) => s + Number(c.population), 0);
  const totalGDP = countriesData.reduce((s, c) => s + Number(c.gdp), 0);
  const totalMarketCap = stocksData.reduce((s, st) => s + st.price * 1000000, 0);

  document.getElementById('stat-countries').textContent = `${countriesData.length} 國`;
  document.getElementById('stat-pop').textContent = `${(totalPop / 10000).toLocaleString()} 萬`;
  document.getElementById('stat-gdp').textContent = `$${(totalGDP / 1e12).toFixed(2)} 兆`;
  document.getElementById('stat-market-cap').textContent = `$${(totalMarketCap / 1e8).toFixed(1)} 億`;

  if (eventsData.length > 0) {
    document.getElementById('banner-event-text').innerHTML = `<strong>[${eventsData[0].type}]</strong> ${eventsData[0].title}`;
  }

  const sortedByGDP = [...countriesData].sort((a, b) => b.gdp - a.gdp);
  document.getElementById('gdp-ranking-list').innerHTML = sortedByGDP.map((c, i) => `
    <div class="ranking-item">
      <span>#${i + 1} ${c.flag} <strong>${c.name}</strong></span>
      <span>$${(c.gdp / 1e8).toLocaleString()} 億</span>
    </div>
  `).join('');

  document.getElementById('dashboard-events-list').innerHTML = eventsData.slice(0, 4).map(ev => `
    <div class="event-card type-${ev.type} sev-${ev.severity}" style="margin-bottom:8px; padding:10px;">
      <div class="event-meta"><span class="event-tag">${ev.type}</span><span>${ev.dateStr || ev.year + '年'}</span></div>
      <h4 style="font-size:0.9rem;">${ev.title}</h4>
    </div>
  `).join('');

  if (worldData.timeline) {
    document.getElementById('full-timeline').innerHTML = worldData.timeline.map(t => `<li><span class="timeline-year">${t.year}</span>${t.event}</li>`).join('');
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
  document.getElementById('countries-grid').innerHTML = list.map(c => `
    <div class="country-card">
      <div>
        <h3>${c.flag} ${c.name} <small style="color:var(--text-muted)">(${c.code})</small></h3>
        <p style="font-size:0.78rem; color:var(--accent); margin:4px 0;">👤 玩家：${c.owner} | 📍 ${c.coords?.lat ?? 0}°, ${c.coords?.lon ?? 0}°</p>
        <p style="margin:8px 0; color:var(--text-muted); font-size:0.86rem;">${c.description}</p>
        <div>${c.tags.map(t => `<span class="tag">#${t}</span>`).join('')}</div>
      </div>
      <div class="card-actions">
        <button class="btn-secondary" style="flex:1;" onclick="openCountryWiki('${c.id}')">📖 Wiki</button>
        <button class="btn-secondary" style="flex:1;" onclick="openNationalPortal('${c.id}')">🌐 國家官網</button>
        ${canEditCountry(c) ? `<button class="btn-primary" style="padding:6px 10px;" onclick="editCountry('${c.id}')">✏️</button>` : ''}
      </div>
    </div>
  `).join('');
}

function renderTransport() {
  document.getElementById('transport-list').innerHTML = transportData.map(tr => {
    const c1 = countriesData.find(c => c.id === tr.fromCountryId)?.name || '未知';
    const c2 = countriesData.find(c => c.id === tr.toCountryId)?.name || '未知';
    return `<div class="event-card"><div class="event-meta"><span class="event-tag">${tr.type}</span><span>${c1} ⇄ ${c2}</span></div><h4>${tr.name}</h4><p>樞紐：${tr.hubs} ｜ 運量：${tr.capacity}</p></div>`;
  }).join('');
}

function renderDiplomacy() {
  document.getElementById('diplomacy-relations-list').innerHTML = diplomacyData.relations.map(r => {
    const cA = countriesData.find(c => c.id === r.countryA);
    const cB = countriesData.find(c => c.id === r.countryB);
    return `<div class="event-card"><div class="event-meta"><span class="event-tag">${r.status}</span></div><h4>${cA ? cA.flag + cA.name : '未知'} ⇄ ${cB ? cB.flag + cB.name : '未知'}</h4><p>${r.note}</p></div>`;
  }).join('');
  document.getElementById('diplomacy-orgs-list').innerHTML = diplomacyData.organizations.map(org => `
    <div class="event-card" style="border-left-color:var(--success);"><div class="event-meta"><span class="event-tag">總部：${org.hq}</span></div><h4>${org.name}</h4><p>${org.purpose}（成員：${org.members.join('、')}）</p></div>
  `).join('');
}

function populateCountryDropdowns() {
  const allOptions = countriesData.map(c => `<option value="${c.id}">${c.flag} ${c.name}</option>`).join('');
  ['t-from', 't-to', 'd-country-a', 'd-country-b'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = allOptions;
  });
  document.getElementById('e-target-country').innerHTML = `<option value="">無特定國家</option>` + allOptions;

  const editableCountries = countriesData.filter(c => canEditCountry(c));
  document.getElementById('edit-country-selector').innerHTML = `<option value="NEW">➕ 建立全新國家...</option>` +
    editableCountries.map(c => `<option value="${c.id}">✏️ 編輯：${c.flag} ${c.name}</option>`).join('');
  document.getElementById('draw-target-country').innerHTML = editableCountries.map(c => `<option value="${c.id}">${c.flag} ${c.name}</option>`).join('');

  document.getElementById('trade-stock-select').innerHTML = stocksData.map(s =>
    `<option value="${s.ticker}">${s.ticker} - ${s.name} ($${s.price.toFixed(2)})</option>`
  ).join('');
}

function openCountryWiki(countryId) {
  const c = countriesData.find(item => item.id === countryId);
  if (!c) return;
  currentDrawerCountryId = countryId;

  const editBtn = document.getElementById('drawer-edit-btn');
  if (canEditCountry(c)) editBtn.classList.remove('hidden');
  else editBtn.classList.add('hidden');

  document.getElementById('drawer-body').innerHTML = `
    <h2 style="font-size: 1.7rem;">${c.flag} ${c.name}</h2>
    <p style="color: var(--accent); margin-bottom: 14px;">${c.officialName}</p>
    <p style="line-height: 1.6; margin-bottom: 16px;">${c.description}</p>
    <table class="wiki-table">
      <tr><td>玩家擁有者</td><td>${c.owner}</td></tr>
      <tr><td>首都與經緯度</td><td>${c.capital} (${c.coords?.lat ?? 0}°, ${c.coords?.lon ?? 0}°)</td></tr>
      <tr><td>政體 / 元首</td><td>${c.government} / ${c.leader}</td></tr>
      <tr><td>總人口</td><td>${Number(c.population).toLocaleString()} 人</td></tr>
      <tr><td>GDP</td><td>$${Number(c.gdp).toLocaleString()}</td></tr>
      <tr><td>貨幣 / 語言</td><td>${c.currency} / ${c.language}</td></tr>
      <tr><td>主要城市</td><td>${c.cities.join('、')}</td></tr>
    </table>
  `;
  document.getElementById('country-drawer').classList.remove('hidden');
}

function openBuilderForNew() {
  if (!currentUser) { alert('🔑 請先登入或註冊玩家帳號！'); switchView('accounts'); return; }
  document.getElementById('country-builder-form').reset();
  document.getElementById('b-id').value = '';
  document.getElementById('builder-mode-title').textContent = '🎨 創建新國家 & 設計專屬官網';
  document.getElementById('delete-country-btn').classList.add('hidden');
  document.getElementById('permission-notice').textContent = `🎮 目前以「${currentUser.username}」身份建立國家與設計官網。`;
  switchView('builder');
}

function editCountry(countryId) {
  const c = countriesData.find(item => item.id === countryId);
  if (!c || !canEditCountry(c)) return alert('⛔ 無編輯權限！');
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

  document.getElementById('b-web-theme').value = c.website?.theme || 'cyber';
  document.getElementById('b-web-slogan').value = c.website?.slogan || '';
  document.getElementById('b-web-notice').value = c.website?.notice || '';
  document.getElementById('b-web-culture').value = c.website?.culture || '';

  document.getElementById('builder-mode-title').textContent = `✏️ 管理國家與官網：${c.flag} ${c.name}`;
  document.getElementById('delete-country-btn').classList.remove('hidden');
  document.getElementById('edit-country-selector').value = c.id;
  switchView('builder');
}

// ==========================================
// 6. 所有表單與互動事件綁定
// ==========================================
function setupEventListeners() {
  document.querySelectorAll('.nav-btn:not(.disabled)').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.view === 'builder') openBuilderForNew();
      else switchView(btn.dataset.view);
    });
  });

  // Flow Time 流速切換
  document.querySelectorAll('.flow-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.flow-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      flowSpeed = Number(btn.dataset.speed);
      const badge = document.getElementById('flow-status-badge');
      badge.textContent = flowSpeed === 0 ? '已暫停' : `${flowSpeed}x (${(30 / flowSpeed).toFixed(1)}m/日)`;
    });
  });

  // 股票下單交易
  document.getElementById('stock-trade-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!currentUser) return alert('🔑 請先登入玩家帳號才能買賣股票！');

    const ticker = document.getElementById('trade-stock-select').value;
    const action = document.getElementById('trade-action').value;
    const shares = Number(document.getElementById('trade-shares').value);
    const stock = stocksData.find(s => s.ticker === ticker);
    if (!stock || shares <= 0) return;

    const totalCost = stock.price * shares;
    const currentOwned = playerPortfolio.holdings[ticker] || 0;

    if (action === 'BUY') {
      if (playerPortfolio.cash < totalCost) return alert('❌ 可用資金不足！');
      playerPortfolio.cash -= totalCost;
      playerPortfolio.holdings[ticker] = currentOwned + shares;
      stock.prevPrice = stock.price;
      stock.price = Number((stock.price * (1 + Math.min(0.05, shares * 0.0005))).toFixed(2));
    } else {
      if (currentOwned < shares) return alert('❌ 持有股數不足！');
      playerPortfolio.cash += totalCost;
      playerPortfolio.holdings[ticker] = currentOwned - shares;
      stock.prevPrice = stock.price;
      stock.price = Math.max(5, Number((stock.price * (1 - Math.min(0.05, shares * 0.0005))).toFixed(2)));
    }

    stock.volume += shares;
    stockLogs.unshift({
      time: new Date().toLocaleTimeString(),
      actor: `🎮 ${currentUser.username}`,
      action: action === 'BUY' ? '買進' : '賣出',
      ticker,
      shares,
      price: stock.price
    });
    saveAll();
    alert(`✅ 交易成功！已${action === 'BUY' ? '買進' : '賣出'} ${ticker} ${shares} 股。`);
  });

  // 聯合國大會發言 & 提案
  document.getElementById('un-chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('un-chat-input');
    const text = input.value.trim();
    if (!text) return;

    unMessages.push({
      sender: getSpeakerIdentity(),
      text,
      time: `${simDate.year}/${simDate.month}/${simDate.day} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      isAdmin: isAdmin()
    });
    input.value = '';
    saveAll();
  });

  document.getElementById('un-proposal-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!currentUser) return alert('🔑 請先登入帳號再提交聯合國決議案！');
    const title = document.getElementById('un-prop-title').value.trim();
    const desc = document.getElementById('un-prop-desc').value.trim();
    const myCountry = countriesData.find(c => c.owner === currentUser.username);
    const author = myCountry ? `${myCountry.flag} ${myCountry.name}` : currentUser.username;

    unProposals.unshift({ id: `prop-${Date.now()}`, title, desc, author, yes: 1, no: 0 });
    unMessages.push({
      sender: '🏛️ 聯合國議事處',
      text: `📜 ${author} 正式提交了新決議案：「${title}」，請各國代表前往右側投票！`,
      time: `${simDate.year}/${simDate.month}/${simDate.day}`,
      isAdmin: true
    });
    document.getElementById('un-proposal-form').reset();
    saveAll();
  });

  // 帳號登入 / 註冊
  document.getElementById('auth-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const u = document.getElementById('auth-username').value.trim();
    const p = document.getElementById('auth-password').value.trim();

    if (u === (worldData.adminAccount?.username || 'admin')) {
      if (p === (worldData.adminAccount?.password || '2026')) {
        currentUser = { username: u, role: 'ADMIN' };
        localStorage.setItem(KEYS.SESSION, JSON.stringify(currentUser));
        updateUserUI();
        refreshAllViews();
        return alert(`👑 歡迎回來，世界管理員 ${worldData.administrator}！`);
      } else return alert('❌ 管理員密碼錯誤！');
    }

    let player = registeredPlayers.find(pl => pl.username === u);
    if (player) {
      if (player.banned) return alert('🚫 你的帳號已被世界管理員踢出伺服器！');
      if (player.password !== p) return alert('❌ 密碼錯誤！');
    } else {
      player = { username: u, password: p, banned: false };
      registeredPlayers.push(player);
      alert(`🎉 新玩家「${u}」註冊成功！`);
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
  });

  // 地圖經緯度與領土手繪
  const mapCanvas = document.getElementById('world-map-canvas');
  mapCanvas.addEventListener('mousemove', (e) => {
    const rect = mapCanvas.getBoundingClientRect();
    const { lat, lon } = percentToLatLon(((e.clientX - rect.left) / rect.width) * 100, ((e.clientY - rect.top) / rect.height) * 100);
    document.getElementById('cursor-coord-hud').textContent =
      `經緯度：${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
  });

  mapCanvas.addEventListener('click', (e) => {
    if (!isDrawMode) return;
    const targetId = document.getElementById('draw-target-country').value;
    const country = countriesData.find(c => c.id === targetId);
    if (!country || !canEditCountry(country)) return alert('⛔ 無權限繪製此國領土！');

    const rect = mapCanvas.getBoundingClientRect();
    const x = Number((((e.clientX - rect.left) / rect.width) * 100).toFixed(1));
    const y = Number((((e.clientY - rect.top) / rect.height) * 100).toFixed(1));
    const candidate = [...tempPolygonPoints, { x, y }];
    const area = calculatePolygonAreaKm2(candidate);
    const maxArea = country.maxTerritoryArea || 10000;
    if (area > maxArea) return alert(`⚠️ 超過領土面積上限 (${maxArea.toLocaleString()} km²)！`);

    tempPolygonPoints = candidate;
    document.getElementById('draw-used-area').textContent = area.toLocaleString();
    renderMap();
  });

  document.getElementById('toggle-draw-mode-btn').addEventListener('click', () => {
    if (!currentUser) { alert('🔑 請先登入帳號！'); return switchView('accounts'); }
    isDrawMode = !isDrawMode;
    tempPolygonPoints = [];
    document.getElementById('territory-draw-toolbar').classList.toggle('hidden', !isDrawMode);
    mapCanvas.classList.toggle('drawing-mode', isDrawMode);
    renderMap();
  });

  document.getElementById('clear-territory-btn').addEventListener('click', () => { tempPolygonPoints = []; renderMap(); });
  document.getElementById('save-territory-btn').addEventListener('click', () => {
    const targetId = document.getElementById('draw-target-country').value;
    const country = countriesData.find(c => c.id === targetId);
    if (!country || tempPolygonPoints.length < 3) return alert('⚠️ 至少需要 3 個頂點！');
    country.territoryPoints = [...tempPolygonPoints];
    tempPolygonPoints = [];
    saveAll();
    alert('✅ 領土邊界已儲存！');
  });

  document.querySelectorAll('.layer-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentMapLayer = btn.dataset.layer;
      renderMap();
    });
  });

  // 國家創建 / 編輯 / 設計官網表單
  document.getElementById('country-builder-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const existingId = document.getElementById('b-id').value;
    const code = document.getElementById('b-code').value.trim().toUpperCase();
    const name = document.getElementById('b-name').value.trim();
    const flag = document.getElementById('b-flag').value.trim();
    const lat = Number(document.getElementById('b-lat').value);
    const lon = Number(document.getElementById('b-lon').value);

    const websiteConfig = {
      theme: document.getElementById('b-web-theme').value,
      slogan: document.getElementById('b-web-slogan').value.trim() || `歡迎造訪${name}`,
      notice: document.getElementById('b-web-notice').value.trim() || '國政運作一切正常。',
      culture: document.getElementById('b-web-culture').value.trim() || document.getElementById('b-desc').value.trim()
    };

    if (existingId) {
      const target = countriesData.find(c => c.id === existingId);
      if (!target || !canEditCountry(target)) return;
      Object.assign(target, {
        name, officialName: document.getElementById('b-official').value.trim(), code, flag,
        color: document.getElementById('b-color').value, capital: document.getElementById('b-capital').value.trim(),
        government: document.getElementById('b-gov').value.trim(), leader: document.getElementById('b-leader').value.trim(),
        population: Number(document.getElementById('b-pop').value), gdp: Number(document.getElementById('b-gdp').value),
        coords: { lat, lon }, currency: document.getElementById('b-currency').value.trim(),
        language: document.getElementById('b-lang').value.trim(), religion: document.getElementById('b-religion').value.trim(),
        cities: document.getElementById('b-cities').value.split('、').map(s => s.trim()).filter(Boolean),
        tags: document.getElementById('b-tags').value.split(',').map(s => s.trim()).filter(Boolean),
        description: document.getElementById('b-desc').value.trim(),
        website: websiteConfig
      });
      alert(`✅ 「${flag} ${name}」與專屬國家官網已更新！`);
    } else {
      const pos = latLonToPercent(lat, lon);
      const newC = {
        id: `${code.toLowerCase()}-${Date.now().toString().slice(-4)}`,
        owner: currentUser.username, name, officialName: document.getElementById('b-official').value.trim(),
        code, flag, color: document.getElementById('b-color').value, capital: document.getElementById('b-capital').value.trim(),
        government: document.getElementById('b-gov').value.trim(), leader: document.getElementById('b-leader').value.trim(),
        population: Number(document.getElementById('b-pop').value), gdp: Number(document.getElementById('b-gdp').value),
        coords: { lat, lon }, maxTerritoryArea: 10000,
        territoryPoints: [
          { x: Math.max(5, pos.x - 4), y: Math.max(5, pos.y - 4) },
          { x: Math.min(95, pos.x + 4), y: Math.max(5, pos.y - 4) },
          { x: Math.min(95, pos.x + 4), y: Math.min(95, pos.y + 4) },
          { x: Math.max(5, pos.x - 4), y: Math.min(95, pos.y + 4) }
        ],
        currency: document.getElementById('b-currency').value.trim(), language: document.getElementById('b-lang').value.trim(),
        religion: document.getElementById('b-religion').value.trim(),
        cities: document.getElementById('b-cities').value.split('、').map(s => s.trim()).filter(Boolean),
        tags: document.getElementById('b-tags').value.split(',').map(s => s.trim()).filter(Boolean),
        description: document.getElementById('b-desc').value.trim(),
        website: websiteConfig
      };
      countriesData.push(newC);
      syncStocksWithCountries();
      alert(`🎉 國家「${flag} ${name}」已成立，專屬官網與股票代碼 (${code}.WSE) 已自動上線！`);
    }
    saveAll();
  });

  // 手動新聞通播（附帶股價連動）
  document.getElementById('event-publish-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const targetCountryId = document.getElementById('e-target-country').value;
    const impact = Number(document.getElementById('e-market-impact').value);
    let content = document.getElementById('e-content').value.trim();

    if (targetCountryId && impact !== 0) {
      const st = stocksData.find(s => s.countryId === targetCountryId);
      if (st) {
        st.prevPrice = st.price;
        st.price = Math.max(5, Number((st.price * (1 + impact)).toFixed(2)));
        content += `（股市連動：${st.ticker} ${impact > 0 ? '+' : ''}${(impact * 100).toFixed(0)}% ➔ $${st.price}）`;
      }
    }

    eventsData.unshift({
      id: `evt-${Date.now()}`,
      year: simDate.year,
      dateStr: `${simDate.year}/${simDate.month}/${simDate.day}`,
      type: document.getElementById('e-type').value,
      severity: document.getElementById('e-severity').value,
      region: document.getElementById('e-region').value.trim(),
      title: document.getElementById('e-title').value.trim(),
      content
    });
    saveAll();
    document.getElementById('event-publish-form').reset();
    alert('📡 新聞已發布並同步影響股市！');
  });

  // 其他按鈕事件
  document.getElementById('event-filter-type').addEventListener('change', (e) => renderEventsFeed(e.target.value));
  document.getElementById('trigger-auto-event-btn').addEventListener('click', () => triggerAutoNewsStation());
  document.getElementById('drawer-portal-btn').addEventListener('click', () => { if (currentDrawerCountryId) openNationalPortal(currentDrawerCountryId); });
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
    renderCountriesGrid(countriesData.filter(c => c.name.toLowerCase().includes(kw) || c.owner.toLowerCase().includes(kw) || c.tags.some(t => t.toLowerCase().includes(kw))));
    switchView('countries');
  });
  document.getElementById('transport-form').addEventListener('submit', (e) => {
    e.preventDefault();
    transportData.push({
      id: `tr-${Date.now()}`, type: document.getElementById('t-type').value, name: document.getElementById('t-name').value.trim(),
      fromCountryId: document.getElementById('t-from').value, toCountryId: document.getElementById('t-to').value,
      hubs: document.getElementById('t-hubs').value.trim(), capacity: document.getElementById('t-cap').value.trim()
    });
    saveAll();
    document.getElementById('transport-form').reset();
  });
  document.getElementById('diplomacy-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const cA = document.getElementById('d-country-a').value, cB = document.getElementById('d-country-b').value;
    if (cA === cB) return alert('⚠️ 請選擇兩個不同的國家！');
    diplomacyData.relations.unshift({ id: `rel-${Date.now()}`, countryA: cA, countryB: cB, status: document.getElementById('d-status').value, note: document.getElementById('d-note').value.trim() });
    saveAll();
    document.getElementById('diplomacy-form').reset();
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
