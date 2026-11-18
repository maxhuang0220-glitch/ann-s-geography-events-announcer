// ==========================================
// ☁️ 全服雲端自動儲存設定 (JSONBin.io)
// 填入你的 BIN_ID 與 API_KEY 後，所有玩家資料將自動雲端儲存並跨裝置即時同步！
// ==========================================
const CLOUD_CONFIG = {
  BIN_ID: '6afdba8aac6210605a91eb80',
  API_KEY: '$2a$10$ew.hZs85AT40frZdjdtZJeqgpM35jIlI.mQNGpOuYPO.db4QGtu6O'
};

let worldData = {};
let countriesData = [];
let eventsData = [];
let pendingNewsData = [];
let transportData = [];
let diplomacyData = { relations: [], organizations: [] };

// 股票市場與玩家資金狀態
let stocksData = [];
let stockLogs = [];
let allPortfolios = {}; // { [username]: { cash: 100000, holdings: {} } } 雲端儲存所有玩家的資金與持股
let selectedChartTicker = '';
let chartShowAllHistory = true;

// 聯合國大會聊天室 & 決議案狀態
let unMessages = [];
let unProposals = [];

// 帳號與權限狀態
let currentUser = null;
let registeredPlayers = [];

// 跨機標準時間與確定性同步參數
const MS_PER_SIM_DAY = 30 * 60 * 1000;
const AUTO_NEWS_INTERVAL_MS = 30 * 1000;
const MAX_PLAYER_STOCKS = 10;

let simDate = { year: 2028, month: 1, day: 1, dayProgress: 0 };
let flowSpeed = 1;
let speedOffsetMs = 0;
let speedAnchorRealMs = Date.now();
let syncLoopTimer = null;
let cloudPullTimer = null;
let lastSyncedTickSlot = 0;
let lastProcessedTotalSimDays = -1;
let lastCloudUpdatedAt = 0;
let isCloudSyncing = false;

let currentMapLayer = 'political';
let isDrawMode = false;
let tempPolygonPoints = [];
let currentDrawerCountryId = null;

// 本地永久備份鍵名（即使網頁改版升級也保留舊版資料自動遷移）
const STORAGE_BACKUP_KEY = 'vw_persistent_world_state_v1';
const SESSION_KEY = 'vw_current_login_session';

// ==========================================
// ☁️ 雲端自動儲存與拉取核心引擎
// ==========================================
function isCloudEnabled() {
  return (
    CLOUD_CONFIG.BIN_ID &&
    !CLOUD_CONFIG.BIN_ID.includes('請在此貼上') &&
    CLOUD_CONFIG.API_KEY &&
    !CLOUD_CONFIG.API_KEY.includes('請在此貼上')
  );
}

function buildPersistPayload() {
  const customStocks = stocksData
    .filter(s => s.isCustom)
    .map(s => ({
      ticker: s.ticker,
      name: s.name,
      countryId: s.countryId,
      owner: s.owner,
      ipoPrice: s.ipoPrice || s.price,
      volume: s.volume,
      isCustom: true
    }));

  const customEvents = eventsData.filter(e => e.isCustom);

  return {
    updatedAt: Date.now(),
    countriesData,
    customEvents,
    pendingNewsData,
    transportData,
    diplomacyData,
    customStocks,
    allPortfolios,
    unMessages,
    unProposals,
    registeredPlayers
  };
}

function applyPersistedState(state, defCountries, defEvents, defTransport, defDiplomacy) {
  if (!state || typeof state !== 'object') return;
  if (Array.isArray(state.countriesData) && state.countriesData.length > 0) {
    countriesData = state.countriesData;
  } else if (defCountries) {
    countriesData = defCountries;
  }

  pendingNewsData = Array.isArray(state.pendingNewsData) ? state.pendingNewsData : pendingNewsData;
  transportData = Array.isArray(state.transportData) ? state.transportData : (defTransport || transportData);
  diplomacyData = state.diplomacyData && state.diplomacyData.relations ? state.diplomacyData : (defDiplomacy || diplomacyData);
  allPortfolios = state.allPortfolios && typeof state.allPortfolios === 'object' ? state.allPortfolios : allPortfolios;
  unMessages = Array.isArray(state.unMessages) && state.unMessages.length > 0 ? state.unMessages : unMessages;
  unProposals = Array.isArray(state.unProposals) && state.unProposals.length > 0 ? state.unProposals : unProposals;
  registeredPlayers = Array.isArray(state.registeredPlayers) && state.registeredPlayers.length > 0 ? state.registeredPlayers : registeredPlayers;

  if (state.updatedAt) lastCloudUpdatedAt = state.updatedAt;

  // 確保每個國家都有官網物件
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

  // 重建全服同步股票與新聞（並注入玩家自訂股票與管理員核准新聞）
  rebuildGlobalSyncedMarketAndNews(
    countriesData,
    defEvents || [],
    state.customStocks || [],
    state.customEvents || []
  );
}

