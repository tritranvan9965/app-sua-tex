"use strict";
// Hai chế độ kiểu Foxit Phantom: Sửa chữ (khung cho mọi ô chữ của các trang đang hiện, bấm vào sửa tại chỗ, bấm ra ngoài là xong)
// và Sửa đối tượng (khung cho ảnh, hình, nhóm; chọn rồi kéo, co, xóa trực tiếp). Danh sách lấy từ lõi (/api/chu-ds-dong, /api/dt-ds)
// theo từng trang lúc trang được vẽ, nên cuộn tới đâu nạp tới đó.
// Việc sửa đối tượng giữ trong m.ct như chú thích: {loai:"sua-dt", khoa, id, trang, khung_cu, khung_moi (null = xóa), viec} nên Ctrl+Z, nhân bản trang,
// đổi thẻ đều dùng chung cơ chế cũ. viec = {loai:"doi"|"co"|"xoa", ...} đúng dạng máy chủ nhận (xem app.ap_sua_trang).
// Bản xem trước lúc kéo: cắt vùng đối tượng từ canvas trang đã vẽ (spCat), chỗ cũ che trắng.

const SP_NEN_TRANG = 0.9;  // đối tượng phủ quá 90% diện tích trang coi như nền, không hiện khung
const SP_TOI_THIEU = 2;    // pt, cạnh nhỏ nhất khi co
const SP_BUOC = 1, SP_BUOC_TO = 10;
const SP_CAC_TAY = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const spDsChu = new Map();  // "duong|trang" -> Promise<ds>; file nguồn không đổi trong phiên nên giữ được
const spDsDt = new Map();
const spCat = new Map();    // "khoa|id" -> {cv, rong, cao}: ảnh cắt từ trang gốc
let spChon = {t: null, v: null, ids: []};
let spBaoLoi = 0;

const spCoCt = t => t.m.ct ?? (t.m.ct = []);
const spDangMo = v => v === xvPdf && (congCu === "sua-chu" || congCu === "sua-dt");
const spMucDt = (t, id) => spCoCt(t).find(c => c.loai === "sua-dt" && c.id === id);

function spLay(kho, url, m) {
  const k = `${m.duong}|${m.so}`;
  if (!kho.has(k)) {
    const p = goi(url, {duong: m.duong, trang: m.so}).then(kq => kq.ds);
    kho.set(k, p);
    p.catch(() => kho.delete(k));
  }
  return kho.get(k);
}

// ---------- Khung trên trang ----------

// Gọi mỗi lần veLop và lúc đổi công cụ: dựng khung nếu trang vừa hiện hoặc vừa đổi chế độ, không thì chỉ làm tươi trạng thái.
function capNhatKhungSp(v, t) {
  const kieu = spDangMo(v) && t.ve ? congCu : null;
  if (t.spKieu === kieu && (!kieu || t.spLop?.isConnected)) return kieu && spLamTuoi(v, t);
  t.spLop?.remove();
  t.spLop = null;
  t.spKieu = kieu;
  t.spLan = (t.spLan || 0) + 1;
  if (kieu) spDung(v, t, kieu);
}

function spTatCa() {
  for (const t of xvPdf.trang) capNhatKhungSp(xvPdf, t);
  for (const t of xvTex.trang) { t.spLop?.remove(); t.spLop = t.spKieu = null; }
}

async function spDung(v, t, kieu) {
  const lan = t.spLan;
  if (t.m.xoay) {
    if (Date.now() - spBaoLoi > 4000) { spBaoLoi = Date.now(); bao("Trang này đã xoay trong app. Lưu file rồi mở lại để sửa.", true); }
    return;
  }
  const lop = t.spLop = Object.assign(document.createElement("div"), {className: "lop-sp"});
  t.o.append(lop);
  let ds;
  try {
    ds = await (kieu === "sua-chu" ? spLay(spDsChu, "/api/chu-ds-dong", t.m) : spLay(spDsDt, "/api/dt-ds", t.m));
  } catch (e) {
    if (lan === t.spLan && Date.now() - spBaoLoi > 4000) { spBaoLoi = Date.now(); bao(e.message, true); }
    return;
  }
  if (lan !== t.spLan || !lop.isConnected) return;
  t.spBox = [];
  for (const d of ds) {
    const e = kieu === "sua-chu" ? spKhungChu(v, t, d) : spKhungDt(v, t, d);
    if (!e) continue;
    e.classList.add("khung-sp", kieu === "sua-chu" ? "sp-chu" : "sp-dt");
    e.d = d;
    t.spBox.push(e);
    lop.append(e);
  }
  if (kieu === "sua-dt") spDungKhungChon(v, t);
  spLamTuoi(v, t);
}

