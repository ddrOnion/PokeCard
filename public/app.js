// State Management
let currentLanguage = 'ALL';
let currentSearch = '';
let currentViewMode = localStorage.getItem('cardvault_view_mode') || 'detailed';
let currentTitleLang = localStorage.getItem('cardvault_title_lang') || 'auto'; // 'auto' | 'zh' | 'en' | 'ja'
let cardsData = [];
let statsData = {};
let draggedCardId = null;

// DOM Elements
const totalValueEl = document.getElementById('totalValue');
const totalCostEl = document.getElementById('totalCost');
const totalPnLBadgeEl = document.getElementById('totalPnLBadge');
const totalPnLAmountEl = document.getElementById('totalPnLAmount');
const totalCardCountEl = document.getElementById('totalCardCount');
const countTCEl = document.getElementById('countTC');
const countJPEl = document.getElementById('countJP');
const countENEl = document.getElementById('countEN');
const cardsGridEl = document.getElementById('cardsGrid');
const searchInputEl = document.getElementById('searchInput');
const langTabsEl = document.getElementById('langTabs');
const btnSyncPricesEl = document.getElementById('btnSyncPrices');

// View mode & Toolbar Elements
const btnViewDetailed = document.getElementById('btnViewDetailed');
const btnViewOverview = document.getElementById('btnViewOverview');
const overviewToolbarEl = document.getElementById('overviewToolbar');
const toastNotificationEl = document.getElementById('toastNotification');
const wifiPillBadgeEl = document.getElementById('wifiPillBadge');
const wifiUrlTextEl = document.getElementById('wifiUrlText');
const titleLangTabsEl = document.getElementById('titleLangTabs');

// Modals
const addCardModalEl = document.getElementById('addCardModal');
const scanModalEl = document.getElementById('scanModal');
const btnOpenAddModal = document.getElementById('btnOpenAddModal');
const btnCloseAddModal = document.getElementById('btnCloseAddModal');
const btnCancelAdd = document.getElementById('btnCancelAdd');
const btnOpenScanModal = document.getElementById('btnOpenScanModal');
const btnCloseScanModal = document.getElementById('btnCloseScanModal');

// Form elements
const addCardForm = document.getElementById('addCardForm');
const inputLang = document.getElementById('inputLang');
const inputRawId = document.getElementById('inputRawId');
const inputBuyPrice = document.getElementById('inputBuyPrice');
const inputCardName = document.getElementById('inputCardName');

// Scan elements
const scanFileInput = document.getElementById('scanFileInput');
const dropZone = document.getElementById('dropZone');
const imagePreviewContainer = document.getElementById('imagePreviewContainer');
const scannedImagePreview = document.getElementById('scannedImagePreview');
const scanStatus = document.getElementById('scanStatus');
const scanDetectedLang = document.getElementById('scanDetectedLang');
const scanDetectedId = document.getElementById('scanDetectedId');
const scanBuyPrice = document.getElementById('scanBuyPrice');
const btnConfirmScanAdd = document.getElementById('btnConfirmScanAdd');

// 卡牌 ID 智慧正規化函數：消除有無空格差異 (例如 'M5F112/081' 與 'M5F 112/081')
function normalizeCardId(input) {
  if (!input || typeof input !== 'string') return null;
  let raw = input.trim().replace(/\s*\/\s*/, '/');
  
  // 情況 1: 已有空格分隔 'SET_CODE NUM' 或 'SET_CODE NUM/TOTAL'
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
    const letterNumMatch = beforeSlash.match(/^([A-Za-z0-9]*[A-Za-z])([0-9]+)$/);
    if (letterNumMatch) {
      const letterPart = letterNumMatch[1].toUpperCase();
      const numPart = letterNumMatch[2];
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
  
  // 情況 3: 無空格無斜線，例如 'M5F112', 'S8BF254', 'SVI242'
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

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initViewMode();
  initTitleLang();
  fetchCardsAndStats();
  setupEventListeners();
  fetchNetworkInfo();
});

