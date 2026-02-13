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

// ✅ NEW 條件：7 天內（含今天）
function isWithinDays(updatedKey, days) {
  if (!updatedKey) return false;

  // updatedKey: YYYYMMDD
  const s = String(updatedKey);
  if (s.length !== 8) return false;

  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));

  const updated = new Date(y, m - 1, d);
  const now = new Date();
  // 以「日期」計算，避免時區/時間造成誤差
  const updatedMid = new Date(updated.getFullYear(), updated.getMonth(), updated.getDate()).getTime();
  const nowMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  const diffDays = Math.floor((nowMid - updatedMid) / (24 * 60 * 60 * 1000));
  return diffDays >= 0 && diffDays <= days;
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

  // ✅ 依 last_updated 最新→最舊
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

  // ✅ NEW：7天內
  const showNew = isWithinDays(item._updatedKey, 7);
  if (showNew) {
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

function renderResults(items) {
  const list = $("resultList");
  if (!list) return;
  list.innerHTML = "";

  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "item";
    empty.innerHTML = `<div class="q">找不到</div><div class="a">換個關鍵字試試：例如「報修 / 1999 / 外送 / 水壓 / 車位 / 窗簾」</div>`;
    list.appendChild(empty);
    return;
  }

  for (const it of items) list.appendChild(itemCard(it));
}

function getFilteredAndScored() {
  const qEl = $("q");
  const q = qEl ? normalize(qEl.value) : "";

  let items = all;

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
  const pager = $("pager");
  if (!pager) return;

  const list = $("resultList");
  if (list && list.parentElement) {
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

// ✅ (2) 把「FAQ回報&補充」移到搜尋框上方
function ensureTallyButtonAboveSearch() {
  const q = $("q");
  if (!q) return;

  // 已存在就不重複加
  let wrap = document.getElementById("tallyAboveSearch");
  if (wrap) return;

  wrap = document.createElement("div");
  wrap.id = "tallyAboveSearch";
  wrap.style.cssText =
    "display:flex;justify-content:flex-end;align-items:center;margin:0 0 10px 0;";

  const a = document.createElement("a");
  a.href = TALLY_URL;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.className = "btn";
  a.textContent = "FAQ回報&補充";
  a.style.cssText = "text-decoration:none;display:inline-flex;align-items:center;";

  if (String(TALLY_URL || "").includes("https://tally.so/r/obMaNV")) {
    a.textContent = "FAQ回報&補充";
    a.style.opacity = "0.75";
  }

  wrap.appendChild(a);

  // 插到搜尋框所在容器的「上一行」
  const searchWrap = q.parentElement;
  if (searchWrap && searchWrap.parentElement) {
    searchWrap.parentElement.insertBefore(wrap, searchWrap);
  } else {
    // fallback
    q.insertAdjacentElement("beforebegin", wrap);
  }
}

// ✅ (3) Footer 加 ©
function ensureFooter() {
  let footer = document.getElementById("siteFooter");
  if (footer) return;

  footer = document.createElement("div");
  footer.id = "siteFooter";

  const year = new Date().getFullYear();
  footer.innerHTML = `
    <div style="max-width:1100px;margin:0 auto;padding:18px 20px;color:#9ca3af;font-size:12px;">
      © ${year} 南港機廠社宅 FAQ｜僅供參考，以管理中心公告為準。
    </div>
  `;

  footer.style.cssText =
    "margin-top:28px;border-top:1px solid rgba(148,163,184,.18);";

  document.body.appendChild(footer);
}

function render() {
  const items = getFilteredAndScored();
  const { pageItems, totalPages } = paginate(items);

  renderTop(items);
  renderResults(pageItems);

  ensureTallyButtonAboveSearch();
  movePagerToBottom();
  updatePagerUI(totalPages);

  ensureFooter();
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
