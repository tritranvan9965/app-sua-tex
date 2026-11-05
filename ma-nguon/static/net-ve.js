"use strict";
// Thuộc tính nét vẽ: màu, độ dày, kiểu nét, đầu mũi tên, tô nền, độ trong. Hiện thành một thanh nổi (giống thanh của hộp chữ)
// ngay trên trang khi bật công cụ vẽ hoặc khi bấm chọn một nét đã vẽ. Thanh nổi nằm gần chỗ đang vẽ, không bị thu gọn theo ribbon,
// và không ép ribbon rộng thêm. Mỗi công cụ nhớ thuộc tính riêng, lưu chung với bố cục (bc.net).
// Vẽ ra màn hình, ra bản in, ra file đều qua veMot1 trong chu-thich.js nên các thuộc tính ở đây tự ra đúng mọi nơi.

const DAY_TOI_THIEU = 0.5, DAY_TOI_DA = 10, DAY_BUOC = 0.5;
const KIEU_NET = [["lien", "Nét liền"], ["gach", "Nét gạch"], ["cham", "Nét chấm"], ["gach-cham", "Nét gạch chấm"]];
const TRONG_NET = [[0.2, "Nhạt"], [0.35, "Vừa"], [0.55, "Đậm"]];
const DAU_NET = [[1, "Một đầu"], [2, "Hai đầu"]];
const NEN_NET = [[0, "Không tô"], [1, "Tô nhạt"]];
const TEN_NET = {but: "Bút vẽ", "duong-thang": "Đường thẳng", "mui-ten": "Mũi tên", "chu-nhat": "Hình chữ nhật", tron: "Hình tròn",
  "to-sang": "Tô sáng", "gach-chan": "Gạch chân", "gach-ngang": "Gạch ngang"};
// Mỗi công cụ chỉ hiện những mục hợp với nó.
const MUC_NET = {but: ["mau", "net", "kieu"], "duong-thang": ["mau", "net", "kieu"], "mui-ten": ["mau", "net", "kieu", "dau"],
  "chu-nhat": ["mau", "net", "kieu", "nen"], tron: ["mau", "net", "kieu", "nen"], "to-sang": ["mau", "trong"],
  "gach-chan": ["mau", "net", "kieu"], "gach-ngang": ["mau", "net", "kieu"]};
const GOC_NET = {
  but: {mau: "#c0262d", net: 2, kieu: "lien"}, "duong-thang": {mau: "#c0262d", net: 2, kieu: "lien"},
  "mui-ten": {mau: "#c0262d", net: 2, kieu: "lien", dau: 1}, "chu-nhat": {mau: "#c0262d", net: 2, kieu: "lien", nen: 0},
  tron: {mau: "#c0262d", net: 2, kieu: "lien", nen: 0}, "to-sang": {mau: "#f2c400", trong: 0.35},
  "gach-chan": {mau: "#c0262d", net: 1, kieu: "lien"}, "gach-ngang": {mau: "#c0262d", net: 1, kieu: "lien"},
};
const TOI_DA_GAN_DAY = 5;
const XANH_CHON = "#1f5fbf";

let tn = structuredClone(GOC_NET);  // thuộc tính sẽ dùng cho nét mới, theo từng công cụ
let ganDayNet = [];                  // màu tự chọn gần đây (không tính màu có sẵn)
let viTriNet = "tren";
let chonNet = null;                  // {v, t, c}: nét đã vẽ đang chọn để sửa
let daVeConTro = 0;

const laMauHop = s => typeof s === "string" && /^#[0-9a-f]{6}$/i.test(s);
const cungMau = (a, b) => a?.toLowerCase() === b?.toLowerCase();
// Bảng chỉ hiện 3 màu cố định theo công cụ; ô thứ tư là màu đang dùng hoặc màu dùng gần nhất.
const MAU_CO_DINH = loai => (loai === "to-sang" ? ["#f2c400", "#5bc25b", "#d6467f"] : ["#c0262d", "#1f5fbf", "#1a1a1a"]);
const TEN_MAU = {"#c0262d": "Đỏ", "#1f5fbf": "Xanh dương", "#1a1a1a": "Đen", "#f2c400": "Vàng", "#5bc25b": "Xanh lá", "#d6467f": "Hồng"};
const soPt = n => String(n).replace(".", ",");