// 背景自動上傳所有使用者資料到雲端（防洗掉保護）
async function pushStateToCloud(payload) {
  if (!isCloudEnabled() || isCloudSyncing) return;
  isCloudSyncing = true;
  updateCloudBadge('☁️ 雲端儲存中...');
  try {
    const res = await fetch(`https://api.jsonbin.io/v3/b/${CLOUD_CONFIG.BIN_ID}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': CLOUD_CONFIG.API_KEY
      },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      lastCloudUpdatedAt = payload.updatedAt;
      updateCloudBadge('☁️ 雲端已同步');
    } else {
      updateCloudBadge('⚠️ 雲端寫入異常');
    }
  } catch (e) {
    console.warn('雲端上傳失敗，已保存在本地安全快取：', e);
    updateCloudBadge('⚠️ 離線本地備份');
  } finally {
    isCloudSyncing = false;
  }
}

// 從雲端拉取最新全服資料
async function pullStateFromCloud(isInitial = false) {
  if (!isCloudEnabled() || isCloudSyncing) return null;
  try {
    const res = await fetch(`https://api.jsonbin.io/v3/b/${CLOUD_CONFIG.BIN_ID}/latest`, {
      headers: { 'X-Master-Key': CLOUD_CONFIG.API_KEY }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const record = data.record;
    if (record && record.updatedAt && (isInitial || record.updatedAt > lastCloudUpdatedAt)) {
      updateCloudBadge('☁️ 雲端已同步');
      return record;
    }
    updateCloudBadge('☁️ 雲端已同步');
  } catch (e) {
    if (isInitial) updateCloudBadge('⚠️ 單機備份模式');
  }
  return null;
}

function updateCloudBadge(text) {
  const el = document.getElementById('world-clock-display');
  if (!el) return;
  el.title = text;
}

// ==========================================
// 跨機確定性隨機數產生器 (Mulberry32 PRNG)
// ==========================================
function createSeededRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStringToSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ==========================================
// 70 種新聞事件模板庫
// ==========================================
function build70NewsTemplates() {
  const templates = [];

  templates.push({
    type: '超級大漲', sev: '緊急', minImp: 0.25, maxImp: 0.35,
    titleFn: (c) => `🚀 【超級大漲】${c.name}宣布「跨維度零點能源反應爐」商業化成功！`,
    contentFn: (c) => `【GNN 全球頭條】${c.name}皇家科學院在${c.capital}正式點亮全球首座零成本清潔能源核心，全球主權基金瘋狂掃貨，該國股價迎來史詩級暴漲！`
  });

  templates.push({
    type: '史詩崩盤', sev: '緊急', minImp: -0.38, maxImp: -0.28,
    titleFn: (c) => `💥 【史詩崩盤】${c.name}中央清算銀行遭量子駭客癱瘓，金融體系爆發恐慌拋售！`,
    contentFn: (c) => `【GNN 紅色警報】${c.capital}證券與外匯清算系統突發大規模熔斷，流動性瞬間枯竭，市場出現不計代價的恐慌性崩盤抛售！`
  });

  const strongBullTopics = [
    ['發現全球最大深海稀土與氦-3礦脈', '探勘船隊傳回捷報，未來三十年戰略資源自給無虞'],
    ['與三大星際貿易聯盟簽署零關稅自由貿易協定', '出口訂單預期將呈現倍數級成長'],
    ['新一代反重力磁浮貨運網全線貫通', '跨國物流成本驟降六成，企業獲利大幅上修'],
    ['主權財富基金宣布啟動千億級股票庫藏股回購', '強力護盤決心激勵外資機構大舉加碼'],
    ['生物基因工程中心成功研發長壽抗衰老新藥', '全球醫藥專利授權金湧入國庫'],
    ['年度 GDP 成長率突破 9.8% 創下歷史新高', '經濟基本面極度強勁，吸引全球熱錢匯聚'],
    ['量子超級電腦演算中心在首都正式商轉', '吸引數十家跨國科技巨頭進駐設立總部'],
    ['央行宣布調降企業所得稅並發放科技研發補貼', '民營企業資本支出意願大幅攀升'],
    ['全球主權評級機構將該國信用評等調升至 AAA 最高級', '融資成本大幅降低，股匯雙雙走強'],
    ['成功奪得下屆世界科技博覽會主辦權', '觀光、基建與內需消費題材全面點火']
  ];
  strongBullTopics.forEach(([headline, detail]) => {
    templates.push({
      type: '新聞', sev: '重大', minImp: 0.06, maxImp: 0.11,
      titleFn: (c) => `📈 【強勁利多】${c.name}${headline}`,
      contentFn: (c) => `【GNN 財經快訊】${c.officialName}今日宣布${detail}，投資人信心大振。`
    });
  });

  const strongBearTopics = [
    ['近海發生規模 7.1 強震，主要工業園區暫時停工檢修', '基礎設施受損引發供應鏈斷鏈擔憂'],
    ['超級氣旋風暴正面登陸沿海港口，海運航線全面停航', '進出口貿易被迫中斷，航運與製造股承壓'],
    ['大型商業銀行爆發壞帳準備金不足危機', '金融體系緊縮引發市場避險情緒升溫'],
    ['能源管線發生重大洩漏事故，工業用電啟動分區限電', '高耗能產業產能利用率被迫下調'],
    ['國際貿易仲裁庭裁定對該國出口商品課徵懲罰性關稅', '外銷主力企業營收面臨嚴峻挑戰'],
    ['央行意外大幅升息三碼以對抗輸入性通膨', '資金成本高漲導致股市估值面臨修正'],
    ['主要礦產區爆發無限期全國性大罷工', '原物料報價飆升，下游製造業毛利受創'],
    ['國防部宣布提升邊境戰備等級並實施部分空域管制', '地緣政治風險升溫促使外資短線撤離'],
    ['關鍵半導體晶圓廠發生無塵室電力中斷事故', '全球科技供應鏈出貨時程被迫延後'],
    ['財政部公布季度赤字擴大並擬開徵資本利得附加稅', '市場賣壓湧現，權值股普遍走跌']
  ];
  strongBearTopics.forEach(([headline, detail]) => {
    templates.push({
      type: '自然災害', sev: '重大', minImp: -0.11, maxImp: -0.06,
      titleFn: (c) => `📉 【強勁利空】${c.name}${headline}`,
      contentFn: (c) => `【GNN 突發報導】受${detail}影響，${c.capital}交易大廳湧現明顯調節賣壓。`
    });
  });

  const mildBullTopics = [
    '季度零售銷售數據優於市場分析師預期',
    '觀光局統計入境國際旅客人次較去年同期成長 18%',
    '新世代高速鐵路延伸線順利完成試車通車',
    '國內失業率降至近五年來最低水準',
    '綠色再生能源發電佔比正式突破 65%',
    '多家本土新創企業獲得國際創投基金注資',
    '港口貨櫃吞吐量連續三個月維持正成長',
    '農漁業豐收帶動食品加工出口穩健上揚',
    '政府推出青年創業低利貸款方案刺激內需',
    '國際航空公司新增多條直飛首都的定期航班',
    '製造業採購經理人指數 (PMI) 回升至 54.2 擴張區間',
    '外匯存底穩步增加，匯率維持強勢穩定'
  ];
  mildBullTopics.forEach((topic) => {
    templates.push({
      type: '新聞', sev: '一般', minImp: 0.02, maxImp: 0.05,
      titleFn: (c) => `💹 【溫和利多】${c.name}${topic}`,
      contentFn: (c) => `【GNN 經濟觀察】${c.name}最新公布的經濟指標展現韌性，市場買盤溫和進場承接。`
    });
  });

  const mildBearTopics = [
    '季度出口訂單增速略低於市場先前樂觀預估',
    '國際大宗商品價格上漲墊高企業營運成本',
    '部分科技大廠宣布進入庫存調整期，拉貨動能放緩',
    '房地產成交量較上月小幅萎縮，營建類股走軟',
    '央行會議紀要顯示短期內暫無降息寬鬆空間',
    '外資機構在連續買超後進行例行性獲利了結',
    '夏季高溫乾旱導致水力發電量略為下滑',
    '消費物價指數 (CPI) 微幅高於央行設定目標',
    '跨國海運運費上漲壓縮中小型貿易商利潤',
    '部分傳統產業面臨海外低價競爭壓力',
    '企業季度財報匯兌損失略高於預期',
    '金融監管機構宣布提高銀行業資本適足率門檻'
  ];
  mildBearTopics.forEach((topic) => {
    templates.push({
      type: '新聞', sev: '一般', minImp: -0.05, maxImp: -0.02,
      titleFn: (c) => `📊 【溫和利空】${c.name}${topic}`,
      contentFn: (c) => `【GNN 市場動態】受${topic}影響，投資人操作轉趨謹慎，股價呈現小幅回檔。`
    });
  });

  const microMoveTopics = [
    '證券交易所完成例行性交易主機軟體升級',
    '財政部公布上月稅收統計符合年度預算進度',
    '首都銀行公會舉辦年度金融科技論壇',
    '國營事業公布年度設備維護與資本支出計畫',
    '統計局發布最新人口結構與都市化發展報告',
    '中央氣象局預測下月全國氣候將維持穩定舒適',
    '交通部啟動全國高速公路智慧號誌優化工程',
    '商會代表團出訪鄰國進行例行性經貿交流',
    '央行公開市場操作維持隔夜拆款利率不變',
    '能源局公布本週國內汽柴油參考零售價格微調',
    '工業區管理處舉辦環保減碳技術觀摩會',
    '海關總署啟用新一代自動化通關查驗系統'
  ];
  microMoveTopics.forEach((topic) => {
    templates.push({
      type: '新聞', sev: '一般', minImp: -0.012, maxImp: 0.012,
      titleFn: (c) => `〰️ 【微幅震盪】${c.name}${topic}`,
      contentFn: (c) => `【GNN 簡訊】${c.name}${topic}，市場反應平淡，股價僅出現極小幅度的正常技術性波動。`
    });
  });

  const zeroImpactTopics = [
    '首都國家美術館舉辦「星海與古典」跨國藝術特展',
    '全國青少年交響樂團在音樂廳舉行年度慈善公演',
    '教育部宣布全國中小學新增天文觀測與程式設計課程',
    '國家足球代表隊在國際友誼賽中與對手握手言和',
    '首都中央公園一年一度的春季花卉嘉年華盛大開幕',
    '國家圖書館完成十萬冊珍貴歷史文獻數位化典藏',
    '天文台觀測到本世紀最壯觀的雙子座流星雨極大期',
    '文化部評選出本年度十大歷史建築修復示範社區',
    '全國馬拉松錦標賽吸引超過三萬名跑者熱情參與',
    '國家植物園成功培育出稀有高山蘭花新品種',
    '郵政總局發行「世界自然奇觀」紀念郵票全套',
    '外交部舉辦多國美食文化節，各國使節齊聚交流'
  ];
  zeroImpactTopics.forEach((topic) => {
    templates.push({
      type: '外交條約', sev: '一般', minImp: 0, maxImp: 0,
      titleFn: (c) => `🕊️ 【日常焦點】${c.name}${topic}`,
      contentFn: (c) => `【GNN 生活文化】${c.officialName}今日舉辦${topic}，活動氣氛熱絡（此新聞屬民生文化動態，對金融市場無直接影響）。`
    });
  });

  return templates;
}

const NEWS_70_TEMPLATES = build70NewsTemplates();

// ==========================================
// 全球統一 UTC 時間槽：同步所有使用者的新聞與股價
// ==========================================
function getEpochStartMs() {
  return Date.parse(worldData.epochStartISO || '2026-11-17T00:00:00Z');
}

function getCurrentGlobalTickSlot() {
  const elapsed = Math.max(0, Date.now() - getEpochStartMs());
  return Math.floor(elapsed / AUTO_NEWS_INTERVAL_MS);
}

function formatSimDateFromTickSlot(tickSlot) {
  const baseDate = worldData.epochWorldDate || { year: 2028, month: 1, day: 1 };
  const elapsedMs = tickSlot * AUTO_NEWS_INTERVAL_MS;
  const wholeSimDays = Math.floor(elapsedMs / MS_PER_SIM_DAY);
  const baseTotalDays = (baseDate.year * 360) + ((baseDate.month - 1) * 30) + (baseDate.day - 1);
  const currentTotalDays = baseTotalDays + wholeSimDays;
  const year = Math.floor(currentTotalDays / 360);
  const remAfterYear = currentTotalDays % 360;
  const month = Math.floor(remAfterYear / 30) + 1;
  const day = (remAfterYear % 30) + 1;
  return { year, dateStr: `${year}/${month}/${day} UTC` };
}

function simulateDeterministicGlobalTick(tickSlot, baseCountries, allStockList, generatedEvents, generatedLogs, recordAllPoints = true) {
  const rng = createSeededRandom(hashStringToSeed(`VW-GLOBAL-TICK-${worldData.epochStartISO}-${tickSlot}`));
  const dateInfo = formatSimDateFromTickSlot(tickSlot);

  const virtualFunds = ['🤖 星際主權基金', '🤖 量子避險資本', '🤖 遠洋貿易銀行', '🤖 散戶自動交易程式', '🤖 皇家退休基金'];
  allStockList.forEach(st => {
    const isBuy = rng() < 0.505;
    const deltaPct = (isBuy ? 1 : -1) * (0.0015 + rng() * 0.0085);
    const shares = Math.floor(rng() * 70) + 15;
    st.prevPrice = st.price;
    st.price = Math.max(1, Number((st.price * (1 + deltaPct)).toFixed(2)));
    st.volume += shares;
    if (recordAllPoints) st.history.push(st.price);

    if (generatedLogs && rng() < 0.35) {
      const buyerName = virtualFunds[Math.floor(rng() * virtualFunds.length)];
      generatedLogs.unshift({
        time: dateInfo.dateStr,
        actor: buyerName,
        action: isBuy ? '買進' : '賣出',
        ticker: st.ticker,
        shares,
        price: st.price
      });
    }
  });

  if (baseCountries.length > 0) {
    const target = baseCountries[Math.floor(rng() * baseCountries.length)];
    const countryStocks = allStockList.filter(s => s.countryId === target.id);
    const affectedStock = countryStocks.length > 0 ? countryStocks[Math.floor(rng() * countryStocks.length)] : null;

    const picked = NEWS_70_TEMPLATES[Math.floor(rng() * NEWS_70_TEMPLATES.length)];
    const impactPct = picked.minImp === picked.maxImp
      ? picked.minImp
      : picked.minImp + rng() * (picked.maxImp - picked.minImp);

    let stockNote = '';
    if (affectedStock) {
      if (Math.abs(impactPct) >= 0.001) {
        affectedStock.prevPrice = affectedStock.price;
        affectedStock.price = Math.max(1, Number((affectedStock.price * (1 + impactPct)).toFixed(2)));
        if (recordAllPoints) {
          affectedStock.history[affectedStock.history.length - 1] = affectedStock.price;
        }
        const sign = impactPct > 0 ? '+' : '';
        const pctStr = `${sign}${(impactPct * 100).toFixed(2)}%`;
        stockNote = `（全球股市同步反應：${affectedStock.ticker} ${pctStr} ➔ $${affectedStock.price.toFixed(2)}）`;

        if (generatedLogs) {
          generatedLogs.unshift({
            time: dateInfo.dateStr,
            actor: impactPct > 0 ? '📰 全球利多買盤' : '📰 全球利空賣壓',
            action: impactPct > 0 ? '買進' : '賣出',
            ticker: affectedStock.ticker,
            shares: Math.floor(rng() * 180) + 50,
            price: affectedStock.price
          });
        }
      } else {
        stockNote = `（全球股市同步反應：${affectedStock.ticker} 維持平盤 $0.00%）`;
      }
    }

    if (generatedEvents) {
      generatedEvents.unshift({
        id: `gnn-sync-${tickSlot}`,
        year: dateInfo.year,
        dateStr: dateInfo.dateStr,
        type: picked.type,
        severity: picked.sev,
        region: `${target.flag} ${target.name}`,
        title: picked.titleFn(target),
        content: picked.contentFn(target) + stockNote
      });
    }
  }
}

function rebuildGlobalSyncedMarketAndNews(baseCountries, defaultEvents, customStocksList = [], customEventsList = []) {
  const currentSlot = getCurrentGlobalTickSlot();
  const historyWindowSlots = 240;
  const startSlot = Math.max(1, currentSlot - historyWindowSlots);

  const syncedStocks = baseCountries.map(c => {
    const seedRng = createSeededRandom(hashStringToSeed(`VW-IPO-${worldData.epochStartISO}-${c.id}`));
    const ipoPrice = Number((90 + seedRng() * 80).toFixed(2));
    return {
      ticker: `${c.code}.WSE`,
      name: `${c.name}國家控股集團`,
      countryId: c.id,
      owner: c.owner || 'SYSTEM',
      ipoPrice,
      price: ipoPrice,
      prevPrice: ipoPrice,
      volume: 15000,
      isCustom: false,
      history: [ipoPrice]
    };
  });

  customStocksList.forEach(cs => {
    if (!syncedStocks.some(s => s.ticker === cs.ticker)) {
      const baseP = Number(cs.ipoPrice || cs.price || 100);
      syncedStocks.push({
        ...cs,
        ipoPrice: baseP,
        price: baseP,
        prevPrice: baseP,
        isCustom: true,
        history: [baseP]
      });
    }
  });

  const syncedEvents = [];
  const syncedLogs = [];

  for (let slot = startSlot; slot <= currentSlot; slot++) {
    simulateDeterministicGlobalTick(slot, baseCountries, syncedStocks, syncedEvents, syncedLogs, true);
  }

  eventsData = [...customEventsList, ...syncedEvents.slice(0, 60), ...defaultEvents].slice(0, 90);
  stocksData = syncedStocks;
  stockLogs = syncedLogs.slice(0, 30);
  lastSyncedTickSlot = currentSlot;
}

// ==========================================
// 玩家個人資金與持股存取（自動保存在全服狀態中）
// ==========================================
function getCurrentPlayerPortfolio() {
  const key = currentUser ? currentUser.username : '__GUEST__';
  if (!allPortfolios[key]) {
    allPortfolios[key] = { cash: 100000, holdings: {} };
  }
  return allPortfolios[key];
}

// ==========================================
// 初始化系統（優先從雲端載入，次要讀取本地永久備份，最後讀取預設 JSON）
// ==========================================
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

    // 預設基準狀態
    countriesData = defCountries;
    transportData = defTransport;
    diplomacyData = defDiplomacy;
    unMessages = [
      { sender: '👑 秘書長 (蔡幸恩)', text: '歡迎各國代表進入聯合國大會堂！全服已啟用雲端自動儲存與跨機同步引擎。', time: '2028/01/01', isAdmin: true }
    ];
    unProposals = [
      { id: 'prop-1', title: '第 1 號決議：全球領海與跨國航線自由通行公約', desc: '保障所有主權國家民用航空與商船在公海的和平通行權。', author: '星辰聯邦', yes: 2, no: 0 }
    ];
    registeredPlayers = [
      { username: 'Captain Huang', password: '123', banned: false },
      { username: 'Elena', password: '123', banned: false }
    ];

    // 1. 先載入本地永久備份（確保更新網頁時資料不遺失）
    const localSaved = JSON.parse(localStorage.getItem(STORAGE_BACKUP_KEY));
    if (localSaved) {
      applyPersistedState(localSaved, defCountries, defEvents, defTransport, defDiplomacy);
    } else {
      applyPersistedState({}, defCountries, defEvents, defTransport, defDiplomacy);
    }

    // 2. 接著從雲端資料庫拉取最新全服存檔（若雲端資料較新則自動覆蓋同步）
    const cloudSaved = await pullStateFromCloud(true);
    if (cloudSaved) {
      applyPersistedState(cloudSaved, defCountries, defEvents, defTransport, defDiplomacy);
      localStorage.setItem(STORAGE_BACKUP_KEY, JSON.stringify(cloudSaved));
    }

    currentUser = JSON.parse(localStorage.getItem(SESSION_KEY)) || null;
    if (stocksData.length > 0 && !selectedChartTicker) {
      selectedChartTicker = stocksData[0].ticker;
    }

    flowSpeed = worldData.defaultSpeed ?? 1;
    speedAnchorRealMs = Date.now();
    speedOffsetMs = 0;
    syncStandardWorldTime(true);

    updateUserUI();
    refreshAllViews();
    setupEventListeners();
    startGlobalSyncLoop();
    startCloudAutoPullLoop();
  } catch (err) {
    console.error("初始化失敗：", err);
  }
}

