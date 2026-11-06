"use strict";
// Hộp chữ trên PDF: thêm, chọn, kéo, sửa, định dạng. Lúc lưu, hộp chữ thành chữ thật trong file (xem chu_pdf.py), không vào ảnh PNG.
// Mục hộp chữ trong m.ct: {loai:"hop-chu", id?, x, y, chu, mau, phong, co, dam, nghieng, gach}. x, y là góc trên-trái, đơn vị pt.
// Mục không bị sửa tại chỗ: mọi thay đổi tạo mục mới thay vào mảng, nên lichCt (Ctrl+Z) chỉ cần giữ mảng cũ.

const GIAN_DONG = 1.3;  // bằng lõi: giãn dòng = 1.3 × cỡ chữ
const CO_CHU_MIN = 4, CO_CHU_MAX = 200;
const PHONG_MAC_DINH = "Times New Roman";

const ctChu = {phong: PHONG_MAC_DINH, co: 12, dam: false, nghieng: false, gach: false};  // lựa chọn gần nhất, dùng cho hộp chữ mới
try { Object.assign(ctChu, JSON.parse(localStorage.getItem("suaTexHopChu") || "{}")); } catch { /* không có thì dùng mặc định */ }
const luuCtChu = () => { try { localStorage.setItem("suaTexHopChu", JSON.stringify(ctChu)); } catch { /* bỏ qua */ } };

// hc.c: hộp đang chọn (đã nằm trong t.m.ct). hc.sua: đang gõ {o: ô gõ, nhap: bản đang sửa, goc: hộp cũ hoặc null nếu là hộp mới}.
const hc = {v: null, t: null, c: null, sua: null};
// sc: ô sửa chữ có sẵn (sua-chu.js) {o, nhap, doi, dong, g, t, v, truoc, cu}. Thanh định dạng dùng chung với hộp chữ.
const sc = {sua: null, dangHoi: false, henGhiChu: 0, cho: null};

const moDo = document.createElement("canvas").getContext("2d");
const fontHc = (c, px = c.co) => `${c.nghieng ? "italic " : ""}${c.dam ? "700 " : "400 "}${px}px "${c.phong}", sans-serif`;

// ---------- Số đo phông (độ cao trên/dưới đường cơ sở) lấy từ máy chủ để khớp vị trí dòng chữ trong file ----------

const thongSoPhong = new Map();  // "họ|đ|n" -> {asc, desc, dam_gia, nghieng_gia} hoặc Promise
const khoaPhong = (c, dam = c.dam, nghieng = c.nghieng) => `${c.phong}|${+dam}|${+nghieng}`;

function layThongSoPhong(c, dam = c.dam, nghieng = c.nghieng) {
  const k = khoaPhong(c, dam, nghieng);
  if (!thongSoPhong.has(k)) {
    thongSoPhong.set(k, goi("/api/chu-tim-phong", {ho: c.phong, dam, nghieng}).then(kq => {
      thongSoPhong.set(k, kq);
      veLaiTatCaHc();
      return kq;
    }, () => {
      const kq = {asc: 0.9, desc: 0.25, dam_gia: false, nghieng_gia: false, khong_co: true};
      thongSoPhong.set(k, kq);
      return kq;
    }));
  }
  return thongSoPhong.get(k);
}

function soDoPhong(c) {
  const kq = layThongSoPhong(c);
  return kq instanceof Promise ? {asc: 0.9, desc: 0.25} : kq;
}

function veLaiTatCaHc() {
  for (const v of [xvTex, xvPdf]) v.trang.forEach(t => v.veLop(t));
}

// ---------- Vẽ, đo ----------

