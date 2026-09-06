const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const DB_PATH = path.join(__dirname, 'pokecard.db');

// 取得本機 WiFi / 區域網路 IPv4 位址 (優先篩選 WiFi 與一般家用區網 192.168.x / 10.x)
function getNetworkIps() {
  const interfaces = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        const isWifi = name.toLowerCase().includes('wi-fi') || name.toLowerCase().includes('wlan');
        const isLan = net.address.startsWith('192.168.') || net.address.startsWith('10.');
        results.push({ name, ip: net.address, priority: isWifi ? 1 : (isLan ? 2 : 3) });
      }
    }
  }
  results.sort((a, b) => a.priority - b.priority);
  return results.map(r => ({ name: r.name, ip: r.ip }));
}

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 匯率預設值 (定時或啟動時更新)
const FOREX_RATES = {
  USD: 32.25,
  EUR: 35.10,
  JPY: 0.215,
  TWD: 1.0
};

// 卡牌 ID 智慧正規化函數：消除有無空格差異 (例如 'M5F112/081' 與 'M5F 112/081'、'S8BF254/184' 與 'S8BF 254/184')
function normalizeCardId(input) {
  if (!input || typeof input !== 'string') return null;
  let raw = input.trim();
  
  // 處理斜線前後可能存在的零星空格: 'M5F 112 / 081' -> 'M5F 112/081'
  raw = raw.replace(/\s*\/\s*/, '/');
  
  // 情況 1: 已有空格分隔 'SET_CODE NUM' 或 'SET_CODE NUM/TOTAL'
  // 例如 'SV11WF 139/086', 'M2 083/080', '151 199/165', 'M1LF 065/063'
  const spaceMatch = raw.match(/^([A-Za-z0-9\.\-]+)\s+([0-9]+)(?:\/([0-9]+))?$/);
  if (spaceMatch) {
    const setCode = spaceMatch[1].toUpperCase();
    const cardNumber = spaceMatch[2];
    const totalNumber = spaceMatch[3] || '';
    const formatted = `${setCode} ${cardNumber}${totalNumber ? '/' + totalNumber : ''}`;
    return { setCode, cardNumber, totalNumber, formatted };
  }
  
  // 情況 2: 無空格但有斜線，例如 'M5F112/081', 'M2AF226/193', 'S8BF254/184', 'SVI242/198', 'M2083/080'
  const slashMatch = raw.match(/^(.+)\/([0-9]+)$/);
  if (slashMatch) {
    const beforeSlash = slashMatch[1].trim();
    const totalNumber = slashMatch[2].trim();
    
    // 拆分 beforeSlash 為 setCode 與 cardNumber
    const letterNumMatch = beforeSlash.match(/^([A-Za-z0-9]*[A-Za-z])([0-9]+)$/);
    if (letterNumMatch) {
      const letterPart = letterNumMatch[1].toUpperCase();
      const numPart = letterNumMatch[2];

      // 若數字部分長度超過3 (例如 M2083 -> letterPart: 'M', numPart: '2083')
      // PTCG 常規卡號為 3 位數 (083)，前置數字為擴充包代號 (2 -> M2)
      if (numPart.length > 3) {
        const cardDigits = Math.min(Math.max(totalNumber.length, 3), numPart.length - 1);
        const cardNumber = numPart.slice(-cardDigits);
        const setCode = letterPart + numPart.slice(0, -cardDigits);
        const formatted = `${setCode} ${cardNumber}/${totalNumber}`;
        return { setCode, cardNumber, totalNumber, formatted };
      }

      const setCode = letterPart;
      const cardNumber = numPart;
      const formatted = `${setCode} ${cardNumber}/${totalNumber}`;
      return { setCode, cardNumber, totalNumber, formatted };
    }
  }
  
  // 情況 3: 無空格無斜線，例如 'M5F112', 'S8BF254', 'SVI242', 'M2083'
  const compactMatch = raw.match(/^([A-Za-z0-9]*[A-Za-z])([0-9]+)$/);
  if (compactMatch) {
    const letterPart = compactMatch[1].toUpperCase();
    const numPart = compactMatch[2];
    if (numPart.length > 3) {
      const cardNumber = numPart.slice(-3);
      const setCode = letterPart + numPart.slice(0, -3);
      const formatted = `${setCode} ${cardNumber}`;
      return { setCode, cardNumber, totalNumber: '', formatted };
    }
    const setCode = letterPart;
    const cardNumber = numPart;
    const formatted = `${setCode} ${cardNumber}`;
    return { setCode, cardNumber, totalNumber: '', formatted };
  }

  // 兜底純數字
  const numOnly = raw.match(/^([0-9]+)(?:\/([0-9]+))?$/);
  if (numOnly) {
    return {
      setCode: 'CARD',
      cardNumber: numOnly[1],
      totalNumber: numOnly[2] || '',
      formatted: `CARD ${numOnly[1]}${numOnly[2] ? '/' + numOnly[2] : ''}`
    };
  }
  
  return null;
}

