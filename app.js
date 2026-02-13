// Google Sheet 發佈的 CSV 連結
const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRWEbXZ_v_wKPkTFIMCzvtYhBxgcNqTz2mkhvrKjwyNs_dP68JuaMkXMeIsC7qB6HwGJ_Fa1dcQLA7L/pub?output=csv";

// ✅ Tally 表單連結（請換成你的）
const TALLY_URL = "https://tally.so/r/obMaNV";

// 欄位名稱需和你的 Sheet 第一列一致：
// question | keywords | category | answer_short | answer_steps | last_updated | source_note

const $ = (id) => document.getElementById(id);

let all = [];
let activeCategory = "全部";

// 分頁狀態
let currentPage = 1;
const PAGE_SIZE = 20;

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (c === '"' && inQuotes && next === '"') {
      cur += '"';
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (c === "," && !inQuotes) {
      row.push(cur);
      cur = "";
      continue;
    }
    if ((c === "\n" || c === "\r") && !inQuotes) {
      if (c === "\r" && next === "\n") i++;
      row.push(cur);
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      cur = "";
      continue;
    }
    cur += c;
  }
  row.push(cur);
  if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
}

function normalize(s) {
  return String(s || "").trim();
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// 允許 last_updated 多種格式：
// 2026-02-13 / 2026.02.13 / 2026-02 / 2026.02 / 2026/02 等
function parseLastUpdatedToComparable(isoLike) {
  const raw = normalize(isoLike);
  if (!raw) return 0;

  // 抓出數字序列
  const parts = raw
    .replaceAll("/", "-")
    .replaceAll(".", "-")
    .split("-")
    .map((x) => x.trim())
    .filter(Boolean);

  const y = Number(parts[0] || 0);
  const m = Number(parts[1] || 1);
  const d = Number(parts[2] || 1);

  if (!y) return 0;

  // 做成可比較的整數 YYYYMMDD
  const mm = String(Math.max(1, Math.min(12, m))).padStart(2, "0");
  const dd = String(Math.max(1, Math.min(31, d))).padStart(2, "0");
  return Number(`${y}${mm}${dd}`);
}

function todayKey() {
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  return Number(`${y}${m}${d}`);
}

function toRecords(rows) {
  const header = rows[0].map((h) => normalize(h));
  const idx = (name) => header.indexOf(name);

  const get = (r, name) => {
    const i = idx(name);
    return i >= 0 ? normalize(r[i]) : "";
  };

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const question = get(r, "question");
    if (!question) continue;

    const last_updated = get(r, "last_updated");
    records.push({
      question,
      keywords: get(r, "keywords"),
      category: get(r, "category") || "其他",
      answer_short: get(r, "answer_short"),
      answer_steps: get(r, "answer_steps"),
      last_updated,
      source_note: get(r, "source_note"),
      _updatedKey: parseLastUpdatedToComparable(last_updated),
    });
  }

  // ✅ (2) 依 last_updated 最新→最舊
  records.sort((a, b) => (b._updatedKey || 0) - (a._updatedKey || 0));

  return records;
}

function scoreMatch(item, q) {
  if (!q) return 1;

  const hay = (
    item.question +
    " " +
    item.keywords +
    " " +
    item.category +
    " " +
    item.answer_short +
    " " +
    item.answer_steps
  ).toLowerCase();

  const raw = q.toLowerCase().trim();
  const tokens = Array.from(
    new Set([raw, ...raw.split(/\s+/).filter(Boolean)])
  ).filter(Boolean);

  let score = 0;
  for (const t of tokens) {
    if (hay.includes(t)) score += 2;
  }

  const qhay = item.question.toLowerCase();
  for (const t of tokens) {
    if (qhay.includes(t)) score += 2;
  }
  return score;
}

function buildChips(items) {
  const chips = $("chips");
  if (!chips) return;

  const categories = Array.from(new Set(items.map((x) => x.category))).sort();
  const allCats = ["全部", ...categories];

  chips.innerHTML = "";
  for (const cat of allCats) {
    const b = document.createElement("button");
    b.className = "chip" + (cat === activeCategory ? " active" : "");
    b.textContent = cat;
    b.onclick = () => {
      activeCategory = cat;
      currentPage = 1;
      buildChips(all);
      render();
    };
    chips.appendChild(b);
  }
}