function spDat(e, k, t, le = 0) {
  const [x0, y0, x1, y1] = k;
  Object.assign(e.style, {left: `${(x0 - le) / t.w * 100}%`, top: `${(y0 - le) / t.h * 100}%`, width: `${(x1 - x0 + 2 * le) / t.w * 100}%`, height: `${(y1 - y0 + 2 * le) / t.h * 100}%`});
}

function spKhongSua(e, ly) {
  e.classList.add("khong-sua");
  e.dataset.ten = "Chưa sửa được ở đây";
  e.dataset.goiY = ly || "Lõi chưa sửa được mục này.";
}

function spKhungChu(v, t, d) {
  if (!d.chu.trim()) return null;
  const e = document.createElement("div");
  spDat(e, d.khung, t, 1);
  if (d.sua_duoc === false) spKhongSua(e, loiDeHieu(d.ly_do || ""));
  e.onpointerenter = () => { if (d.sua_duoc !== false) duKienSc(t.m, d).catch(() => {}); };  // hỏi trước geometry để bấm xuống là mở ngay
  e.onpointerdown = ev => {
    ev.stopPropagation();
    if (ev.button) return;
    ev.preventDefault();
    const g = t.o.getBoundingClientRect();
    batDauSuaChu(v, t, d, (ev.clientX - g.left) / v.daVe);
  };
  return e;
}

function spKhungDt(v, t, d) {
  if (d.nen_trang) return null;
  const [x0, y0, x1, y1] = d.khung;
  if ((x1 - x0) * (y1 - y0) > SP_NEN_TRANG * t.w * t.h) return null;
  const e = document.createElement("div");
  e.classList.add(`loai-${d.loai}`);
  if (d.sua_duoc === false) spKhongSua(e, d.ly_do);
  e.onpointerdown = ev => spBamDt(ev, v, t, d);
  return e;
}

// Trạng thái hiện tại của khung: đã sửa, đang sửa, đã xóa, đang chọn.
function spLamTuoi(v, t) {
  if (!t.spBox) return;
  if (t.spKieu === "sua-chu") {
    const ct = spCoCt(t), dangSua = sc.sua?.t === t ? sc.sua.dong.id : null;
    const da = new Set(ct.filter(c => c.loai === "sua-dong" && !c.an).map(c => c.dong_id));
    for (const e of t.spBox) {
      e.classList.toggle("da-sua", da.has(e.d.id));
      e.hidden = e.d.id === dangSua;
    }
  } else {
    for (const e of t.spBox) {
      const c = spMucDt(t, e.d.id);
      e.hidden = !!c && !c.khung_moi;
      spDat(e, c?.khung_moi ?? e.d.khung, t);
      e.classList.toggle("da-sua", !!c);
      e.classList.toggle("chon", spChon.t === t && spChon.ids.includes(e.d.id));
    }
    spCapNhatKhungChon(t);
  }
}

// ---------- Sửa đối tượng: chọn ----------

const spKhungHienTai = (t, id) => {
  const c = spMucDt(t, id);
  return c ? c.khung_moi : t.spBox?.find(e => e.d.id === id)?.d.khung;
};

function spDungKhungChon(v, t) {
  const k = t.spChon = document.createElement("div");
  k.className = "chon-dt";
  k.hidden = true;
  k.onpointerdown = ev => { ev.stopPropagation(); if (!ev.button) { ev.preventDefault(); spKeo(ev, v, t, "than"); } };
  for (const h of SP_CAC_TAY) {
    const n = document.createElement("i");
    n.className = `tay-dt tay-${h}`;
    n.onpointerdown = ev => { ev.stopPropagation(); if (!ev.button) { ev.preventDefault(); spKeo(ev, v, t, h); } };
    k.append(n);
  }
  t.spLop.append(k);
}