// 初始化資料庫
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Failed to open database:', err.message);
  } else {
    console.log('Connected to SQLite database at', DB_PATH);
    initDatabase();
  }
});

function initDatabase() {
  db.serialize(() => {
    // 卡片表
    db.run(`
      CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY,
        raw_id TEXT NOT NULL,
        language TEXT NOT NULL,          -- 'TC' (台版), 'JP' (日版), 'EN' (美版)
        set_code TEXT NOT NULL,
        card_number TEXT NOT NULL,
        total_number TEXT,
        name_zh TEXT,
        name_en TEXT,
        name_ja TEXT,
        rarity TEXT,
        category TEXT,
        image_url TEXT,
        market_price_twd REAL DEFAULT 0,
        original_price REAL DEFAULT 0,
        original_currency TEXT DEFAULT 'TWD',
        buy_price_twd REAL DEFAULT 0,
        price_source TEXT,
        last_price_updated TEXT,
        created_at TEXT,
        sort_order INTEGER DEFAULT 0
      )
    `);

    // 動態確保現有資料表具備 sort_order 欄位 (Migration)
    db.run(`ALTER TABLE cards ADD COLUMN sort_order INTEGER DEFAULT 0`, (alterErr) => {
      // 若欄位已存在會報錯，直接忽略，並回填尚未指派 sort_order 的卡片
      db.run(`UPDATE cards SET sort_order = rowid WHERE sort_order IS NULL OR sort_order = 0`);
    });

    // 價格歷史記錄表
    db.run(`
      CREATE TABLE IF NOT EXISTS price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id TEXT NOT NULL,
        price_twd REAL NOT NULL,
        source TEXT,
        recorded_at TEXT,
        FOREIGN KEY (card_id) REFERENCES cards(id)
      )
    `);

    // 1. 動態修復 M2AF 249 衝浪手 SAR 官方原圖與多語系
    db.run(`
      UPDATE cards 
      SET image_url = 'https://www.pokemon-card.com/assets/images/card_images/large/M2a/050009_T_SAFUA.jpg',
          name_zh = '衝浪手 (Surfer)',
          name_en = 'Surfer',
          name_ja = 'サーファー'
      WHERE raw_id LIKE '%M2AF%249%' OR raw_id LIKE '%M2a%249%'
    `);

    // 2. 動態修復 #12 S8BF 254 幸福蛋V CSR (VMAX Climax You Iribi 官方原圖) 與報價
    db.run(`
      UPDATE cards 
      SET image_url = 'https://www.pokemon-card.com/assets/images/card_images/large/S8b/041082_P_HAPINASUV.jpg',
          raw_id = 'S8BF 254/184',
          name_zh = '幸福蛋V (Blissey V)',
          name_en = 'Blissey V',
          name_ja = 'ハピナスV',
          rarity = 'Character Super Rare (CSR)',
          category = 'Pokemon',
          market_price_twd = 503,
          original_price = 14.33,
          original_currency = 'EUR',
          price_source = '台版對映日版 (S8b) 牌價換算'
      WHERE raw_id LIKE '%S8B%254%' OR id LIKE '%S8B%254%'
    `);

    // 3. 動態修復 #11 M2AF 226 超級沙奈朵ex 多語系名稱
    db.run(`
      UPDATE cards 
      SET name_zh = '超級沙奈朵ex (Mega Gardevoir ex)',
          name_en = 'Mega Gardevoir ex',
          name_ja = 'メガサーナイトex'
      WHERE raw_id LIKE '%M2AF%226%' OR id LIKE '%M2AF%226%'
    `);

    // 4. 資料庫內所有卡片 ID 格式自動正規化 (消除空格與無空格差異)
    db.all('SELECT id, raw_id FROM cards', (err, rows) => {
      if (!err && rows) {
        rows.forEach(r => {
          const norm = normalizeCardId(r.raw_id);
          if (norm && norm.formatted !== r.raw_id) {
            db.run(
              'UPDATE cards SET raw_id = ?, set_code = ?, card_number = ?, total_number = ? WHERE id = ?',
              [norm.formatted, norm.setCode, norm.cardNumber, norm.totalNumber, r.id]
            );
            console.log(`Auto-normalized card raw_id: '${r.raw_id}' -> '${norm.formatted}'`);
          }
        });
      }
    });

    // 5. 補齊全庫卡片繁中/英文/日文名稱欄位
    db.all('SELECT id, name_zh, name_en, name_ja FROM cards', (err, rows) => {
      if (!err && rows) {
        rows.forEach(r => {
          const res = resolveCardNames(r.name_zh, r.name_en, r.name_ja);
          if (res.zh !== r.name_zh || res.en !== r.name_en || res.ja !== r.name_ja) {
            db.run('UPDATE cards SET name_zh = ?, name_en = ?, name_ja = ? WHERE id = ?',
              [res.zh, res.en, res.ja, r.id]);
          }
        });
      }
    });

    // 檢查是否有初始測試卡片
    db.get('SELECT COUNT(*) as count FROM cards', (err, row) => {
      if (!err && row && row.count === 0) {
        console.log('Seeding initial requested test cards...');
        seedInitialCards();
      }
    });
  });
}