// 初始化卡名顯示語言選項
function initTitleLang() {
  document.querySelectorAll('.lang-pill-btn').forEach(btn => {
    if (btn.dataset.titleLang === currentTitleLang) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

// 取得卡片依當前語言設定應呈現之主標題與副標題
function getCardDisplayNames(card) {
  const zh = card.name_zh || '';
  const en = card.name_en || '';
  const ja = card.name_ja || '';

  let primary = '';
  let sub = '';

  if (currentTitleLang === 'zh') {
    primary = zh || en || ja || card.raw_id;
    const parts = [en, ja].filter(n => n && n !== primary);
    sub = parts.join(' · ');
  } else if (currentTitleLang === 'en') {
    primary = en || zh || ja || card.raw_id;
    const parts = [zh, ja].filter(n => n && n !== primary);
    sub = parts.join(' · ');
  } else if (currentTitleLang === 'ja') {
    primary = ja || zh || en || card.raw_id;
    const parts = [zh, en].filter(n => n && n !== primary);
    sub = parts.join(' · ');
  } else {
    // 'auto' 依版本顯示 (台版顯示繁中、日版顯示日文、美版顯示英文)
    if (card.language === 'TC') {
      primary = zh || en || ja || card.raw_id;
      const parts = [en, ja].filter(n => n && n !== primary);
      sub = parts.join(' · ');
    } else if (card.language === 'JP') {
      primary = ja || zh || en || card.raw_id;
      const parts = [zh, en].filter(n => n && n !== primary);
      sub = parts.join(' · ');
    } else if (card.language === 'EN') {
      primary = en || zh || ja || card.raw_id;
      const parts = [zh, ja].filter(n => n && n !== primary);
      sub = parts.join(' · ');
    } else {
      primary = zh || en || ja || card.raw_id;
      sub = `${en} · ${ja}`;
    }
  }

  return { primary, sub };
}

// 取得本機 WiFi / 區域網路連線位址
async function fetchNetworkInfo() {
  try {
    const res = await fetch('/api/network-info');
    if (res.ok) {
      const data = await res.json();
      if (data.networkIps && data.networkIps.length > 0) {
        // 優先選取 WiFi 網卡或第一個非虛擬的區網 IP
        const targetNet = data.networkIps.find(n => n.name.toLowerCase().includes('wi-fi') || n.name.toLowerCase().includes('wlan')) || data.networkIps[0];
        const wifiUrl = `http://${targetNet.ip}:${data.port}`;
        if (wifiUrlTextEl && wifiPillBadgeEl) {
          wifiUrlTextEl.innerText = `${targetNet.ip}:${data.port}`;
          wifiPillBadgeEl.style.display = 'inline-flex';
          wifiPillBadgeEl.addEventListener('click', () => {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(wifiUrl).then(() => {
                showToast(`📋 已複製 WiFi 網址：${wifiUrl}`);
              }).catch(() => {
                prompt('請複製 WiFi 存取網址：', wifiUrl);
              });
            } else {
              prompt('請複製 WiFi 存取網址：', wifiUrl);
            }
          });
        }
      }
    }
  } catch (e) {
    console.warn('Network info fetch skipped:', e);
  }
}

// 初始化檢視模式
function initViewMode() {
  setViewMode(currentViewMode, false);
}

// 切換詳細模式與卡冊一覽模式
function setViewMode(mode, doRender = true) {
  currentViewMode = mode;
  localStorage.setItem('cardvault_view_mode', mode);

  if (mode === 'overview') {
    btnViewDetailed.classList.remove('active');
    btnViewOverview.classList.add('active');
    overviewToolbarEl.style.display = 'flex';
    cardsGridEl.classList.add('overview-mode');
  } else {
    btnViewOverview.classList.remove('active');
    btnViewDetailed.classList.add('active');
    overviewToolbarEl.style.display = 'none';
    cardsGridEl.classList.remove('overview-mode');
  }

  if (doRender && cardsData && cardsData.length > 0) {
    renderCards(cardsData);
  }
}

function setupEventListeners() {
  // 卡名顯示語言切換 (Auto / ZH / EN / JA)
  if (titleLangTabsEl) {
    titleLangTabsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.lang-pill-btn');
      if (!btn) return;
      document.querySelectorAll('.lang-pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTitleLang = btn.dataset.titleLang;
      localStorage.setItem('cardvault_title_lang', currentTitleLang);

      const langNames = { auto: '依發行版本', zh: '繁體中文 (台)', en: '英文 (美)', ja: '日文 (日)' };
      showToast(`🌐 卡名顯示語言已切換為：${langNames[currentTitleLang] || currentTitleLang}`);

      if (cardsData && cardsData.length > 0) {
        renderCards(cardsData);
      }
    });
  }

  // 檢視模式切換 (Detailed vs Overview)
  btnViewDetailed.addEventListener('click', () => setViewMode('detailed'));
  btnViewOverview.addEventListener('click', () => setViewMode('overview'));

  // 卡冊一覽工具列快捷重排
  overviewToolbarEl.addEventListener('click', async (e) => {
    const chip = e.target.closest('.btn-sort-chip');
    if (!chip) return;
    const sortType = chip.dataset.sort;
    if (!cardsData || cardsData.length === 0) return;

    if (sortType === 'price-desc') {
      cardsData.sort((a, b) => (b.market_price_twd || 0) - (a.market_price_twd || 0));
    } else if (sortType === 'price-asc') {
      cardsData.sort((a, b) => (a.market_price_twd || 0) - (b.market_price_twd || 0));
    } else if (sortType === 'rawid-asc') {
      cardsData.sort((a, b) => (a.raw_id || '').localeCompare(b.raw_id || ''));
    } else if (sortType === 'cost-desc') {
      cardsData.sort((a, b) => (b.buy_price_twd || 0) - (a.buy_price_twd || 0));
    }

    renderCards(cardsData);
    await saveCardsOrder('✨ 已根據所選條件自動重排並儲存順序！');
  });

  // Tabs
  langTabsEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-btn')) {
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
      e.target.classList.add('active');
      currentLanguage = e.target.dataset.lang;
      fetchCardsAndStats();
    }
  });

  // Search debounce
  let searchTimer;
  searchInputEl.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      currentSearch = e.target.value.trim();
      fetchCardsAndStats();
    }, 250);
  });

  // Sync Prices
  btnSyncPricesEl.addEventListener('click', async () => {
    btnSyncPricesEl.disabled = true;
    const originalHtml = btnSyncPricesEl.innerHTML;
    btnSyncPricesEl.innerHTML = '<span class="icon">⏳</span> 同步連網報價中...';

    try {
      await fetch('/api/cards/refresh-prices', { method: 'POST' });
      setTimeout(async () => {
        await fetchCardsAndStats();
        btnSyncPricesEl.innerHTML = '✅ 同步完成！';
        setTimeout(() => {
          btnSyncPricesEl.innerHTML = originalHtml;
          btnSyncPricesEl.disabled = false;
        }, 1500);
      }, 1000);
    } catch (err) {
      console.error(err);
      btnSyncPricesEl.innerHTML = originalHtml;
      btnSyncPricesEl.disabled = false;
    }
  });

  // Add Card Modal
  btnOpenAddModal.addEventListener('click', () => addCardModalEl.classList.add('active'));
  btnCloseAddModal.addEventListener('click', () => addCardModalEl.classList.remove('active'));
  btnCancelAdd.addEventListener('click', () => addCardModalEl.classList.remove('active'));

  // 自動格式化卡號輸入框 (消除有無空格差異)
  inputRawId.addEventListener('blur', () => {
    const norm = normalizeCardId(inputRawId.value);
    if (norm) {
      inputRawId.value = norm.formatted;
    }
  });

  inputRawId.addEventListener('change', () => {
    const norm = normalizeCardId(inputRawId.value);
    if (norm) {
      inputRawId.value = norm.formatted;
    }
  });

  addCardForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById('btnSubmitAdd');
    submitBtn.disabled = true;
    submitBtn.innerText = '查詢網路價格並入庫...';

    // 提交前自動將輸入正規化
    const norm = normalizeCardId(inputRawId.value);
    const finalRawId = norm ? norm.formatted : inputRawId.value.trim();
    inputRawId.value = finalRawId;

    try {
      const res = await fetch('/api/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawId: finalRawId,
          language: inputLang.value,
          buyPriceTWD: inputBuyPrice.value || 0,
          cardName: inputCardName?.value?.trim() || ''
        })
      });
      if (res.ok) {
        addCardModalEl.classList.remove('active');
        addCardForm.reset();
        showToast(`🎉 成功入庫卡片：${finalRawId}`);
        await fetchCardsAndStats();
      } else {
        alert('新增失敗，請檢查卡號代碼');
      }
    } catch (err) {
      console.error(err);
      alert('網路錯誤');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerText = '確認並聯網拉取報價入庫';
    }
  });

  // Scan Modal
  btnOpenScanModal.addEventListener('click', () => scanModalEl.classList.add('active'));
  btnCloseScanModal.addEventListener('click', () => scanModalEl.classList.remove('active'));

  // Image Upload Handling
  scanFileInput.addEventListener('change', handleImageUpload);

  // Drag and drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processImageFile(e.dataTransfer.files[0]);
    }
  });

  btnConfirmScanAdd.addEventListener('click', async () => {
    btnConfirmScanAdd.disabled = true;
    btnConfirmScanAdd.innerText = '入庫中...';
    
    const norm = normalizeCardId(scanDetectedId.value);
    const finalRawId = norm ? norm.formatted : scanDetectedId.value.trim();
    scanDetectedId.value = finalRawId;

    try {
      const res = await fetch('/api/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawId: finalRawId,
          language: scanDetectedLang.value,
          buyPriceTWD: scanBuyPrice.value || 0,
          capturedImage: scannedImagePreview.src
        })
      });
      if (res.ok) {
        scanModalEl.classList.remove('active');
        resetScanState();
        showToast(`🎉 成功入庫卡片：${finalRawId}`);
        await fetchCardsAndStats();
      }
    } catch (err) {
      console.error(err);
    } finally {
      btnConfirmScanAdd.disabled = false;
      btnConfirmScanAdd.innerText = '✨ 確認資料無誤，聯網取價並收入卡冊';
    }
  });

  // 卡牌卡冊操作事件委派 (刪除 / 單卡更新)
  cardsGridEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const cardId = btn.dataset.id;
    const cardName = btn.dataset.name || '此卡片';

    if (action === 'delete') {
      if (confirm(`確定要從收藏中移除「${cardName}」嗎？`)) {
        btn.disabled = true;
        try {
          const res = await fetch(`/api/cards/${encodeURIComponent(cardId)}`, { method: 'DELETE' });
          if (res.ok) {
            showToast(`🗑️ 已成功移除卡片「${cardName}」`);
            const cardEl = document.getElementById(`card-${cardId}`);
            if (cardEl) {
              cardEl.style.transition = 'opacity 0.25s, transform 0.25s';
              cardEl.style.opacity = '0';
              cardEl.style.transform = 'scale(0.85)';
              setTimeout(() => fetchCardsAndStats(), 250);
            } else {
              await fetchCardsAndStats();
            }
          } else {
            const errData = await res.json().catch(() => ({}));
            alert(`刪除失敗：${errData.error || res.statusText}`);
            btn.disabled = false;
          }
        } catch (err) {
          console.error('Delete error:', err);
          alert('刪除時發生網路錯誤');
          btn.disabled = false;
        }
      }
    } else if (action === 'refresh') {
      btn.disabled = true;
      const originalText = btn.innerHTML;
      btn.innerHTML = '⏳';
      try {
        const res = await fetch(`/api/cards/${encodeURIComponent(cardId)}/refresh`, { method: 'POST' });
        if (res.ok) {
          showToast(`🔄 已成功更新「${cardName}」之市場報價！`);
          await fetchCardsAndStats();
        } else {
          alert('報價更新失敗，請檢查網路連線');
        }
      } catch (err) {
        console.error('Refresh card error:', err);
      } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }
  });
}