// 統一儲存函式：同時寫入本地永久快取 + 背景自動上傳雲端資料庫
function saveAll() {
  const payload = buildPersistPayload();
  localStorage.setItem(STORAGE_BACKUP_KEY, JSON.stringify(payload));
  refreshAllViews();
  pushStateToCloud(payload);
}

// 每 12 秒背景檢查雲端是否有其他玩家的新操作（新國家、新股票、新聞申請、聯合國發言）
function startCloudAutoPullLoop() {
  if (cloudPullTimer) clearInterval(cloudPullTimer);
  cloudPullTimer = setInterval(async () => {
    const cloudSaved = await pullStateFromCloud(false);
    if (cloudSaved) {
      applyPersistedState(cloudSaved, null, [], null, null);
      localStorage.setItem(STORAGE_BACKUP_KEY, JSON.stringify(cloudSaved));
      refreshAllViews();
    }
  }, 12000);
}

function refreshAllViews() {
  renderDashboard();
  renderEventsFeed(document.getElementById('event-filter-type').value || 'ALL');
  renderPendingNewsPanel();
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
// 1. 跨機 UTC 標準時間 + 每 0.5 分鐘全服同步新聞與股價循環
// ==========================================
function getAccumulatedElapsedMs() {
  if (flowSpeed === 0) return speedOffsetMs;
  return speedOffsetMs + (Date.now() - speedAnchorRealMs) * flowSpeed;
}

function syncStandardWorldTime(isInitial = false) {
  const epochStartMs = getEpochStartMs();
  const baseDate = worldData.epochWorldDate || { year: 2028, month: 1, day: 1 };

  const totalWorldRealMs = Math.max(0, (Date.now() - epochStartMs) + getAccumulatedElapsedMs() - (Date.now() - speedAnchorRealMs));
  const exactTotalSimDays = totalWorldRealMs / MS_PER_SIM_DAY;
  const wholeSimDays = Math.floor(exactTotalSimDays);
  const dayProgress = exactTotalSimDays - wholeSimDays;

  const baseTotalDays = (baseDate.year * 360) + ((baseDate.month - 1) * 30) + (baseDate.day - 1);
  const currentTotalDays = baseTotalDays + wholeSimDays;

  const year = Math.floor(currentTotalDays / 360);
  const remAfterYear = currentTotalDays % 360;
  const month = Math.floor(remAfterYear / 30) + 1;
  const day = (remAfterYear % 30) + 1;

  simDate = { year, month, day, dayProgress };
  updateClockUI();

  if (isInitial) {
    lastProcessedTotalSimDays = wholeSimDays;
  } else if (wholeSimDays > lastProcessedTotalSimDays) {
    const prevYear = Math.floor((baseTotalDays + lastProcessedTotalSimDays) / 360);
    lastProcessedTotalSimDays = wholeSimDays;
    if (year > prevYear) {
      countriesData.forEach(c => {
        c.population = Math.round(Number(c.population) * 1.012);
        c.gdp = Math.round(Number(c.gdp) * 1.025);
      });
      saveAll();
    }
  }
}

function startGlobalSyncLoop() {
  if (syncLoopTimer) clearInterval(syncLoopTimer);
  syncLoopTimer = setInterval(() => {
    syncStandardWorldTime(false);

    if (flowSpeed === 0) return;
    const currentSlot = getCurrentGlobalTickSlot();
    if (currentSlot > lastSyncedTickSlot) {
      for (let slot = lastSyncedTickSlot + 1; slot <= currentSlot; slot++) {
        simulateDeterministicGlobalTick(slot, countriesData, stocksData, eventsData, stockLogs, true);
      }
      if (eventsData.length > 90) eventsData.length = 90;
      if (stockLogs.length > 30) stockLogs.length = 30;
      lastSyncedTickSlot = currentSlot;

      refreshAllViews();
    }
  }, 1000);
}

function updateClockUI() {
  const m = String(simDate.month).padStart(2, '0');
  const d = String(simDate.day).padStart(2, '0');
  const pct = Math.floor((simDate.dayProgress || 0) * 100);
  const cloudTag = isCloudEnabled() ? '☁️' : '💾';
  document.getElementById('world-clock-display').textContent = `${cloudTag} ${simDate.year}年 ${m}月 ${d}日 (${pct}%)`;
}

function recordStockPricePoint(stock, newPrice) {
  stock.prevPrice = stock.price;
  stock.price = Math.max(1, Number(newPrice.toFixed(2)));
  if (!Array.isArray(stock.history)) stock.history = [stock.prevPrice];
  stock.history.push(stock.price);
}

function triggerAutoNewsStation() {
  if (!isAdmin()) {
    return alert('⚠️ 為確保所有玩家的自動新聞與股價完全同步，系統每 0.5 分鐘會依全球標準時間自動同步播報！僅管理員可手動強制插播。');
  }
  const nextSlot = lastSyncedTickSlot + 1;
  simulateDeterministicGlobalTick(nextSlot, countriesData, stocksData, eventsData, stockLogs, true);
  lastSyncedTickSlot = nextSlot;
  refreshAllViews();
}

// ==========================================
// 2. 新聞發布權限分流 & 管理員審核佇列
// ==========================================
function renderPendingNewsPanel() {
  const countEl = document.getElementById('pending-news-count');
  const listEl = document.getElementById('pending-news-list');
  const formTitle = document.getElementById('news-form-title');
  const formHint = document.getElementById('news-permission-hint');
  const submitBtn = document.getElementById('news-submit-btn');

  if (isAdmin()) {
    formTitle.textContent = '📡 管理員直接發布全球新聞聯播';
    formHint.innerHTML = '👑 已驗證世界管理員身份，你送出的新聞將<strong>立即全網廣播、雲端保存並連動股價</strong>。';
    formHint.style.color = 'var(--success)';
    submitBtn.textContent = '📡 立即全網聯播';
  } else {
    formTitle.textContent = '📝 向管理員申請發布新聞';
    formHint.innerHTML = '⚠️ 非管理員無直接發布權限，送出後需等待管理員（<code>admin</code>）核准才會廣播。';
    formHint.style.color = 'var(--warning)';
    submitBtn.textContent = '📩 提交新聞申請給管理員';
  }

  if (countEl) countEl.textContent = pendingNewsData.length;
  if (!listEl) return;

  if (pendingNewsData.length === 0) {
    listEl.innerHTML = `<p class="hint">目前沒有待審核的玩家新聞申請。</p>`;
    return;
  }

  listEl.innerHTML = pendingNewsData.map(item => `
    <div class="event-card" style="padding:10px;">
      <div class="event-meta">
        <span class="event-tag">申請人：${item.applicant}</span>
        <span class="event-tag">${item.type}</span>
        <span>申請波動：${item.impact > 0 ? '+' : ''}${(item.impact * 100).toFixed(0)}%</span>
      </div>
      <h4 style="font-size:0.9rem;">${item.title}</h4>
      <p style="font-size:0.82rem; margin-bottom:8px;">${item.content}</p>
      ${isAdmin() ? `
        <div style="display:flex; gap:8px;">
          <button class="btn-primary" style="padding:5px 10px; font-size:0.8rem;" onclick="reviewPendingNews('${item.id}', true)">✅ 核准並聯播</button>
          <button class="btn-danger" style="padding:5px 10px; font-size:0.8rem;" onclick="reviewPendingNews('${item.id}', false)">❌ 駁回</button>
        </div>
      ` : `<small style="color:var(--warning);">⏳ 等待管理員審核中...</small>`}
    </div>
  `).join('');
}

function reviewPendingNews(reqId, approve) {
  if (!isAdmin()) return alert('⛔ 僅限世界管理員可審核新聞申請！');
  const idx = pendingNewsData.findIndex(p => p.id === reqId);
  if (idx === -1) return;
  const req = pendingNewsData[idx];
  pendingNewsData.splice(idx, 1);

  if (approve) {
    let finalContent = `${req.content}（由 ${req.applicant} 投稿，管理員核准發布）`;
    if (req.targetCountryId && req.impact !== 0) {
      const st = stocksData.find(s => s.countryId === req.targetCountryId);
      if (st) {
        recordStockPricePoint(st, st.price * (1 + req.impact));
        finalContent += `（股市連動：${st.ticker} ${req.impact > 0 ? '+' : ''}${(req.impact * 100).toFixed(0)}% ➔ $${st.price.toFixed(2)}）`;
      }
    }
    eventsData.unshift({
      id: `evt-${Date.now()}`,
      year: simDate.year,
      dateStr: `${simDate.year}/${simDate.month}/${simDate.day} UTC`,
      type: req.type,
      severity: req.severity,
      region: req.region,
      title: req.title,
      content: finalContent,
      isCustom: true
    });
    alert('✅ 已核准並全網聯播該則新聞（已自動存入雲端）！');
  } else {
    alert('🗑️ 已駁回該筆新聞申請。');
  }
  saveAll();
}

// ==========================================
// 3. 全球股票系統 (完整歷史折線圖 + 玩家建股上限 10 支 + 管理員監管)
// ==========================================
function selectChartStock(ticker) {
  selectedChartTicker = ticker;
  const chartSelect = document.getElementById('chart-stock-select');
  if (chartSelect) chartSelect.value = ticker;
  const tradeSelect = document.getElementById('trade-stock-select');
  if (tradeSelect) tradeSelect.value = ticker;
  renderStockLineChart();
}

function renderStockLineChart() {
  const svg = document.getElementById('stock-line-chart');
  const hud = document.getElementById('chart-stats-hud');
  if (!svg || stocksData.length === 0) return;

  const stock = stocksData.find(s => s.ticker === selectedChartTicker) || stocksData[0];
  selectedChartTicker = stock.ticker;
  const fullHistory = stock.history && stock.history.length >= 2 ? stock.history : [stock.prevPrice, stock.price];
  const pts = chartShowAllHistory ? fullHistory : fullHistory.slice(-40);

  const minVal = Math.min(...pts);
  const maxVal = Math.max(...pts);
  const range = Math.max(1, maxVal - minVal);
  const padMin = Math.max(0, minVal - range * 0.12);
  const padMax = maxVal + range * 0.12;
  const padRange = Math.max(0.5, padMax - padMin);

  const firstPrice = pts[0];
  const lastPrice = pts[pts.length - 1];
  const isGain = lastPrice >= firstPrice;
  const strokeColor = isGain ? '#10b981' : '#ef4444';
  const fillColor = isGain ? 'rgba(16, 185, 129, 0.18)' : 'rgba(239, 68, 68, 0.18)';

  if (hud) {
    const totalDiff = lastPrice - firstPrice;
    const totalPct = firstPrice > 0 ? ((totalDiff / firstPrice) * 100).toFixed(2) : '0.00';
    hud.innerHTML = `
      🌐 全服同步點數：<strong style="color:#38bdf8;">${fullHistory.length} 筆</strong> ｜
      目前：<strong style="color:${strokeColor}; font-size:0.95rem;">$${lastPrice.toFixed(2)}</strong> (${isGain ? '+' : ''}${totalPct}%) ｜
      最高：<span style="color:#f8fafc;">$${maxVal.toFixed(2)}</span> ｜
      最低：<span style="color:#f8fafc;">$${minVal.toFixed(2)}</span>
    `;
  }

  const W = 800;
  const H = 230;
  const leftMargin = 62;
  const rightMargin = 22;
  const topMargin = 18;
  const bottomMargin = 24;
  const plotW = W - leftMargin - rightMargin;
  const plotH = H - topMargin - bottomMargin;

  let gridHTML = '';
  for (let i = 0; i <= 3; i++) {
    const ratio = i / 3;
    const y = topMargin + plotH * ratio;
    const priceLabel = (padMax - padRange * ratio).toFixed(2);
    gridHTML += `
      <line x1="${leftMargin}" y1="${y}" x2="${W - rightMargin}" y2="${y}" stroke="rgba(148, 163, 184, 0.16)" stroke-dasharray="4,4" />
      <text x="${leftMargin - 8}" y="${y + 4}" fill="#94a3b8" font-size="11" text-anchor="end" font-family="monospace">$${priceLabel}</text>
    `;
  }

  const coords = pts.map((val, idx) => {
    const x = leftMargin + (idx / Math.max(1, pts.length - 1)) * plotW;
    const y = topMargin + ((padMax - val) / padRange) * plotH;
    return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)), val };
  });

  const linePointsStr = coords.map(c => `${c.x},${c.y}`).join(' ');
  const areaPointsStr = `${coords[0].x},${topMargin + plotH} ${linePointsStr} ${coords[coords.length - 1].x},${topMargin + plotH}`;

  const dotRadius = pts.length > 80 ? 1.2 : (pts.length > 35 ? 1.8 : 2.5);
  const dotsHTML = coords.map((c, idx) => {
    const isLast = idx === coords.length - 1;
    if (!isLast && pts.length > 150 && idx % 2 !== 0) return '';
    return `<circle cx="${c.x}" cy="${c.y}" r="${isLast ? 4.5 : dotRadius}" fill="${isLast ? '#fff' : strokeColor}" stroke="${strokeColor}" stroke-width="1.8" />`;
  }).join('');

  const lastCoord = coords[coords.length - 1];
  const latestTagHTML = `
    <rect x="${Math.min(W - 74, lastCoord.x - 28)}" y="${Math.max(2, lastCoord.y - 22)}" width="64" height="17" rx="4" fill="${strokeColor}" />
    <text x="${Math.min(W - 42, lastCoord.x + 4)}" y="${Math.max(14, lastCoord.y - 10)}" fill="#0f172a" font-size="10.5" font-weight="bold" text-anchor="middle" font-family="monospace">$${lastCoord.val.toFixed(2)}</text>
  `;

  svg.innerHTML = `
    ${gridHTML}
    <polygon points="${areaPointsStr}" fill="${fillColor}" />
    <polyline points="${linePointsStr}" fill="none" stroke="${strokeColor}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" />
    ${dotsHTML}
    ${latestTagHTML}
  `;
}