// 種子測試卡片：
// 1. 台版 SV11WF 139/086 (灰塵山 AR)
// 2. 日版 M2 083/080 (炭小侍 AR)
// 3. 美版 SVI 242/198 (Team Star Grunt 全圖)
async function seedInitialCards() {
  const seedCards = [
    {
      id: 'TC_SV11WF_139_086',
      raw_id: 'SV11WF 139/086',
      language: 'TC',
      set_code: 'SV11WF',
      card_number: '139',
      total_number: '086',
      name_zh: '灰塵山 (Garbodor)',
      name_en: 'Garbodor',
      name_ja: 'ダストダス',
      rarity: 'Illustration Rare (AR)',
      category: 'Pokemon',
      image_url: 'https://www.pokemon-card.com/assets/images/card_images/large/SV11W/048051_P_DASUTODASU.jpg',
      market_price_twd: 125,
      original_price: 3.68,
      original_currency: 'EUR',
      buy_price_twd: 100,
      price_source: 'Cardmarket (JP/TC Equivalent) x Forex',
      last_price_updated: new Date().toISOString(),
      created_at: new Date().toISOString()
    },
    {
      id: 'JP_M2_083_080',
      raw_id: 'M2 083/080',
      language: 'JP',
      set_code: 'M2',
      card_number: '083',
      total_number: '080',
      name_zh: '炭小侍 (Charcadet)',
      name_en: 'Charcadet',
      name_ja: 'カルボウ',
      rarity: 'Illustration Rare (AR)',
      category: 'Pokemon',
      image_url: 'https://www.pokemon-card.com/assets/images/card_images/large/M2/048489_P_KARUBOU.jpg',
      market_price_twd: 43,
      original_price: 1.21,
      original_currency: 'EUR',
      buy_price_twd: 35,
      price_source: 'Cardmarket JP Node x Forex',
      last_price_updated: new Date().toISOString(),
      created_at: new Date().toISOString()
    },
    {
      id: 'EN_SVI_242_198',
      raw_id: 'SVI 242/198',
      language: 'EN',
      set_code: 'SVI',
      card_number: '242',
      total_number: '198',
      name_zh: '天星隊手下 (Team Star Grunt)',
      name_en: 'Team Star Grunt',
      name_ja: 'スター団のしたっぱ',
      rarity: 'Ultra Rare (Full Art)',
      category: 'Trainer',
      image_url: 'https://assets.tcgdex.net/en/sv/sv01/242/high.webp',
      market_price_twd: 48,
      original_price: 1.49,
      original_currency: 'USD',
      buy_price_twd: 45,
      price_source: 'TCGplayer Market Price',
      last_price_updated: new Date().toISOString(),
      created_at: new Date().toISOString()
    }
  ];

  const stmt = db.prepare(`
    INSERT INTO cards (
      id, raw_id, language, set_code, card_number, total_number,
      name_zh, name_en, name_ja, rarity, category, image_url,
      market_price_twd, original_price, original_currency, buy_price_twd,
      price_source, last_price_updated, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const card of seedCards) {
    stmt.run([
      card.id, card.raw_id, card.language, card.set_code, card.card_number, card.total_number,
      card.name_zh, card.name_en, card.name_ja, card.rarity, card.category, card.image_url,
      card.market_price_twd, card.original_price, card.original_currency, card.buy_price_twd,
      card.price_source, card.last_price_updated, card.created_at
    ]);

    // 寫入初始價格歷史
    db.run(
      'INSERT INTO price_history (card_id, price_twd, source, recorded_at) VALUES (?, ?, ?, ?)',
      [card.id, card.market_price_twd, card.price_source, card.last_price_updated]
    );
  }

  stmt.finalize();
  console.log('Seed completed.');
  
  // 啟動後在背景非同步更新這三張卡片之實時連網報價
  refreshAllCardPrices();
}

// 核心多語系聯網抓價函數
async function fetchOnlinePrice(language, setCode, cardNumber) {
  const normSet = setCode.toUpperCase().trim();
  const padNum = cardNumber.padStart(3, '0');
  const cleanNum = cardNumber.replace(/^0+/, '') || '1';

  if (language === 'EN') {
    // 英文版映射對照：SVI -> sv01
    let tcgdexSet = normSet.toLowerCase();
    if (normSet === 'SVI' || normSet === 'SV1') tcgdexSet = 'sv01';
    if (normSet === 'PAL' || normSet === 'SV2') tcgdexSet = 'sv02';
    if (normSet === 'OBF' || normSet === 'SV3') tcgdexSet = 'sv03';
    if (normSet === 'MEW' || normSet === '151') tcgdexSet = 'sv03.5';
    if (normSet === 'PAR' || normSet === 'SV4') tcgdexSet = 'sv04';
    if (normSet === 'PAF') tcgdexSet = 'sv04.5';

    const cardIdVariants = [`${tcgdexSet}-${padNum}`, `${tcgdexSet}-${cleanNum}`];
    for (const cid of cardIdVariants) {
      try {
        const res = await fetch(`https://api.tcgdex.net/v2/en/cards/${cid}`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const json = await res.json();
          const tcgplayer = json?.pricing?.tcgplayer;
          const cardmarket = json?.pricing?.cardmarket;
          let priceUSD = 0;
          let source = 'TCGdex (TCGplayer)';

          if (tcgplayer) {
            const h = tcgplayer.holofoil || tcgplayer.normal || tcgplayer['reverse-holofoil'];
            if (h && h.marketPrice) {
              priceUSD = h.marketPrice;
            }
          }
          if (!priceUSD && cardmarket && cardmarket.trend) {
            return {
              priceTWD: Math.round(cardmarket.trend * FOREX_RATES.EUR),
              originalPrice: cardmarket.trend,
              originalCurrency: 'EUR',
              source: 'Cardmarket EUR',
              meta: json
            };
          }
          if (priceUSD > 0) {
            return {
              priceTWD: Math.round(priceUSD * FOREX_RATES.USD),
              originalPrice: priceUSD,
              originalCurrency: 'USD',
              source: source,
              meta: json
            };
          }
        }
      } catch (e) {
        console.warn(`TCGdex EN failed for ${cid}:`, e.message);
      }
    }
  } else if (language === 'JP' || language === 'TC') {
    // 台版/日版系列映射：台灣版通常在日版代號末尾加 'F' (如 M1LF -> M1L, SV11WF -> SV11W, SV8aF -> SV8a)
    let jpSet = normSet;
    if (language === 'TC') {
      if (normSet.endsWith('F') && normSet.length >= 3) {
        jpSet = normSet.slice(0, -1);
      }
    }

    const cardIdVariants = [`${jpSet}-${padNum}`, `${jpSet}-${cleanNum}`];
    for (const cid of cardIdVariants) {
      try {
        const res = await fetch(`https://api.tcgdex.net/v2/ja/cards/${cid}`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const json = await res.json();
          const cm = json?.pricing?.cardmarket;
          let eur = cm?.trend || cm?.avg || cm?.avg30 || 1.5;
          let twd = Math.round(eur * FOREX_RATES.EUR);
          let note = language === 'TC' 
            ? `台版對映日版 (${jpSet}) 牌價換算` 
            : 'TCGdex JP Node (Cardmarket Trend)';

          return {
            priceTWD: twd > 0 ? twd : 50,
            originalPrice: eur,
            originalCurrency: 'EUR',
            source: note,
            meta: json
          };
        }
      } catch (e) {
        console.warn(`TCGdex JP failed for ${cid}:`, e.message);
      }
    }
  }

  // 兜底模擬報價
  return null;
}