function veHopChu(ctx, c) {
  if (hc.sua?.goc === c) return;  // đang gõ trong ô thật
  const {asc} = soDoPhong(c), cach = c.co * GIAN_DONG;
  ctx.font = fontHc(c);
  ctx.textBaseline = "alphabetic";
  c.chu.split("\n").forEach((dong, i) => {
    const yb = c.y + asc * c.co + i * cach;
    ctx.fillText(dong, c.x, yb);
    if (c.gach && dong.trim()) {
      const day = Math.max(c.co * 0.05, 0.4);
      ctx.fillRect(c.x, yb + c.co * 0.12 - day / 2, ctx.measureText(dong).width, day);
    }
  });
}

// Khung bao của hộp, đơn vị pt.
function khungHc(c) {
  moDo.font = fontHc(c);
  const dong = c.chu.split("\n");
  return {x: c.x, y: c.y, w: Math.max(c.co * 0.5, ...dong.map(d => moDo.measureText(d).width)), h: dong.length * c.co * GIAN_DONG};
}

const mucHc = c => ({id: c.id, x: c.x, y: c.y, chu: c.chu, phong: c.phong, co: c.co, mau: c.mau, dam: !!c.dam, nghieng: !!c.nghieng,
  gach_chan: !!c.gach, gian_dong: GIAN_DONG});

// Từ mục đọc từ file (chu_pdf.doc_chu_da_them) thành mục hộp chữ.
const hopChuTuFile = m => ({loai: "hop-chu", id: m.id, x: m.x, y: m.y, chu: m.chu, mau: m.mau, phong: m.phong, co: m.co, dam: m.dam, nghieng: m.nghieng, gach: m.gach_chan});

// Nạp sẵn số đo phông cho các hộp chữ đọc từ file, để vẽ ngay đúng chỗ.
function napPhongHc(ds) {
  const da = new Set();
  return Promise.all(ds.filter(c => !da.has(khoaPhong(c)) && da.add(khoaPhong(c))).map(c => layThongSoPhong(c)));
}

// ---------- Khung chọn trên trang ----------

// Mỗi hộp có một phần tử trong suốt phủ lên để bấm, kéo; hộp đang chọn có viền. Giữ lại phần tử cũ để kéo không bị đứt.
function capNhatKhungHc(v, t) {
  t.khungHc ??= new Map();
  const dung = new Set(t.m.ct.filter(c => c.loai === "hop-chu"));
  for (const [c, el] of t.khungHc) if (!dung.has(c)) { el.remove(); t.khungHc.delete(c); }
  for (const c of dung) {
    let el = t.khungHc.get(c);
    if (!el) {
      el = document.createElement("div");
      el.className = "khung-hc";
      el.onpointerdown = e => batDauKeoHc(e, v, t, el.hop, el);  // el.hop luôn là mục hiện tại của phần tử này
      t.khungHc.set(c, el);
    }
    el.hop = c;
    if (el.parentNode !== t.o) t.o.append(el);
    const k = khungHc(c);
    Object.assign(el.style, {left: `${k.x * v.daVe}px`, top: `${k.y * v.daVe}px`, width: `${k.w * v.daVe}px`, height: `${k.h * v.daVe}px`});
    el.classList.toggle("chon", hc.c === c);
    el.hidden = hc.sua?.goc === c;
  }
}

function chonHc(v, t, c) {
  if (hc.c === c && hc.t === t) return capNhatThanhHc();
  const cu = hc.t;
  hc.v = v;
  hc.t = c ? t : null;
  hc.c = c;
  if (cu && cu !== t) cu.khungHc?.forEach(el => el.classList.remove("chon"));
  if (c) t.khungHc?.forEach((el, x) => el.classList.toggle("chon", x === c));
  else cu?.khungHc?.forEach(el => el.classList.remove("chon"));
  capNhatThanhHc();
}

// Bỏ chọn; đang gõ thì chốt chữ đang gõ (huy = bỏ chữ đang gõ).
function boChonHc(huy = false) {
  if (hc.sua) chotSoanHc(!huy);
  if (hc.c) chonHc(hc.v, hc.t, null);
  capNhatThanhHc();
}

// ---------- Kéo ----------

let lanBamCuoi = {c: null, gio: 0};  // để nhận nhấp đúp