function spCapNhatKhungChon(t) {
  const k = t.spChon;
  if (!k) return;
  const ids = spChon.t === t ? spChon.ids.filter(id => spKhungHienTai(t, id)) : [];
  k.hidden = !ids.length;
  if (!ids.length) return;
  const ks = ids.map(id => spKhungHienTai(t, id));
  spDat(k, [Math.min(...ks.map(a => a[0])), Math.min(...ks.map(a => a[1])), Math.max(...ks.map(a => a[2])), Math.max(...ks.map(a => a[3]))], t, 1);
  k.classList.toggle("nhieu", ids.length > 1);
}

function spDatChon(t, ids) {
  const cu = spChon.t;
  spChon = {t: ids.length ? t : null, v: ids.length ? xvPdf : null, ids};
  if (cu && cu !== t && cu.o.isConnected) spLamTuoi(xvPdf, cu);
  if (t.o.isConnected) spLamTuoi(xvPdf, t);
  capNhatRibbon();
}

function boChonDt() {
  if (spChon.t) spDatChon(spChon.t, []);
}

function spBamDt(ev, v, t, d) {
  ev.stopPropagation();
  if (ev.button) return;
  ev.preventDefault();
  if (d.sua_duoc === false) return bao(d.ly_do ? `Chưa sửa được: ${d.ly_do}` : "Chưa sửa được mục này.", true);
  const them = ev.ctrlKey || ev.metaKey || ev.shiftKey;
  const co = spChon.t === t ? spChon.ids : [];
  if (them) return spDatChon(t, co.includes(d.id) ? co.filter(i => i !== d.id) : [...co, d.id]);
  if (!co.includes(d.id)) spDatChon(t, [d.id]);
  spKeo(ev, v, t, "than");
}

// ---------- Sửa đối tượng: kéo, co ----------

// Ghi (hoặc bỏ) mục sửa của một đối tượng theo khung mới, trả mảng ct mới. khongDoi: về đúng chỗ cũ thì bỏ mục.
function spGhiMuc(t, ct, d, km, giu) {
  const rest = ct.filter(c => !(c.loai === "sua-dt" && c.id === d.id)), i = ct.findIndex(c => c.loai === "sua-dt" && c.id === d.id);
  const kc = d.khung;
  if (km && Math.abs(km[0] - kc[0]) < 0.005 && Math.abs(km[1] - kc[1]) < 0.005 && Math.abs(km[2] - kc[2]) < 0.005 && Math.abs(km[3] - kc[3]) < 0.005) return rest;
  let viec;
  if (!km) viec = {loai: "xoa"};
  else if (Math.abs((km[2] - km[0]) - (kc[2] - kc[0])) < 0.005 && Math.abs((km[3] - km[1]) - (kc[3] - kc[1])) < 0.005) viec = {loai: "doi", dx: km[0] - kc[0], dy: km[1] - kc[1]};
  else viec = {loai: "co", khung_moi: km.map(n => +n.toFixed(3)), ...(giu ? {giu_ti_le: true} : {})};
  const moi = {loai: "sua-dt", khoa: `${t.m.duong}|${t.m.so}`, id: d.id, trang: t.m.so, khung_cu: kc, khung_moi: km, viec};
  if (i < 0) return [...rest, moi];
  rest.splice(i, 0, moi);
  return rest;
}

const spDoiTuong = (t, id) => t.spBox?.find(e => e.d.id === id)?.d;

// Khung mới khi kéo tay cầm h từ khung k0 một đoạn (dx, dy); giu: giữ tỉ lệ.
function spCo(k0, h, dx, dy, giu) {
  let [x0, y0, x1, y1] = k0;
  if (h.includes("w")) x0 += dx;
  if (h.includes("e")) x1 += dx;
  if (h.includes("n")) y0 += dy;
  if (h.includes("s")) y1 += dy;
  const w0 = k0[2] - k0[0], h0 = k0[3] - k0[1];
  if (giu && w0 > 0 && h0 > 0) {
    let s;
    const sx = (x1 - x0) / w0, sy = (y1 - y0) / h0;
    s = h.length === 2 ? Math.max(sx, sy) : h === "n" || h === "s" ? sy : sx;  // góc: khung lớn hơn con trỏ; cạnh: theo cạnh đang kéo
    s = Math.max(s, SP_TOI_THIEU / Math.min(w0, h0));
    const w = w0 * s, hh = h0 * s;
    if (h.includes("w")) x0 = k0[2] - w; else x1 = k0[0] + w;
    if (h.includes("n")) y0 = k0[3] - hh; else y1 = k0[1] + hh;
    if (h === "n" || h === "s") { x0 = (k0[0] + k0[2]) / 2 - w / 2; x1 = x0 + w; }
    if (h === "e" || h === "w") { y0 = (k0[1] + k0[3]) / 2 - hh / 2; y1 = y0 + hh; }
    if (h.length === 2) { if (h.includes("w")) x1 = k0[2]; else x0 = k0[0]; if (h.includes("n")) y1 = k0[3]; else y0 = k0[1]; }
    return [x0, y0, x1, y1];
  }
  if (x1 - x0 < SP_TOI_THIEU) { if (h.includes("w")) x0 = x1 - SP_TOI_THIEU; else x1 = x0 + SP_TOI_THIEU; }
  if (y1 - y0 < SP_TOI_THIEU) { if (h.includes("n")) y0 = y1 - SP_TOI_THIEU; else y1 = y0 + SP_TOI_THIEU; }
  return [x0, y0, x1, y1];
}

