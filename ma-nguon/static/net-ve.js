"use strict";
// Thuộc tính nét vẽ: màu, độ dày, kiểu nét, đầu mũi tên, tô nền, độ trong. Hiện thành một thanh nổi (giống thanh của hộp chữ)
// ngay trên trang khi bật công cụ vẽ hoặc khi bấm chọn một nét đã vẽ. Thanh nổi nằm gần chỗ đang vẽ, không bị thu gọn theo ribbon,
// và không ép ribbon rộng thêm. Mỗi công cụ nhớ thuộc tính riêng, lưu chung với bố cục (bc.net).
// Vẽ ra màn hình, ra bản in, ra file đều qua veMot1 trong chu-thich.js nên các thuộc tính ở đây tự ra đúng mọi nơi.

const MAU_NET = [["#c0262d", "Đỏ"], ["#e8791d", "Cam"], ["#f2c400", "Vàng"], ["#1f8a4c", "Xanh lá"], ["#0b8f8c", "Xanh ngọc"],
  ["#1f5fbf", "Xanh dương"], ["#7a3db5", "Tím"], ["#d6467f", "Hồng"], ["#1a1a1a", "Đen"], ["#6b7280", "Xám"]];
const DAY_NET = [0.5, 1, 2, 3, 5];
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
const coTrongPalette = m => MAU_NET.some(([x]) => cungMau(x, m));
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
function doiNetChon(doi) {
  const {v, t, c} = chonNet, i = t.m.ct.indexOf(c);
  if (i < 0) return;
  const moi = {...c, ...doi};
  lichCt.push({v, t, ct: t.m.ct, chonI: i});
  t.m.ct = t.m.ct.map((x, j) => (j === i ? moi : x));
  chonNet.c = moi;
  v.veLop(t);
  daDoiCt(v);
}

