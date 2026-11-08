"use strict";
// Theo dòng: kéo thả đổi chỗ, xóa, nhân đôi, chuyển lên/xuống cho khối bài (Câu, Bài, Ví dụ) và khối lý thuyết.
// Mỗi thao tác là đúng một lần replaceRange trong soan, nên Ctrl+Z hoàn tác trọn vẹn. Chữ giữ nguyên, không đánh số lại
// (khối viết bằng "Câu 1." thì số do người gõ; khối dạng môi trường thì phanTichFile tự đếm lại).

const KEO_BIEU_TUONG = '<svg class="bt" viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></g></svg>';
let keoDangKeo = null, keoHenBao = 0, keoO = null;

const keoCoThe = () => tt.cheDo === "dong" && !$("vung-dong").hidden && !tt.dangSua && !$("tim").value.trim() && soan.getValue() === khoaDong;  // khoaDong khác văn bản: khối trên màn hình chưa kịp vẽ lại
const keoDsKhoi = () => tt.khoi.filter(k => k.loai !== "tu-do");

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

function keoSua(a, b, chen) {
  soan.operation(() => soan.replaceRange(chen, soan.posFromIndex(a), soan.posFromIndex(b)));
  khoaDong = null;
  capNhat();
}

function keoDanhDau(vt) {
  const k = tt.khoi.find(x => x.loai !== "tu-do" && x.dau <= vt && vt < x.cuoi);
  if (!k?.o) return;
  k.o.classList.remove("vua-keo");
  void k.o.offsetWidth;
  k.o.classList.add("vua-keo");
}

// Thả khối k vào chỗ trước khối thứ chiSo trong danh sách khối (bằng độ dài danh sách là thả xuống cuối).
function keoDi(k, chiSo) {
  if (!keoCoThe()) return false;
  const ds = keoDsKhoi(), vt = ds.indexOf(k);
  if (vt < 0 || chiSo === vt || chiSo === vt + 1) return false;
  const chu = soan.getValue(), {s, e} = keoDoan(chu, k), cuoiFile = chiSo >= ds.length;
  const pos = cuoiFile ? keoDoan(chu, ds[ds.length - 1]).e : keoDoan(chu, ds[chiSo]).s;
  let doan = chu.slice(s, e);
  if (!doan.endsWith("\n")) doan += "\n";
  if (!cuoiFile && !/\n[ \t]*\n$/.test(doan)) doan += "\n";
  // Thả xuống cuối thì giữ một dòng trống giữa khối trước và khối vừa thả.
  const truoc = cuoiFile && pos > 0 ? (chu[pos - 1] !== "\n" ? "\n\n" : chu[pos - 2] !== "\n" ? "\n" : "") : "";
    if (pos <= s) {
    keoSua(pos, e, doan + chu.slice(pos, s));
    keoDanhDau(pos);
  } else {
    keoSua(s, pos, chu.slice(e, pos) + truoc + doan);
    keoDanhDau(s + (pos - e) + truoc.length);
  }
  return true;
}

function keoNhanDoi(k) {
  if (!keoCoThe()) return;
  const chu = soan.getValue(), {s, e} = keoDoan(chu, k);
  let doan = chu.slice(s, e);
  if (!doan.endsWith("\n")) doan += "\n";
  const coTrong = /\n[ \t]*\n$/.test(doan), them = coTrong ? "" : "\n";
  keoSua(e, e, them + doan);
  keoDanhDau(e + them.length);
  keoHienBao(`Đã nhân đôi ${k.nhan}.`);
}

function keoXoa(k) {
  if (!keoCoThe()) return;
  const chu = soan.getValue(), {s, e} = keoDoan(chu, k);
  keoSua(s, e, "");
  keoHienBao(`Đã xóa ${k.nhan}.`);
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

function keoLenXuong(k, huong) {
  const ds = keoDsKhoi(), vt = ds.indexOf(k);
  if (huong < 0 ? vt <= 0 : vt >= ds.length - 1) return;
  keoDi(k, huong < 0 ? vt - 1 : vt + 2);
}

// ---------- Nút trên đầu khối ----------

// Gọi từ veKhoi sau khi dựng đầu khối.
function keoGanNut(k, dau) {
  if (k.loai !== "bai" && k.loai !== "lt") return;
  const tay = document.createElement("button"), xoa = document.createElement("button");
  tay.type = xoa.type = "button";
  tay.className = "keo-tay";
  tay.innerHTML = KEO_BIEU_TUONG;
  tay.title = "Giữ chuột kéo để đổi chỗ";
  tay.setAttribute("aria-label", `Kéo ${k.nhan} để đổi chỗ`);
  xoa.className = "keo-xoa";
  xoa.innerHTML = bieuTuong("xoa");
  xoa.title = `Xóa ${k.nhan}`;
  xoa.setAttribute("aria-label", `Xóa ${k.nhan}`);
  dau.prepend(tay);
  dau.append(xoa);
}

$("vung-dong").addEventListener("click", e => {
  const xoa = e.target.closest?.(".keo-xoa");
  if (!xoa) return;
  if (!keoCoThe()) return bao("Xong dòng đang sửa rồi hãy xóa câu.", true);
  const k = tt.khoi[+xoa.closest(".khoi").dataset.i];
  if (k) keoXoa(k);
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
  const d = keoDangKeo;
  d.chiSo = keoChiSoThu(d.y);
  const vt = keoDsKhoi().indexOf(d.k), vo = d.chiSo === vt || d.chiSo === vt + 1;
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
  d.k.o?.classList.remove("dang-keo");
  if (d.dang && tha && !d.vach.hidden) keoDi(d.k, d.chiSo);
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
    d.k.o.classList.add("dang-keo");
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
  if (!tay || e.button !== 0) return;
  e.preventDefault();
  if (!keoCoThe()) return bao("Xong dòng đang sửa rồi hãy kéo câu.", true);
  const k = tt.khoi[+tay.closest(".khoi").dataset.i];
  if (!k) return;
  keoDangKeo = {k, id: e.pointerId, x0: e.clientX, y0: e.clientY, y: e.clientY, dang: false, chiSo: -1};
  document.addEventListener("pointermove", keoDiChuyen);
  document.addEventListener("pointerup", keoNha);
  document.addEventListener("pointercancel", keoHuy);
  document.addEventListener("keydown", keoPhim, true);
});

// ---------- Menu chuột phải ----------

$("vung-dong").addEventListener("contextmenu", e => {
  const o = e.target.closest?.(".khoi.bai, .khoi.lt");
  if (!o || e.target.closest(".sua") || !keoCoThe()) return;
  const k = tt.khoi[+o.dataset.i];
  if (!k) return;
  e.preventDefault();
  if (typeof anGoiY === "function") anGoiY();
  const ds = keoDsKhoi(), vt = ds.indexOf(k);
  moMenu(null, [
    {ten: `Chuyển ${k.nhan} lên`, bat: () => vt > 0, lam: () => keoLenXuong(k, -1)},
    {ten: `Chuyển ${k.nhan} xuống`, bat: () => vt < ds.length - 1, lam: () => keoLenXuong(k, 1)},
    {ten: `Nhân đôi ${k.nhan}`, lam: () => keoNhanDoi(k)},
    null,
    {ten: `Xóa ${k.nhan}`, nguy: true, lam: () => keoXoa(k)},
  ], [e.clientX, e.clientY]);
});