function buildGroupCopyText(item) {
  const lines = [];
  lines.push(`Q：${item.question}`);
  if (item.answer_short) lines.push(`答：${item.answer_short}`);
  if (item.answer_steps) lines.push(`步驟：${item.answer_steps}`);
  if (item.category) lines.push(`分類：${item.category}`);
  if (item.last_updated) lines.push(`更新：${item.last_updated}`);
  return lines.join("\n");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    const status = $("status");
    if (status) {
      status.textContent = "已複製到剪貼簿 ✅";
      setTimeout(() => {
        status.textContent = `已載入 ${all.length} 筆`;
      }, 1200);
    }
  } catch {
    alert("複製失敗，請手動複製。");
  }
}

function itemCard(item) {
  const div = document.createElement("div");
  div.className = "item";

  // ✅ (3) 當日更新 NEW 標籤
  const isNewToday = item._updatedKey && item._updatedKey === todayKey();
  if (isNewToday) {
    const badge = document.createElement("div");
    badge.textContent = "NEW";
    badge.style.cssText =
      "position:absolute;top:12px;right:14px;font-size:12px;font-weight:800;" +
      "padding:4px 8px;border-radius:999px;background:rgba(34,197,94,.18);" +
      "color:#22c55e;border:1px solid rgba(34,197,94,.35);";
    div.style.position = "relative";
    div.appendChild(badge);
  }

  const q = document.createElement("div");
  q.className = "q";
  q.textContent = item.question;

  const meta = document.createElement("div");
  meta.className = "meta2";
  meta.innerHTML = `
    <span class="tag">${escapeHtml(item.category || "其他")}</span>
    ${item.last_updated ? `<span>更新：${escapeHtml(item.last_updated)}</span>` : ""}
  `;

  const a = document.createElement("div");
  a.className = "a";

  const short = item.answer_short ? `✔ ${escapeHtml(item.answer_short)}` : "";
  const steps = item.answer_steps
    ? `<div style="margin-top:8px;color:#cbd5e1">📌 ${escapeHtml(item.answer_steps)}</div>`
    : "";
  const src = item.source_note
    ? `<div style="margin-top:8px;color:#9ca3af;font-size:12px">來源：${escapeHtml(item.source_note)}</div>`
    : "";

  a.innerHTML = `${short}${steps}${src}`;

  const actions = document.createElement("div");
  actions.className = "actions";

  const copyBtn = document.createElement("button");
  copyBtn.className = "btn";
  copyBtn.textContent = "📋 複製群組用版本";
  copyBtn.onclick = () => copyText(buildGroupCopyText(item));

  actions.appendChild(copyBtn);

  div.appendChild(q);
  div.appendChild(meta);
  div.appendChild(a);
  div.appendChild(actions);
  return div;
}

function renderTop(items) {
  const top = $("topList");
  if (!top) return;
  top.innerHTML = "";

  const pick = [...items]
    .sort(
      (a, b) =>
        (b.keywords.length + b.answer_steps.length) -
        (a.keywords.length + a.answer_steps.length)
    )
    .slice(0, 15);

  for (const it of pick) top.appendChild(itemCard(it));
}

function ensureTallyLinkBelowResults(container) {
  if (!container) return;

  // 防止重複加
  const existing = document.getElementById("tallyLinkRow");
  if (existing) existing.remove();

  const wrap = document.createElement("div");
  wrap.id = "tallyLinkRow";
  wrap.style.cssText =
    "margin-top:16px;display:flex;justify-content:center;";

  const a = document.createElement("a");
  a.href = TALLY_URL;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = "FAQ回報&補充";
  a.className = "btn";
  a.style.cssText =
    "text-decoration:none;display:inline-flex;align-items:center;gap:8px;";

  // 若沒換掉連結，給提醒
  if (String(TALLY_URL || "").includes("REPLACE_ME")) {
    a.textContent = "FAQ回報&補充（請先設定 Tally 連結）";
    a.style.opacity = "0.75";
  }

  wrap.appendChild(a);
  container.appendChild(wrap);
}

