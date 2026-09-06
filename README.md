# CardVault - PTCG 寶可夢卡牌資產管理系統 ⚡

[![Node.js](https://img.shields.io/badge/Node.js-18+-68a063?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-5.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![SQLite](https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

專為寶可夢集換式卡牌（PTCG）收藏家與投資者設計的現代化卡牌資產管理與電子卡冊系統。支援繁體中文（台版）、日文與英文跨版本卡牌追蹤、即時國際市場行情換算、自定義卡冊拖曳排序與跨裝置（手機/平板）區網同步存取。

---

## ✨ 核心特色 (Key Features)

### 1. 🎴 雙重視圖切換 (Dual View Modes)
- **卡夾一覽模式 (Binder Overview Grid)**：
  - 模擬實體九宮格/多格卡冊排版。
  - 原生支援 **HTML5 拖曳換位排序 (Drag-and-Drop Reorder)**，直覺自訂你的卡冊陳列順序。
  - 懸停即時卡牌全圖預覽。
- **詳細清單模式 (Detailed Asset View)**：
  - 完整展示入手成本 (Buy Price)、國際最新市價 (Market Price) 與即時未實現損益 (PnL)。
  - 支援單卡點擊呼叫卡牌詳細燈箱 (Modal)，可即時修正購入成本並自動重算投報率。

### 2. 🌐 多國語系動態切換 (Multi-Language Switcher)
- 頂部操作列支援四態名稱切換：
  - **🌐 依版本 (Auto)**：依卡牌原始發行版本呈現（台版顯示中文、日版顯示日文、美版顯示英文）。
  - **🇹🇼 台版 (zh)**：強制以繁體中文作為主標題，輔以英文/日文副標。
  - **🇺🇸 美版 (en)**：以英文名稱作為主標題，利於對照 TCGplayer 牌價。
  - **🇯🇵 日版 (ja)**：以日文名稱作為主標題，利於比對日本官方圖鑒。
- 狀態透過 `localStorage` 本地持久化儲存。

### 3. 📈 即時跨國牌價與自動匯率換算 (Price Tracker & Forex)
- 自動抓取國際市場價格訊號：
  - **TCGdex (TCGplayer / Cardmarket)**：支援美元 (USD) 與歐元 (EUR) 即時趨勢牌價。
  - **台版映射日版公式**：自動解析繁中版卡號並對映日版官方代碼，抓取日版市場均價後按當日即時匯率換算為新台幣 (TWD)。
  - 自動計算整體投資組合淨值、總成本與總損益率。

### 4. 🖼️ 官方高解析圖床爬蟲與自訂照片上傳
- 整合日本官方網站 (`pokemon-card.com`) 與 TCGdex 高清卡圖檢索爬蟲。
- 支援寶可夢本體卡、訓練家卡 (Trainer/Supporter)、SAR、AR、UR 等全系列卡圖自動爬取。
- 支援使用手機相機即時拍照或本地上傳卡牌實體品相照片。

### 5. 📱 跨裝置 Local Wi-Fi 連線支援
- 自動偵測本機實體 Wi-Fi IPv4 位址（如 `http://192.168.x.x:3080`）。
- 頂部狀態列提供快捷 Wi-Fi Badge，點擊即可複製手機連線網址。
- 隨附 `allow-wifi-access.bat` 一鍵配置 Windows 防火牆規則。

---

## 🛠️ 技術架構 (Tech Stack)

- **後端 (Backend)**：Node.js, Express 5, SQLite3 (`pokecard.db`)
- **爬蟲與牌價 (Scraper & APIs)**：TCGdex API, Pokémon Card JP 官方端點, Cheerio
- **前端 (Frontend)**：Vanilla JavaScript (ES6+), Modern CSS (Glassmorphism, Flexbox/Grid, Dark Mode)
- **圖示庫 (Icons)**：Font Awesome 6

---

## 🚀 快速開始 (Quick Start)

### 1. 安裝依賴
```bash
git clone https://github.com/ddrOnion/PokeCard.git
cd PokeCard
npm install
```

### 2. 開啟本機服務
```bash
npm start
```
伺服器啟動後將監聽 `0.0.0.0:3080`：
- 本機訪問：`http://localhost:3080`
- 同區網手機/平板訪問：`http://<您的本機區域IP>:3080`

### 3. 手機連線防火牆設定（Windows 使用者）
若手機無法存取 `http://<區域IP>:3080`，請在專案目錄下右鍵以「系統管理員身分執行」：
```cmd
allow-wifi-access.bat
```
該批次檔會自動在 Windows Defender 防火牆新增 Port 3080 入站允許規則。

---

## 📂 專案結構 (Directory Structure)

```text
PokeCard/
├── allow-wifi-access.bat   # Windows 防火牆 Port 3080 自動開放腳本
├── package.json            # 專案設定與相依套件
├── server.js               # Express 5 後端核心、SQLite 資料庫管理與爬蟲邏輯
├── pokecard.db             # SQLite 輕量化卡牌資料庫
├── public/
│   ├── index.html          # 前端儀表板、操作列與 Modal 結構
│   ├── style.css           # 玻璃擬態 (Glassmorphism) 深色主題設計系統
│   ├── app.js              # 前端業務邏輯、拖曳排序、語系切換與 API 通訊
│   └── uploads/            # 使用者上傳實體卡牌照片存儲目錄
└── README.md
```

---

## 📄 授權協議 (License)

本專案採用 [MIT License](LICENSE) 授權。
卡牌圖案與商標版權均屬 Nintendo, Creatures Inc., GAME FREAK Inc. 及 The Pokémon Company 所有。