function napThuocTinhNet(luu) {
  if (!luu || typeof luu !== "object") return;
  for (const [loai, goc] of Object.entries(GOC_NET)) {
    const d = luu.tn?.[loai];
    if (!d) continue;
    const moi = {...goc};
    if (laMauHop(d.mau)) moi.mau = d.mau;
    if (typeof d.net === "number" && d.net >= 0.1 && d.net <= 20) moi.net = d.net;
    if (d.kieu in KIEU_GACH) moi.kieu = d.kieu;
    if ("dau" in goc && (d.dau === 1 || d.dau === 2)) moi.dau = d.dau;
    if ("nen" in goc && (d.nen === 0 || d.nen === 1)) moi.nen = d.nen;
    if ("trong" in goc && typeof d.trong === "number" && d.trong >= 0.05 && d.trong <= 1) moi.trong = d.trong;
    tn[loai] = moi;
  }
  if (Array.isArray(luu.gan)) ganDayNet = luu.gan.filter(laMauHop).slice(0, TOI_DA_GAN_DAY);
  if (luu.vt === "duoi") viTriNet = "duoi";
  capNhatThanhNet();
}

function luuNet() {
  bc.net = {tn, gan: ganDayNet, vt: viTriNet};
  luuBoCuc();
}

// Thuộc tính cho nét sắp vẽ (chỉ các trường hợp với công cụ).
function thuocTinhMoi(loai) {
  const t = {...tn[loai]};
  if (loai !== "to-sang") mauCt = t.mau;  // hộp chữ và ghi chú lấy màu chung theo nét vừa chọn, trừ màu tô sáng
  return t;
}

// Giá trị hiệu lực của một chú thích; chú thích cũ thiếu trường thì dùng giá trị như trước đây.
function giaTriNet(c, k) {
  if (c[k] !== undefined) return c[k];
  return k === "net" ? (c.loai === "gach-chan" || c.loai === "gach-ngang" ? 1 : 2)
    : k === "kieu" ? "lien" : k === "dau" ? 1 : k === "nen" ? 0 : k === "trong" ? 0.35 : c.mau;
}

// ---------- Tìm, chọn nét đã vẽ ----------

function dMoDoan(x, y, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const u = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
  return Math.hypot(x - (ax + u * dx), y - (ay + u * dy));
}

function duongViền(c) {
  const [[x0, y0], [x1, y1]] = c.d;
  if (c.loai === "chu-nhat") return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
  if (c.loai === "tron") {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, a = Math.abs(x1 - x0) / 2, b = Math.abs(y1 - y0) / 2;
    return Array.from({length: 49}, (_, i) => [cx + a * Math.cos(i * Math.PI / 24), cy + b * Math.sin(i * Math.PI / 24)]);
  }
  return c.d;
}

function chamNet(c, x, y, tol) {
  if (c.khung) return c.khung.some(([a, b, w, h]) => x >= a - tol && x <= a + w + tol && y >= b - tol && y <= b + h + tol);
  if (!c.d) return false;
  const dd = duongViền(c), rong = tol + giaTriNet(c, "net") / 2;
  for (let i = 1; i < dd.length; i++) if (dMoDoan(x, y, dd[i - 1], dd[i]) <= rong) return true;
  if (c.nen && (c.loai === "chu-nhat" || c.loai === "tron")) {
    const [[x0, y0], [x1, y1]] = c.d;
    if (c.loai === "chu-nhat") return x >= Math.min(x0, x1) && x <= Math.max(x0, x1) && y >= Math.min(y0, y1) && y <= Math.max(y0, y1);
    const a = Math.abs(x1 - x0) / 2, b = Math.abs(y1 - y0) / 2;
    return a > 0 && b > 0 && ((x - (x0 + x1) / 2) / a) ** 2 + ((y - (y0 + y1) / 2) / b) ** 2 <= 1;
  }
  return false;
}

// Chú thích vẽ sau nằm trên, nên tìm từ cuối về đầu.
function ctChamTai(ct, x, y, tol) {
  for (let i = ct.length - 1; i >= 0; i--) if (MUC_NET[ct[i].loai] && chamNet(ct[i], x, y, tol)) return i;
  return -1;
}