function batDauKeoHc(e, v, t, c, el) {
  if (e.button || !(congCu === "chu" || congCu === "hop-chu")) return;
  e.stopPropagation();
  e.preventDefault();
  if (hc.sua) chotSoanHc(true);
  const dau = {x: e.clientX, y: e.clientY}, gioNay = e.timeStamp;
  const nhapDup = lanBamCuoi.c === c && gioNay - lanBamCuoi.gio < 450;
  lanBamCuoi = {c, gio: gioNay};
  chonHc(v, t, c);
  if (nhapDup) { lanBamCuoi = {c: null, gio: 0}; return moSoanHc(v, t, c, false); }
  const cu = t.m.ct, goc = {x: c.x, y: c.y};
  let hien = c, daDi = false;
  el.setPointerCapture(e.pointerId);
  const di = ev => {
    const dx = (ev.clientX - dau.x) / v.daVe, dy = (ev.clientY - dau.y) / v.daVe;
    if (!daDi && Math.hypot(dx, dy) * v.daVe < 3) return;
    daDi = true;
    const k = khungHc(c), moi = {...c, x: Math.max(0, Math.min(t.w - k.w, goc.x + dx)), y: Math.max(0, Math.min(t.h - k.h, goc.y + dy))};
    t.m.ct = t.m.ct.map(x => (x === hien ? moi : x));
    t.khungHc.set(moi, el);
    t.khungHc.delete(hien);
    el.hop = moi;
    if (hc.c === hien) hc.c = moi;
    hien = moi;
    v.veLop(t);
  };
  const xong = () => {
    el.removeEventListener("pointermove", di);
    el.removeEventListener("pointerup", xong);
    el.removeEventListener("pointercancel", xong);
    if (!daDi) return;
    lichCt.push({v, t, ct: cu});
    daDoiCt(v);
  };
  el.addEventListener("pointermove", di);
  el.addEventListener("pointerup", xong);
  el.addEventListener("pointercancel", xong);
}

// ---------- Thêm, sửa nội dung ----------

// Bấm vào chỗ trống bằng công cụ Hộp chữ: mở ô gõ hộp mới ở đó.
function batDauHc(v, t, x, y) {
  boChonHc();
  moSoanHc(v, t, {loai: "hop-chu", x, y, chu: "", mau: mauCt, ...ctChu}, true);
}

function moSoanHc(v, t, goc, moi) {
  document.querySelector(".o-nhap")?.remove();
  const o = document.createElement("textarea"), nhap = {...goc};
  o.className = "o-nhap o-nhap-hc";
  o.value = goc.chu;
  o.spellcheck = false;
  o.wrap = "off";
  o.placeholder = "Gõ chữ";
  o.onpointerdown = e => e.stopPropagation();
  hc.v = v;
  hc.t = t;
  hc.c = moi ? null : goc;
  hc.sua = {o, nhap, goc: moi ? null : goc, t, v};
  o.oninput = () => { nhap.chu = o.value; kieuOSoan(); capNhatThanhHc(); };
  o.onblur = e => {
    if (e.relatedTarget?.closest?.("#thanh-chu") || !hc.sua || hc.sua.o !== o) return;  // bấm vào thanh định dạng thì vẫn đang sửa
    chotSoanHc(true);
  };
  o.onkeydown = e => {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); chotSoanHc(false); return; }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); chotSoanHc(true); return; }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && "biu".includes(e.key.toLowerCase())) {
      e.preventDefault();
      const k = {b: "dam", i: "nghieng", u: "gach"}[e.key.toLowerCase()];
      datDinhDangHc({[k]: !nhap[k]});
    }
  };
  t.o.append(o);
  t.khungHc?.forEach(el => { el.hidden = false; });
  if (!moi) { v.veLop(t); }
  kieuOSoan();
  o.focus();
  o.setSelectionRange(o.value.length, o.value.length);
  capNhatThanhHc();
}

