"use strict";
// Theo dòng: chọn một hay nhiều khối bài (Câu, Bài, Ví dụ) và khối lý thuyết, rồi kéo thả đổi chỗ, xóa, nhân đôi, chuyển lên/xuống, sao chép.
// Mỗi thao tác là đúng một lần replaceRange trong soan, nên Ctrl+Z hoàn tác trọn vẹn. Chữ giữ nguyên, không đánh số lại
// (khối viết bằng "Câu 1." thì số do người gõ; khối dạng môi trường thì phanTichFile tự đếm lại).
// Chọn: Ctrl+bấm vào khối để chọn hay bỏ chọn, Shift+bấm để chọn một dải. Chọn mất đi khi văn bản đổi hoặc đổi file.

const KEO_BIEU_TUONG = '<svg class="bt" viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></g></svg>';
let keoDangKeo = null, keoHenBao = 0, keoO = null;
let keoChon = null;  // {tep, tap: Set chỉ số khối, neo: chỉ số khối bấm gần nhất}

const keoCoThe = () => tt.cheDo === "dong" && !$("vung-dong").hidden && !tt.dangSua && !$("tim").value.trim() && soan.getValue() === khoaDong;  // khoaDong khác văn bản: khối trên màn hình chưa kịp vẽ lại
const keoDsKhoi = () => tt.khoi.filter(k => k.loai !== "tu-do");
const keoChonDuoc = k => k.loai === "bai" || k.loai === "lt";
const keoTenNhom = nhom => nhom.length > 1 ? `${nhom.length} câu` : nhom[0].nhan;

// ---------- Chọn khối ----------

function keoVeChon() {
  for (const k of tt.khoi) k.o?.classList.toggle("da-chon", !!keoChon && keoChon.tap.has(k.i));
}

function keoBoChon() {
  if (!keoChon) return;
  keoChon = null;
  keoVeChon();
}

// Chọn chỉ có giá trị với file đang mở; sửa văn bản (có thể đánh lại chỉ số) thì bỏ chọn ở sự kiện change.
const keoDaChon = () => (keoChon && keoChon.tep === tt.tep && keoChon.tap.size ? keoChon : null);
soan.on("change", keoBoChon);

function keoBamChon(k, e) {
  const ds = keoDsKhoi().filter(keoChonDuoc);
  if (!keoDaChon()) keoChon = {tep: tt.tep, tap: new Set(), neo: -1};
  const c = keoChon;
  if (e.shiftKey && c.neo >= 0 && ds.some(x => x.i === c.neo)) {
    const a = ds.findIndex(x => x.i === c.neo), b = ds.indexOf(k);
    if (!(e.ctrlKey || e.metaKey)) c.tap.clear();
    for (let j = Math.min(a, b); j <= Math.max(a, b); j++) c.tap.add(ds[j].i);
  } else {
    if (c.tap.has(k.i)) c.tap.delete(k.i); else c.tap.add(k.i);
    c.neo = k.i;
  }
  if (!c.tap.size) keoChon = null;
  keoVeChon();
}

// Nhóm khối để thao tác: nếu k nằm trong các khối đã chọn thì cả nhóm, không thì riêng k.
function keoNhom(k) {
  const c = keoDaChon();
  if (c?.tap.has(k.i)) return tt.khoi.filter(x => c.tap.has(x.i));
  keoBoChon();
  return [k];
}

const keoLienNhau = nhom => {
  const ds = keoDsKhoi(), a = ds.indexOf(nhom[0]);
  return a >= 0 && nhom.every((k, j) => ds[a + j] === k);
};

// ---------- Tính văn bản mới ----------

