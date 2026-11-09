"use strict";
// Ngân hàng câu hỏi: tab "Ngân hàng" trên thanh file (cột xanh bên trái). Chọn thư mục ngân hàng, xem theo cây tri thức hoặc theo nguồn,
// bấm một nút để xem danh sách câu, kéo một câu thả vào file đang mở (Toàn bộ code hoặc Theo dòng), câu nào đã có trong file thì được tích.
// Chạy độc lập: cả file nằm trong một hàm, không thêm tên toàn cục; lỗi chỉ hiện trong khung ngân hàng, không ảnh hưởng chỗ khác.
// Chỉ đọc từ app.js: $, goi, bao, soan, tt; và từ theo-dong.js: khoaDong (chỉ khi Theo dòng đang hiện đúng nội dung file).

(() => {
const KIEU_KEO = "application/x-tritex-ngan-hang";
const MOI_TRUONG = /^(bt|bai|baitap|ex|cau|cauhoi|tn|ds|tln|vd|vidu)$/;
const nh = {kieu: "tri-thuc", cay: [], mo: new Set(), nut: null, ds: [], tong: 0, khoa: new Set(), thuMuc: "", dem: 0, dangMo: false, tepTruoc: null, demDs: 0, daNap: false, tong2: 0};
const o = {};  // các phần tử giao diện

try { nh.kieu = localStorage.getItem("nh-kieu") === "nguon" ? "nguon" : "tri-thuc"; } catch (e) { /* trình duyệt chặn bộ nhớ thì dùng mặc định */ }

const tao = (the, lop, chu) => {
  const e = document.createElement(the);
  if (lop) e.className = lop;
  if (chu !== undefined) e.textContent = chu;
  return e;
};
const nutBam = (chu, lam, tieuDe) => {
  const b = tao("button", "", chu);
  b.type = "button";
  if (tieuDe) b.title = tieuDe;
  b.onclick = an(lam);
  return b;
};

function baoTrongKhung(chu, loi = true) {
  o.bao.textContent = chu || "";
  o.bao.className = `nh-bao${loi ? " loi" : ""}`;
  o.bao.hidden = !chu;
}

// Bọc mọi việc: lỗi (đồng bộ hay không) chỉ hiện trong khung ngân hàng.
function an(lam) {
  return async (...a) => {
    try { await lam(...a); } catch (e) { try { baoTrongKhung(e?.message || String(e)); } catch (e2) { /* hết cách */ } }
  };
}

async function goiNh(duong, than) {
  const kq = await goi(`/api/ngan-hang/${duong}`, than || {});
  if (kq.loi) throw new Error(kq.loi);
  return kq;
}

// ---------- Khung và tab ----------

function dung() {
  const ban = document.querySelector(".ban");
  if (!ban) return;
  o.tab = tao("div", "nh-tab");
  o.tab.setAttribute("role", "tablist");
  o.tabTep = tao("button", "", "Tệp");
  o.tabNh = tao("button", "", "Ngân hàng");
  for (const [b, mo] of [[o.tabTep, false], [o.tabNh, true]]) {
    b.type = "button";
    b.setAttribute("role", "tab");
    b.onclick = an(() => hienKhung(mo));
    o.tab.append(b);
  }
  o.khung = tao("div", "nh-khung");
  o.khung.hidden = true;
  o.tenThuMuc = tao("strong", "nh-ten", "Chưa chọn thư mục");
  const dau = tao("div", "nh-dau");
  dau.append(o.tenThuMuc, nutBam("Chọn thư mục", chonThuMuc, "Chọn thư mục chứa các file .tex của ngân hàng"), nutBam("Làm mới", () => napCay(true), "Đọc lại thư mục (sau khi sửa file ngân hàng)"));
  o.kieuTri = nutBam("Cây tri thức", () => doiKieu("tri-thuc"));
  o.kieuNguon = nutBam("Nguồn ngân hàng", () => doiKieu("nguon"));
  const kieu = tao("div", "nh-kieu");
  kieu.setAttribute("role", "group");
  kieu.append(o.kieuTri, o.kieuNguon);
  o.bao = tao("p", "nh-bao");
  o.bao.hidden = true;
  o.cay = tao("div", "nh-cay");
  o.ds = tao("div", "nh-ds");
  o.khung.append(dau, kieu, o.bao, o.cay, o.ds);
  ban.prepend(o.tab);
  ban.append(o.khung);
  ve();
  hienKhung(false);
}

function hienKhung(mo) {
  nh.dangMo = mo;
  const ban = document.querySelector(".ban");
  ban.classList.toggle("nh-mo", mo);
  o.khung.hidden = !mo;
  $("cay").hidden = mo;
  o.tabTep.setAttribute("aria-selected", String(!mo));
  o.tabNh.setAttribute("aria-selected", String(mo));
  if (mo) {
    if (!nh.cay.length && !nh.daNap) napCay();
    capNhatTich();
  }
}

async function chonThuMuc() {
  let kq = await goi("/api/chon-thu-muc", {});
  if (kq.khong_co_hop) {  // chạy bằng trình duyệt: không có hộp chọn thư mục của hệ thống
    const duong = prompt("Dán đường dẫn thư mục ngân hàng câu hỏi:", nh.thuMuc);
    if (!duong) return;
    kq = {duong: duong.trim()};
  }
  if (kq.huy || !kq.duong) return;
  const r = await goiNh("dat-thu-muc", {duong: kq.duong});
  nh.nut = null;
  nh.ds = [];
  nh.mo.clear();
  nh.thuMuc = r.thu_muc;
  nhanCay(r);
}

async function doiKieu(k) {
  nh.kieu = k;
  try { localStorage.setItem("nh-kieu", k); } catch (e) { /* không lưu được thì thôi */ }
  nh.nut = null;
  nh.ds = [];
  nh.mo.clear();
  await napCay();
}

async function napCay(lamMoi = false) {
  baoTrongKhung("");
  const luc = ++nh.dem;
  const cuoc = await goiNh("thong-tin");
  nh.thuMuc = cuoc.thu_muc;
  nh.daNap = true;
  if (!nh.thuMuc) {
    nh.cay = [];
    ve();
    return;
  }
  o.cay.setAttribute("aria-busy", "true");
  try {
    const r = await goiNh("cay", {kieu: nh.kieu});
    if (luc !== nh.dem) return;
    nhanCay(r);
    if (lamMoi && nh.nut) await napDs(nh.nut, 0);
  } finally { o.cay.removeAttribute("aria-busy"); }
}

function nhanCay(r) {
  nh.cay = r.cay;
  nh.thuMuc = r.thu_muc;
  nh.tong = r.tong;
  ve();
}

// ---------- Vẽ cây và danh sách ----------

function ve() {
  o.tenThuMuc.textContent = nh.thuMuc ? `${nh.thuMuc.split(/[\\/]/).filter(Boolean).pop()} (${nh.tong ?? 0} câu)` : "Chưa chọn thư mục";
  o.tenThuMuc.title = nh.thuMuc;
  o.kieuTri.setAttribute("aria-pressed", String(nh.kieu === "tri-thuc"));
  o.kieuNguon.setAttribute("aria-pressed", String(nh.kieu === "nguon"));
  o.cay.replaceChildren();
  if (!nh.cay.length) {
    o.cay.append(tao("p", "nh-trong", nh.thuMuc ? "Thư mục này chưa có câu hỏi nào (file .tex có \\begin{bt}...\\end{bt})." : "Bấm Chọn thư mục để chọn nơi chứa ngân hàng câu hỏi."));
  } else {
    o.cay.append(veNut(nh.cay));
  }
  veDs();
}

function veNut(ds) {
  const ul = tao("ul");
  for (const n of ds) {
    const li = tao("li"), co = n.con.length > 0, mo = nh.mo.has(n.id);
    const hang = tao("div", "nh-hang");
    hang.setAttribute("aria-current", String(nh.nut === n.id));
    const mui = tao("span", `nh-mui${co ? "" : " rong"}`, co ? (mo ? "▾" : "▸") : "");
    mui.onclick = e => { e.stopPropagation(); if (co) { nh.mo.has(n.id) ? nh.mo.delete(n.id) : nh.mo.add(n.id); ve(); } };
    const nut = tao("button", "nh-nut");
    nut.type = "button";
    nut.title = n.ma && n.ma !== n.ten ? `${n.ma} · ${n.ten}` : n.ten;
    nut.append(...(n.ma && nh.kieu === "tri-thuc" && /\d/.test(n.ma) ? [tao("span", "nh-ma", n.ma)] : []), tao("span", "nh-ten-nut", n.ten), tao("span", "nh-so", String(n.dem)));
    nut.onclick = an(async () => {
      if (co) nh.mo.add(n.id);
      nh.nut = n.id;
      ve();
      await napDs(n.id, 0);
    });
    hang.append(mui, nut);
    li.append(hang);
    if (co && mo) li.append(veNut(n.con));
    ul.append(li);
  }
  return ul;
}

async function napDs(nut, tu) {
  baoTrongKhung("");
  const luc = ++nh.demDs;
  const r = await goiNh("ds", {nut, tu});
  if (luc !== nh.demDs || nut !== nh.nut) return;
  nh.ds = tu ? nh.ds.concat(r.ds) : r.ds;
  nh.tong2 = r.tong;
  veDs();
  capNhatTich();
}

function veDs() {
  o.ds.replaceChildren();
  if (!nh.nut) {
    o.ds.append(tao("p", "nh-trong", "Bấm một nút trên cây để xem danh sách câu."));
    return;
  }
  const dau = tao("div", "nh-ds-dau");
  o.dem = tao("span", "", "");
  dau.append(tao("strong", "", `${nh.tong2 ?? 0} câu`), o.dem, tao("em", "", "Kéo câu thả vào file, hoặc bấm đúp để chèn vào chỗ con trỏ"));
  const ul = tao("ul");
  for (const c of nh.ds) {
    const li = tao("li", "nh-cau");
    li.draggable = true;
    li.dataset.khoa = c.khoa.join(" ");
    li.title = "Kéo thả vào file đang mở, hoặc bấm đúp để chèn vào chỗ con trỏ";
    const tich = tao("span", "nh-tich");
    tich.setAttribute("aria-hidden", "true");
    const tren = tao("div", "nh-tren");
    tren.append(tich, tao("span", "nh-id", c.nhan));
    for (const [co, chu] of [[c.muc, `Mức ${c.muc}`], [c.thieu === "loigiai", "thiếu lời giải"], [c.tt, "thực tế"], [nh.nut.startsWith("ng:") && c.vitri, c.vitri]]) {
      if (co) tren.append(tao("span", "nh-chip", chu));
    }
    li.append(tren, tao("div", "nh-xem", c.xem || ""));
    li.ondragstart = e => {
      e.dataTransfer.setData(KIEU_KEO, JSON.stringify({tep: c.tep, so_tt: c.so_tt, nhan: c.nhan}));
      e.dataTransfer.setData("text/plain", c.nhan);
      e.dataTransfer.effectAllowed = "copy";
    };
    li.ondblclick = an(() => chenTaiConTro(c));
    ul.append(li);
  }
  o.ds.append(dau, ul);
  if (nh.ds.length < nh.tong2) o.ds.append(nutBam(`Hiện thêm (còn ${nh.tong2 - nh.ds.length})`, () => napDs(nh.nut, nh.ds.length)));
}

// ---------- Dấu tích câu đã có trong file đang mở ----------

let henTich = 0, demTich = 0;
function capNhatTich() {
  clearTimeout(henTich);
  henTich = setTimeout(an(async () => {
    const luc = ++demTich;
    const chu = tt.tep?.la_tex ? soan.getValue() : "";
    const r = chu ? await goiNh("trong-file", {chu}) : {khoa: []};
    if (luc !== demTich) return;
    nh.khoa = new Set(r.khoa);
    let co = 0;
    for (const li of o.ds.querySelectorAll(".nh-cau")) {
      const tich = li.dataset.khoa.split(" ").some(k => nh.khoa.has(k));
      li.classList.toggle("co", tich);
      if (tich) co++;
    }
    if (o.dem) o.dem.textContent = tt.tep?.la_tex ? `· đã có trong file: ${co}${nh.ds.length < nh.tong2 ? "+" : ""}` : "";
  }), 350);
}

// ---------- Kéo thả vào file ----------

const laKeoNh = e => !!e.dataTransfer && [...e.dataTransfer.types].includes(KIEU_KEO);

// Tìm các câu trong văn bản như ngan_hang.py: dòng đầu gồm cả dòng %@ ngay trên câu, dòng cuối là \end.
function tachCau(chu) {
  const dong = chu.split("\n"), kq = [];
  for (let i = 0; i < dong.length; i++) {
    const m = dong[i].match(/^\s*\\begin\{(\w+)\}/);
    if (!m || !MOI_TRUONG.test(m[1])) continue;
    const dem = (d, t) => (d.match(new RegExp(`\\\\${t}\\{${m[1]}\\}`, "g")) || []).length;
    let mo = 0, j = i;
    for (; j < dong.length; j++) {
      mo += dem(dong[j], "begin") - dem(dong[j], "end");
      if (mo <= 0) break;
    }
    if (j >= dong.length) break;
    let k = i - 1;
    while (k >= 0 && !dong[k].trim()) k--;
    kq.push({a: k >= 0 && /^\s*%@/.test(dong[k]) ? k : i, b: j});
    i = j;
  }
  return kq;
}

const chiDan = tao("div", "nh-chi-dan");
chiDan.hidden = true;
const anChiDan = () => { chiDan.hidden = true; };
function hienChiDan(y, trai, rong) {
  if (!chiDan.isConnected) document.body.append(chiDan);
  Object.assign(chiDan.style, {top: `${y - 1}px`, left: `${trai}px`, width: `${rong}px`});
  chiDan.hidden = false;
}

// Vị trí chèn ở Toàn bộ code: đầu một dòng, và không bao giờ nằm giữa một câu (rơi vào giữa thì dạt về trước hoặc sau câu đó).
function dongChenCode(e) {
  const p = soan.coordsChar({left: e.clientX, top: e.clientY}, "window");
  let dong = p.line;
  const cau = tachCau(soan.getValue()).find(c => dong >= c.a && dong <= c.b);
  if (cau) dong = dong - cau.a < (cau.b - cau.a + 1) / 2 ? cau.a : cau.b + 1;
  return dong;
}

function yCuaDong(dong) {
  const n = soan.lineCount();
  return dong >= n ? soan.charCoords({line: n - 1, ch: 0}, "window").bottom : soan.charCoords({line: dong, ch: 0}, "window").top;
}

// Vị trí chèn ở Theo dòng: trước hoặc sau khối đang nằm dưới con trỏ. Chỉ tin các khối khi màn hình đang khớp đúng với văn bản.
function dongChenTheoDong(e) {
  if (typeof khoaDong === "undefined" || khoaDong !== soan.getValue() || !tt.khoi?.length) return null;
  const y = e.clientY;
  for (const k of tt.khoi) {
    if (!k.o?.isConnected) continue;
    const r = k.o.getBoundingClientRect();
    if (y >= r.bottom) continue;
    if (y < r.top + r.height / 2) {
      let dong = soan.posFromIndex(k.dau).line;
      if (dong > 0 && /^\s*%@/.test(soan.getLine(dong - 1))) dong--;
      return {dong, y: r.top};
    }
    const p = soan.posFromIndex(k.cuoi);
    return {dong: p.ch > 0 ? p.line + 1 : p.line, y: r.bottom};
  }
  const cuoi = tt.khoi.filter(k => k.o?.isConnected).pop();
  return cuoi ? {dong: soan.lineCount(), y: cuoi.o.getBoundingClientRect().bottom} : {dong: soan.lineCount(), y: $("vung-dong").getBoundingClientRect().top + 8};
}

function chenCau(chu, dong) {
  const n = soan.lineCount();
  const truoc = dong > 0 && soan.getLine(Math.min(dong, n) - 1).trim() ? "\n" : "";
  if (dong >= n) {
    const cuoi = {line: n - 1, ch: soan.getLine(n - 1).length};
    soan.replaceRange(`${soan.getLine(n - 1).trim() ? "\n\n" : "\n"}${chu}\n`, cuoi);
  } else {
    soan.replaceRange(`${truoc}${chu}\n\n`, {line: dong, ch: 0});
  }
  soan.setCursor({line: Math.min(dong + (truoc ? 1 : 0), soan.lineCount() - 1), ch: 0});
}

// Nội dung câu để chèn; ảnh trong câu được máy chủ chép sang hinh/<tên file>/ của file đang mở như khi tự chèn ảnh.
async function layCau(c) {
  const r = await goiNh("noi-dung", {tep: c.tep, so_tt: c.so_tt, dich: tt.tep.duong, chu_dich: soan.getValue()});
  if (typeof anhDaThem !== "undefined") for (const ref of r.anh_moi || []) anhDaThem.add(ref);  // để Lưu dọn được nếu bỏ câu
  if (r.thieu?.length) baoTrongKhung(`Không tìm thấy ảnh: ${r.thieu.join(", ")} — giữ nguyên đường dẫn cũ.`, true);
  return r;
}

async function tha(e, tinh) {
  anChiDan();
  const goc = JSON.parse(e.dataTransfer.getData(KIEU_KEO));
  const vt = tinh();
  if (vt == null) return baoTrongKhung("Màn hình đang cập nhật, thả lại sau giây lát.");
  const r = await layCau(goc);
  chenCau(r.chu.replace(/\s+$/, ""), vt);
  bao(`Đã chèn ${goc.nhan} vào file.`);
  capNhatTich();
}

// Bấm đúp một câu: chèn vào chỗ con trỏ. Theo dòng dùng vạch chèn (tdViTriChen của theo-dong.js); Toàn bộ code dùng con trỏ CodeMirror, không chen vào giữa câu.
async function chenTaiConTro(c) {
  if (!tt.tep?.la_tex) return baoTrongKhung("Mở một file .tex trước, rồi bấm đúp câu để chèn.");
  if (tt.cheDo === "dong") {
    const vt = typeof tdViTriChen === "function" ? tdViTriChen() : null;
    if (vt == null) return baoTrongKhung("Bấm vào file ở chỗ muốn chèn để đặt vạch chèn, rồi bấm đúp câu.");
    const r = await layCau(c);
    if (tdChenTai(vt, r.chu) < 0) return baoTrongKhung("Đang sửa dở một dòng, xong dòng đó rồi chèn lại.");
  } else {
    let dong = soan.getCursor().line;
    const cau = tachCau(soan.getValue()).find(k => dong >= k.a && dong <= k.b);
    if (cau) dong = cau.b + 1;
    const r = await layCau(c);
    chenCau(r.chu.replace(/\s+$/, ""), dong);
  }
  bao(`Đã chèn ${c.nhan} vào file.`);
  capNhatTich();
}

function nghe(vung, tinh) {
  vung.addEventListener("dragover", e => {
    if (!laKeoNh(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (!tt.tep?.la_tex) { e.dataTransfer.dropEffect = "none"; return; }
    e.dataTransfer.dropEffect = "copy";
    try {
      const r = vung.getBoundingClientRect(), v = tinh(e);
      if (v) hienChiDan(v.y, r.left, r.width); else anChiDan();
    } catch (err) { anChiDan(); }
  }, true);
  vung.addEventListener("dragleave", e => { if (laKeoNh(e) && !vung.contains(e.relatedTarget)) anChiDan(); }, true);
  vung.addEventListener("drop", e => {
    if (!laKeoNh(e)) return;
    e.preventDefault();
    e.stopPropagation();
    anChiDan();
    if (!tt.tep?.la_tex) return baoTrongKhung("Mở một file .tex trước, rồi kéo câu vào.");
    an(() => tha(e, () => tinh(e)?.dong ?? null))();
  }, true);
}

function noiKeoTha() {
  const codeMirror = soan.getWrapperElement();
  nghe(codeMirror, e => { const dong = dongChenCode(e); return {dong, y: yCuaDong(dong)}; });
  nghe($("vung-dong"), dongChenTheoDong);
  document.addEventListener("dragend", anChiDan);
}

// ---------- Khởi động ----------

try {
  dung();
  noiKeoTha();
  soan.on("change", capNhatTich);
  setInterval(() => {  // đổi sang file khác thì đánh dấu lại, không cần app.js báo
    if (!nh.dangMo || tt.tep === nh.tepTruoc) return;
    nh.tepTruoc = tt.tep;
    capNhatTich();
  }, 500);
} catch (e) {
  console.warn("Ngân hàng câu hỏi không khởi động được:", e);
}
})();
