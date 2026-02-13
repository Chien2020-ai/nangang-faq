// Google Sheet 發佈的 CSV 連結（你提供的）
const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRWEbXZ_v_wKPkTFIMCzvtYhBxgcNqTz2mkhvrKjwyNs_dP68JuaMkXMeIsC7qB6HwGJ_Fa1dcQLA7L/pub?output=csv";

// 欄位名稱需和你的 Sheet 第一列一致：
// question | keywords | category | answer_short | answer_steps | last_updated | source_note

const $ = (id) => document.getElementById(id);

let all = [];
let activeCategory = "全部";

function parseCSV(text) {
  // 簡單 CSV parser（支援引號、逗號、換行）
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (c === '"' && inQuotes && next === '"') {
      // escaped quote
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

    records.push({
      question,
      keywords: get(r, "keywords"),
      category: get(r, "category") || "其他",
      answer_short: get(r, "answer_short"),
      answer_steps: get(r, "answer_steps"),
      last_updated: get(r, "last_updated"),
      source_note: get(r, "source_note"),
    });
  }
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

  const tokens = q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  let score = 0;
  for (const t of tokens) {
    if (hay.includes(t)) score += 2;
  }

  // 額外偏好：問題標題命中
  const qhay = item.question.toLowerCase();
  for (const t of tokens) {
    if (qhay.includes(t)) score += 2;
  }
  return score;
}

function buildChips(items) {
  const categories = Array.from(new Set(items.map((x) => x.category))).sort();
  const allCats = ["全部", ...categories];

  const chips = $("chips");
  chips.innerHTML = "";
  for (const cat of allCats) {
    const b = document.createElement("button");
    b.className = "chip" + (cat === activeCategory ? " active" : "");
    b.textContent = cat;
    b.onclick = () => {
      activeCategory = cat;
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
    $("status").textContent = "已複製到剪貼簿 ✅";
    setTimeout(() => ($("status").textContent = `已載入 ${all.length} 筆`), 1200);
  } catch {
    alert("複製失敗，請手動複製。");
  }
}

function itemCard(item) {
  const div = document.createElement("div");
  div.className = "item";

  const q = document.createElement("div");
  q.className = "q";
  q.textContent = item.question;

  const meta = document.createElement("div");
  meta.className = "meta2";
  meta.innerHTML = `
    <span class="tag">${item.category || "其他"}</span>
    ${item.last_updated ? `<span>更新：${item.last_updated}</span>` : ""}
  `;

  const a = document.createElement("div");
  a.className = "a";

  const short = item.answer_short ? `✔ ${escapeHtml(item.answer_short)}` : "";
  const steps = item.answer_steps
    ? `<div style="margin-top:8px;color:#cbd5e1">📌 ${escapeHtml(item.answer_steps)}</div>`
    : "";
  const src = item.source_note
    ? `<div style="margin-top:8px;color:#9ca3af;font-size:12px">來源：${escapeHtml(
        item.source_note
      )}</div>`
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
  top.innerHTML = "";

  // heuristic：較完整的排前面（keywords + steps 越多越可能是「可用答案」）
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

function render() {
  const q = normalize($("q").value);

  let items = all;
  if (activeCategory !== "全部") {
    items = items.filter((x) => x.category === activeCategory);
  }

  const scored = items
    .map((x) => ({ x, s: scoreMatch(x, q) }))
    .filter((o) => (q ? o.s > 0 : true))
    .sort((a, b) => b.s - a.s)
    .map((o) => o.x);

  renderTop(all);
  renderResults(scored);
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function init() {
  if (!SHEET_CSV_URL) {
    $("status").textContent = "請先設定 SHEET_CSV_URL";
    return;
  }

  $("status").textContent = "讀取中…";

  const res = await fetch(SHEET_CSV_URL);
  const text = await res.text();
  const rows = parseCSV(text);

  if (!rows || rows.length < 2) {
    $("status").textContent = "載入失敗：CSV 沒有資料或格式不正確";
    return;
  }

  all = toRecords(rows);

  if (!all.length) {
    $("status").textContent =
      "已載入 0 筆：請檢查 Sheet 第一列欄位名稱是否為 question/keywords/category/answer_short/answer_steps/last_updated/source_note";
    return;
  }

  $("status").textContent = `已載入 ${all.length} 筆`;

  const maxUpdated = all
    .map((x) => x.last_updated)
    .filter(Boolean)
    .sort()
    .slice(-1)[0];

  $("updated").textContent = maxUpdated ? `最新更新：${maxUpdated}` : "";

  buildChips(all);
  render();

  $("q").addEventListener("input", render);
  $("clearBtn").onclick = () => {
    $("q").value = "";
    activeCategory = "全部";
    buildChips(all);
    render();
  };
}

init().catch((err) => {
  console.error(err);
  $("status").textContent = "載入失敗：請檢查 Sheet 是否已發佈為公開 CSV";
});