// Đoạn văn bản của khối: cả dòng đầu, cả xuống dòng cuối và các dòng trống theo sau, để cắt ra không dính dòng, không dư dòng trống.
function keoDoan(chu, k) {
  let s = k.dau, e = k.cuoi;
  while (s < e && /\s/.test(chu[s])) s++;  // dau có thể nằm ở xuống dòng của dòng trước
  const dongDau = chu.lastIndexOf("\n", s - 1) + 1;
  if (/^[ \t]*$/.test(chu.slice(dongDau, s))) s = dongDau;
  let het = chu.indexOf("\n", e);
  if (het < 0) het = chu.length;
  if (/^[ \t]*$/.test(chu.slice(e, het))) e = Math.min(het + 1, chu.length);
  e += chu.slice(e).match(/^(?:[ \t]*\n)+/)?.[0].length || 0;
  return {s, e};
}

// Bỏ các đoạn bo (đã xếp theo thứ tự, không chồng nhau) rồi chèn chen vào vị trí vt (toạ độ văn bản cũ, là biên của một đoạn).
// Trả về khoảng cần thay trong văn bản cũ, chữ thay vào, và vị trí đoạn chèn trong văn bản mới.
function keoGhep(chu, bo, vt, chen, cuoiFile) {
  const lo = Math.min(bo.length ? bo[0].s : vt, vt ?? Infinity), hi = Math.max(bo.length ? bo[bo.length - 1].e : vt, vt ?? 0);
  let out = "", pos = lo, a = -1, b = -1;
  const them = den => {
    if (vt !== null && a < 0 && vt <= den) {
      out += chu.slice(pos, vt);
      pos = vt;
      let ct = (chu.slice(Math.max(0, lo - 2), lo) + out).slice(-2), c = chen;
      if (!c.endsWith("\n")) c += "\n";
      if (cuoiFile) { if (ct.length && ct[ct.length - 1] !== "\n") c = "\n\n" + c; else if (ct.length > 1 && ct[0] !== "\n") c = "\n" + c; }
      else if (!/\n[ \t]*\n$/.test(c)) c += "\n";
      a = lo + out.length;
      out += c;
      b = lo + out.length;
    }
    out += chu.slice(pos, den);
    pos = den;
  };
  for (const r of bo) { them(r.s); pos = r.e; }
  them(hi);
  return {lo, hi, moi: out, a, b};
}

function keoSua(kq) {
  soan.operation(() => soan.replaceRange(kq.moi, soan.posFromIndex(kq.lo), soan.posFromIndex(kq.hi)));
  khoaDong = null;
  capNhat();
}

// Nháy các khối nằm trong đoạn văn bản [a, b) của văn bản mới.
function keoDanhDau(a, b) {
  for (const k of tt.khoi) {
    if (!keoChonDuoc(k) || !k.o || k.cuoi <= a || k.cuoi > b) continue;
    k.o.classList.remove("vua-keo");
    void k.o.offsetWidth;
    k.o.classList.add("vua-keo");
  }
}

const keoDoanNhom = (chu, nhom) => nhom.map(k => keoDoan(chu, k));
const keoChepChu = (chu, ds) => ds.map(({s, e}) => chu.slice(s, e)).join("");

// ---------- Thao tác ----------

// Thả cả nhóm vào chỗ trước khối thứ chiSo trong danh sách khối (bằng độ dài danh sách là thả xuống cuối), các khối nằm liền nhau theo thứ tự cũ.
function keoDi(nhom, chiSo) {
  if (!keoCoThe()) return false;
  const ds = keoDsKhoi(), vt = ds.indexOf(nhom[0]);
  if (nhom.some(k => !ds.includes(k))) return false;
  if (keoLienNhau(nhom) && chiSo >= vt && chiSo <= vt + nhom.length) return false;
  const chu = soan.getValue(), bo = keoDoanNhom(chu, nhom), cuoiFile = chiSo >= ds.length;
  const pos = cuoiFile ? keoDoan(chu, ds[ds.length - 1]).e : keoDoan(chu, ds[chiSo]).s;
  const kq = keoGhep(chu, bo, pos, keoChepChu(chu, bo), cuoiFile);
  keoBoChon();
  keoSua(kq);
  keoDanhDau(kq.a, kq.b);
  return true;
}