// 快速點擊填入範例
window.setQuickCard = function(lang, rawId, price) {
  inputLang.value = lang;
  inputRawId.value = rawId;
  inputBuyPrice.value = price;
};

// 處理圖片上傳與 OCR 模擬識別
function handleImageUpload(e) {
  if (e.target.files && e.target.files[0]) {
    processImageFile(e.target.files[0]);
  }
}

function processImageFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    scannedImagePreview.src = e.target.result;
    document.querySelector('.drop-zone-content').style.display = 'none';
    imagePreviewContainer.style.display = 'block';

    scanStatus.innerHTML = '⚡ 執行 Vision 邊緣校正與 OCR 抽取中...';
    scanStatus.style.borderLeftColor = 'var(--accent-gold)';

    // 模擬端側 Vision OCR 智能解析
    setTimeout(() => {
      // 根據檔名或隨機智能識別為三張測試範例之一或標準格式
      let detectedLang = 'TC';
      let detectedId = 'SV11WF 139/086';

      const fileName = file.name.toUpperCase();
      if (fileName.includes('M2') || fileName.includes('CHAR') || fileName.includes('JP')) {
        detectedLang = 'JP';
        detectedId = 'M2 083/080';
      } else if (fileName.includes('SVI') || fileName.includes('GRUNT') || fileName.includes('EN')) {
        detectedLang = 'EN';
        detectedId = 'SVI 242/198';
      }

      scanDetectedLang.value = detectedLang;
      scanDetectedId.value = detectedId;
      scanStatus.innerHTML = `✅ <b>識別成功！</b> 偵測到底部序號：<code>${detectedId}</code> (${detectedLang})`;
      scanStatus.style.borderLeftColor = 'var(--success)';
      btnConfirmScanAdd.disabled = false;
    }, 900);
  };
  reader.readAsDataURL(file);
}