// Ô gõ có cùng phông, cỡ, màu, vị trí như hộp thật để thấy đúng thứ sẽ ghi vào file.
function kieuOSoan() {
  const {o, nhap, v} = hc.sua, he = v.daVe, {desc, asc} = soDoPhong(nhap);
  const dong = nhap.chu.split("\n"), cach = nhap.co * GIAN_DONG;
  moDo.font = fontHc(nhap);
  const rong = Math.max(nhap.co * 6, ...dong.map(d => moDo.measureText(d).width + nhap.co));
  const lech = (cach - (asc + desc) * nhap.co) / 2;  // nửa khoảng trống trên và dưới trong một dòng
  Object.assign(o.style, {
    left: `${nhap.x * he}px`, top: `${(nhap.y - lech) * he}px`, width: `${rong * he}px`, height: `${Math.max(dong.length, 1) * cach * he}px`,
    font: fontHc(nhap, nhap.co * he), lineHeight: `${cach * he}px`, color: nhap.mau, textDecoration: nhap.gach ? "underline" : "none",
  });
}

function chotSoanHc(luu) {
  const s = hc.sua;
  if (!s) return;
  hc.sua = null;
  const {v, t, goc} = s;
  s.o.onblur = null;
  s.o.remove();
  const chu = s.nhap.chu.replace(/\s+$/, "");
  if (!chu.trim()) {
    if (luu && goc) {  // xóa hết chữ của hộp cũ: bỏ hộp
      lichCt.push({v, t, ct: t.m.ct});
      t.m.ct = t.m.ct.filter(x => x !== goc);
      daDoiCt(v);
      hc.c = null;
    }
  } else if (luu) {
    const moi = {...s.nhap, chu};
    if (goc) {
      const doi = ["chu", "phong", "co", "mau", "dam", "nghieng", "gach"].some(k => goc[k] !== moi[k]);
      if (doi) {
        lichCt.push({v, t, ct: t.m.ct});
        t.m.ct = t.m.ct.map(x => (x === goc ? moi : x));
        daDoiCt(v);
      }
      hc.c = doi ? moi : goc;
    } else {
      themCt(v, t, moi);
      hc.c = moi;
      hc.v = v;
      hc.t = t;
    }
  }
  v.veLop(t);
  capNhatThanhHc();
}

function xoaHc() {
  const {v, t, c} = hc;
  if (!c) return;
  lichCt.push({v, t, ct: t.m.ct});
  t.m.ct = t.m.ct.filter(x => x !== c);
  hc.c = null;
  daDoiCt(v);
  v.veLop(t);
  capNhatThanhHc();
}

// ---------- Thanh định dạng ----------

const thanh = document.createElement("div");
thanh.id = "thanh-chu";
thanh.hidden = true;
thanh.innerHTML = `
  <select id="tc-phong" aria-label="Phông chữ"></select>
  <span class="tc-co">
    <button type="button" id="tc-nho" aria-label="Giảm cỡ chữ">−</button>
    <input id="tc-co" type="number" min="${CO_CHU_MIN}" max="${CO_CHU_MAX}" step="1" aria-label="Cỡ chữ (pt)">
    <button type="button" id="tc-to" aria-label="Tăng cỡ chữ">+</button>
  </span>
  <button type="button" id="tc-mau" aria-label="Màu chữ" title="Màu chữ"><i></i></button>
  <button type="button" id="tc-dam" aria-label="Đậm" title="Đậm (Ctrl+B)"><b>B</b></button>
  <button type="button" id="tc-nghieng" aria-label="Nghiêng" title="Nghiêng (Ctrl+I)"><i>I</i></button>
  <button type="button" id="tc-gach" aria-label="Gạch chân" title="Gạch chân (Ctrl+U)"><u>U</u></button>
  <span id="tc-ghi" hidden></span>`;
document.body.append(thanh);
const tc = id => document.getElementById(id);

