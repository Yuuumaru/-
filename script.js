const PREFS = [
    "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
    "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
    "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
    "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
    "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
    "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
    "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"
];

// 状態管理
let targetName = "位置特定中...";
let targetLat = 0.0, targetLon = 0.0;
const swaveSpeed = 3.5;
let lastEewId = "";
let lastEewData = null;
let timerInterval = null;
let currentHypoPref = "";
let blinkState = true;
let currentPts = []; // 詳細情報用

const IP_GEO_API = "https://ipapi.co/json/"; 
const ZIP_API_URL = "https://zipcloud.ibsnet.co.jp/api/search?zipcode=";
const EEW_API_URL = "https://api.wolfx.jp/jma_eew.json";
const P2P_API_URL = "https://api.p2pquake.net/v2/jma/quake?limit=40";

window.onload = () => {
    initGrid();
    initLocation();
    updateClock();
    setInterval(updateClock, 1000);
    
    fetchEEW();
    fetchP2P();
    setInterval(fetchEEW, 2000); 
    setInterval(fetchP2P, 15000); 
    
    setInterval(blinkLoop, 500);
};

function initGrid() {
    const container = document.getElementById("grid-container");
    container.innerHTML = "";
    PREFS.forEach(pref => {
        const cell = document.createElement("div");
        cell.className = "pref-cell";
        cell.id = `cell-${pref}`;
        cell.innerHTML = `
            <span class="pref-name">${pref}</span>
            <span class="hypo-label" id="hypo-${pref}">震源地</span>
            <span class="pref-intensity" id="intensity-${pref}">0</span>
        `;
        container.appendChild(cell);
    });
}

function updateClock() {
    const now = new Date();
    document.getElementById("date-label").innerText = now.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
    document.getElementById("clock-label").innerText = now.toLocaleTimeString('ja-JP', { hour12: false });
}

function blinkLoop() {
    blinkState = !blinkState;
    PREFS.forEach(pref => {
        const lbl = document.getElementById(`hypo-${pref}`);
        if (pref === currentHypoPref) {
            lbl.style.display = blinkState ? "block" : "none";
        } else {
            lbl.style.display = "none";
        }
    });
}

function initLocation() {
    const savedZip = localStorage.getItem("zip_code");
    if (savedZip) {
        fetchLocationByZip(savedZip);
    } else {
        fetchAutoLocation();
    }
}

function fetchAutoLocation() {
    fetch(IP_GEO_API)
        .then(res => res.json())
        .then(data => {
            targetName = `${data.region || ''}${data.city || ''}`;
            targetLat = parseFloat(data.latitude || 0);
            targetLon = parseFloat(data.longitude || 0);
            document.getElementById("location-label").innerText = `📍 監視地点(IP): ${targetName}`;
        })
        .catch(() => {
            document.getElementById("location-label").innerText = `📍 監視地点: 取得失敗(東京デフォルト)`;
            targetLat = 35.6895; targetLon = 139.6917; 
        });
}

function fetchLocationByZip(zipCode) {
    fetch(`${ZIP_API_URL}${zipCode}`)
        .then(res => res.json())
        .then(data => {
            if (data.status === 200 && data.results) {
                const resData = data.results[0];
                targetName = `${resData.address1}${resData.address2}${resData.address3}`;
                localStorage.setItem("zip_code", zipCode);
                document.getElementById("location-label").innerText = `📍 監視地点(郵): ${targetName}`;
                targetLat = 35.6895; targetLon = 139.6917; 
            } else {
                alert("郵便番号が見つかりませんでした。");
            }
        }).catch(() => alert("接続に失敗しました。"));
}

function setZipCode() {
    const zip = prompt("郵便番号を入力してください（ハイフンなし）");
    if (zip) fetchLocationByZip(zip);
}

function parseScale(raw) {
    const m = {10: "1", 20: "2", 30: "3", 40: "4", 45: "5弱", 50: "5強", 55: "6弱", 60: "6強", 70: "7"};
    return m[raw] || "0";
}