// 自動多級官方卡圖抓取引擎 (Multi-tier Official Card Artwork Ingestion)
async function fetchCardArtwork(language, setCode, cardNumber, cardNameJa, tcgdexImage, capturedImageBase64, customId) {
  // 1. 若前端拍照/上傳了實體卡片照片，優先保存至本地靜態目錄
  if (capturedImageBase64 && capturedImageBase64.startsWith('data:image')) {
    try {
      const uploadsDir = path.join(__dirname, 'public', 'uploads');
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

      const base64Data = capturedImageBase64.replace(/^data:image\/\w+;base64,/, '');
      const filename = `${customId}.jpg`;
      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
      console.log(`Saved user-captured card photo to /uploads/${filename}`);
      return `/uploads/${filename}`;
    } catch (err) {
      console.warn('Failed to save user captured image:', err.message);
    }
  }

  // 2. 若為日版或台版，向日本官方資料庫 (pokemon-card.com) 檢索官方原畫 (支援寶可夢、訓練家卡與特殊卡)
  if (language === 'JP' || language === 'TC' || cardNameJa) {
    let jpSet = setCode.toUpperCase();
    if (language === 'TC' && jpSet.endsWith('F') && jpSet.length >= 3) {
      jpSet = jpSet.slice(0, -1);
    }

    if (cardNameJa && cardNameJa !== `${setCode} #${cardNumber}`) {
      try {
        const cleanJa = cardNameJa.split(' ')[0].trim();
        // 使用 keyword 參數以同時支援寶可夢 (Pokemon) 與訓練家/道具卡 (Trainer/Item)，並帶 regulation_header_search_item0=all 涵蓋全世代規約卡牌 (如劍盾 S8b)
        const officialUrl = `https://www.pokemon-card.com/card-search/resultAPI.php?keyword=${encodeURIComponent(cleanJa)}&regulation_header_search_item0=all&sm_and_keyword=true`;
        const res = await fetch(officialUrl, { signal: AbortSignal.timeout(4000) });
        if (res.ok) {
          const data = await res.json();
          if (data && data.cardList && data.cardList.length > 0) {
            // 找出符合該擴充包 (不分大小寫比對，如 /M2a/ 與 M2A, /S8b/ 與 S8B) 的卡片
            const matchedList = data.cardList.filter(c => 
              c.cardThumbFile && c.cardThumbFile.toLowerCase().includes(`/${jpSet.toLowerCase()}/`)
            );
            if (matchedList.length > 0) {
              // 若卡號是秘卡/全圖 (通常卡號大於普通卡總數)，排在擴充包後段 (AR/SR/SAR/CSR 特畫)
              const chosen = matchedList.length > 1 ? matchedList[matchedList.length - 1] : matchedList[0];
              const fullOfficialUrl = `https://www.pokemon-card.com${chosen.cardThumbFile}`;
              console.log(`Auto-scraped official JP image for ${setCode} #${cardNumber}: ${fullOfficialUrl}`);
              return fullOfficialUrl;
            }
            // 兜底第一張命中
            if (data.cardList[0].cardThumbFile) {
              return `https://www.pokemon-card.com${data.cardList[0].cardThumbFile}`;
            }
          }
        }
      } catch (e) {
        console.warn('Official JP Image Scraping fallback error:', e.message);
      }
    }
  }

  // 3. 英文版：若 TCGdex 提供圖片，驗證其是否有效
  if (tcgdexImage) {
    const fullUrl = `${tcgdexImage}/high.webp`;
    try {
      const probe = await fetch(fullUrl, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
      if (probe.ok) return fullUrl;
    } catch (e) {}
  }

  // 4. 兜底通用官方背面
  return 'https://assets.tcgdex.net/univ/cards/card-back/high.webp';
}

// 常用卡牌繁中 / 英文 / 日文多語系對照字典
const CARD_NAME_TRANSLATIONS = {
  'サーファー': { zh: '衝浪手 (Surfer)', en: 'Surfer', ja: 'サーファー' },
  'Surfer': { zh: '衝浪手 (Surfer)', en: 'Surfer', ja: 'サーファー' },
  '衝浪手': { zh: '衝浪手 (Surfer)', en: 'Surfer', ja: 'サーファー' },
  'ハピナスV': { zh: '幸福蛋V (Blissey V)', en: 'Blissey V', ja: 'ハピナスV' },
  'ハピナス': { zh: '幸福蛋 (Blissey)', en: 'Blissey', ja: 'ハピナス' },
  'Blissey V': { zh: '幸福蛋V (Blissey V)', en: 'Blissey V', ja: 'ハピナスV' },
  'Blissey': { zh: '幸福蛋 (Blissey)', en: 'Blissey', ja: 'ハピナス' },
  '幸福蛋': { zh: '幸福蛋 (Blissey)', en: 'Blissey', ja: 'ハピナス' },
  'メガサーナイトex': { zh: '超級沙奈朵ex (Mega Gardevoir ex)', en: 'Mega Gardevoir ex', ja: 'メガサーナイトex' },
  'Mega Gardevoir ex': { zh: '超級沙奈朵ex (Mega Gardevoir ex)', en: 'Mega Gardevoir ex', ja: 'メガサーナイトex' },
  'サーナイト': { zh: '沙奈朵 (Gardevoir)', en: 'Gardevoir', ja: 'サーナイト' },
  'Gardevoir': { zh: '沙奈朵 (Gardevoir)', en: 'Gardevoir', ja: 'サーナイト' },
  'メガゼ拉オラex': { zh: '超級捷拉奧拉ex (Mega Zeraora ex)', en: 'Mega Zeraora ex', ja: 'メガゼラオラex' },
  'メガゼラオラex': { zh: '超級捷拉奧拉ex (Mega Zeraora ex)', en: 'Mega Zeraora ex', ja: 'メガゼラオラex' },
  'Mega Zeraora ex': { zh: '超級捷拉奧拉ex (Mega Zeraora ex)', en: 'Mega Zeraora ex', ja: 'メガゼラオラex' },
  'ゼラオラ': { zh: '捷拉奧拉 (Zeraora)', en: 'Zeraora', ja: 'ゼラオラ' },
  'レシラムV': { zh: '萊希拉姆V (Reshiram V)', en: 'Reshiram V', ja: 'レシラムV' },
  'Reshiram V': { zh: '萊希拉姆V (Reshiram V)', en: 'Reshiram V', ja: 'レシラムV' },
  'レシラム': { zh: '萊希拉姆 (Reshiram)', en: 'Reshiram', ja: 'レシラム' },
  'デカグース': { zh: '貓鼬冠 (Gumshoos)', en: 'Gumshoos', ja: 'デカグース' },
  'Gumshoos': { zh: '貓鼬冠 (Gumshoos)', en: 'Gumshoos', ja: 'デカグース' },
  'ルンパッパ': { zh: '樂天河童 (Ludicolo)', en: 'Ludicolo', ja: 'ルンパッパ' },
  'Ludicolo': { zh: '樂天河童 (Ludicolo)', en: 'Ludicolo', ja: 'ルンパッパ' },
  'ゴクリン': { zh: '溶食獸 (Gulpin)', en: 'Gulpin', ja: 'ゴクリン' },
  'Gulpin': { zh: '溶食獸 (Gulpin)', en: 'Gulpin', ja: 'ゴクリン' },
  'フシギソウ': { zh: '妙蛙草 (Ivysaur)', en: 'Ivysaur', ja: 'フシギソウ' },
  'Ivysaur': { zh: '妙蛙草 (Ivysaur)', en: 'Ivysaur', ja: 'フシギソウ' },
  'カルボウ': { zh: '炭小侍 (Charcadet)', en: 'Charcadet', ja: 'カルボウ' },
  'Charcadet': { zh: '炭小侍 (Charcadet)', en: 'Charcadet', ja: 'カルボウ' },
  'ダストダス': { zh: '灰塵山 (Garbodor)', en: 'Garbodor', ja: 'ダストダス' },
  'Garbodor': { zh: '灰塵山 (Garbodor)', en: 'Garbodor', ja: 'ダストダス' },
  'スター団のしたっぱ': { zh: '天星隊手下 (Team Star Grunt)', en: 'Team Star Grunt', ja: 'スター団のしたっぱ' },
  'Team Star Grunt': { zh: '天星隊手下 (Team Star Grunt)', en: 'Team Star Grunt', ja: 'スター団のしたっぱ' }
};

function resolveCardNames(nameZh, nameEn, nameJa) {
  const candidate = (nameZh || nameEn || nameJa || '').trim();
  const cleanKey = candidate.split(' ')[0].trim();
  const matched = CARD_NAME_TRANSLATIONS[cleanKey] || CARD_NAME_TRANSLATIONS[candidate];
  if (matched) {
    return {
      zh: matched.zh,
      en: matched.en,
      ja: matched.ja
    };
  }
  return {
    zh: nameZh || nameEn || nameJa,
    en: nameEn || nameZh || nameJa,
    ja: nameJa || nameZh || nameEn
  };
}

// 常用全國圖鑑繁中字典
const POKEDEX_ZH = {
  1: '妙蛙種子', 2: '妙蛙草', 3: '妙蛙花',
  4: '小火龍', 5: '火恐龍', 6: '噴火龍',
  7: '傑尼龜', 8: '卡咪龜', 9: '水箭龜',
  25: '皮卡丘', 133: '伊布',
  569: '灰塵山', 935: '炭小侍', 936: '紅蓮鎧騎', 937: '蒼炎刃鬼'
};

// 刷新全庫卡片價格
async function refreshAllCardPrices() {
  console.log('Initiating online price refresh for all cards...');
  db.all('SELECT * FROM cards', async (err, cards) => {
    if (err || !cards) return;
    for (const card of cards) {
      try {
        const result = await fetchOnlinePrice(card.language, card.set_code, card.card_number);
        if (result && result.priceTWD > 0) {
          const now = new Date().toISOString();
          db.run(`
            UPDATE cards
            SET market_price_twd = ?, original_price = ?, original_currency = ?, price_source = ?, last_price_updated = ?
            WHERE id = ?
          `, [result.priceTWD, result.originalPrice, result.originalCurrency, result.source, now, card.id]);

          db.run(`
            INSERT INTO price_history (card_id, price_twd, source, recorded_at)
            VALUES (?, ?, ?, ?)
          `, [card.id, result.priceTWD, result.source, now]);
          console.log(`Updated price for ${card.id}: NT$ ${result.priceTWD} (${result.source})`);
        }
      } catch (e) {
        console.error(`Error refreshing price for ${card.id}:`, e.message);
      }
    }
  });
}

// =================== REST API ENDPOINTS ===================

// 1. 取得卡片清單與總資產統計
app.get('/api/cards', (req, res) => {
  const { lang, search } = req.query;
  let query = 'SELECT * FROM cards WHERE 1=1';
  const params = [];

  if (lang && lang !== 'ALL') {
    query += ' AND language = ?';
    params.push(lang);
  }
  if (search) {
    query += ' AND (name_zh LIKE ? OR name_en LIKE ? OR raw_id LIKE ? OR set_code LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }

  query += ' ORDER BY sort_order ASC, created_at DESC';

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    // 計算整體資產統計
    db.all('SELECT market_price_twd, buy_price_twd, language FROM cards', (err2, allRows) => {
      let totalValue = 0;
      let totalCost = 0;
      const countsByLang = { TC: 0, JP: 0, EN: 0 };

      if (!err2 && allRows) {
        allRows.forEach(r => {
          totalValue += (r.market_price_twd || 0);
          totalCost += (r.buy_price_twd || 0);
          if (countsByLang[r.language] !== undefined) {
            countsByLang[r.language]++;
          }
        });
      }

      const totalPnL = totalValue - totalCost;
      const pnlPercentage = totalCost > 0 ? ((totalPnL / totalCost) * 100).toFixed(1) : '0.0';

      res.json({
        cards: rows,
        stats: {
          totalCards: allRows ? allRows.length : 0,
          totalValueTWD: totalValue,
          totalCostTWD: totalCost,
          totalPnLTWD: totalPnL,
          pnlPercentage: pnlPercentage,
          countsByLang,
          forex: FOREX_RATES
        }
      });
    });
  });
});

