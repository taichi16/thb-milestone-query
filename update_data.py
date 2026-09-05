#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
省道里程樁資料自動更新腳本 (update_data.py)
功能：
1. 解析 data.gov.tw/dataset/7040 網頁，獲取最新的 CSV 下載連結與 md5_url。
2. 比對本地 metadata.json，檢查是否有新版本。
3. 若有新版本，下載最新的 CSV 檔案至 data/data.csv，並更新 metadata.json。
4. 本腳本僅使用 Python 內建標準庫，無需額外安裝套件，便於 GitHub Actions 執行。
"""

import os
import re
import ssl
import json
import urllib.request
from datetime import datetime

# 停用 SSL 憑證驗證（避免政府網站憑證過期或 SSL 交握錯誤）
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

DATASET_URL = "https://data.gov.tw/dataset/7040"
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
}

def get_latest_dataset_info():
    """爬取政府資料開放平臺，獲取最新 CSV 下載網址與 md5_url"""
    try:
        req = urllib.request.Request(DATASET_URL, headers=HEADERS)
        with urllib.request.urlopen(req, context=ctx) as response:
            html = response.read().decode('utf-8')
        
        # 搜尋品質資料下載網址 (包含 nid=7040 與 md5_url)
        # 網頁中可能包含轉義的斜線 \u002F
        pattern = r'https?:\\u002F\\u002Fquality\.data\.gov\.tw\\u002Fdq_download_csv\.php\?nid=7040&md5_url=[a-f0-9]+'
        matches = re.findall(pattern, html)
        if not matches:
            # 嘗試未轉義的匹配
            pattern_unescaped = r'https?://quality\.data\.gov\.tw/dq_download_csv\.php\?nid=7040&md5_url=[a-f0-9]+'
            matches = re.findall(pattern_unescaped, html)
            
        if not matches:
            # 備用匹配：尋找任何含有 quality.data.gov.tw 與 csv 的網址
            fallback = r'https?[^"\']+(?:quality\.data\.gov\.tw)[^"\']+(?:csv)[^"\']+'
            matches = re.findall(fallback, html)
            
        if matches:
            download_url = matches[0].replace('\\u002F', '/')
            # 提取 md5_url
            md5_match = re.search(r'md5_url=([a-f0-9]+)', download_url)
            md5_url = md5_match.group(1) if md5_match else ""
            return download_url, md5_url
        else:
            print("無法在網頁中找到 CSV 下載連結。")
            return None, None
    except Exception as e:
        print(f"獲取資料集網頁時發生錯誤: {e}")
        return None, None

def main():
    # 確保資料夾存在
    os.makedirs("data", exist_ok=True)
    
    metadata_path = "metadata.json"
    csv_path = "data/data.csv"
    
    # 讀取本地 metadata.json
    local_metadata = {}
    if os.path.exists(metadata_path):
        try:
            with open(metadata_path, 'r', encoding='utf-8') as f:
                local_metadata = json.load(f)
        except Exception as e:
            print(f"讀取本地 metadata.json 失敗: {e}")
            
    local_md5 = local_metadata.get("md5_url", "")
    
    print("正在檢查政府開放資料平台 (dataset 7040)...")
    download_url, online_md5 = get_latest_dataset_info()
    
    if not download_url or not online_md5:
        print("無法獲取線上資料集資訊，更新終止。")
        return
        
    print(f"本地資料 md5_url: {local_md5}")
    print(f"線上最新 md5_url: {online_md5}")
    
    # 檢查是否需要更新
    # 如果 CSV 檔案不存在，或 md5_url 不一致，則進行更新
    if not os.path.exists(csv_path) or local_md5 != online_md5:
        print("偵測到新版本或本地資料遺失，準備下載更新...")
        print(f"下載網址: {download_url}")
        
        try:
            req = urllib.request.Request(download_url, headers=HEADERS)
            with urllib.request.urlopen(req, context=ctx) as response:
                csv_data = response.read()
                
            # 驗證下載的資料是否為有效的 CSV (至少包含欄位名與基本行數)
            decoded_preview = csv_data[:1000].decode('utf-8', errors='ignore')
            if "公路編號" not in decoded_preview:
                print("警告：下載的資料不包含預期的 CSV 標頭，下載可能失敗或被阻擋。")
                return
                
            # 寫入 CSV 檔案
            with open(csv_path, 'wb') as f:
                f.write(csv_data)
            print(f"CSV 下載成功，儲存至 {csv_path} (大小: {len(csv_data)} 位元組)")
            
            # 更新 metadata
            new_metadata = {
                "last_updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "md5_url": online_md5,
                "csv_size": len(csv_data),
                "last_checked": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "status": "success"
            }
            
            with open(metadata_path, 'w', encoding='utf-8') as f:
                json.dump(new_metadata, f, ensure_ascii=False, indent=2)
                
            print("metadata.json 更新成功！")
            
        except Exception as e:
            print(f"下載或寫入資料時發生錯誤: {e}")
    else:
        print(f"資料已是最新版 (MD5: {online_md5})，無需更新。")

if __name__ == "__main__":
    main()