function keoNhanDoi(nhom) {
  if (!keoCoThe()) return;
  const chu = soan.getValue(), bo = keoDoanNhom(chu, nhom), cuoi = bo[bo.length - 1].e;
  const doan = keoChepChu(chu, bo), coTrong = /\n[ \t]*\n$/.test(doan.endsWith("\n") ? doan : doan + "\n");
  const kq = keoGhep(chu, [], cuoi, (coTrong || cuoi >= chu.length ? "" : "\n") + doan, false);
  keoBoChon();
  keoSua(kq);
  keoDanhDau(kq.a, kq.b);
  keoHienBao(`Đã nhân đôi ${keoTenNhom(nhom)}.`);
}

function keoXoa(nhom) {
  if (!keoCoThe()) return;
  const chu = soan.getValue();
  keoBoChon();
  keoSua(keoGhep(chu, keoDoanNhom(chu, nhom), null, "", false));
  keoHienBao(`Đã xóa ${keoTenNhom(nhom)}.`);
}

function keoChep(nhom) {
  const chu = soan.getValue(), van = keoDoanNhom(chu, nhom).map(({s, e}) => chu.slice(s, e).trimEnd()).join("\n\n");
  const xong = () => bao(`Đã sao chép ${keoTenNhom(nhom)}.`);
  const du = () => {
    const o = document.createElement("textarea");
    o.value = van;
    document.body.append(o);
    o.select();
    try { document.execCommand("copy"); xong(); } catch { bao("Không sao chép được.", true); }
    o.remove();
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(van).then(xong, du); else du();
}

function keoLenXuong(nhom, huong) {
  const ds = keoDsKhoi(), a = ds.indexOf(nhom[0]), b = a + nhom.length - 1;
  if (!keoLienNhau(nhom) || (huong < 0 ? a <= 0 : b >= ds.length - 1)) return;
  keoDi(nhom, huong < 0 ? a - 1 : b + 2);
}

// Thông báo có nút Hoàn tác (bao() chỉ hiện chữ).
function keoHienBao(chu) {
  if (!keoO) {
    keoO = document.createElement("div");
    keoO.id = "keo-bao";
    keoO.setAttribute("role", "status");
    keoO.innerHTML = '<span></span><button type="button">Hoàn tác</button><small>Ctrl+Z</small>';
    keoO.children[1].onclick = () => { keoAnBao(); hoanTac(false); };
    document.body.append(keoO);
  }
  keoO.firstChild.textContent = chu;
  keoO.hidden = false;
  clearTimeout(keoHenBao);
  keoHenBao = setTimeout(keoAnBao, 8000);
}

function keoAnBao() {
  clearTimeout(keoHenBao);
  if (keoO) keoO.hidden = true;
}

// ---------- Nút trên đầu khối ----------

// Gọi từ veKhoi sau khi dựng đầu khối.
function keoGanNut(k, dau) {
  if (!keoChonDuoc(k)) return;
  k.o.classList.toggle("da-chon", !!keoDaChon()?.tap.has(k.i));
  const tay = document.createElement("button"), xoa = document.createElement("button");
  tay.type = xoa.type = "button";
  tay.className = "keo-tay";
  tay.innerHTML = KEO_BIEU_TUONG;
  tay.title = "Giữ chuột kéo để đổi chỗ. Ctrl+bấm để chọn nhiều khối";
  tay.setAttribute("aria-label", `Kéo ${k.nhan} để đổi chỗ`);
  xoa.className = "keo-xoa";
  xoa.innerHTML = bieuTuong("xoa");
  xoa.title = `Xóa ${k.nhan} (nếu đang chọn nhiều khối thì xóa cả nhóm)`;
  xoa.setAttribute("aria-label", `Xóa ${k.nhan}`);
  dau.prepend(tay);
  dau.append(xoa);
}

const keoKhoiTai = o => tt.khoi[+o.dataset.i];

// Ctrl hay Shift + bấm vào khối thì chọn, không mở sửa dòng (nghe ở pha bắt để chạy trước trình nghe của theo-dong.js).
$("vung-dong").addEventListener("mousedown", e => {
  if ((e.ctrlKey || e.metaKey || e.shiftKey) && e.target.closest?.(".khoi.bai, .khoi.lt")) e.preventDefault();  // khỏi bôi đen chữ
}, true);

$("vung-dong").addEventListener("click", e => {
  const o = e.target.closest?.(".khoi.bai, .khoi.lt");
  if (o && (e.ctrlKey || e.metaKey || e.shiftKey) && !e.target.closest(".sua, .keo-xoa")) {
    e.preventDefault();
    e.stopPropagation();
    if (!keoCoThe()) return bao("Xong dòng đang sửa rồi hãy chọn câu.", true);
    const k = keoKhoiTai(o);
    if (k) keoBamChon(k, e);
    return;
  }
  const xoa = e.target.closest?.(".keo-xoa");
  if (xoa) {
    e.stopPropagation();
    if (!keoCoThe()) return bao("Xong dòng đang sửa rồi hãy xóa câu.", true);
    const k = keoKhoiTai(xoa.closest(".khoi"));
    if (k) keoXoa(keoNhom(k));
    return;
  }
  if (!e.target.closest?.(".keo-tay")) keoBoChon();  // bấm thường vào chỗ khác thì bỏ chọn, bấm vào dòng vẫn mở sửa như cũ
}, true);

document.addEventListener("keydown", e => {
  if (!keoDaChon() || keoDangKeo || e.target.closest?.("input, textarea, select, dialog, .CodeMirror") || document.querySelector(".bang-menu")) return;
  if (e.key === "Escape") { keoBoChon(); return; }
  if (e.key === "Delete" && keoCoThe()) {
    e.preventDefault();
    keoXoa(tt.khoi.filter(k => keoChon.tap.has(k.i)));
  }
});

// ---------- Kéo thả ----------

function keoChiSoThu(y) {
  const ds = keoDsKhoi();
  for (let i = 0; i < ds.length; i++) {
    const r = ds[i].o.getBoundingClientRect();
    if (y < r.top + r.height / 2) return i;
  }
  return ds.length;
}

function keoVachTai(chiSo) {
  const ds = keoDsKhoi(), vung = $("vung-dong"), vr = vung.getBoundingClientRect();
  const r = (chiSo < ds.length ? ds[chiSo] : ds[ds.length - 1]).o.getBoundingClientRect();
  const y = (chiSo < ds.length ? r.top : r.bottom) - vr.top + vung.scrollTop;
  return Math.max(0, y - 1);
}

function keoCapNhatVach() {
  const d = keoDangKeo, ds = keoDsKhoi(), vt = ds.indexOf(d.nhom[0]);
  d.chiSo = keoChiSoThu(d.y);
  const vo = keoLienNhau(d.nhom) && d.chiSo >= vt && d.chiSo <= vt + d.nhom.length;
  d.vach.hidden = vo;
  if (!vo) d.vach.style.top = `${keoVachTai(d.chiSo)}px`;
}

function keoVong() {
  const d = keoDangKeo;
  if (!d || !d.dang) return;
  const vung = $("vung-dong"), r = vung.getBoundingClientRect(), mep = 56;
  const toc = d.y < r.top + mep ? -Math.ceil((r.top + mep - d.y) / 4) : d.y > r.bottom - mep ? Math.ceil((d.y - (r.bottom - mep)) / 4) : 0;
  if (toc) { vung.scrollTop += Math.max(-24, Math.min(24, toc)); keoCapNhatVach(); }
  d.vong = requestAnimationFrame(keoVong);
}

function keoKetThuc(tha) {
  const d = keoDangKeo;
  if (!d) return;
  keoDangKeo = null;
  cancelAnimationFrame(d.vong);
  document.removeEventListener("pointermove", keoDiChuyen);
  document.removeEventListener("pointerup", keoNha);
  document.removeEventListener("pointercancel", keoHuy);
  document.removeEventListener("keydown", keoPhim, true);
  document.body.classList.remove("dang-keo-khoi");
  d.vach?.remove();
  for (const k of d.nhom) k.o?.classList.remove("dang-keo");
  if (d.dang && tha && !d.vach.hidden) keoDi(d.nhom, d.chiSo);
}

function keoDiChuyen(e) {
  const d = keoDangKeo;
  if (!d || e.pointerId !== d.id) return;
  d.y = e.clientY;
  if (!d.dang) {
    if (Math.abs(e.clientY - d.y0) < 4 && Math.abs(e.clientX - d.x0) < 4) return;
    d.dang = true;
    d.vach = document.createElement("div");
    d.vach.className = "keo-vach";
    $("vung-dong").append(d.vach);
    for (const k of d.nhom) k.o.classList.add("dang-keo");
    document.body.classList.add("dang-keo-khoi");
    d.vong = requestAnimationFrame(keoVong);
  }
  keoCapNhatVach();
}

const keoNha = e => { if (keoDangKeo && e.pointerId === keoDangKeo.id) keoKetThuc(true); };
const keoHuy = () => keoKetThuc(false);
function keoPhim(e) {
  if (e.key !== "Escape") return;
  e.preventDefault();
  e.stopPropagation();
  keoKetThuc(false);
}

$("vung-dong").addEventListener("pointerdown", e => {
  const tay = e.target.closest?.(".keo-tay");
  if (!tay || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;  // có phím bổ trợ là để chọn, không kéo
  e.preventDefault();
  if (!keoCoThe()) return bao("Xong dòng đang sửa rồi hãy kéo câu.", true);
  const k = keoKhoiTai(tay.closest(".khoi"));
  if (!k) return;
  keoDangKeo = {nhom: keoNhom(k), id: e.pointerId, x0: e.clientX, y0: e.clientY, y: e.clientY, dang: false, chiSo: -1};
  document.addEventListener("pointermove", keoDiChuyen);
  document.addEventListener("pointerup", keoNha);
  document.addEventListener("pointercancel", keoHuy);
  document.addEventListener("keydown", keoPhim, true);
});

// ---------- Menu chuột phải ----------

$("vung-dong").addEventListener("contextmenu", e => {
  const o = e.target.closest?.(".khoi.bai, .khoi.lt");
  if (!o || e.target.closest(".sua") || !keoCoThe()) return;
  const k = keoKhoiTai(o);
  if (!k) return;
  e.preventDefault();
  if (typeof anGoiY === "function") anGoiY();
  const nhom = keoNhom(k), ten = keoTenNhom(nhom), ds = keoDsKhoi(), a = ds.indexOf(nhom[0]), b = a + nhom.length - 1, lien = keoLienNhau(nhom);
  moMenu(null, [
    {ten: `Chuyển ${ten} lên`, bat: () => lien && a > 0, lam: () => keoLenXuong(nhom, -1)},
    {ten: `Chuyển ${ten} xuống`, bat: () => lien && b < ds.length - 1, lam: () => keoLenXuong(nhom, 1)},
    {ten: `Nhân đôi ${ten}`, lam: () => keoNhanDoi(nhom)},
    {ten: `Sao chép ${ten}`, lam: () => keoChep(nhom)},
    null,
    {ten: `Xóa ${ten}`, nguy: true, phim: nhom.length > 1 ? "Delete" : "", lam: () => keoXoa(nhom)},
  ], [e.clientX, e.clientY]);
});