function datThuocTinhNet(k, gia) {
  if (chonNet) doiNetChon({[k]: gia});
  else if (tn[congCu]) {
    tn[congCu][k] = gia;
    if (k === "mau" && congCu !== "to-sang") mauCt = gia;
  }
  if (k === "mau" && !coTrongPalette(gia)) ganDayNet = [gia, ...ganDayNet.filter(m => !cungMau(m, gia))].slice(0, TOI_DA_GAN_DAY);
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

function svgKieu(kieu) {
  const d = KIEU_GACH[kieu](2.5).map(n => +n.toFixed(2)).join(" ");
  return svgNet(40, 14, `<line x1="4" y1="7" x2="36" y2="7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"${d ? ` stroke-dasharray="${d}"` : ""}/>`);
}

function svgDau(n) {
  const mui = (x, y, h) => `<path d="M${x + h * 6} ${y - 5}L${x} ${y}L${x + h * 6} ${y + 5}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  return svgNet(40, 20, `<line x1="6" y1="10" x2="34" y2="10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>${mui(34, 10, -1)}${n === 2 ? mui(6, 10, 1) : ""}`);
}

function svgNen(n) {
  return svgNet(26, 20, `<rect x="3" y="3" width="20" height="14" rx="2" fill="${n ? "currentColor" : "none"}" fill-opacity="${n ? 0.25 : 0}" stroke="currentColor" stroke-width="2"/>`);
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

const thanhNet = document.createElement("div");
thanhNet.id = "thanh-net";
thanhNet.hidden = true;
thanhNet.setAttribute("role", "toolbar");
thanhNet.setAttribute("aria-label", "Màu, độ dày và kiểu nét");
const mucNet = {};  // mã mục -> {o: khung mục, nut: [[giá trị, nút]]}
const oMauNet = document.createElement("input");
oMauNet.type = "color";
oMauNet.hidden = true;
oMauNet.setAttribute("aria-label", "Màu khác");
const veMau = document.createElement("canvas");
veMau.id = "tn-mau-thu";
veMau.setAttribute("aria-label", "Xem trước nét");
const tieuNet = document.createElement("div"), phuNet = document.createElement("div");
const hangMau = document.createElement("div"), nutKhac = document.createElement("button"), ganDayO = document.createElement("span");
const nutXong = dung("Bỏ chọn", "Xong", "Thôi chỉnh nét này, trở lại vẽ nét mới"), nutXoa = dung("Xóa nét này", "Xóa", "Xóa nét đang chọn. Ctrl+Z để lấy lại");
const nutViTri = dung("Đưa thanh này xuống dưới", "", "Chuyển thanh lên hoặc xuống mép trang cho khỏi che chỗ đang vẽ");

function taoMuc(ma, tenMuc, hang) {
  const o = document.createElement("div"), nhan = document.createElement("div");
  o.className = "tn-muc";
  o.dataset.muc = ma;
  nhan.className = "tn-nhan";
  nhan.textContent = tenMuc;
  o.append(nhan, hang);
  hang.classList.add("tn-hang");
  thanhNet.append(o);
  mucNet[ma] = {o, nut: []};
  return o;
}

function taoNutMuc(ma, gia, nut) {
  nut.onclick = () => datThuocTinhNet(ma, gia);
  mucNet[ma].nut.push([gia, nut]);
  return nut;
}

(function dungThanhNet() {
  const dau = document.createElement("div");
  dau.className = "tn-dau";
  tieuNet.className = "tn-tieu";
  phuNet.className = "tn-phu";
  dau.append(tieuNet, phuNet);
  thanhNet.append(dau);

  hangMau.className = "tn-mau";
  taoMuc("mau", "Màu", hangMau);
  for (const [m, ten] of MAU_NET) {
    const b = dung(ten, svgNet(14, 14, `<path d="M2.5 7.5l3 3 6-6.5" fill="none" stroke="${mauChu(m)}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`), `Chọn màu ${ten.toLowerCase()}`);
    b.className = "tn-o-mau";
    b.style.background = m;
    hangMau.append(taoNutMuc("mau", m, b));
  }
  nutKhac.type = "button";
  nutKhac.className = "tn-khac";
  nutKhac.textContent = "Màu khác…";
  nutKhac.dataset.ten = "Màu khác";
  nutKhac.dataset.goiY = "Mở bảng màu để chọn bất kỳ màu nào";
  nutKhac.onclick = () => { oMauNet.value = giaTriHienNet("mau") ?? "#c0262d"; oMauNet.click(); };
  oMauNet.onchange = () => datThuocTinhNet("mau", oMauNet.value.toLowerCase());
  ganDayO.className = "tn-gan";
  hangMau.append(nutKhac, ganDayO, oMauNet);

  const hangDay = document.createElement("div");
  taoMuc("net", "Độ dày", hangDay);
  for (const d of DAY_NET) {
    const b = dung(`${soPt(d)} pt`, `<i style="height:${Math.max(1, d * 4 / 3).toFixed(2)}px"></i><small>${soPt(d)}</small>`, `Độ dày nét ${soPt(d)} pt`);
    b.className = "tn-day";
    hangDay.append(taoNutMuc("net", d, b));
  }
  const hangKieu = document.createElement("div");
  taoMuc("kieu", "Kiểu nét", hangKieu);
  for (const [k, ten] of KIEU_NET) hangKieu.append(taoNutMuc("kieu", k, dung(ten, svgKieu(k), ten)));

  const hangDauMui = document.createElement("div");
  taoMuc("dau", "Đầu mũi tên", hangDauMui);
  for (const [n, ten] of DAU_NET) hangDauMui.append(taoNutMuc("dau", n, dung(ten, svgDau(n), `${ten}: ${n === 2 ? "mũi tên ở cả hai đầu" : "mũi tên ở đầu cuối nét kéo"}`)));
  const hangNen = document.createElement("div");
  taoMuc("nen", "Tô nền", hangNen);
  for (const [n, ten] of NEN_NET) hangNen.append(taoNutMuc("nen", n, dung(ten, svgNen(n), n ? "Tô nền bên trong bằng màu nhạt cùng màu nét" : "Chỉ vẽ viền, không tô nền")));
  const hangTrong = document.createElement("div");
  taoMuc("trong", "Độ trong", hangTrong);
  for (const [a, ten] of TRONG_NET) {
    const b = dung(ten, `<i style="opacity:${a}"></i>${ten}`, `Màu tô ${ten.toLowerCase()}${a < 0.3 ? ", thấy chữ rõ nhất" : a > 0.5 ? ", đậm nhất" : ""}`);
    b.className = "tn-trong";
    hangTrong.append(taoNutMuc("trong", a, b));
  }

  const cuoi = document.createElement("div"), hanh = document.createElement("div");
  cuoi.className = "tn-cuoi";
  hanh.className = "tn-hanh";
  nutXong.className = nutXoa.className = "tn-chu";
  nutXong.textContent = "Xong";
  nutXoa.textContent = "Xóa";
  nutViTri.className = "tn-vitri";
  nutXong.onclick = () => boChonNet();
  nutXoa.onclick = xoaNetChon;
  nutViTri.onclick = () => { viTriNet = viTriNet === "tren" ? "duoi" : "tren"; luuNet(); capNhatThanhNet(); };
  hanh.append(nutXong, nutXoa, nutViTri);
  cuoi.append(veMau, hanh);
  thanhNet.append(cuoi);
  document.body.append(thanhNet);
})();

thanhNet.addEventListener("pointerdown", e => e.stopPropagation());
thanhNet.addEventListener("mousedown", e => { if (!e.target.closest("input")) e.preventDefault(); });  // giữ chữ đang bôi đen khi bấm thanh

// ---------- Xem trước ----------

// Mẫu vẽ bằng chính veMot1 ở cỡ thật đang xem, nên màu, độ dày, kiểu nét, đầu mũi tên, tô nền, độ trong đúng như trên trang.
function veMauThu() {
  const loai = loaiHienNet(), v = chonNet?.v ?? xv(), he = Math.max(0.8, Math.min(2, v.daVe || 1.33)), dpr = devicePixelRatio || 1;
  const R = 112, C = 38;
  veMau.width = Math.round(R * dpr);
  veMau.height = Math.round(C * dpr);
  veMau.style.width = `${R}px`;
  veMau.style.height = `${C}px`;
  const ctx = veMau.getContext("2d");
  ctx.scale(dpr * he, dpr * he);
  const r = R / he, c = C / he, base = chonNet ? chonNet.c : {loai, ...tn[loai]};
  const mau = {...base, loai};
  const ngang = [[8 / he, c / 2], [r - 8 / he, c / 2]];
  if (loai === "but") veMot1(ctx, {...mau, d: Array.from({length: 24}, (_, i) => [8 / he + i * (r - 16 / he) / 23, c / 2 + Math.sin(i / 3.2) * c * 0.22])});
  else if (loai === "duong-thang" || loai === "mui-ten") veMot1(ctx, {...mau, d: ngang});
  else if (loai === "chu-nhat" || loai === "tron") veMot1(ctx, {...mau, d: [[16 / he, 7 / he], [r - 16 / he, c - 7 / he]]});
  else {
    ctx.font = `${Math.min(15, c * 0.42)}px "Be Vietnam Pro","Segoe UI",sans-serif`;
    ctx.fillStyle = "#17302a";
    ctx.textBaseline = "middle";
    ctx.fillText("Chữ mẫu", 14 / he, c / 2);
    const w = ctx.measureText("Chữ mẫu").width, h = Math.min(15, c * 0.42) * 1.35;
    veMot1(ctx, {...mau, khung: [[14 / he - 2, c / 2 - h / 2, w + 4, h]]});
  }
}

// ---------- Con trỏ ----------

function capNhatConTroNet() {
  const v = xv(), loai = congCu, ve = !!MUC_NET[loai] && NHOM_KEO.has(loai);
  daVeConTro = v.daVe;
  document.body.classList.toggle("cc-ve", ve);
  if (!ve) return document.body.style.removeProperty("--con-tro");
  const p = tn[loai], d = Math.max(5, Math.min(64, p.net * v.daVe)), S = Math.ceil(Math.max(32, d + 10)), m = S / 2, mau = p.mau;
  const chu = `<path d="M${m - 10} ${m}H${m + 10}M${m} ${m - 10}V${m + 10}" stroke="#fff" stroke-width="3"/><path d="M${m - 10} ${m}H${m + 10}M${m} ${m - 10}V${m + 10}" stroke="#17302a" stroke-width="1"/>`;
  const noi = (loai === "but" ? "" : chu) + `<circle cx="${m}" cy="${m}" r="${d / 2 + 0.75}" fill="none" stroke="#fff" stroke-width="1.5"/><circle cx="${m}" cy="${m}" r="${d / 2}" fill="${mau}" stroke="#17302a" stroke-opacity=".55" stroke-width=".8"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">${noi}</svg>`;
  document.body.style.setProperty("--con-tro", `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${Math.round(m)} ${Math.round(m)}, crosshair`);
}

// ---------- Cập nhật thanh ----------

function capNhatThanhNet() {
  const v = xv();
  if (chonNet && (chonNet.v !== v || !chonNet.t.o.isConnected || !chonNet.t.m.ct.includes(chonNet.c))) chonNet = null;
  const loai = loaiHienNet(), hien = !!v.trang.length && !!MUC_NET[loai];
  thanhNet.hidden = !hien;
  capNhatConTroNet();
  if (!hien) return;
  const coMuc = MUC_NET[loai];
  for (const [ma, {o, nut}] of Object.entries(mucNet)) {
    o.hidden = !coMuc.includes(ma);
    const gt = giaTriHienNet(ma);
    for (const [g, b] of nut) b.setAttribute("aria-pressed", ma === "mau" ? cungMau(g, gt) : g === gt);
  }
  const mau = giaTriHienNet("mau");
  thanhNet.style.setProperty("--mau-tn", mau);
  nutKhac.classList.toggle("dang-chon", !coTrongPalette(mau) && !ganDayNet.some(m => cungMau(m, mau)));
  ganDayO.replaceChildren(...(ganDayNet.length ? [Object.assign(document.createElement("span"), {className: "tn-nhan", textContent: "Gần đây"})] : []),
    ...ganDayNet.map(m => {
      const b = dung(`Màu ${m.toUpperCase()}`, svgNet(14, 14, `<path d="M2.5 7.5l3 3 6-6.5" fill="none" stroke="${mauChu(m)}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`), "Màu đã dùng gần đây");
      b.className = "tn-o-mau";
      b.style.background = m;
      b.setAttribute("aria-pressed", cungMau(m, mau));
      b.onclick = () => datThuocTinhNet("mau", m);
      return b;
    }));
  thanhNet.classList.toggle("dang-sua", !!chonNet);
  tieuNet.textContent = TEN_NET[loai];
  phuNet.textContent = chonNet ? "Đang sửa nét đã chọn" : "Cho nét sắp vẽ";
  nutXong.hidden = nutXoa.hidden = !chonNet;
  nutViTri.dataset.ten = nutViTri.ariaLabel = viTriNet === "tren" ? "Đưa thanh này xuống dưới" : "Đưa thanh này lên trên";
  nutViTri.innerHTML = bieuTuong(viTriNet === "tren" ? "tro-xuong" : "tro-len");
  veMauThu();
  datViTriNet();
}

// Thanh nằm giữa mép trên (hoặc mép dưới) khung xem. Nét đang chọn mà nằm dưới thanh thì thanh nhảy sang mép đối diện.
function datViTriNet() {
  if (thanhNet.hidden) return;
  const v = chonNet?.v ?? xv(), kv = v.o.getBoundingClientRect(), le = 8;
  thanhNet.style.maxWidth = `${Math.max(240, kv.width - 2 * le)}px`;
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