let dsPhongViet = null;
async function napDsPhong() {
  if (dsPhongViet) return;
  dsPhongViet = [];
  try {
    dsPhongViet = (await (await fetch("/api/phong-viet")).json()).ds;
  } catch { dsPhongViet = []; }
  const o = tc("tc-phong");
  o.replaceChildren(...dsPhongViet.map(p => {
    const op = new Option(p.ho, p.ho);
    op.style.fontFamily = `"${p.ho}", sans-serif`;
    return op;
  }));
  if (dsPhongViet.length && !dsPhongViet.some(p => p.ho === ctChu.phong)) ctChu.phong = dsPhongViet.find(p => p.ho === PHONG_MAC_DINH)?.ho ?? dsPhongViet[0].ho;
  capNhatThanhHc();
}

// Đối tượng đang được định dạng: ô đang gõ, hộp đang chọn, hoặc (công cụ Hộp chữ chưa chọn gì) lựa chọn mặc định cho hộp mới.
const doiTuongHc = () => sc.sua?.nhap ?? hc.sua?.nhap ?? hc.c ?? ctChu;

function datDinhDangHc(thay) {
  if (sc.sua) return datDinhDangSc(thay);  // sửa chữ có sẵn: không đổi lựa chọn mặc định của hộp chữ mới
  const dt = doiTuongHc();
  if (thay.co !== undefined) thay.co = Math.min(CO_CHU_MAX, Math.max(CO_CHU_MIN, Math.round(thay.co * 2) / 2));
  if (!hc.sua && hc.c) {
    const {v, t, c} = hc, moi = {...c, ...thay};
    lichCt.push({v, t, ct: t.m.ct});
    t.m.ct = t.m.ct.map(x => (x === c ? moi : x));
    hc.c = moi;
    daDoiCt(v);
    v.veLop(t);
  } else {
    Object.assign(dt, thay);
    if (hc.sua) kieuOSoan();
  }
  for (const k of ["phong", "co", "dam", "nghieng", "gach"]) if (thay[k] !== undefined) ctChu[k] = thay[k];
  luuCtChu();
  capNhatThanhHc();
  if (hc.sua) hc.sua.o.focus();
}

const nutThanh = (id, lam) => {
  tc(id).onpointerdown = e => e.preventDefault();  // giữ nguyên con trỏ trong ô đang gõ
  tc(id).onclick = lam;
};
nutThanh("tc-nho", () => datDinhDangHc({co: doiTuongHc().co - 1}));
nutThanh("tc-to", () => datDinhDangHc({co: doiTuongHc().co + 1}));
nutThanh("tc-dam", () => datDinhDangHc({dam: !doiTuongHc().dam}));
nutThanh("tc-nghieng", () => datDinhDangHc({nghieng: !doiTuongHc().nghieng}));
nutThanh("tc-gach", () => datDinhDangHc({gach: !doiTuongHc().gach}));
nutThanh("tc-mau", () => {
  $("o-mau").value = doiTuongHc().mau ?? mauCt;
  $("o-mau").click();
});
tc("tc-phong").onchange = e => datDinhDangHc({phong: e.target.value});
tc("tc-co").onchange = e => { const so = parseFloat(e.target.value); if (so > 0) datDinhDangHc({co: so}); else capNhatThanhHc(); };
tc("tc-co").onkeydown = e => { e.stopPropagation(); if (e.key === "Enter") e.target.blur(); };
thanh.addEventListener("pointerdown", e => e.stopPropagation());

// Đổi màu bằng ô màu chung: hộp đang chọn hoặc đang gõ đổi theo.
$("o-mau").addEventListener("change", e => {
  if (sc.sua || hc.sua || hc.c) datDinhDangHc({mau: e.target.value});
});