function adminManageStock(ticker, mode) {
  if (!isAdmin()) return alert('⛔ 僅限世界管理員可管理股票！');
  const idx = stocksData.findIndex(s => s.ticker === ticker);
  if (idx === -1) return;
  const st = stocksData[idx];

  if (mode === 'DELETE') {
    if (!confirm(`確定要將「${st.ticker} - ${st.name}」強制下市刪除嗎？`)) return;
    stocksData.splice(idx, 1);
    if (selectedChartTicker === ticker && stocksData.length > 0) {
      selectedChartTicker = stocksData[0].ticker;
    }
    saveAll();
  } else if (mode === 'PUMP') {
    recordStockPricePoint(st, st.price * 1.15);
    saveAll();
  } else if (mode === 'DUMP') {
    recordStockPricePoint(st, st.price * 0.85);
    saveAll();
  }
}

function renderStocksMarket() {
  const listEl = document.getElementById('stocks-market-list');
  if (!listEl) return;

  const quotaBadge = document.getElementById('player-stock-quota-badge');
  if (quotaBadge) {
    if (!currentUser) {
      quotaBadge.textContent = '請先登入以建立股票';
    } else if (isAdmin()) {
      quotaBadge.textContent = '👑 管理員無上限';
    } else {
      const myCreatedCount = stocksData.filter(s => s.owner === currentUser.username).length;
      quotaBadge.textContent = `已建立：${myCreatedCount} / ${MAX_PLAYER_STOCKS} 支`;
    }
  }

  listEl.innerHTML = stocksData.map(st => {
    const c = countriesData.find(item => item.id === st.countryId);
    const diff = st.price - st.prevPrice;
    const pct = st.prevPrice ? ((diff / st.prevPrice) * 100).toFixed(2) : '0.00';
    const isUp = diff >= 0;
    const isSelected = st.ticker === selectedChartTicker;

    return `
      <div class="stock-row" onclick="selectChartStock('${st.ticker}')" style="cursor:pointer; ${isSelected ? 'border-color: var(--accent); background: rgba(56, 189, 248, 0.08);' : ''}">
        <div>
          <strong>${c ? c.flag : '🏢'} ${st.name}</strong>
          <span class="event-tag" style="margin-left:6px;">${st.ticker}</span>
          <div style="font-size:0.76rem; color:var(--text-muted); margin-top:4px;">
            發行人：${st.owner || 'SYSTEM'} ｜ 歷史點數：${(st.history || []).length} 筆 ｜ 成交量：${st.volume.toLocaleString()}
          </div>
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

  const adminStockEl = document.getElementById('admin-stock-list');
  if (adminStockEl) {
    if (!isAdmin()) {
      adminStockEl.innerHTML = `<p class="hint">⚠️ 僅限世界管理員（<code>admin</code>）登入後可強制調價或下市刪除全服股票。</p>`;
    } else {
      adminStockEl.innerHTML = stocksData.map(st => `
        <div class="ranking-item" style="align-items:center; font-size:0.82rem;">
          <span><strong>${st.ticker}</strong> (${st.owner || 'SYSTEM'}) $${st.price.toFixed(2)}</span>
          <div style="display:flex; gap:4px;">
            <button class="btn-tiny" onclick="adminManageStock('${st.ticker}', 'PUMP')" title="強制拉抬 +15%">📈+15%</button>
            <button class="btn-tiny" onclick="adminManageStock('${st.ticker}', 'DUMP')" title="強制打壓 -15%">📉-15%</button>
            <button class="btn-danger" style="padding:3px 7px; font-size:0.75rem;" onclick="adminManageStock('${st.ticker}', 'DELETE')">🗑️下市</button>
          </div>
        </div>
      `).join('');
    }
  }

  renderStockLineChart();

  const portfolio = getCurrentPlayerPortfolio();
  document.getElementById('player-cash').textContent = `$${portfolio.cash.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  let portVal = 0;
  const holdingEntries = Object.entries(portfolio.holdings).filter(([, qty]) => qty > 0);

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
// 4. 聯合國大會制度
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
// 5. 國家獨特官方網站 (National Portal)
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
// 6. 權限、地圖與基礎視圖渲染
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
  const cloudStatus = isCloudEnabled()
    ? `✅ <strong>雲端自動儲存已啟動</strong>（Bin ID: <code>${CLOUD_CONFIG.BIN_ID}</code>，網頁更新資料永不遺失）`
    : `⚠️ <strong>目前為單機備份模式</strong>（請在 <code>js/app.js</code> 頂端填入 JSONBin <code>BIN_ID</code> 與 <code>API_KEY</code> 以啟用全服雲端儲存）`;

  container.innerHTML = `
    <p style="color:var(--success); font-size:0.86rem; margin-bottom:12px;">
      ${cloudStatus}<br/>
      全服同步時間槽：目前第 <code>${lastSyncedTickSlot}</code> 槽
    </p>
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
  ['t-from', 't-to', 'd-country-a', 'd-country-b', 'cs-country'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = allOptions;
  });
  document.getElementById('e-target-country').innerHTML = `<option value="">無特定國家 (0%)</option>` + allOptions;

  const editableCountries = countriesData.filter(c => canEditCountry(c));
  document.getElementById('edit-country-selector').innerHTML = `<option value="NEW">➕ 建立全新國家...</option>` +
    editableCountries.map(c => `<option value="${c.id}">✏️ 編輯：${c.flag} ${c.name}</option>`).join('');
  document.getElementById('draw-target-country').innerHTML = editableCountries.map(c => `<option value="${c.id}">${c.flag} ${c.name}</option>`).join('');

  const stockOptions = stocksData.map(s =>
    `<option value="${s.ticker}">${s.ticker} - ${s.name} ($${s.price.toFixed(2)})</option>`
  ).join('');
  document.getElementById('trade-stock-select').innerHTML = stockOptions;

  const chartSelect = document.getElementById('chart-stock-select');
  if (chartSelect) {
    chartSelect.innerHTML = stockOptions;
    if (selectedChartTicker) chartSelect.value = selectedChartTicker;
  }
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
  document.getElementById('permission-notice').textContent = `🎮 目前以「${currentUser.username}」身份建立國家與設計官網（建立後自動雲端存檔）。`;
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
// 7. 所有表單與互動事件綁定
// ==========================================
function setupEventListeners() {
  document.querySelectorAll('.nav-btn:not(.disabled)').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.view === 'builder') openBuilderForNew();
      else switchView(btn.dataset.view);
    });
  });

  document.getElementById('chart-stock-select').addEventListener('change', (e) => {
    selectChartStock(e.target.value);
  });

  document.getElementById('toggle-chart-range-btn').addEventListener('click', (e) => {
    chartShowAllHistory = !chartShowAllHistory;
    e.target.textContent = chartShowAllHistory ? '📜 目前顯示：全部歷史紀錄' : '🔍 目前顯示：近期 40 筆紀錄';
    renderStockLineChart();
  });

  document.getElementById('create-stock-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!currentUser) return alert('🔑 請先登入帳號再申請股票掛牌上市！');

    if (!isAdmin()) {
      const myStocksCount = stocksData.filter(s => s.owner === currentUser.username).length;
      if (myStocksCount >= MAX_PLAYER_STOCKS) {
        return alert(`⚠️ 掛牌失敗！每位玩家至多只能建立 ${MAX_PLAYER_STOCKS} 支股票。`);
      }
    }

    const rawCode = document.getElementById('cs-ticker').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!rawCode) return alert('⚠️ 請輸入有效的英數字股票代碼！');
    const ticker = `${rawCode}.WSE`;
    if (stocksData.some(s => s.ticker === ticker)) {
      return alert(`❌ 股票代碼 ${ticker} 已被註冊使用，請更換代碼！`);
    }

    const name = document.getElementById('cs-name').value.trim();
    const countryId = document.getElementById('cs-country').value;
    const initPrice = Math.max(10, Math.min(500, Number(document.getElementById('cs-price').value)));

    const newStock = {
      ticker,
      name,
      countryId,
      owner: currentUser.username,
      ipoPrice: initPrice,
      price: initPrice,
      prevPrice: initPrice,
      volume: 1000,
      isCustom: true,
      history: [initPrice, initPrice]
    };

    stocksData.push(newStock);
    selectedChartTicker = ticker;
    document.getElementById('create-stock-form').reset();
    saveAll();
    alert(`🎉 恭喜！「${name} (${ticker})」已成功上市並自動儲存至雲端！`);
  });

  document.querySelectorAll('.flow-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.flow-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      speedOffsetMs = getAccumulatedElapsedMs();
      speedAnchorRealMs = Date.now();
      flowSpeed = Number(btn.dataset.speed);

      const badge = document.getElementById('flow-status-badge');
      badge.textContent = flowSpeed === 0 ? '已暫停' : `${flowSpeed}x (${(30 / flowSpeed).toFixed(1)}m/日)`;
      syncStandardWorldTime(false);
    });
  });

  document.getElementById('stock-trade-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!currentUser) return alert('🔑 請先登入玩家帳號才能買賣股票！');

    const ticker = document.getElementById('trade-stock-select').value;
    const action = document.getElementById('trade-action').value;
    const shares = Number(document.getElementById('trade-shares').value);
    const stock = stocksData.find(s => s.ticker === ticker);
    if (!stock || shares <= 0) return;

    const portfolio = getCurrentPlayerPortfolio();
    const totalCost = stock.price * shares;
    const currentOwned = portfolio.holdings[ticker] || 0;

    if (action === 'BUY') {
      if (portfolio.cash < totalCost) return alert('❌ 可用資金不足！');
      portfolio.cash -= totalCost;
      portfolio.holdings[ticker] = currentOwned + shares;
      recordStockPricePoint(stock, stock.price * (1 + Math.min(0.05, shares * 0.0005)));
    } else {
      if (currentOwned < shares) return alert('❌ 持有股數不足！');
      portfolio.cash += totalCost;
      portfolio.holdings[ticker] = currentOwned - shares;
      recordStockPricePoint(stock, stock.price * (1 - Math.min(0.05, shares * 0.0005)));
    }

    stock.volume += shares;
    selectedChartTicker = ticker;
    stockLogs.unshift({
      time: new Date().toLocaleTimeString(),
      actor: `🎮 ${currentUser.username}`,
      action: action === 'BUY' ? '買進' : '賣出',
      ticker,
      shares,
      price: stock.price
    });
    saveAll();
    alert(`✅ 交易成功！已${action === 'BUY' ? '買進' : '賣出'} ${ticker} ${shares} 股（持股已自動存檔）。`);
  });

  document.getElementById('event-publish-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!currentUser) return alert('🔑 請先登入帳號才能發布或申請新聞！');

    const type = document.getElementById('e-type').value;
    const severity = document.getElementById('e-severity').value;
    const targetCountryId = document.getElementById('e-target-country').value;
    const impact = Number(document.getElementById('e-market-impact').value);
    const region = document.getElementById('e-region').value.trim();
    const title = document.getElementById('e-title').value.trim();
    let content = document.getElementById('e-content').value.trim();

    if (isAdmin()) {
      if (targetCountryId && impact !== 0) {
        const st = stocksData.find(s => s.countryId === targetCountryId);
        if (st) {
          recordStockPricePoint(st, st.price * (1 + impact));
          content += `（股市連動：${st.ticker} ${impact > 0 ? '+' : ''}${(impact * 100).toFixed(0)}% ➔ $${st.price.toFixed(2)}）`;
        }
      }
      eventsData.unshift({
        id: `evt-${Date.now()}`,
        year: simDate.year,
        dateStr: `${simDate.year}/${simDate.month}/${simDate.day} UTC`,
        type,
        severity,
        region,
        title,
        content,
        isCustom: true
      });
      document.getElementById('event-publish-form').reset();
      saveAll();
      alert('👑 管理員新聞已直接全網聯播並存入雲端！');
    } else {
      pendingNewsData.unshift({
        id: `req-${Date.now()}`,
        applicant: currentUser.username,
        type,
        severity,
        targetCountryId,
        impact,
        region,
        title,
        content
      });
      document.getElementById('event-publish-form').reset();
      saveAll();
      alert('📩 已成功向世界管理員提交新聞申請並存入雲端！');
    }
  });

  document.getElementById('un-chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('un-chat-input');
    const text = input.value.trim();
    if (!text) return;

    unMessages.push({
      sender: getSpeakerIdentity(),
      text,
      time: `${simDate.year}/${simDate.month}/${simDate.day} UTC`,
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
      time: `${simDate.year}/${simDate.month}/${simDate.day} UTC`,
      isAdmin: true
    });
    document.getElementById('un-proposal-form').reset();
    saveAll();
  });

  document.getElementById('auth-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const u = document.getElementById('auth-username').value.trim();
    const p = document.getElementById('auth-password').value.trim();

    if (u === (worldData.adminAccount?.username || 'admin')) {
      if (p === (worldData.adminAccount?.password || '2026')) {
        currentUser = { username: u, role: 'ADMIN' };
        localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
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
      alert(`🎉 新玩家「${u}」註冊成功並已自動存入雲端資料庫！`);
    }
    currentUser = { username: u, role: 'PLAYER' };
    localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
    saveAll();
    updateUserUI();
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    currentUser = null;
    localStorage.removeItem(SESSION_KEY);
    updateUserUI();
    refreshAllViews();
  });

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
    alert('✅ 領土邊界已儲存至雲端！');
  });

  document.querySelectorAll('.layer-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentMapLayer = btn.dataset.layer;
      renderMap();
    });
  });

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
      alert(`✅ 「${flag} ${name}」與專屬國家官網已更新並存入雲端！`);
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
      const customStocks = stocksData.filter(s => s.isCustom);
      const customEvents = eventsData.filter(e => e.isCustom);
      rebuildGlobalSyncedMarketAndNews(countriesData, [], customStocks, customEvents);
      alert(`🎉 國家「${flag} ${name}」已成立並永久儲存至雲端！`);
    }
    saveAll();
  });

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
    if (confirm('確定要清除本機快取並重新從雲端拉取最新資料嗎？')) {
      localStorage.removeItem(STORAGE_BACKUP_KEY);
      localStorage.removeItem(SESSION_KEY);
      location.reload();
    }
  });
}

initWorld();
