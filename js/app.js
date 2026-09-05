/**
 * 省道里程樁查詢系統 - 前端主程式 (app.js)
 * 包含 IndexedDB 管理、CSV 解析、地圖整合、搜尋引擎與更新機制
 */

// ==========================================================================
// 1. IndexedDB 核心模組 (使用原生 Promise 封裝，無外部相依)
// ==========================================================================
const DB_NAME = 'THB_Milestone_DB';
const DB_VERSION = 1;
const STORE_NAME = 'app_data';

function getDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

function dbGet(key) {
    return getDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    }));
}

function dbSet(key, val) {
    return getDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(val, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    }));
}

// ==========================================================================
// 2. 全域狀態與變數
// ==========================================================================
let allMilestones = [];       // 所有里程樁數據
let roadMap = new Map();       // 省道名稱對應其里程樁列表
let map = null;               // Leaflet 地圖實例
let activeMarkers = [];       // 地圖上當前繪製的標記
let routePolyline = null;     // 地圖上的省道路段折線
let selectedMilestone = null; // 當前選取的里程樁
let currentTab = 'roads';     // 當前分頁 ('roads', 'search', 'about')
let currentRoad = null;       // 當前選取的省道名稱

// 地圖標記樣式 (選取狀態與一般狀態)
const activeIcon = L.divIcon({
    className: 'custom-pin-active',
    html: `<div style="
        width: 18px; 
        height: 18px; 
        background-color: #0284c7; 
        border: 3px solid #ffffff; 
        border-radius: 50%;
        box-shadow: 0 0 12px rgba(2, 132, 199, 0.8), 0 2px 6px rgba(0, 0, 0, 0.3);
    "></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9]
});

// ==========================================================================
// 3. 初始化與資料載入流程
// ==========================================================================
document.addEventListener('DOMContentLoaded', async () => {
    // 初始化深淺色主題 (預設淺色)
    initTheme();
    
    // 渲染 Lucide 圖標
    lucide.createIcons();
    
    // 初始化地圖
    initMap();
    
    // 設置自動偵測 GitHub 儲存庫連結
    setupRepoLink();
    
    // 綁定事件接聽器
    bindEvents();
    
    // 開始載入資料流程
    await loadDataFlow();
});

/**
 * 載入資料主流程：
 * 檢查快取 -> 有快取則直接載入 -> 無快取則下載 CSV 並建立快取
 */
async function loadDataFlow() {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingProgress = document.getElementById('loading-progress');
    const loadingStatus = document.getElementById('loading-status');
    
    try {
        // 1. 檢查 IndexedDB 快取
        loadingStatus.textContent = "正在檢查本地快取...";
        loadingProgress.style.width = "10%";
        
        const cachedMeta = await dbGet('metadata');
        const cachedData = await dbGet('milestones');
        
        if (cachedMeta && cachedData && cachedData.length > 0) {
            // 有快取，直接載入
            loadingStatus.textContent = "正在自快取載入里程資料...";
            loadingProgress.style.width = "50%";
            
            allMilestones = cachedData;
            processMilestones();
            
            loadingProgress.style.width = "100%";
            setTimeout(() => {
                loadingOverlay.classList.add('fade-out');
            }, 300);
            
            updateVersionStatus(cachedMeta);
            return;
        }
        
        // 2. 無快取，執行首次下載
        loadingStatus.textContent = "首次載入，正在取得中繼資料...";
        loadingProgress.style.width = "20%";
        
        // 獲取 metadata.json
        const metaRes = await fetch('metadata.json?t=' + Date.now());
        const meta = await metaRes.json();
        
        loadingStatus.textContent = `下載省道里程數據 (${(meta.csv_size / 1024 / 1024).toFixed(2)} MB)...`;
        loadingProgress.style.width = "40%";
        
        // 下載 CSV 數據
        const csvRes = await fetch('data/data.csv?t=' + Date.now());
        if (!csvRes.ok) throw new Error("下載 CSV 失敗");
        const csvText = await csvRes.text();
        
        loadingStatus.textContent = "正在解析里程數據...";
        loadingProgress.style.width = "70%";
        
        // 解析 CSV 並轉換
        allMilestones = parseCSVData(csvText);
        
        loadingStatus.textContent = "正在寫入本地瀏覽器資料庫...";
        loadingProgress.style.width = "90%";
        
        // 存入 IndexedDB 快取
        await dbSet('metadata', meta);
        await dbSet('milestones', allMilestones);
        
        processMilestones();
        
        loadingProgress.style.width = "100%";
        loadingStatus.textContent = "載入完成！";
        
        setTimeout(() => {
            loadingOverlay.classList.add('fade-out');
        }, 500);
        
        updateVersionStatus(meta);
        
    } catch (error) {
        console.error("載入資料流失敗:", error);
        if (window.location.protocol === 'file:') {
            document.getElementById('loading-title').textContent = "請透過本地伺服器開啟";
            document.getElementById('loading-subtitle').innerHTML = 
                "因瀏覽器安全性限制 (CORS)，直接雙擊檔案 (<code>file://</code>) 無法讀取資料檔。<br><br>我們已在本地為您啟動伺服器，請改由以下連結開啟：<br><br><a href='http://localhost:8080' style='display:inline-block; padding:8px 16px; background:var(--accent-color); color:#fff; border-radius:8px; font-weight:bold; text-decoration:none;'>👉 點此前往 http://localhost:8080</a><br><br><span style='font-size:12px; color:var(--text-muted);'>（推送到 GitHub 後，在 GitHub Pages 則可直接正常開啟）</span>";
            loadingStatus.textContent = "瀏覽器 CORS 安全策略限制";
            loadingStatus.style.color = "#f59e0b";
        } else {
            loadingStatus.textContent = "載入失敗，請確認網路連線並重新整理網頁！";
            loadingStatus.style.color = "#ef4444";
            document.getElementById('loading-title').textContent = "系統載入錯誤";
        }
    }
}

/**
 * 解析 CSV 數據並結構化為 JS 物件陣列
 */
function parseCSVData(csvText) {
    const parsed = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true
    });
    
    if (parsed.errors && parsed.errors.length > 0) {
        console.warn("CSV 解析過程中出現警告:", parsed.errors);
    }
    
    const results = [];
    const milestonePattern = /^(\d+)K\+(\d{3})$/;
    
    parsed.data.forEach((row, index) => {
        const road = row['公路編號'];
        const milestoneStr = row['起點樁號'] || '';
        const match = milestoneStr.match(milestonePattern);
        
        // 略過經緯度或關鍵欄位缺失的無效資料
        const lon = parseFloat(row['坐標-E-WGS84']);
        const lat = parseFloat(row['坐標-N-WGS84']);
        if (isNaN(lon) || isNaN(lat) || !road) return;
        
        let k = 0;
        let m = '000';
        let totalMeters = 0;
        
        if (match) {
            k = parseInt(match[1], 10);
            m = match[2];
            totalMeters = k * 1000 + parseInt(m, 10);
        }
        
        results.push({
            id: index,
            road: road,
            roadCode: row['公路編碼'] || '',
            county: row['隸屬縣市'] || '',
            township: row['隸屬鄉鎮'] || '',
            village: row['隸屬村里'] || '',
            lon: lon,
            lat: lat,
            k: k,
            m: m,
            totalMeters: totalMeters,
            milestone: milestoneStr,
            elevation: row['坐標Z'] ? parseFloat(row['坐標Z']).toFixed(2) : '-',
            position: row['設置位置'] || '未知',
            direction: row['牌面方向'] || '未知',
            status: row['現況'] || '良好',
            office: `${row['管養單位'] || ''} ${row['管養工務段'] || ''}`.trim() || '未知',
            date: row['調查日期'] || '',
            notes: row['備註'] || ''
        });
    });
    
    return results;
}

/**
 * 處理與分組里程樁資料
 */
function processMilestones() {
    roadMap.clear();
    
    // 按省道編號分組
    allMilestones.forEach(item => {
        if (!roadMap.has(item.road)) {
            roadMap.set(item.road, []);
        }
        roadMap.get(item.road).push(item);
    });
    
    // 將每條省道的里程樁依公里數排序
    for (let [road, list] of roadMap.entries()) {
        list.sort((a, b) => a.totalMeters - b.totalMeters);
    }
    
    // 渲染省道列表與下拉選單
    renderRoadList();
    renderRoadDropdown();
}

// ==========================================================================
// 4. 地圖控制模組 (Leaflet)
// ==========================================================================
function initMap() {
    // 建立地圖，預設中心點在台灣地理中心
    map = L.map('map', {
        zoomControl: true,
        attributionControl: true
    }).setView([23.7, 120.95], 8);
    
    // 1. 臺灣通用電子地圖 (NLSC EMAP) - 專為台灣路網打造、全中文清晰標註、高對比且無浮水印
    const emapLayer = L.tileLayer('https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}', {
        attribution: '&copy; <a href="https://maps.nlsc.gov.tw/" target="_blank" rel="noopener noreferrer">國土測繪圖資服務雲</a>',
        maxZoom: 19
    });
    
    // 2. OpenStreetMap (OSM) 標準國際圖資
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
        maxZoom: 19
    });

    // 預設啟用臺灣通用電子地圖
    emapLayer.addTo(map);

    // 加入右上角圖層切換器
    const baseLayers = {
        "臺灣通用電子圖 (清晰)": emapLayer,
        "OpenStreetMap 街圖": osmLayer
    };
    L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);
}

/**
 * 清除地圖上的所有標記與線段
 */
function clearMapLayers() {
    activeMarkers.forEach(marker => map.removeLayer(marker));
    activeMarkers = [];
    
    if (routePolyline) {
        map.removeLayer(routePolyline);
        routePolyline = null;
    }
}

/**
 * 繪製單一里程樁的標記並聚焦
 */
function focusMilestoneOnMap(item) {
    clearMapLayers();
    
    const latLng = [item.lat, item.lon];
    
    // 建立發光選取標記
    const marker = L.marker(latLng, { icon: activeIcon }).addTo(map);
    
    // 點擊標記時，若在手機版，彈出詳細資訊
    marker.on('click', () => {
        showDetailPanel(item);
    });
    
    // 彈出資訊視窗
    marker.bindPopup(`
        <div style="font-weight:700; font-size:15px; margin-bottom:6px; color:var(--accent-color);">
            ${item.road} ${item.milestone}
        </div>
        <div style="font-size:13px; margin-bottom:3px; color:var(--text-secondary);">
            縣市：<strong style="color:var(--text-primary); font-weight:600;">${item.county}${item.township}</strong>
        </div>
        <div style="font-size:13px; margin-bottom:3px; color:var(--text-secondary);">
            海拔：<strong style="color:var(--text-primary); font-weight:600;">${item.elevation} m</strong>
        </div>
        <div style="margin-top:8px;">
            <a href="javascript:void(0)" onclick="window.appShowDetail(${item.id})" style="color:var(--accent-color); font-weight:700; font-size:13px; text-decoration:none;">
                查看詳細資訊 &rarr;
            </a>
        </div>
    `).openPopup();
    
    activeMarkers.push(marker);
    
    // 平滑移動與放大
    map.flyTo(latLng, 16, {
        animate: true,
        duration: 1.2
    });
    
    // 全域註冊，供彈出視窗中的 JavaScript 呼叫
    window.appShowDetail = (id) => {
        const found = allMilestones.find(x => x.id === id);
        if (found) showDetailPanel(found);
    };
}

/**
 * 繪製整條省道的所有里程標記與路線折線
 */
function drawRoadRouteOnMap(roadName) {
    clearMapLayers();
    
    const points = roadMap.get(roadName);
    if (!points || points.length === 0) return;
    
    const latLngs = [];
    
    points.forEach(item => {
        const latLng = [item.lat, item.lon];
        latLngs.push(latLng);
        
        // 建立精簡圓點標記，避免地圖太擁擠
        const circleMarker = L.circleMarker(latLng, {
            radius: 5,
            fillColor: '#0284c7',
            color: '#ffffff',
            weight: 1.5,
            opacity: 0.9,
            fillOpacity: 0.95
        }).addTo(map);
        
        // 綁定地圖 Popup
        circleMarker.bindPopup(`
            <div style="font-weight:700; font-size:14px; color:var(--accent-color); margin-bottom:4px;">${item.road} ${item.milestone}</div>
            <div style="font-size:12px; color:var(--text-secondary); margin-bottom:6px;">座標：${item.lat.toFixed(5)}, ${item.lon.toFixed(5)}</div>
            <div><a href="javascript:void(0)" onclick="window.appSelectMilestone(${item.id})" style="color:var(--accent-color); font-weight:700; font-size:13px; text-decoration:none;">選擇此點 &rarr;</a></div>
        `);
        
        activeMarkers.push(circleMarker);
    });
    
    // 連接里程點，繪製路網折線
    routePolyline = L.polyline(latLngs, {
        color: '#0284c7',
        weight: 4,
        opacity: 0.75,
        dashArray: '3, 6' // 虛線效果增加設計感
    }).addTo(map);
    
    // 自動調整地圖範圍以包含整條公路
    const bounds = L.latLngBounds(latLngs);
    map.fitBounds(bounds, { padding: [50, 50] });
    
    // 全域註冊
    window.appSelectMilestone = (id) => {
        const found = allMilestones.find(x => x.id === id);
        if (found) {
            selectMilestoneItem(found);
        }
    };
}

// ==========================================================================
// 5. 介面渲染與路由模組
// ==========================================================================

/**
 * 渲染左側公路列表
 */
function renderRoadList(filterQuery = '') {
    const listEl = document.getElementById('road-list');
    listEl.innerHTML = '';
    
    const query = filterQuery.toLowerCase().trim();
    
    // 獲取所有省道公路名稱並排序
    // 排序邏輯：台1 -> 台1甲 -> 台2 -> ...
    const roads = Array.from(roadMap.keys()).sort((a, b) => {
        return a.localeCompare(b, 'zh-Hant-TW', { numeric: true });
    });
    
    let matchedCount = 0;
    
    roads.forEach(road => {
        const list = roadMap.get(road);
        const count = list.length;
        
        // 搜尋篩選：比對公路名稱，或所屬縣市
        const isMatched = !query || 
            road.toLowerCase().includes(query) || 
            list.some(item => item.county.includes(query) || item.township.includes(query));
            
        if (!isMatched) return;
        
        matchedCount++;
        const li = document.createElement('li');
        li.dataset.road = road;
        if (currentRoad === road) li.classList.add('active');
        
        li.innerHTML = `
            <div class="list-item-left">
                <i data-lucide="route" class="list-icon"></i>
                <div>
                    <div class="list-item-title">${road}</div>
                    <div class="list-item-sub">起訖里程: ${list[0].milestone} ~ ${list[count-1].milestone}</div>
                </div>
            </div>
            <span class="badge">${count} 點</span>
        `;
        
        li.addEventListener('click', () => {
            selectRoad(road);
        });
        
        listEl.appendChild(li);
    });
    
    // 重新載入新加入節點的 Lucide 圖標
    lucide.createIcons({ attrs: { class: 'list-icon' } });
    
    if (matchedCount === 0) {
        listEl.innerHTML = `<div style="padding:24px; text-align:center; color:var(--text-muted); font-size:var(--font-size-sm);">無符合公路資料</div>`;
    }
}

/**
 * 渲染地圖覆蓋道路選單
 */
function renderRoadDropdown() {
    const selector = document.getElementById('map-road-selector');
    selector.innerHTML = '<option value="">-- 選擇省道繪製全部里程樁 --</option>';
    
    const roads = Array.from(roadMap.keys()).sort((a, b) => {
        return a.localeCompare(b, 'zh-Hant-TW', { numeric: true });
    });
    
    roads.forEach(road => {
        const option = document.createElement('option');
        option.value = road;
        option.textContent = `${road} (${roadMap.get(road).length} 點)`;
        selector.appendChild(option);
    });
}

/**
 * 選擇特定省道公路，進入二級里程樁列表
 */
function selectRoad(roadName) {
    currentRoad = roadName;
    
    // 更新高亮狀態
    document.querySelectorAll('#road-list li').forEach(li => {
        if (li.dataset.road === roadName) {
            li.classList.add('active');
        } else {
            li.classList.remove('active');
        }
    });
    
    // 渲染里程樁二級清單
    renderMilestoneList(roadName);
    
    // 在地圖上繪製整條路徑
    drawRoadRouteOnMap(roadName);
    
    // 切換至二級面板
    switchSubTab('milestones');
}

/**
 * 渲染里程樁二級列表
 */
function renderMilestoneList(roadName, filterQuery = '') {
    const listEl = document.getElementById('milestone-list');
    listEl.innerHTML = '';
    
    document.getElementById('active-road-title').textContent = `${roadName}里程座標`;
    
    const query = filterQuery.toLowerCase().trim();
    const milestones = roadMap.get(roadName) || [];
    document.getElementById('active-road-count').textContent = `${milestones.length} 點`;
    
    let matchedCount = 0;
    
    milestones.forEach(item => {
        const isMatched = !query || 
            item.milestone.toLowerCase().includes(query) ||
            item.county.toLowerCase().includes(query) ||
            item.township.toLowerCase().includes(query) ||
            item.position.toLowerCase().includes(query);
            
        if (!isMatched) return;
        
        matchedCount++;
        const li = document.createElement('li');
        li.dataset.id = item.id;
        if (selectedMilestone && selectedMilestone.id === item.id) li.classList.add('active');
        
        li.innerHTML = `
            <div class="list-item-left">
                <i data-lucide="map-pin" class="list-icon"></i>
                <div>
                    <div class="list-item-title">${item.milestone}</div>
                    <div class="list-item-sub">${item.county} ${item.township} • 設置: ${item.position}</div>
                </div>
            </div>
            <i data-lucide="chevron-right" class="list-icon" style="width:16px;"></i>
        `;
        
        li.addEventListener('click', () => {
            selectMilestoneItem(item);
        });
        
        listEl.appendChild(li);
    });
    
    lucide.createIcons({ attrs: { class: 'list-icon' } });
    
    if (matchedCount === 0) {
        listEl.innerHTML = `<div style="padding:24px; text-align:center; color:var(--text-muted); font-size:var(--font-size-sm);">無符合里程資料</div>`;
    }
}

/**
 * 選取特定里程樁並啟動地圖與詳情
 */
function selectMilestoneItem(item) {
    selectedMilestone = item;
    
    // 更新高亮狀態 (在二級列表與搜尋結果中)
    document.querySelectorAll('#milestone-list li, #search-result-list li').forEach(li => {
        if (parseInt(li.dataset.id) === item.id) {
            li.classList.add('active');
        } else {
            li.classList.remove('active');
        }
    });
    
    // 在地圖上定位
    focusMilestoneOnMap(item);
    
    // 顯示詳細資料面板
    showDetailPanel(item);
    
    // 手機版自動切換至地圖分頁，讓使用者看到地圖
    if (window.innerWidth <= 768) {
        switchMobileTab('map');
    }
}

/**
 * 顯示詳細資訊面板並填充資料
 */
function showDetailPanel(item) {
    document.getElementById('detail-road-name').textContent = `${item.road}線`;
    document.getElementById('detail-road-code').textContent = item.roadCode;
    document.getElementById('detail-k').textContent = item.k;
    document.getElementById('detail-m').textContent = item.m;
    document.getElementById('detail-position').textContent = `設置：${item.position}`;
    document.getElementById('detail-county').textContent = item.county || '無';
    document.getElementById('detail-township').textContent = item.township || '無';
    document.getElementById('detail-village').textContent = item.village || '無';
    document.getElementById('detail-elevation').textContent = `${item.elevation} 公尺`;
    document.getElementById('detail-coords').textContent = `${item.lat.toFixed(7)}, ${item.lon.toFixed(7)}`;
    document.getElementById('detail-direction').textContent = item.direction || '無';
    document.getElementById('detail-status').textContent = item.status || '正常';
    document.getElementById('detail-office').textContent = item.office || '未知';
    document.getElementById('detail-date').textContent = item.date || '無紀錄';
    
    const notesEl = document.getElementById('detail-notes');
    const notesContainer = document.getElementById('detail-notes-container');
    if (item.notes) {
        notesEl.textContent = item.notes;
        notesContainer.style.display = 'flex';
    } else {
        notesContainer.style.display = 'none';
    }
    
    // 顯示卡片
    document.getElementById('detail-panel').classList.remove('hide');
}

// ==========================================================================
// 6. 搜尋引擎模組
// ==========================================================================
function performGlobalSearch(query) {
    const listEl = document.getElementById('search-result-list');
    const summaryEl = document.getElementById('search-results-summary');
    listEl.innerHTML = '';
    
    const term = query.toLowerCase().trim();
    if (!term) {
        summaryEl.textContent = '請輸入關鍵字開始搜尋';
        return;
    }
    
    // 支援多重關鍵字交叉搜尋 (以空白字元分隔)
    const keywords = term.split(/\s+/);
    
    const matched = allMilestones.filter(item => {
        return keywords.every(kw => {
            return item.road.toLowerCase().includes(kw) ||
                   item.milestone.toLowerCase().includes(kw) ||
                   item.county.toLowerCase().includes(kw) ||
                   item.township.toLowerCase().includes(kw) ||
                   item.position.toLowerCase().includes(kw) ||
                   item.office.toLowerCase().includes(kw);
        });
    });
    
    // 限制搜尋結果上限以確保網頁流暢度
    const LIMIT = 200;
    const count = matched.length;
    summaryEl.textContent = `找到 ${count} 筆符合條件的里程座標 ${count > LIMIT ? `(僅顯示前 ${LIMIT} 筆)` : ''}`;
    
    const listToRender = matched.slice(0, LIMIT);
    
    listToRender.forEach(item => {
        const li = document.createElement('li');
        li.dataset.id = item.id;
        if (selectedMilestone && selectedMilestone.id === item.id) li.classList.add('active');
        
        li.innerHTML = `
            <div class="list-item-left">
                <i data-lucide="map-pin" class="list-icon"></i>
                <div>
                    <div class="list-item-title">${item.road} • ${item.milestone}</div>
                    <div class="list-item-sub">${item.county}${item.township} • 設置: ${item.position}</div>
                </div>
            </div>
            <i data-lucide="chevron-right" class="list-icon" style="width:16px;"></i>
        `;
        
        li.addEventListener('click', () => {
            selectMilestoneItem(item);
        });
        
        listEl.appendChild(li);
    });
    
    lucide.createIcons({ attrs: { class: 'list-icon' } });
}

// ==========================================================================
// 7. 更新管理器 (更新按鈕事件)
// ==========================================================================
async function checkAndExecuteUpdate() {
    const btn = document.getElementById('update-btn');
    const icon = document.getElementById('update-icon');
    
    if (btn.classList.contains('disabled')) return;
    
    // 設為載入中狀態
    btn.classList.add('disabled');
    icon.classList.add('spinning');
    btn.setAttribute('disabled', 'true');
    
    try {
        const cachedMeta = await dbGet('metadata');
        const cachedMetaMd5 = cachedMeta ? cachedMeta.md5_url : '';
        
        // 發送請求取得儲存庫最新的 metadata.json (加亂數避開快取)
        const res = await fetch('metadata.json?t=' + Date.now());
        if (!res.ok) throw new Error("取得線上中繼資料失敗");
        const onlineMeta = await res.json();
        
        // 比對 md5
        if (cachedMetaMd5 === onlineMeta.md5_url) {
            alert(`目前已是最新版！\n\n資料更新時間：${onlineMeta.last_updated}\n比對字串 (MD5)：${onlineMeta.md5_url}`);
            
            // 更新檢查時間
            if (cachedMeta) {
                cachedMeta.last_checked = new Date().toLocaleString();
                await dbSet('metadata', cachedMeta);
                updateVersionStatus(cachedMeta);
            }
        } else {
            // 有新版本，提示並下載
            const confirmUpdate = confirm(`偵測到有新版資料！\n\n本地更新時間：${cachedMeta ? cachedMeta.last_updated : '無'}\n線上最新時間：${onlineMeta.last_updated}\n\n是否下載更新？`);
            
            if (confirmUpdate) {
                // 顯示載入層
                const overlay = document.getElementById('loading-overlay');
                const progress = document.getElementById('loading-progress');
                const status = document.getElementById('loading-status');
                
                document.getElementById('loading-title').textContent = "正在下載更新資料";
                overlay.classList.remove('fade-out');
                
                status.textContent = "正在從伺服器取得最新里程檔案...";
                progress.style.width = "40%";
                
                // 下載最新 CSV
                const csvRes = await fetch('data/data.csv?t=' + Date.now());
                if (!csvRes.ok) throw new Error("下載最新 CSV 失敗");
                const csvText = await csvRes.text();
                
                status.textContent = "正在解析並重構快取資料庫...";
                progress.style.width = "75%";
                
                allMilestones = parseCSVData(csvText);
                
                // 覆寫 IndexedDB
                await dbSet('metadata', onlineMeta);
                await dbSet('milestones', allMilestones);
                
                processMilestones();
                
                progress.style.width = "100%";
                status.textContent = "更新完成！";
                
                setTimeout(() => {
                    overlay.classList.add('fade-out');
                }, 500);
                
                updateVersionStatus(onlineMeta);
                alert("資料庫更新成功，已成功載入最新版資料！");
            }
        }
    } catch (error) {
        console.error("檢查更新失敗:", error);
        alert("檢查更新時發生錯誤，請確認網路連線！\n錯誤說明: " + error.message);
    } finally {
        // 還原按鈕狀態
        btn.classList.remove('disabled');
        icon.classList.remove('spinning');
        btn.removeAttribute('disabled');
    }
}

// ==========================================================================
// 8. 輔助功能與事件綁定
// ==========================================================================

function updateVersionStatus(meta) {
    const statusEl = document.getElementById('version-status');
    statusEl.innerHTML = `
        <i data-lucide="database" style="width:12px; height:12px; color:var(--success-color);"></i>
        <span>資料更新日: ${meta.last_updated} (快取版本)</span>
    `;
    lucide.createIcons({ attrs: { class: 'list-icon' } });
}

function setupRepoLink() {
    const hostname = window.location.hostname;
    const repoEl = document.getElementById('repo-link');
    if (!repoEl) return;
    
    if (hostname.endsWith('.github.io')) {
        const parts = window.location.pathname.split('/');
        const repoName = parts[1] || '';
        const username = hostname.split('.')[0];
        if (username && repoName) {
            const repoUrl = `https://github.com/${username}/${repoName}`;
            repoEl.href = repoUrl;
            repoEl.textContent = `${username}/${repoName}`;
        }
    } else {
        repoEl.href = 'https://github.com';
        repoEl.textContent = 'GitHub 專案庫';
    }
}