function capNhatThanhHc() {
  const hien = sc.sua?.t.o.isConnected || (hc.sua || hc.c) && hc.t?.o.isConnected || (congCu === "hop-chu" && xv().trang.length);
  if (hc.t && !hc.t.o.isConnected && !hc.sua) { hc.c = null; hc.t = null; }
  thanh.hidden = !hien;
  if (!hien) return;
  napDsPhong();
  thanh.classList.toggle("sua-chu", !!sc.sua);  // lõi sửa chữ có sẵn chưa gạch chân
  const dt = doiTuongHc();
  const o = tc("tc-phong");
  if (!dsPhongViet?.some(p => p.ho === dt.phong) && dt.phong) {  // phông không còn trong danh sách: vẫn hiện để biết
    if (![...o.options].some(op => op.value === dt.phong)) {
      const op = new Option(dt.phong, dt.phong);
      op.style.fontFamily = `"${dt.phong}", sans-serif`;
      o.append(op);
    }
  }
  o.value = dt.phong;
  o.style.fontFamily = `"${dt.phong}", var(--phong)`;
  if (document.activeElement !== tc("tc-co")) tc("tc-co").value = dt.co;
  const mau = dt.mau ?? mauCt;
  tc("tc-mau").firstElementChild.style.background = mau;
  for (const [id, k] of [["tc-dam", "dam"], ["tc-nghieng", "nghieng"], ["tc-gach", "gach"]]) tc(id).setAttribute("aria-pressed", !!dt[k]);
  ghiChuGiaLap(dt);
  datViTriThanh();
}

// Phông không có kiểu đậm/nghiêng thật thì app giả lập khi ghi file; báo để người dùng biết.
async function ghiChuGiaLap(dt) {
  const g = tc("tc-ghi");
  if (!dt.dam && !dt.nghieng) { g.hidden = true; return; }
  const kq = await layThongSoPhong(dt);
  if (doiTuongHc() !== dt && doiTuongHc().phong !== dt.phong) return;
  const ds = [dt.dam && kq.dam_gia && "đậm", dt.nghieng && kq.nghieng_gia && "nghiêng"].filter(Boolean);
  g.hidden = !ds.length;
  g.textContent = ds.length ? `${ds.join(", ")} giả lập` : "";
}

// Thanh nằm sát mép trên khung xem, ở giữa, nên không che dòng chữ nào quanh chỗ đang sửa. Nếu chỗ đang sửa ở sát mép trên (thanh sẽ đè lên) thì chuyển xuống mép dưới.
function datViTriThanh() {
  if (thanh.hidden) return;
  const v = sc.sua?.v ?? hc.sua?.v ?? hc.v ?? xv(), kv = v.o.getBoundingClientRect(), tr = thanh.getBoundingClientRect();
  const nguon = sc.sua ? sc.sua.o : hc.sua ? hc.sua.o : hc.c ? hc.t?.khungHc?.get(hc.c) : null;
  const k = nguon?.getBoundingClientRect(), le = 8, cach = 10;
  const tren = Math.max(4, kv.top + le), duoi = Math.min(innerHeight - tr.height - 4, kv.bottom - tr.height - le - 36);  // 36: thanh điều hướng đáy
  const dung = y => !k || !k.width || k.bottom < y - cach || k.top > y + tr.height + cach;
  const y = dung(tren) || !dung(duoi) ? tren : duoi;
  const x = Math.max(4, Math.min(innerWidth - tr.width - 4, kv.left + (kv.width - tr.width) / 2));
  Object.assign(thanh.style, {left: `${x}px`, top: `${y}px`});
}

for (const v of [xvTex, xvPdf]) v.o.addEventListener("scroll", () => datViTriThanh(), {passive: true});
addEventListener("resize", () => datViTriThanh());

addEventListener("keydown", e => {
  if (e.target.closest?.("textarea, input, select, .CodeMirror, dialog")) return;
  if (hc.c && !hc.sua && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); xoaHc(); }
  else if (hc.c && !hc.sua && e.key === "Enter") { e.preventDefault(); moSoanHc(hc.v, hc.t, hc.c, false); }
  else if (e.key === "Escape" && hc.c) boChonHc();
});