function khungNet(c) {
  if (c.khung) {
    const a = Math.min(...c.khung.map(k => k[0])), b = Math.min(...c.khung.map(k => k[1]));
    return {x: a - 2, y: b - 2, w: Math.max(...c.khung.map(k => k[0] + k[2])) - a + 4, h: Math.max(...c.khung.map(k => k[1] + k[3])) - b + 4};
  }
  if (!c.d) return null;
  const xs = c.d.map(p => p[0]), ys = c.d.map(p => p[1]), le = giaTriNet(c, "net") / 2 + (c.loai === "mui-ten" ? 8 : 3);
  const a = Math.min(...xs) - le, b = Math.min(...ys) - le;
  return {x: a, y: b, w: Math.max(...xs) + le - a, h: Math.max(...ys) + le - b};
}

function chonNetTai(v, t, x, y) {
  const i = ctChamTai(t.m.ct, x, y, 8 / v.daVe), cu = chonNet;
  chonNet = i >= 0 ? {v, t, c: t.m.ct[i]} : null;
  if (cu && cu.t !== t) cu.v.veLop(cu.t);
  v.veLop(t);
  capNhatThanhNet();
}

function boChonNet() {
  const cu = chonNet;
  chonNet = null;
  if (cu?.t.o.isConnected) cu.v.veLop(cu.t);
  capNhatThanhNet();
}

// Khung nét đứt xanh quanh nét đang chọn. Chỉ vẽ lên màn hình (veLop), không vào bản in hay file.
function veChonNet(ctx, t, daVe) {
  if (chonNet?.t !== t) return;
  const k = khungNet(chonNet.c);
  if (!k) return;
  ctx.save();
  ctx.lineJoin = "miter";
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3.5 / daVe;
  ctx.strokeRect(k.x, k.y, k.w, k.h);
  ctx.strokeStyle = XANH_CHON;
  ctx.lineWidth = 1.5 / daVe;
  ctx.setLineDash([5 / daVe, 3 / daVe]);
  ctx.strokeRect(k.x, k.y, k.w, k.h);
  ctx.restore();
}

// ---------- Đổi thuộc tính ----------

function loaiHienNet() { return chonNet ? chonNet.c.loai : congCu; }

function giaTriHienNet(k) { return chonNet ? giaTriNet(chonNet.c, k) : tn[congCu]?.[k]; }

// Đổi thuộc tính nét đang chọn: tạo mục mới thay vào mảng (giống hộp chữ), nên Ctrl+Z chỉ cần giữ mảng cũ.
function doiNetChon(doi, khongLich = false) {
  const {v, t, c} = chonNet, i = t.m.ct.indexOf(c);
  if (i < 0) return;
  const moi = {...c, ...doi};
  if (!khongLich) lichCt.push({v, t, ct: t.m.ct, chonI: i});
  t.m.ct = t.m.ct.map((x, j) => (j === i ? moi : x));
  chonNet.c = moi;
  v.veLop(t);
  daDoiCt(v);
}

// khongLich: đang kéo thanh trượt, cả lượt kéo chỉ là một bước hoàn tác (đã ghi ở lần đổi đầu tiên).
function datThuocTinhNet(k, gia, khongLich = false) {
  if (chonNet) doiNetChon({[k]: gia}, khongLich);
  else if (tn[congCu]) {
    tn[congCu][k] = gia;
    if (k === "mau" && congCu !== "to-sang") mauCt = gia;
  }
  if (k === "mau" && !MAU_CO_DINH(loaiHienNet()).some(m => cungMau(m, gia))) ganDayNet = [gia, ...ganDayNet.filter(m => !cungMau(m, gia))].slice(0, TOI_DA_GAN_DAY);
  luuNet();
  capNhatThanhNet();
}

function xoaNetChon() {
  if (!chonNet) return;
  const {v, t, c} = chonNet;
  lichCt.push({v, t, ct: t.m.ct});
  t.m.ct = t.m.ct.filter(x => x !== c);
  chonNet = null;
  v.veLop(t);
  daDoiCt(v);
  capNhatThanhNet();
}

// ---------- Hình vẽ nhỏ: nút, mẫu xem trước ----------