function renderResults(items) {
  const list = $("resultList");
  if (!list) return;
  list.innerHTML = "";

  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "item";
    empty.innerHTML = `<div class="q">找不到</div><div class="a">換個關鍵字試試：例如「報修 / 1999 / 外送 / 水壓 / 車位 / 窗簾」</div>`;
    list.appendChild(empty);

    // ✅ (4) 搜尋結果區塊下方加 Tally 連結
    ensureTallyLinkBelowResults(list);
    return;
  }

  for (const it of items) list.appendChild(itemCard(it));

  // ✅ (4) 搜尋結果區塊下方加 Tally 連結
  ensureTallyLinkBelowResults(list);
}

function getFilteredAndScored() {
  const qEl = $("q");
  const q = qEl ? normalize(qEl.value) : "";

  let items = all;

  // ✅ 保持最新→最舊（all 已排序）
  if (activeCategory !== "全部") {
    items = items.filter((x) => x.category === activeCategory);
  }

  if (!q) return items;

  return items
    .map((x) => ({ x, s: scoreMatch(x, q) }))
    .filter((o) => o.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((o) => o.x);
}

function paginate(items) {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = 1;

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = items.slice(start, start + PAGE_SIZE);

  return { pageItems, totalPages };
}

function movePagerToBottom() {
  // ✅ (1) 把分頁元件移到頁面最底下（不改 HTML 也能做）
  const pager = $("pager");
  if (!pager) return;

  // 找一個你頁面上最穩的容器：resultList 存在就放它後面；不然就放 body 最後
  const list = $("resultList");
  if (list && list.parentElement) {
    // 放在 results 區塊的父層最後
    list.parentElement.appendChild(pager);
  } else {
    document.body.appendChild(pager);
  }
}

function updatePagerUI(totalPages) {
  const pager = $("pager");
  const pageInfo = $("pageInfo");
  const prev = $("prevPage");
  const next = $("nextPage");

  if (!pager || !pageInfo || !prev || !next) return;

  pager.style.display = totalPages > 1 ? "flex" : "none";
  pageInfo.textContent = `第 ${currentPage} / ${totalPages} 頁`;

  prev.disabled = currentPage <= 1;
  next.disabled = currentPage >= totalPages;

  prev.onclick = () => {
    if (currentPage <= 1) return;
    currentPage -= 1;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  next.onclick = () => {
    if (currentPage >= totalPages) return;
    currentPage += 1;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
}

function render() {
  const items = getFilteredAndScored();
  const { pageItems, totalPages } = paginate(items);

  renderTop(items); // 如果你 HTML 拿掉 topList，這裡會跳過
  renderResults(pageItems);

  movePagerToBottom();
  updatePagerUI(totalPages);
}

async function init() {
  const status = $("status");
  if (status) status.textContent = "讀取中…";

  const res = await fetch(SHEET_CSV_URL);
  const text = await res.text();
  const rows = parseCSV(text);

  if (!rows || rows.length < 2) {
    if (status) status.textContent = "載入失敗：CSV 沒有資料或格式不正確";
    return;
  }

  all = toRecords(rows);

  if (!all.length) {
    if (status) {
      status.textContent =
        "已載入 0 筆：請檢查 Sheet 第一列欄位名稱是否為 question/keywords/category/answer_short/answer_steps/last_updated/source_note";
    }
    return;
  }

  if (status) status.textContent = `已載入 ${all.length} 筆`;

  const maxUpdated = all
    .map((x) => x._updatedKey)
    .filter(Boolean)
    .sort((a, b) => a - b)
    .slice(-1)[0];

  const updated = $("updated");
  if (updated) {
    // 顯示原字串中最大值不一定準，這裡用 _updatedKey 顯示 YYYY-MM
    if (maxUpdated) {
      const s = String(maxUpdated);
      updated.textContent = `最新更新：${s.slice(0, 4)}-${s.slice(4, 6)}`;
    } else {
      updated.textContent = "";
    }
  }

  buildChips(all);
  render();

  const q = $("q");
  if (q) {
    q.addEventListener("input", () => {
      currentPage = 1;
      render();
    });
  }

  const clearBtn = $("clearBtn");
  if (clearBtn) {
    clearBtn.onclick = () => {
      if (q) q.value = "";
      activeCategory = "全部";
      currentPage = 1;
      buildChips(all);
      render();
    };
  }
}

init().catch((err) => {
  console.error(err);
  const status = $("status");
  const msg = (err && (err.message || String(err))) || "unknown error";
  if (status) status.textContent = `載入失敗：${msg}`;
});