function getIntensityColor(s) {
    if (["7", "6強", "6弱", "5強", "5弱"].some(x => s.includes(x))) return { bg: "#FF0000", fg: "#FFFFFF" };
    if (s.includes("4")) return { bg: "#FF8C00", fg: "#FFFFFF" };
    if (s.includes("3")) return { bg: "#FFFF00", fg: "#000000" };
    if (s.includes("2")) return { bg: "#00FF00", fg: "#000000" };
    if (s.includes("1")) return { bg: "#1E90FF", fg: "#FFFFFF" };
    return { bg: "#101D29", fg: "#A0B0C0" };
}

function fetchEEW() {
    fetch(EEW_API_URL)
        .then(res => res.json())
        .then(d => {
            if (d.EventID && d.EventID !== lastEewId) {
                lastEewId = d.EventID;
                if (d.isCancel) { resetUI(); return; }
                
                const otStr = d.OriginTime;
                if (otStr) {
                    const ot = new Date(otStr.replace(/\//g, '-'));
                    if ((new Date() - ot) < 600000) { 
                        lastEewData = d;
                        processEEW(d);
                    }
                }
            }
        }).catch(() => {});
}

function processEEW(d) {
    document.getElementById("history-warning").innerText = "";
    const hypo = d.Hypocenter || "";
    currentHypoPref = PREFS.find(p => hypo.includes(p)) || "";
    currentPts = []; // EEW時は詳細データをいったん空にする
    
    displayHeader(hypo, d.Magnitude, d.MaxIntensity, d.Depth, d.OriginTime, d.Latitude, d.Longitude, true);
}

function fetchP2P() {
    fetch(P2P_API_URL)
        .then(res => res.json())
        .then(data => {
            const listDiv = document.getElementById("history-list");
            listDiv.innerHTML = "";
            
            data.forEach((item, i) => {
                const eq = item.earthquake || {};
                const hp = eq.hypocenter || {};
                const name = hp.name || '不明';
                const mag = hp.magnitude || '-';
                const depth = hp.depth || '-';
                const timeF = eq.time || '';
                
                const pts = item.points || [];
                let rawS = item.maxScale || -1;
                if (rawS <= 0 && pts.length > 0) {
                    rawS = Math.max(...pts.map(p => p.scale || 0));
                }
                const mxS = parseScale(rawS);
                const dVal = typeof depth === 'number' ? `${depth}km` : depth;
                
                const div = document.createElement("div");
                div.className = "history-item";
                div.innerHTML = `● ${timeF}<br>&nbsp;&nbsp;${name} (${dVal})<br>&nbsp;&nbsp;M${mag} / 震度:${mxS}`;
                
                div.onclick = () => {
                    document.getElementById("history-warning").innerText = "⚠️ 過去のデータを表示中";
                    currentHypoPref = PREFS.find(p => name.includes(p)) || "";
                    currentPts = pts; 
                    displayHeader(name, mag, mxS, dVal, timeF, hp.latitude, hp.longitude, false);
                    applyGrid(pts);
                };
                
                listDiv.appendChild(div);
            });
        }).catch(() => {
            document.getElementById("history-list").innerText = "履歴情報を取得できませんでした。";
        });
}

function displayHeader(hypo, mag, intensity, depth, timeStr, lat, lon, isEew) {
    const titleEl = document.getElementById("epicenter-name");
    titleEl.innerText = hypo;
    titleEl.style.color = isEew ? "#FF4444" : "#00F2FF";
    
    document.getElementById("info-detail").innerHTML = `発生時刻: ${timeStr}<br>M${mag} / 震度 ${intensity} / 深さ ${depth}<br>緯度: ${lat} / 経度: ${lon}`;
    
    // 過去データかつ計測地点がある場合のみ詳細ボタンを出す
    const navBtn = document.getElementById("detail-nav-btn");
    if (!isEew && currentPts.length > 0) {
        navBtn.style.display = "block";
    } else {
        navBtn.style.display = "none";
    }

    if (isEew && targetLat !== 0.0 && lat && lon) {
        const dist = getDist(parseFloat(lat), parseFloat(lon), targetLat, targetLon);
        const ot = new Date(timeStr.replace(/\//g, '-'));
        startTimer(dist, ot, intensity);
    } else {
        if (timerInterval) clearInterval(timerInterval);
        document.getElementById("arrival-timer").innerText = "";
    }
}

// 市町村詳細画面を開く
function showPrefSelector() {
    document.getElementById("detail-layer").style.display = "flex";
    document.getElementById("city-scroll").style.display = "none";
    document.getElementById("pref-container").style.display = "flex";
    
    const frame = document.getElementById("pref-sel-frame");
    frame.innerHTML = "";
    
    // 地震が観測された都道府県の一覧を抽出
    const activePrefs = new Set(currentPts.map(p => p.pref || ""));
    
    PREFS.forEach(pref => {
        const btn = document.createElement("button");
        btn.className = "pref-btn";
        btn.innerText = pref;
        
        if (activePrefs.has(pref)) {
            btn.style.backgroundColor = "#FFD700";
            btn.style.color = "#000000";
            btn.disabled = false;
            btn.onclick = () => showCityDetail(pref);
        } else {
            btn.style.backgroundColor = "#223344";
            btn.style.color = "#556677";
            btn.disabled = true;
        }
        frame.appendChild(btn);
    });
}

// 市町村の震度を一覧表示
function showCityDetail(prefName) {
    document.getElementById("pref-container").style.display = "none";
    const scroll = document.getElementById("city-scroll");
    scroll.style.display = "block";
    scroll.innerHTML = "";
    
    const cities = currentPts
        .filter(p => p.pref === prefName)
        .sort((a, b) => b.scale - a.scale);
        
    cities.forEach(c => {
        const padName = (c.addr || "").padEnd(15, "　");
        scroll.innerHTML += `${padName} | 震度 ${parseScale(c.scale)}<br>`;
    });
}

function hideDetailLayer() {
    const scroll = document.getElementById("city-scroll");
    if (scroll.style.display === "block") {
        showPrefSelector();
    } else {
        document.getElementById("detail-layer").style.display = "none";
    }
}

function getDist(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

function startTimer(dist, ot, intensity) {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        const rem = ((ot.getTime() + (dist / swaveSpeed) * 1000) - new Date().getTime()) / 1000;
        if (rem > 0) {
            document.getElementById("arrival-timer").innerText = `${targetName} 到着まで: ${Math.floor(rem)}秒`;
            document.getElementById("arrival-timer").style.color = "#FFFF00";
        } else {
            document.getElementById("arrival-timer").innerText = "主要動 到着";
            document.getElementById("arrival-timer").style.color = "#FF4444";
            clearInterval(timerInterval);
        }
    }, 200);
}

function applyGrid(pts) {
    const pMax = {};
    PREFS.forEach(p => pMax[p] = "0");
    const scaleOrder = ["0", "1", "2", "3", "4", "5弱", "5強", "6弱", "6強", "7"];
    
    pts.forEach(pt => {
        const pref = pt.pref || "";
        if (pMax[pref] !== undefined) {
            const s = parseScale(pt.scale || 0);
            if (scaleOrder.indexOf(s) > scaleOrder.indexOf(pMax[pref])) {
                pMax[pref] = s;
            }
        }
    });
    
    PREFS.forEach(p => {
        const val = pMax[p];
        const colors = getIntensityColor(val);
        const cell = document.getElementById(`cell-${p}`);
        const text = document.getElementById(`intensity-${p}`);
        
        cell.style.backgroundColor = colors.bg;
        text.innerText = val;
        text.style.color = (colors.bg === "#FFFF00" || colors.bg === "#00FF00") ? "#000000" : colors.fg;
    });
}

function reDisplayLastEew() {
    if (!lastEewData) {
        alert("表示できる最新の地震速報データがありません。");
        return;
    }
    processEEW(lastEewData);
}

function resetUI() {
    if (timerInterval) clearInterval(timerInterval);
    currentHypoPref = "";
    currentPts = [];
    document.getElementById("history-warning").innerText = "";
    document.getElementById("epicenter-name").innerText = "データ受信待機...";
    document.getElementById("epicenter-name").style.color = "#FFFFFF";
    document.getElementById("info-detail").innerText = "";
    document.getElementById("arrival-timer").innerText = "";
    document.getElementById("detail-nav-btn").style.style = "none";
    applyGrid([]);
}