function spKeo(ev, v, t, h) {
  const ids = [...spChon.ids];
  const goc = ids.map(id => ({d: spDoiTuong(t, id), k: [...spKhungHienTai(t, id)]})).filter(x => x.d);
  if (!goc.length) return;
  const ctTruoc = t.m.ct, x0 = ev.clientX, y0 = ev.clientY;
  const anh = goc.length === 1 && goc[0].d.loai === "anh";
  let daDi = false, hen = 0, cuoi = ev;
  spLayCat(t, goc.map(x => x.d));
  const ve = () => {
    hen = 0;
    const dx = (cuoi.clientX - x0) / v.daVe, dy = (cuoi.clientY - y0) / v.daVe;
    if (!daDi && Math.hypot(dx, dy) * v.daVe < 3) return;
    if (!daDi) { daDi = true; lichCt.push({v, t, ct: ctTruoc}); daDoiCt(v); }
    let ct = ctTruoc;
    for (const {d, k} of goc) {
      if (h === "than") ct = spGhiMuc(t, ct, d, [k[0] + dx, k[1] + dy, k[2] + dx, k[3] + dy]);
      else {
        const giu = anh || cuoi.shiftKey;
        ct = spGhiMuc(t, ct, d, spCo(k, h, dx, dy, giu), giu);
      }
    }
    t.m.ct = ct;
    v.veLop(t);
  };
  const di = e => { cuoi = e; hen ||= requestAnimationFrame(ve); };
  const xong = e => {
    removeEventListener("pointermove", di);
    removeEventListener("pointerup", xong);
    removeEventListener("pointercancel", xong);
    cancelAnimationFrame(hen);
    cuoi = e;
    ve();
    if (daDi) spKiemTra(v, t, ids, ctTruoc);
  };
  addEventListener("pointermove", di);
  addEventListener("pointerup", xong);
  addEventListener("pointercancel", xong);
}

// Hỏi lõi xem các sửa vừa làm có thực hiện được không (đối tượng chồng nhau, nhóm chứa dòng chữ...). Không được thì trả lại như cũ.
async function spKiemTra(v, t, ids, ctTruoc) {
  const ctSau = t.m.ct;
  try {
    for (const id of ids) {
      const c = spMucDt(t, id);
      if (!c) continue;
      const kq = await goi("/api/dt-thu", {duong: t.m.duong, trang: t.m.so, id, viec: c.viec});
      if (!kq.sua_duoc) throw new Error(kq.ly_do);
    }
  } catch (e) {
    if (t.m.ct !== ctSau) return;  // đã có thao tác khác chen vào, để người dùng tự hoàn tác
    const i = lichCt.findLastIndex(x => x.ct === ctTruoc);
    if (i >= 0) lichCt.splice(i, 1);
    t.m.ct = ctTruoc;
    v.veLop(t);
    bao(`Không làm được: ${e.message}`, true);
  }
}