const svgNet = (r, c, noi) => `<svg width="${r}" height="${c}" viewBox="0 0 ${r} ${c}" aria-hidden="true">${noi}</svg>`;
const mauChu = h => { const n = parseInt(h.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 150 ? "#17302a" : "#fff"; };
const dauTich = m => svgNet(14, 14, `<path d="M2.5 7.5l3 3 6-6.5" fill="none" stroke="${mauChu(m)}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`);

function svgKieu(kieu) {
  const d = KIEU_GACH[kieu](2.5).map(n => +n.toFixed(2)).join(" ");
  return svgNet(40, 14, `<line x1="4" y1="7" x2="36" y2="7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"${d ? ` stroke-dasharray="${d}"` : ""}/>`);
}

function svgDau(n) {
  const mui = (x, y, h) => `<path d="M${x + h * 5} ${y - 4}L${x} ${y}L${x + h * 5} ${y + 4}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
  return svgNet(32, 16, `<line x1="5" y1="8" x2="27" y2="8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>${mui(27, 8, -1)}${n === 2 ? mui(5, 8, 1) : ""}`);
}

function svgNen(n) {
  return svgNet(22, 16, `<rect x="3" y="2.5" width="16" height="11" rx="2" fill="${n ? "currentColor" : "none"}" fill-opacity="${n ? 0.25 : 0}" stroke="currentColor" stroke-width="1.8"/>`);
}

const dung = (nhan, noi, h) => {
  const b = document.createElement("button");
  b.type = "button";
  b.innerHTML = noi;
  b.dataset.ten = nhan;
  b.setAttribute("aria-label", nhan);
  if (h) b.dataset.goiY = h;
  return b;
};
const el = (tag, lop, chu) => Object.assign(document.createElement(tag), {className: lop ?? "", textContent: chu ?? ""});

// ---------- Thanh: một hàng thấp ----------

const thanhNet = el("div");
thanhNet.id = "thanh-net";
thanhNet.hidden = true;
thanhNet.setAttribute("role", "toolbar");
thanhNet.setAttribute("aria-label", "Màu, độ dày và kiểu nét");
const mucNet = {};  // mã mục -> {o, nut: [[giá trị, nút]]}
const tieuNet = el("span", "tn-tieu");
const oMauNet = Object.assign(el("input"), {type: "color", hidden: true});
oMauNet.setAttribute("aria-label", "Màu khác");
const veMau = el("canvas");
veMau.id = "tn-mau-thu";
veMau.setAttribute("aria-label", "Xem trước nét");
const nutMau4 = el("button", "tn-o-mau"), hangMau = el("span", "tn-nhom");
const nutKhac = dung("Màu khác", "Khác…", "Mở bảng màu để chọn bất kỳ màu nào");
const oDay = el("input", "tn-truot"), soDay = el("span", "tn-so");
const nutKieu = dung("Kiểu nét", "", "Liền, gạch, chấm hay gạch chấm"), menuKieu = el("div", "tn-menu");
const nutXong = dung("Bỏ chọn", "Xong", "Thôi sửa nét này, trở lại vẽ nét mới"), nutXoa = dung("Xóa nét này", "Xóa", "Xóa nét đang chọn. Ctrl+Z để lấy lại");
const nutDong = dung("Tắt công cụ", "×", "Tắt công cụ này, quay về Chọn chữ");
const nutViTri = dung("Đưa thanh này xuống dưới", "", "Chuyển thanh lên hoặc xuống mép trang cho khỏi che chỗ đang vẽ");
let mauBon = "";  // màu đang nằm ở ô thứ tư

function taoMuc(ma, ...con) {
  const o = el("span", "tn-nhom");
  o.dataset.muc = ma;
  o.append(...con);
  thanhNet.append(o);
  mucNet[ma] = {o, nut: []};
  return o;
}

function nutMuc(ma, gia, b) {
  b.onclick = () => { datThuocTinhNet(ma, gia); menuKieu.hidden = true; };
  mucNet[ma].nut.push([gia, b]);
  return b;
}

(function dungThanhNet() {
  thanhNet.append(tieuNet);
  // Màu: 3 ô cố định theo công cụ, ô thứ tư là màu đang dùng hoặc gần nhất, rồi "Khác…".
  const o = taoMuc("mau");
  for (let i = 0; i < 3; i++) { const b = el("button", "tn-o-mau"); b.type = "button"; o.append(b); b.onclick = () => datThuocTinhNet("mau", b.dataset.mau); mucNet.mau.nut.push([i, b]); }
  nutMau4.type = "button";
  nutMau4.onclick = () => datThuocTinhNet("mau", nutMau4.dataset.mau);
  nutKhac.className = "tn-khac";
  nutKhac.textContent = "Khác…";
  nutKhac.onclick = () => { oMauNet.value = giaTriHienNet("mau") ?? "#c0262d"; oMauNet.click(); };
  oMauNet.onchange = () => datThuocTinhNet("mau", oMauNet.value.toLowerCase());
  o.append(nutMau4, nutKhac, oMauNet);

  // Độ dày: thanh trượt, số pt bên cạnh. Kéo khi đang chọn một nét thì áp ngay, cả lượt kéo là một bước hoàn tác.
  oDay.type = "range";
  oDay.min = DAY_TOI_THIEU; oDay.max = DAY_TOI_DA; oDay.step = DAY_BUOC;
  oDay.setAttribute("aria-label", "Độ dày nét");
  oDay.dataset.ten = "Độ dày nét";
  oDay.dataset.goiY = "Kéo để đổi độ dày, từ 0,5 đến 10 pt";
  let dangKeo = false;
  oDay.oninput = () => { datThuocTinhNet("net", +oDay.value, dangKeo); dangKeo = true; };
  oDay.onchange = () => { dangKeo = false; };
  taoMuc("net", oDay, soDay);

  // Kiểu nét: một nút thả xuống, hiện luôn mẫu của kiểu đang dùng.
  const mk = taoMuc("kieu", nutKieu);
  menuKieu.hidden = true;
  for (const [k, ten] of KIEU_NET) { const b = dung(ten, `${svgKieu(k)}<span>${ten.replace("Nét ", "")}</span>`, ten); b.className = "tn-muc-kieu"; menuKieu.append(nutMuc("kieu", k, b)); }
  mk.append(menuKieu);
  nutKieu.onclick = () => { menuKieu.hidden = !menuKieu.hidden; };

  const dau = taoMuc("dau");
  for (const [n, ten] of DAU_NET) dau.append(nutMuc("dau", n, dung(ten, svgDau(n), n === 2 ? "Mũi tên ở cả hai đầu" : "Mũi tên ở đầu cuối nét kéo")));
  const nen = taoMuc("nen");
  for (const [n, ten] of NEN_NET) nen.append(nutMuc("nen", n, dung(ten, svgNen(n), n ? "Tô nền bên trong bằng màu nhạt cùng màu nét" : "Chỉ vẽ viền, không tô nền")));
  const tr = taoMuc("trong");
  for (const [a, ten] of TRONG_NET) { const b = dung(ten, `<i style="opacity:${a}"></i>${ten}`, `Màu tô ${ten.toLowerCase()}`); b.className = "tn-trong"; tr.append(nutMuc("trong", a, b)); }

  const cuoi = el("span", "tn-cuoi");
  nutXong.className = nutXoa.className = "tn-chu";
  nutXong.textContent = "Xong";
  nutXoa.textContent = "Xóa";
  nutViTri.className = "tn-vitri";
  nutXong.onclick = () => boChonNet();
  nutXoa.onclick = xoaNetChon;
  nutViTri.onclick = () => { viTriNet = viTriNet === "tren" ? "duoi" : "tren"; luuNet(); capNhatThanhNet(); };
  nutDong.className = "tn-dong";
  nutDong.onclick = () => datCongCu("chu");
  cuoi.append(veMau, nutXong, nutXoa, nutViTri, nutDong);
  thanhNet.append(cuoi);
  document.body.append(thanhNet);
})();

thanhNet.addEventListener("pointerdown", e => e.stopPropagation());
thanhNet.addEventListener("mousedown", e => { if (!e.target.closest("input")) e.preventDefault(); });  // giữ chữ đang bôi đen khi bấm thanh
addEventListener("pointerdown", e => { if (!menuKieu.hidden && !menuKieu.parentElement.contains(e.target)) menuKieu.hidden = true; }, true);

// ---------- Xem trước ----------

// Ô nhỏ vẽ bằng chính veMot1 ở cỡ thật đang xem, nên màu, độ dày, kiểu nét, đầu mũi tên, tô nền, độ trong đúng như trên trang.
function veMauThu() {
  const loai = loaiHienNet(), v = chonNet?.v ?? xv(), he = Math.max(0.8, Math.min(1.5, v.daVe || 1.33)), dpr = devicePixelRatio || 1;
  const R = 64, C = 28;
  veMau.width = Math.round(R * dpr);
  veMau.height = Math.round(C * dpr);
  veMau.style.width = `${R}px`;
  veMau.style.height = `${C}px`;
  const ctx = veMau.getContext("2d");
  ctx.scale(dpr * he, dpr * he);
  const r = R / he, c = C / he, base = chonNet ? chonNet.c : {loai, ...tn[loai]};
  const mau = {...base, loai};
  if (loai === "but") veMot1(ctx, {...mau, d: Array.from({length: 24}, (_, i) => [7 / he + i * (r - 14 / he) / 23, c / 2 + Math.sin(i / 3.2) * c * 0.22])});
  else if (loai === "duong-thang" || loai === "mui-ten") veMot1(ctx, {...mau, d: [[7 / he, c / 2], [r - 7 / he, c / 2]]});
  else if (loai === "chu-nhat" || loai === "tron") veMot1(ctx, {...mau, d: [[10 / he, 6 / he], [r - 10 / he, c - 6 / he]]});
  else {
    const co = Math.min(13, c * 0.45);
    ctx.font = `${co}px ${PHONG_CT}`;
    ctx.fillStyle = "#17302a";
    ctx.textBaseline = "middle";
    ctx.fillText("Chữ mẫu", 6 / he, c / 2);
    const w = ctx.measureText("Chữ mẫu").width;
    veMot1(ctx, {...mau, khung: [[6 / he - 2, c / 2 - co * 0.68, w + 4, co * 1.36]]});
  }
}

// ---------- Con trỏ ----------

function capNhatConTroNet() {
  const v = xv(), loai = congCu, ve = !!MUC_NET[loai] && NHOM_KEO.has(loai);
  daVeConTro = v.daVe;
  document.body.classList.toggle("cc-ve", ve);
  if (!ve) return document.body.style.removeProperty("--con-tro");
  // Chấm tròn đúng cỡ nét trên trang (đổi theo thanh trượt), có viền sáng và viền tối nên màu trắng hay đen đều thấy.
  // Thêm hình cây bút chĩa lên phải, đầu bút trùng tâm chấm.
  const p = tn[loai], d = Math.max(4, Math.min(80, p.net * v.daVe)), r = d / 2, mau = p.mau, o = 3;
  const W = Math.ceil(d + 38), H = W, cx = r + o, cy = H - r - o;
  const thanBut = `<path d="M8 -3.6H28V3.6H8Z" fill="${mau}"/><path d="M0 0L8 -3.6V3.6Z" fill="#17302a"/>`;
  const vien = c => `<path d="M0 0L8 -3.6H28V3.6H8Z" fill="none" stroke="${c[0]}" stroke-width="${c[1]}" stroke-linejoin="round"/>`;
  const but = `<g transform="translate(${cx} ${cy}) rotate(-45)">${vien(["#fff", 4])}${thanBut}${vien(["#17302a", 1.2])}</g>`;
  const cham = `<circle cx="${cx}" cy="${cy}" r="${r + 1.6}" fill="none" stroke="#fff" stroke-width="1.6"/><circle cx="${cx}" cy="${cy}" r="${r + 0.4}" fill="none" stroke="#17302a" stroke-width="1"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="${mau}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${cham}${but}</svg>`;
  document.body.style.setProperty("--con-tro", `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${Math.round(cx)} ${Math.round(cy)}, crosshair`);
}

// ---------- Cập nhật thanh ----------

function datOMau(b, m, ten) {
  b.dataset.mau = m;
  b.dataset.ten = ten;
  b.setAttribute("aria-label", ten);
  b.style.background = m;
  b.innerHTML = dauTich(m);
}

function capNhatThanhNet() {
  const v = xv();
  if (chonNet && (chonNet.v !== v || !chonNet.t.o.isConnected || !chonNet.t.m.ct.includes(chonNet.c))) chonNet = null;
  const loai = loaiHienNet(), hien = !!v.trang.length && !!MUC_NET[loai];
  thanhNet.hidden = !hien;
  capNhatConTroNet();
  if (!hien) return;
  const coMuc = MUC_NET[loai];
  for (const [ma, {o, nut}] of Object.entries(mucNet)) {
    if (ma === "mau") continue;
    o.hidden = !coMuc.includes(ma);
    const gt = giaTriHienNet(ma);
    for (const [g, b] of nut) b.setAttribute("aria-pressed", g === gt);
  }
  const mau = giaTriHienNet("mau"), cd = MAU_CO_DINH(loai);
  cd.forEach((m, i) => { const b = mucNet.mau.nut[i][1]; datOMau(b, m, TEN_MAU[m]); b.setAttribute("aria-pressed", cungMau(m, mau)); });
  // Ô thứ tư: màu đang dùng nếu ngoài ba màu trên, không thì màu tự chọn gần nhất, không có thì cam.
  mauBon = !cd.some(m => cungMau(m, mau)) ? mau : ganDayNet.find(m => !cd.some(x => cungMau(x, m))) ?? "#e8791d";
  datOMau(nutMau4, mauBon, mauBon === "#e8791d" && !ganDayNet.length ? "Cam" : "Màu dùng gần nhất");
  nutMau4.setAttribute("aria-pressed", cungMau(mauBon, mau));
  thanhNet.style.setProperty("--mau-tn", mau);
  const dd = giaTriHienNet("net");
  if (coMuc.includes("net")) { oDay.value = dd; soDay.textContent = `${soPt(dd)} pt`; }
  nutKieu.innerHTML = `${svgKieu(giaTriHienNet("kieu") ?? "lien")}<svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><path d="M1 2.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
  thanhNet.classList.toggle("dang-sua", !!chonNet);
  tieuNet.textContent = chonNet ? `${TEN_NET[loai]} đã chọn` : TEN_NET[loai];
  tieuNet.title = chonNet ? "Đang sửa nét đã chọn" : "Thuộc tính cho nét sắp vẽ";
  nutXong.hidden = nutXoa.hidden = !chonNet;
  nutViTri.dataset.ten = nutViTri.ariaLabel = viTriNet === "tren" ? "Đưa thanh này xuống dưới" : "Đưa thanh này lên trên";
  nutViTri.innerHTML = bieuTuong(viTriNet === "tren" ? "tro-xuong" : "tro-len");
  menuKieu.style[viTriNet === "tren" ? "bottom" : "top"] = "";
  menuKieu.style[viTriNet === "tren" ? "top" : "bottom"] = "100%";
  veMauThu();
  datViTriNet();
}

// Thanh nằm giữa mép trên (hoặc mép dưới) khung xem. Nét đang chọn mà nằm dưới thanh thì thanh nhảy sang mép đối diện.
function datViTriNet() {
  if (thanhNet.hidden) return;
  const v = chonNet?.v ?? xv(), kv = v.o.getBoundingClientRect(), le = 8;
  thanhNet.style.maxWidth = `${Math.max(260, kv.width - 2 * le)}px`;
  const tr = thanhNet.getBoundingClientRect();
  const tren = Math.max(4, kv.top + le), duoi = Math.min(innerHeight - tr.height - 4, kv.bottom - tr.height - le - 36);
  let k = null;
  if (chonNet?.t.o.isConnected) {
    const g = chonNet.t.o.getBoundingClientRect(), b = khungNet(chonNet.c);
    if (b) k = {top: g.top + b.y * v.daVe, bottom: g.top + (b.y + b.h) * v.daVe};
  }
  const dung = y => !k || k.bottom < y - 10 || k.top > y + tr.height + 10;
  const uuTien = viTriNet === "tren" ? tren : duoi, khac = viTriNet === "tren" ? duoi : tren;
  const y = dung(uuTien) || !dung(khac) ? uuTien : khac;
  const x = Math.max(4, Math.min(innerWidth - tr.width - 4, kv.left + (kv.width - tr.width) / 2));
  Object.assign(thanhNet.style, {left: `${x}px`, top: `${y}px`});
}

for (const v of [xvTex, xvPdf]) v.o.addEventListener("scroll", () => datViTriNet(), {passive: true});
addEventListener("resize", () => datViTriNet());

addEventListener("keydown", e => {
  if (!chonNet || e.target.closest?.("textarea, input, select, .CodeMirror, dialog")) return;
  if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); xoaNetChon(); }
  else if (e.key === "Escape") boChonNet();
});