/**
 * 切換側邊欄分頁 (PC 版)
 */
function switchTab(tabId) {
    currentTab = tabId;
    
    // 更新 Tabs 高亮
    document.querySelectorAll('.panel-tab').forEach(btn => {
        if (btn.dataset.tab === tabId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    // 更新分頁內容容器顯示
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    document.getElementById(`content-${tabId}`).classList.add('active');
    
    // 如果是快速搜尋分頁，自動聚焦輸入框
    if (tabId === 'search') {
        setTimeout(() => document.getElementById('global-search-input').focus(), 100);
    }
}

/**
 * 切換二級分頁或子畫面
 */
function switchSubTab(subTabId) {
    // 隱藏其他分頁
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    // 顯示指定子畫面
    document.getElementById(`content-${subTabId}`).classList.add('active');
}

/**
 * 切換手機版底部 Tabs
 */
function switchMobileTab(target) {
    const appEl = document.getElementById('app-container');
    
    // 更新底部導覽按鈕狀態
    document.querySelectorAll('.mobile-tab').forEach(btn => {
        if (btn.dataset.target === target) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    if (target === 'map') {
        // 顯示地圖面板，隱藏列表面板
        appEl.classList.remove('show-list');
        appEl.classList.add('show-map');
        // 手機版地圖大小可能改變，重新繪製地圖大小
        setTimeout(() => {
            if (map) map.invalidateSize();
        }, 200);
    } else {
        // 顯示列表面板，隱藏地圖面板
        appEl.classList.remove('show-map');
        appEl.classList.add('show-list');
        
        // 根據手機分頁切換側邊欄分頁
        if (target === 'roads') {
            if (currentRoad) {
                // 如果已經選擇了某條省道，則返回該省道的里程樁列表
                switchSubTab('milestones');
            } else {
                switchTab('roads');
            }
        } else if (target === 'search') {
            switchTab('search');
        }
    }
}

function bindEvents() {
    // 1. PC 側邊欄分頁切換
    document.querySelectorAll('.panel-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            switchTab(btn.dataset.tab);
        });
    });
    
    // 2. 手機版底部 Tabs 切換
    document.querySelectorAll('.mobile-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            switchMobileTab(btn.dataset.target);
        });
    });
    
    // 3. 省道二級清單返回公路列表按鈕
    document.getElementById('back-to-roads-btn').addEventListener('click', () => {
        currentRoad = null;
        switchTab('roads');
        clearMapLayers();
        document.getElementById('detail-panel').classList.add('hide');
    });
    
    // 4. 地圖下拉公路選單 (手機版專用)
    document.getElementById('map-road-selector').addEventListener('change', (e) => {
        const road = e.target.value;
        if (road) {
            drawRoadRouteOnMap(road);
        } else {
            clearMapLayers();
        }
    });
    
    // 5. 關閉詳細卡片按鈕
    document.getElementById('close-detail-btn').addEventListener('click', () => {
        document.getElementById('detail-panel').classList.add('hide');
        selectedMilestone = null;
        // 清除地圖高亮標記
        document.querySelectorAll('#milestone-list li, #search-result-list li').forEach(li => li.classList.remove('active'));
    });
    
    // 6. 複製經緯度
    document.getElementById('copy-coords-btn').addEventListener('click', () => {
        if (!selectedMilestone) return;
        const coordsText = `${selectedMilestone.lat.toFixed(7)},${selectedMilestone.lon.toFixed(7)}`;
        navigator.clipboard.writeText(coordsText).then(() => {
            const btnSpan = document.querySelector('#copy-coords-btn span');
            const originalText = btnSpan.textContent;
            btnSpan.textContent = "已複製！";
            setTimeout(() => btnSpan.textContent = originalText, 1500);
        }).catch(err => {
            console.error('複製失敗:', err);
            alert('複製失敗，您的瀏覽器可能不支援剪貼簿功能。');
        });
    });
    
    // 7. 開始導航
    document.getElementById('navigate-btn').addEventListener('click', () => {
        if (!selectedMilestone) return;
        // 喚起 Google 地圖導航 (適用於手機 App 與電腦網頁版)
        const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${selectedMilestone.lat},${selectedMilestone.lon}`;
        window.open(navUrl, '_blank');
    });
    
    // 8. 篩選公路輸入框
    const roadFilterInput = document.getElementById('road-filter-input');
    const roadClearBtn = document.getElementById('road-filter-clear');
    
    roadFilterInput.addEventListener('input', (e) => {
        const val = e.target.value;
        if (val) {
            roadClearBtn.classList.remove('hide');
        } else {
            roadClearBtn.classList.add('hide');
        }
        renderRoadList(val);
    });
    
    roadClearBtn.addEventListener('click', () => {
        roadFilterInput.value = '';
        roadClearBtn.classList.add('hide');
        renderRoadList();
    });
    
    // 9. 篩選里程樁輸入框
    const msFilterInput = document.getElementById('milestone-filter-input');
    const msClearBtn = document.getElementById('milestone-filter-clear');
    
    msFilterInput.addEventListener('input', (e) => {
        const val = e.target.value;
        if (val) {
            msClearBtn.classList.remove('hide');
        } else {
            msClearBtn.classList.add('hide');
        }
        if (currentRoad) {
            renderMilestoneList(currentRoad, val);
        }
    });
    
    msClearBtn.addEventListener('click', () => {
        msFilterInput.value = '';
        msClearBtn.classList.add('hide');
        if (currentRoad) {
            renderMilestoneList(currentRoad);
        }
    });
    
    // 10. 全局快速搜尋輸入框
    const globalSearchInput = document.getElementById('global-search-input');
    const globalClearBtn = document.getElementById('global-search-clear');
    
    globalSearchInput.addEventListener('input', (e) => {
        const val = e.target.value;
        if (val) {
            globalClearBtn.classList.remove('hide');
        } else {
            globalClearBtn.classList.add('hide');
        }
        performGlobalSearch(val);
    });
    
    globalClearBtn.addEventListener('click', () => {
        globalSearchInput.value = '';
        globalClearBtn.classList.add('hide');
        performGlobalSearch('');
    });
    
    // 11. 更新資料按鈕
    document.getElementById('update-btn').addEventListener('click', () => {
        checkAndExecuteUpdate();
    });

    // 12. 深淺色主題切換按鈕
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            toggleTheme();
        });
    }
}

// ==========================================================================
// 8. 主題管理模組 (深淺色切換與偏好儲存)
// ==========================================================================
function initTheme() {
    const savedTheme = localStorage.getItem('thb_theme') || 'light';
    applyTheme(savedTheme);
}

function applyTheme(theme) {
    const icon = document.getElementById('theme-icon');
    if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        if (icon) icon.setAttribute('data-lucide', 'sun');
    } else {
        document.documentElement.removeAttribute('data-theme');
        if (icon) icon.setAttribute('data-lucide', 'moon');
    }
    lucide.createIcons();
    localStorage.setItem('thb_theme', theme);
}

function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';
    applyTheme(newTheme);
}