function spLayCat(t, ds) {
  const cv = [...t.o.children].find(c => c.tagName === "CANVAS" && !c.classList.contains("lop-ct"));
  if (!cv || !cv.width) return;
  const he = cv.width / t.w;
  for (const d of ds) {
    const k = `${t.m.duong}|${t.m.so}|${d.id}`;
    if (spCat.has(k) && spCat.get(k).he >= he * 0.99) continue;
    const [a, b, c, e] = d.khung, x = Math.max(0, Math.floor(a * he)), y = Math.max(0, Math.floor(b * he));
    const w = Math.min(cv.width, Math.ceil(c * he)) - x, h = Math.min(cv.height, Math.ceil(e * he)) - y;
    if (w < 1 || h < 1) continue;
    const mo = document.createElement("canvas");
    mo.width = w;
    mo.height = h;
    mo.getContext("2d").drawImage(cv, x, y, w, h, 0, 0, w, h);
    spCat.set(k, {cv: mo, he, x0: x / he, y0: y / he, x1: (x + w) / he, y1: (y + h) / he});
  }
}

// ---------- Vẽ bản xem trước (gọi từ veCt) ----------

function veSuaDtCu(ctx, c) {
  const [x0, y0, x1, y1] = c.khung_cu;
  ctx.save();
  ctx.fillStyle = "#fff";
  ctx.fillRect(x0 - 0.4, y0 - 0.4, x1 - x0 + 0.8, y1 - y0 + 0.8);
  ctx.restore();
}

function veSuaDtMoi(ctx, c) {
  if (!c.khung_moi) return;
  const m = spCat.get(`${c.khoa}|${c.id}`), [x0, y0, x1, y1] = c.khung_moi;
  ctx.save();
  if (m) {
    const kc = c.khung_cu, sx = (x1 - x0) / (kc[2] - kc[0]), sy = (y1 - y0) / (kc[3] - kc[1]);
    ctx.drawImage(m.cv, x0 + (m.x0 - kc[0]) * sx, y0 + (m.y0 - kc[1]) * sy, (m.x1 - m.x0) * sx, (m.y1 - m.y0) * sy);
  } else {
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = XANH_CHON;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }
  ctx.restore();
}

// ---------- Phím ----------

function spDoiViTri(dx, dy) {
  const {t, v, ids} = spChon;
  if (!ids.length) return;
  const nay = Date.now(), ctTruoc = t.m.ct;
  if (!spPhim || spPhim.t !== t || nay - spPhim.gio > 700) { spPhim = {t, gio: nay, ct: ctTruoc}; lichCt.push({v, t, ct: ctTruoc}); daDoiCt(v); }
  spPhim.gio = nay;
  let ct = t.m.ct;
  for (const id of ids) {
    const d = spDoiTuong(t, id), k = spKhungHienTai(t, id);
    if (d && k) ct = spGhiMuc(t, ct, d, [k[0] + dx, k[1] + dy, k[2] + dx, k[3] + dy]);
  }
  t.m.ct = ct;
  v.veLop(t);
  clearTimeout(spHenKt);
  spHenKt = setTimeout(() => spKiemTra(v, t, ids, spPhim.ct), 500);
}
let spPhim = null, spHenKt = 0;

function spXoaChon() {
  const {t, v, ids} = spChon;
  if (!ids.length) return;
  const ctTruoc = t.m.ct;
  let ct = ctTruoc;
  for (const id of ids) {
    const d = spDoiTuong(t, id);
    if (d) ct = spGhiMuc(t, ct, d, null);
  }
  lichCt.push({v, t, ct: ctTruoc});
  t.m.ct = ct;
  spDatChon(t, []);
  v.veLop(t);
  daDoiCt(v);
  spKiemTra(v, t, ids, ctTruoc);
}

addEventListener("keydown", e => {
  if (!spDangMo(xvPdf) || e.target.closest?.("textarea, input, select, .CodeMirror, dialog")) return;
  if (congCu === "sua-dt" && spChon.ids.length) {
    const buoc = e.shiftKey ? SP_BUOC_TO : SP_BUOC, huong = {ArrowLeft: [-buoc, 0], ArrowRight: [buoc, 0], ArrowUp: [0, -buoc], ArrowDown: [0, buoc]}[e.key];
    if (huong && !e.ctrlKey && !e.altKey) { e.preventDefault(); return spDoiViTri(...huong); }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); return spXoaChon(); }
    if (e.key === "Escape") { e.preventDefault(); return boChonDt(); }
  }
  // Esc khi không còn gì đang chọn hay đang sửa: thoát về Chọn chữ
  if (e.key === "Escape" && !document.body.classList.contains("toan-man") && !sc.sua && !sc.dangHoi && !(congCu === "sua-dt" && spChon.ids.length)) datCongCu("chu");
});