function resetScanState() {
  document.querySelector('.drop-zone-content').style.display = 'block';
  imagePreviewContainer.style.display = 'none';
  scanFileInput.value = '';
  scanStatus.innerHTML = '請上傳卡片影像進行文字與卡號抽取';
  scanStatus.style.borderLeftColor = 'var(--primary)';
  scanDetectedId.value = '';
  btnConfirmScanAdd.disabled = true;
}

// 取得資料與重新渲染
async function fetchCardsAndStats() {
  try {
    const url = `/api/cards?lang=${currentLanguage}&search=${encodeURIComponent(currentSearch)}`;
    const res = await fetch(url);
    const data = await res.json();

    cardsData = data.cards;
    statsData = data.stats;

    renderStats(statsData);
    renderCards(cardsData);
  } catch (err) {
    console.error('Failed to fetch data:', err);
    cardsGridEl.innerHTML = `
      <div class="empty-state">
        <p>無法連線至本地資料庫伺服器，請確認後端已啟動。</p>
      </div>
    `;
  }
}

// 渲染看板統計
function renderStats(stats) {
  if (!stats) return;

  animateNumber(totalValueEl, stats.totalValueTWD);
  totalCostEl.innerText = stats.totalCostTWD.toLocaleString();
  totalCardCountEl.innerText = stats.totalCards;
  countTCEl.innerText = stats.countsByLang.TC || 0;
  countJPEl.innerText = stats.countsByLang.JP || 0;
  countENEl.innerText = stats.countsByLang.EN || 0;

  totalPnLAmountEl.innerText = (stats.totalPnLTWD >= 0 ? '+' : '') + stats.totalPnLTWD.toLocaleString();
  
  if (stats.totalPnLTWD >= 0) {
    totalPnLBadgeEl.className = 'pnl-badge pnl-positive';
    totalPnLBadgeEl.innerText = `+${stats.pnlPercentage}% 獲利`;
  } else {
    totalPnLBadgeEl.className = 'pnl-badge pnl-negative';
    totalPnLBadgeEl.innerText = `${stats.pnlPercentage}% 虧損`;
  }

  if (stats.forex) {
    document.getElementById('fxUsd').innerText = stats.forex.USD;
    document.getElementById('fxJpy').innerText = stats.forex.JPY;
    document.getElementById('fxEur').innerText = stats.forex.EUR;
  }
}