// 2. 新增卡片
app.post('/api/cards', async (req, res) => {
  try {
    const { rawId, language, buyPriceTWD } = req.body;
    if (!rawId || !language) {
      return res.status(400).json({ error: 'rawId and language are required' });
    }

    // 智慧解析與正規化 ID 格式，消除有無空格、斜線零散空格或大小寫差異
    const cleanRaw = rawId.trim();
    const normalized = normalizeCardId(cleanRaw);
    let setCode = '';
    let cardNumber = '';
    let totalNumber = '';
    let canonicalRawId = cleanRaw;

    if (normalized) {
      setCode = normalized.setCode;
      cardNumber = normalized.cardNumber;
      totalNumber = normalized.totalNumber;
      canonicalRawId = normalized.formatted;
    } else {
      const parts = cleanRaw.split(/[\s\-_]+/);
      setCode = (parts[0] || 'CARD').toUpperCase().replace(/[^A-Za-z0-9]/g, '');
      const numPart = parts[1] || '';
      const [cn, tn] = numPart.split('/');
      cardNumber = (cn || '001').replace(/[^0-9]/g, '');
      totalNumber = (tn || '').replace(/[^0-9]/g, '');
      canonicalRawId = `${setCode} ${cardNumber}${totalNumber ? '/' + totalNumber : ''}`;
    }

    // 確保 customId 絕對不包含斜線 (/) 與 URL 非法字元
    const safeSet = (setCode || 'CARD').replace(/[^A-Za-z0-9]/g, '_');
    const safeNum = (cardNumber || '001').replace(/[^A-Za-z0-9]/g, '_');
    const customId = `${language}_${safeSet}_${safeNum}_${Date.now()}`;
    
    // 聯網拉取即時價格與卡片中繼資訊
    const onlineData = await fetchOnlinePrice(language, setCode, cardNumber);
    const meta = onlineData?.meta;

    let nameZh = meta?.name;
    if (meta?.dexId && meta.dexId[0] && POKEDEX_ZH[meta.dexId[0]]) {
      nameZh = `${POKEDEX_ZH[meta.dexId[0]]} (${meta.name})`;
    } else if (!nameZh) {
      nameZh = `寶可夢卡片 (${setCode} #${cardNumber})`;
    }

    let nameEn = meta?.name || `${setCode} #${cardNumber}`;
    let nameJa = meta?.name || `${setCode} #${cardNumber}`;

    const resolvedNames = resolveCardNames(nameZh, nameEn, nameJa);
    nameZh = resolvedNames.zh;
    nameEn = resolvedNames.en;
    nameJa = resolvedNames.ja;

    const rarity = meta?.rarity || 'Regular';
    const category = meta?.category || 'Pokemon';
    // 自動多級拉圖引擎 (Multi-Tier Auto Image Fetching Engine)
    const imageUrl = await fetchCardArtwork(language, setCode, cardNumber, nameJa, meta?.image, req.body.capturedImage, customId);
    const marketPrice = onlineData?.priceTWD || 50;
    const origPrice = onlineData?.originalPrice || marketPrice;
    const origCurr = onlineData?.originalCurrency || 'TWD';
    const priceSource = onlineData?.source || '手動建立/預設估值';
    const now = new Date().toISOString();

    // 取得當前最大 sort_order 並指派次一順序
    db.get('SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextOrder FROM cards', (orderErr, orderRow) => {
      const nextOrder = (orderRow && orderRow.nextOrder) ? orderRow.nextOrder : 1;

      const insertSql = `
        INSERT INTO cards (
          id, raw_id, language, set_code, card_number, total_number,
          name_zh, name_en, name_ja, rarity, category, image_url,
          market_price_twd, original_price, original_currency, buy_price_twd,
          price_source, last_price_updated, created_at, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      db.run(insertSql, [
        customId, canonicalRawId, language, setCode, cardNumber, totalNumber,
        nameZh, nameEn, nameJa, rarity, category, imageUrl,
        marketPrice, origPrice, origCurr, parseFloat(buyPriceTWD) || 0,
        priceSource, now, now, nextOrder
      ], function(err) {
        if (err) return res.status(500).json({ error: err.message });

        db.run(
          'INSERT INTO price_history (card_id, price_twd, source, recorded_at) VALUES (?, ?, ?, ?)',
          [customId, marketPrice, priceSource, now]
        );

        res.status(201).json({
          message: 'Card added successfully',
          cardId: customId,
          marketPriceTWD: marketPrice,
          sortOrder: nextOrder
        });
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2.1. 拖曳重排卡牌順序 (Batch Reorder via SQLite Transaction)
app.put('/api/cards/reorder', (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order) || order.length === 0) {
    return res.status(400).json({ error: 'order must be a non-empty array of card IDs' });
  }

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    const stmt = db.prepare('UPDATE cards SET sort_order = ? WHERE id = ?');
    order.forEach((id, index) => {
      stmt.run(index + 1, id);
    });
    stmt.finalize((fErr) => {
      if (fErr) {
        db.run('ROLLBACK');
        return res.status(500).json({ error: fErr.message });
      }
      db.run('COMMIT', (cErr) => {
        if (cErr) {
          return res.status(500).json({ error: cErr.message });
        }
        res.json({ message: 'Cards reordered successfully', count: order.length });
      });
    });
  });
});

// 3. 手動觸發全庫實時市價更新
app.post('/api/cards/refresh-prices', async (req, res) => {
  try {
    await refreshAllCardPrices();
    res.json({ message: 'Price refresh triggered successfully in background' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. 刪除卡片 (支援 REST 路徑與 Query Param 傳遞)
app.delete('/api/cards/:id', (req, res) => {
  const id = decodeURIComponent(req.params.id);
  db.run('DELETE FROM cards WHERE id = ?', [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    db.run('DELETE FROM price_history WHERE card_id = ?', [id]);
    res.json({ message: 'Card removed', deletedId: id });
  });
});

app.delete('/api/cards', (req, res) => {
  const id = decodeURIComponent(req.query.id || req.body?.id || '');
  if (!id) return res.status(400).json({ error: 'Card ID is required' });
  db.run('DELETE FROM cards WHERE id = ?', [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    db.run('DELETE FROM price_history WHERE card_id = ?', [id]);
    res.json({ message: 'Card removed', deletedId: id });
  });
});

// 5. 取得單卡歷史價格
app.get('/api/cards/:id/history', (req, res) => {
  const id = decodeURIComponent(req.params.id);
  db.all('SELECT * FROM price_history WHERE card_id = ? ORDER BY recorded_at ASC', [id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 6. 單卡強制重新聯網更新中繼資料與行情
app.post('/api/cards/:id/refresh', (req, res) => {
  const id = decodeURIComponent(req.params.id);
  db.get('SELECT * FROM cards WHERE id = ?', [id], async (err, card) => {
    if (err || !card) return res.status(404).json({ error: 'Card not found' });

    try {
      const onlineData = await fetchOnlinePrice(card.language, card.set_code, card.card_number);
      const meta = onlineData?.meta;
      let nameZh = meta?.name || card.name_zh;
      if (meta?.dexId && meta.dexId[0] && POKEDEX_ZH[meta.dexId[0]]) {
        nameZh = `${POKEDEX_ZH[meta.dexId[0]]} (${meta.name})`;
      }
      const nameEn = meta?.name || card.name_en;
      const nameJa = meta?.name || card.name_ja;
      const rarity = meta?.rarity || card.rarity;
      const imageUrl = await fetchCardArtwork(card.language, card.set_code, card.card_number, nameJa, meta?.image, null, card.id);
      const marketPrice = onlineData?.priceTWD || card.market_price_twd;
      const origPrice = onlineData?.originalPrice || card.original_price;
      const origCurr = onlineData?.originalCurrency || card.original_currency;
      const priceSource = onlineData?.source || card.price_source;
      const now = new Date().toISOString();

      db.run(`
        UPDATE cards
        SET name_zh = ?, name_en = ?, name_ja = ?, rarity = ?, image_url = ?,
            market_price_twd = ?, original_price = ?, original_currency = ?,
            price_source = ?, last_price_updated = ?
        WHERE id = ?
      `, [nameZh, nameEn, nameJa, rarity, imageUrl, marketPrice, origPrice, origCurr, priceSource, now, id], function(uErr) {
        if (uErr) return res.status(500).json({ error: uErr.message });
        res.json({ message: 'Card refreshed', cardId: id, marketPrice, nameZh, imageUrl });
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

// 7. 取得本機與區域網路 (WiFi) 連線資訊
app.get('/api/network-info', (req, res) => {
  const ips = getNetworkIps();
  res.json({
    port: PORT,
    localUrl: `http://localhost:${PORT}`,
    networkIps: ips,
    primaryWifiUrl: ips.length > 0 ? `http://${ips[0].ip}:${PORT}` : `http://localhost:${PORT}`
  });
});

app.listen(PORT, HOST, () => {
  console.log(`\n=================================================`);
  console.log(`⚡ Pokemon Card Vault Web 已成功啟動！`);
  console.log(`- Local 本機連線:      http://localhost:${PORT}`);
  const netIps = getNetworkIps();
  netIps.forEach(n => {
    console.log(`- WiFi 區網連線 (${n.name}): http://${n.ip}:${PORT}`);
  });
  console.log(`=================================================\n`);
});
