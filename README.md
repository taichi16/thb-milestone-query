# 省道里程樁查詢系統

本專案是一個專為手機與電腦設計的**省道里程樁定位、地圖視覺化與導航查詢系統**。
資料來源對接交通部公路局每月更新之「省道里程坐標（里程牌標誌）」開放資料（資料集識別碼：7040）。

本專案採用 **Serverless 靜態網頁架構**，結合 **GitHub Actions** 與 **瀏覽器 IndexedDB 快取技術**，免去了手動複製貼上資料的繁瑣，實現全自動更新，且首頁開啟載入速度僅需數十毫秒。

- 預覽效果與 AppSheet 原理一致，但排版更具科技質感，操作更加流暢。
- **永久免費網址**：上傳至您的 GitHub 後，可透過 GitHub Pages 取得專屬的永久 URL 供隨時存取。

---

## 🌟 核心功能
1. **省道公路清單瀏覽**：依公路編號排序展示所有省道，點選後能一鍵切換至二級里程樁列表，並在地圖上繪製整條公路的走向（折線）。
2. **里程樁詳細資料與地圖**：提供每個里程樁的行政區劃（縣市、鄉鎮、村里）、海拔高度、WGS84 座標、設置位置（是否在道路中間）等完整資訊，並搭配 Leaflet.js 互動地圖。
3. **全局快速搜尋**：首創支援空格多關鍵字交叉篩選（如輸入「台1 45K」或「台9 花蓮」），極速從 30,000+ 筆資料中篩選出結果。
4. **一鍵複製與導航**：提供「複製座標」與「開始導航」按鈕。點選導航可直接喚醒手機內建的 Google Maps App 進行路徑規劃。
5. **手動更新與自動更新雙重機制**：
   - **前端手動更新**：網頁提供「檢查更新」按鈕，點擊會即時與儲存庫最新資料做 md5 比對，若有新版即可一鍵更新瀏覽器快取。
   - **後端自動更新**：設定 GitHub Actions 每日自動執行 Python 爬蟲，偵測政府開放平台是否有新資料包，若有則自動下載最新 CSV 並更新發布。

---

## 🛠️ 本地開發與測試

本專案無任何前端編譯步驟（No Build Tools），只要啟動一個簡單的本地伺服器即可運作：

1. 開啟終端機並進入專案目錄：
   ```bash
   cd thb-milestone-query
   ```
2. 啟動 Python 內建輕量伺服器：
   ```bash
   python3 -m http.server 8080
   ```
3. 在瀏覽器打開以下網址進行測試：
   [http://localhost:8080](http://localhost:8080)

---

## 🚀 GitHub 上傳與 Pages 永久網址部署指南

請按照以下步驟將本專案發布至您的 GitHub 並啟用免費的永久網址：

### 第一步：在 GitHub 上建立新儲存庫 (Repository)
1. 登入您的 [GitHub 帳號](https://github.com/)。
2. 點擊右上角 `+` -> **New repository**。
3. 設定 Repository name 為：`thb-milestone-query`。
4. 設為 **Public**（公開），且**不要**勾選 "Initialize this repository with a README"（因為專案中已包含此檔案）。
5. 點擊 **Create repository**。

### 第二步：上傳本地專案代碼
在您的本地終端機（確保在 `thb-milestone-query` 資料夾下）執行以下指令：

```bash
# 1. 提交檔案至 Git 本地快取
git add .

# 2. 建立提交紀錄
git commit -m "feat: 實作省道里程樁查詢系統與自動更新機制"

# 3. 強制使用 main 做為預設分支
git branch -M main

# 4. 關聯到您剛剛建立的 GitHub 儲存庫 (請將 <your-username> 換成您的 GitHub 帳號)
git remote add origin https://github.com/<your-username>/thb-milestone-query.git

# 5. 上傳代碼
git push -u origin main
```

### 第三步：啟用 GitHub Pages (取得永久網址)
1. 在 GitHub 網頁上，進入您的 `thb-milestone-query` 儲存庫。
2. 點選上方的 **Settings**（設定）。
3. 在左側選單中找到並點選 **Pages**。
4. 在 **Build and deployment** 下的 **Source** 選擇 `Deploy from a branch`。
5. 在 **Branch** 選項中，選擇 `main`，並將資料夾設為 `/ (root)`。
6. 點擊 **Save**。
7. 稍等約 1 分鐘，重新整理頁面，最上方會出現您的專案永久網址：
   `https://<your-username>.github.io/thb-milestone-query/`

### 第四步：設定 GitHub Actions 自動更新權限
為了讓自動更新腳本能在每日偵測到新資料時，自動將資料寫入並提交回您的 GitHub，您需要開啟寫入權限：
1. 依然在儲存庫的 **Settings**（設定）頁面。
2. 點選左側選單的 **Actions** -> **General**。
3. 滾動到最下方找到 **Workflow permissions**。
4. 將預設的 "Read repository contents and packages permissions" 改選為 **"Read and write permissions"**。
5. 點擊 **Save** 儲存。

> 🎉 至此已設定完畢！系統將於每日凌晨自動檢查政府資料，若有更新便會更新網頁，您只需打開您的 Pages 永久網址即可隨時使用最精準的里程資料！