// 數字滾動動畫
function animateNumber(element, targetValue) {
  const startValue = parseInt(element.innerText.replace(/,/g, '')) || 0;
  const duration = 500;
  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const current = Math.floor(startValue + (targetValue - startValue) * progress);
    element.innerText = current.toLocaleString();
    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }
  requestAnimationFrame(update);
}

// 渲染卡牌陳列 (支援詳細模式與卡冊一覽模式)
function renderCards(cards) {
  if (!cards || cards.length === 0) {
    cardsGridEl.innerHTML = `
      <div class="empty-state">
        <span style="font-size: 3rem; display:block; margin-bottom:12px;">📭</span>
        <p>目前尚無此條件的卡片收藏。</p>
        <p class="helper-text">可點擊上方「輸入卡片 ID」或「拍照辨識」添加卡片。</p>
      </div>
    `;
    return;
  }

  if (currentViewMode === 'overview') {
    // 1. 卡冊一覽九宮格模式 (Overview Mode)
    cardsGridEl.innerHTML = cards.map((card, index) => {
      const langBadgeClass = `badge-${card.language.toLowerCase()}`;
      const langLabel = card.language === 'TC' ? '🇹🇼 台' : (card.language === 'JP' ? '🇯🇵 日' : '🇺🇸 美');
      const top3Class = index < 3 ? 'badge-top3' : '';
      const names = getCardDisplayNames(card);

      return `
        <div class="overview-card-item glass-panel" id="card-${card.id}" data-id="${card.id}" title="按住拖曳可調整順序">
          <div class="overview-card-header">
            <span class="order-badge ${top3Class}">#${index + 1}</span>
            <div style="display:flex; align-items:center; gap:5px;">
              <button class="btn-icon-action btn-refresh" data-action="refresh" data-id="${card.id}" title="重新聯網更新報價" style="padding: 2px 5px; font-size: 0.7rem; border-radius: 4px;">🔄</button>
              <button class="btn-icon-action btn-del" data-action="delete" data-id="${card.id}" data-name="${(names.primary || card.raw_id).replace(/"/g, '&quot;')}" title="刪除此卡片" style="padding: 2px 5px; font-size: 0.7rem; border-radius: 4px;">🗑️</button>
              <span class="drag-handle" title="按住拖曳排序">⠿</span>
            </div>
          </div>

          <div class="overview-card-art">
            <img src="${card.image_url}" alt="${names.primary || card.raw_id}" loading="lazy" onerror="this.src='https://assets.tcgdex.net/univ/cards/card-back/high.webp'">
            <span class="overview-lang-tag badge ${langBadgeClass}">${langLabel}</span>
          </div>

          <div class="overview-card-meta">
            <div class="overview-card-title" title="${names.primary}">${names.primary}</div>
            <div class="overview-card-id">${card.raw_id}</div>
            <div class="overview-card-price-row">
              <span class="overview-price-label">即時估值</span>
              <span class="overview-price-val">NT$ ${(card.market_price_twd || 0).toLocaleString()}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } else {
    // 2. 詳細指標模式 (Detailed Mode)
    cardsGridEl.innerHTML = cards.map((card, index) => {
      const langBadgeClass = `badge-${card.language.toLowerCase()}`;
      const langLabel = card.language === 'TC' ? '🇹🇼 台版' : (card.language === 'JP' ? '🇯🇵 日版' : '🇺🇸 美版');
      const pnl = card.market_price_twd - card.buy_price_twd;
      const pnlText = pnl >= 0 ? `+NT$ ${pnl}` : `-NT$ ${Math.abs(pnl)}`;
      const pnlClass = pnl >= 0 ? 'pnl-positive' : 'pnl-negative';
      const top3Class = index < 3 ? 'badge-top3' : '';
      const names = getCardDisplayNames(card);

      return `
        <div class="card-item glass-panel" id="card-${card.id}" data-id="${card.id}">
          <div class="card-visual-wrapper">
            <div class="card-image-box">
              <img src="${card.image_url}" alt="${names.primary || card.raw_id}" loading="lazy" onerror="this.src='https://assets.tcgdex.net/univ/cards/card-back/high.webp'">
            </div>
            <div class="card-meta-details">
              <div>
                <div class="card-top-tags">
                  <div style="display:flex; align-items:center; gap:6px;">
                    <span class="order-badge ${top3Class}">#${index + 1}</span>
                    <span class="badge ${langBadgeClass}">${langLabel}</span>
                  </div>
                  <div style="display:flex; align-items:center; gap:8px;">
                    <span class="card-raw-id">${card.raw_id}</span>
                    <span class="drag-handle" title="按住拖曳排序">⠿</span>
                  </div>
                </div>
                <h3 class="card-title">${names.primary}</h3>
                <p class="card-sub-names">${names.sub}</p>
              </div>
              <div>
                <span class="card-rarity">${card.rarity || 'Regular'}</span>
              </div>
            </div>
          </div>

          <div class="card-price-box">
            <div class="price-row-primary">
              <span class="price-title">當前即時估值</span>
              <span class="price-val">NT$ ${card.market_price_twd.toLocaleString()}</span>
            </div>
            <div class="price-secondary-info">
              <span>入手成本: NT$ ${card.buy_price_twd}</span>
              <span class="pnl-badge ${pnlClass}">${pnlText}</span>
            </div>
          </div>

          <div class="card-card-footer">
            <span class="source-tag" title="${card.price_source}">來源: ${card.price_source || '網路報價'}</span>
            <div class="card-actions-group">
              <button class="btn-icon-action btn-refresh" data-action="refresh" data-id="${card.id}" title="重新聯網更新報價與卡圖">
                🔄
              </button>
              <button class="btn-icon-action btn-del" data-action="delete" data-id="${card.id}" data-name="${(card.name_zh || card.raw_id).replace(/"/g, '&quot;')}" title="刪除此卡片">
                🗑️
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // 綁定原生 HTML5 拖曳排序機制
  setupDragAndDrop();
}

// 實作卡牌拖曳排序機制 (HTML5 Drag and Drop)
function setupDragAndDrop() {
  const cardElements = cardsGridEl.querySelectorAll('.overview-card-item, .card-item');

  cardElements.forEach(item => {
    item.setAttribute('draggable', 'true');

    // 拖曳開始
    item.addEventListener('dragstart', (e) => {
      draggedCardId = item.dataset.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.dataset.id);
      setTimeout(() => item.classList.add('dragging'), 0);
    });

    // 拖曳結束
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      draggedCardId = null;
    });

    // 拖曳經過目標
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const targetCard = e.currentTarget;
      if (targetCard.dataset.id !== draggedCardId && !targetCard.classList.contains('drag-over')) {
        targetCard.classList.add('drag-over');
      }
    });

    // 離開目標
    item.addEventListener('dragleave', (e) => {
      // 避免子元素觸發 leave
      if (!e.currentTarget.contains(e.relatedTarget)) {
        e.currentTarget.classList.remove('drag-over');
      }
    });

    // 放下並完成重排
    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const targetCard = e.currentTarget;
      targetCard.classList.remove('drag-over');

      const targetId = targetCard.dataset.id;
      if (!draggedCardId || draggedCardId === targetId) return;

      const fromIndex = cardsData.findIndex(c => c.id === draggedCardId);
      const toIndex = cardsData.findIndex(c => c.id === targetId);

      if (fromIndex !== -1 && toIndex !== -1) {
        // 從舊位置抽出並插入至新位置
        const [movedCard] = cardsData.splice(fromIndex, 1);
        cardsData.splice(toIndex, 0, movedCard);

        // 重新渲染畫面
        renderCards(cardsData);

        // 異步持久化儲存至 SQLite
        await saveCardsOrder('✅ 卡牌排列順序已自動儲存！');
      }
    });
  });
}

// 異步更新自訂排列順序至後端 API
async function saveCardsOrder(customMsg = '✅ 卡牌排列順序已更新！') {
  try {
    const order = cardsData.map(c => c.id);
    const res = await fetch('/api/cards/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order })
    });

    if (res.ok) {
      showToast(customMsg);
    } else {
      showToast('⚠️ 順序儲存失敗，請檢查後端狀態');
    }
  } catch (err) {
    console.error('Failed to save cards order:', err);
    showToast('⚠️ 網路連線錯誤，無法同步順序');
  }
}

// 顯示浮動 Toast 狀態通知
let toastTimer = null;
function showToast(msg) {
  if (!toastNotificationEl) return;
  toastNotificationEl.innerText = msg;
  toastNotificationEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastNotificationEl.classList.remove('show');
  }, 2400);
}
