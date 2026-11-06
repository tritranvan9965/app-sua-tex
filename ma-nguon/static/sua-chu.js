"use strict";
// Sửa chữ có sẵn trong PDF (kiểu Foxit "Edit Text"). Bấm vào dòng chữ, sửa tại chỗ; lúc lưu máy chủ xóa hẳn chữ cũ và ghi chữ thật (xem chu_pdf.sua_dong).
// Mục trong m.ct: {loai:"sua-dong", dong_id, chu_cu, chu (mới, rỗng = xóa dòng), k_cu:[x0,y0,x1,y1] vùng chữ cũ, x, nen (đường cơ sở), cv (cỡ chữ nhìn thấy),
// phong (họ phông để vẽ trên màn hình), co, mau, dam, nghieng, tt (thuoc_tinh gửi máy chủ), dung_lai, phong_dung, dai, an}.
// Mục không bị sửa tại chỗ (giống hộp chữ): đổi gì cũng tạo mục mới, nên lichCt (Ctrl+Z) chỉ cần giữ mảng cũ.
// Biến sc (trạng thái ô sửa) khai ở hop-chu.js vì thanh định dạng dùng chung.

const SC_PHU_DONG = 2;  // lõi chừa 2 pt quanh vùng chữ cũ (chu_pdf.sua_dong), bắt buộc khớp để suy ra đường cơ sở
const SC_NGUONG_DAI = 0.6;  // chữ mới thò ra quá bên phải chữ cũ hơn 0,6 lần cỡ chữ thì báo có thể đè chữ bên cạnh
const probeSc = new Map();  // "duong|dong_id" -> kết quả chạy thử với chữ nguyên bản (file nguồn không đổi trong phiên)

const hoiSc = (m, dong_id, chu_moi, thuoc_tinh) => goi("/api/chu-sua-thu", {duong: m.duong, trang: m.so, dong_id, chu_moi, thuoc_tinh});

// ---------- Vẽ (màn hình, bản in thử, xuất ảnh). Lúc lưu thì lớp ảnh bỏ mục này vì lõi ghi chữ thật ----------

function veSuaDong(ctx, c) {
  const [x0, y0, x1, y1] = c.k_cu;
  ctx.save();
  ctx.fillStyle = "#fff";
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  if (!c.an && c.chu.trim()) {
    ctx.fillStyle = c.mau;
    ctx.font = `${c.nghieng ? "italic " : ""}${c.dam ? "700 " : "400 "}${c.cv}px "${c.phong}", sans-serif`;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(c.chu, c.x, c.nen);
  }
  ctx.restore();
}

// Từ kết quả chạy thử của lõi: khung chữ mới = (gốc.x - 2, nền - 1,05 cv, ..., nền + 0,35 cv), nên suy ngược ra đường cơ sở và cỡ nhìn thấy.
function hinhHoc(kq) {
  const [a, b, , d] = kq.khung, cv = (d - b) / 1.4;
  return {k_cu: kq.khung_cu, x: a + SC_PHU_DONG, nen: b + 1.05 * cv, cv};
}

function mucSua(dong, kq, g, nhap, tt) {
  const dai = kq.khung[2] - kq.khung_cu[2] > SC_NGUONG_DAI * g.cv;
  return {loai: "sua-dong", dong_id: dong.id, chu_cu: dong.chu, chu: nhap.chu, ...g, k_moi: kq.khung, phong: kq.dung_lai_phong_goc ? nhap.phong : kq.phong_dung,
    co: nhap.co, mau: nhap.mau, dam: nhap.dam, nghieng: nhap.nghieng, tt, dung_lai: kq.dung_lai_phong_goc, phong_dung: kq.phong_dung,
    dam_gia: kq.dam_gia, nghieng_gia: kq.nghieng_gia, dai};
}

// ---------- Mở ô sửa ----------

// dong: một ô trong danh sách của trang (sua-phantom.js, từ /api/chu-ds-dong); xBam: chỗ bấm (pt) để đặt con trỏ.
async function batDauSuaChu(v, t, dong, xBam) {
  const m = t.m;
  if (m.xoay) return bao("Trang này đã xoay trong app. Lưu file rồi mở lại để sửa chữ.", true);
  if (dong.sua_duoc === false) return bao(dong.ly_do ? loiDeHieu(dong.ly_do) : "Dòng này chưa sửa được.", true);
  if (sc.sua) chotSuaChu(true);
  await sc.cho;  // ô trước còn đang chốt: chờ xong để danh sách chú thích của trang là bản mới nhất
  if (sc.dangHoi || sc.sua) return;
  sc.dangHoi = true;
  document.body.classList.add("dang-hoi");
  try {
    const truoc = t.m.ct, cu = truoc.find(c => c.loai === "sua-dong" && c.dong_id === dong.id);
    let g, kq0;
    if (cu) g = {k_cu: cu.k_cu, x: cu.x, nen: cu.nen, cv: cu.cv};
    else {
      kq0 = await duKienSc(m, dong);  // chạy thử nguyên chữ cũ: cho biết đường cơ sở, cỡ và lõi có sửa được dòng này không
      g = hinhHoc(kq0);
    }
    if (sc.sua) return;
    moSuaChu(v, t, dong, g, cu, kq0, truoc, xBam);
  } catch (e) {
    bao(loiDeHieu(e.message), true);
  } finally {
    sc.dangHoi = false;
    document.body.classList.remove("dang-hoi");
  }
}

// Hỏi trước được lúc rê chuột vào ô, nên bấm xuống là mở ngay.
function duKienSc(m, dong) {
  const khoa = `${m.duong}|${dong.id}`;
  if (!probeSc.has(khoa)) {
    const p = hoiSc(m, dong.id, dong.chu, {});
    probeSc.set(khoa, p);
    p.catch(() => probeSc.delete(khoa));
  }
  return probeSc.get(khoa);
}

function loiDeHieu(tb) {
  if (/XObject|cấu trúc lạ/.test(tb)) return "Dòng này nằm trong một khối con của trang (thường gặp ở PDF xuất từ phần mềm đồ họa), app chưa sửa được chữ ở đây.";
  if (/Type0|Identity|CID/i.test(tb)) return "Phông của dòng này dùng kiểu mã hóa đặc biệt, app chưa sửa được chữ ở đây.";
  return tb;
}

function moSuaChu(v, t, dong, g, cu, kq0, truoc, xBam) {
  xoaGhiChuSc();
  const nhap = cu ? {chu: cu.chu, phong: cu.phong, co: cu.co, mau: cu.mau, dam: cu.dam, nghieng: cu.nghieng}
    : {chu: dong.chu.trim(), phong: dong.goi_y_phong, co: Math.round(dong.co * 2) / 2, mau: dong.mau, dam: !!dong.dam, nghieng: !!dong.nghieng};
  const doi = new Set(cu ? Object.keys(cu.tt) : []);
  const o = document.createElement("textarea");
  o.className = "o-nhap o-nhap-hc o-nhap-sc";
  o.value = nhap.chu;
  o.spellcheck = false;
  o.wrap = "off";
  o.rows = 1;
  o.onpointerdown = e => e.stopPropagation();
  o.oninput = () => { nhap.chu = o.value.replace(/\n/g, " "); kieuOSua(); capNhatThanhHc(); };
  o.onblur = e => {
    if (e.relatedTarget?.closest?.("#thanh-chu") || sc.sua?.o !== o) return;
    chotSuaChu(true);
  };
  o.onkeydown = e => {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); chotSuaChu(false); }
    else if (e.key === "Enter") { e.preventDefault(); chotSuaChu(true); }
    else if ((e.ctrlKey || e.metaKey) && !e.altKey && "bi".includes(e.key.toLowerCase())) {
      e.preventDefault();
      const k = e.key.toLowerCase() === "b" ? "dam" : "nghieng";
      datDinhDangSc({[k]: !nhap[k]});
    }
  };
  // Che chữ cũ ngay trên màn hình trong lúc sửa: mục `an` chỉ vẽ nền trắng.
  const an = {loai: "sua-dong", dong_id: dong.id, chu: "", an: true, ...g};
  t.m.ct = truoc.filter(c => c !== cu).concat(an);
  sc.sua = {o, nhap, doi, dong, g, t, v, truoc, cu, kq0};
  t.o.append(o);
  v.veLop(t);
  kieuOSua();
  o.focus();
  const vt = xBam === undefined ? o.value.length : viTriConTro(nhap, xBam - g.x);
  o.setSelectionRange(vt, vt);
  capNhatThanhHc();
  baoPhong(sc.sua, cu ?? kq0, null, true);
}

// Con trỏ đặt vào kẽ chữ gần chỗ bấm nhất (dx: pt tính từ mép trái chữ).
function viTriConTro(nhap, dx) {
  moDo.font = fontHc(nhap);
  let tot = 0, gan = Infinity;
  for (let i = 0; i <= nhap.chu.length; i++) {
    const d = Math.abs(moDo.measureText(nhap.chu.slice(0, i)).width - dx);
    if (d < gan) { gan = d; tot = i; }
  }
  return tot;
}

// Ô gõ trùng đường cơ sở, cỡ chữ, phông với chữ sẽ ghi.
function kieuOSua() {
  const {o, nhap, v, g} = sc.sua, he = v.daVe, {asc, desc} = soDoPhong(nhap), cach = nhap.co * GIAN_DONG;
  moDo.font = fontHc(nhap);
  const rong = Math.max(g.k_cu[2] - g.x, moDo.measureText(nhap.chu).width + nhap.co * 0.5);
  const lech = (cach - (asc + desc) * nhap.co) / 2;
  Object.assign(o.style, {
    left: `${g.x * he}px`, top: `${(g.nen - asc * nhap.co - lech) * he}px`, width: `${rong * he}px`, height: `${cach * he}px`,
    font: fontHc(nhap, nhap.co * he), lineHeight: `${cach * he}px`, color: nhap.mau, background: "#fff",
  });
}

function datDinhDangSc(thay) {
  const s = sc.sua;
  if (thay.co !== undefined) thay.co = Math.min(CO_CHU_MAX, Math.max(CO_CHU_MIN, Math.round(thay.co * 2) / 2));
  Object.assign(s.nhap, thay);
  for (const k of Object.keys(thay)) s.doi.add(k);
  kieuOSua();
  capNhatThanhHc();
  s.o.focus();
}

// ---------- Chốt, hủy ----------

function chotSuaChu(luu) {
  const s = sc.sua;
  if (!s) return sc.cho;
  sc.sua = null;
  return (sc.cho = chotXongSc(s, luu));
}

async function chotXongSc(s, luu) {
  s.o.onblur = null;
  s.o.remove();
  const {v, t, dong, g, nhap, truoc, cu} = s;
  const dat = ct => { t.m.ct = ct; v.veLop(t); capNhatThanhHc(); };
  if (!luu) return dat(truoc);
  const chu = nhap.chu.trim();
  const tt = {};
  for (const k of s.doi) {
    const goc = {phong: undefined, co: dong.co, mau: dong.mau, dam: !!dong.dam, nghieng: !!dong.nghieng}[k];
    if (k === "phong" || (k === "co" ? Math.abs(nhap.co - goc) > 0.01 : nhap[k] !== goc)) tt[k] = nhap[k];
  }
  if (chu === dong.chu.trim() && !Object.keys(tt).length) {  // giống hệt bản gốc: bỏ chỗ sửa
    if (cu) lichCt.push({v, t, ct: truoc});
    return dat(truoc.filter(c => c !== cu));
  }
  try {
    const kq = await hoiSc(t.m, dong.id, chu, tt);
    const moi = mucSua(dong, kq, hinhHoc(kq), {...nhap, chu}, tt);
    lichCt.push({v, t, ct: truoc});
    dat(t.m.ct.filter(c => !(c.loai === "sua-dong" && c.dong_id === dong.id)).concat(moi));
    daDoiCt(v);
    baoPhong({v, t, g: moi}, kq, moi);
  } catch (e) {
    dat(truoc);
    bao(loiDeHieu(e.message), true);
  }
}

function huySuaChu() {
  if (sc.sua) chotSuaChu(false);
  xoaGhiChuSc();
}

// ---------- Dòng nhắc gần ô ----------

function xoaGhiChuSc() {
  clearTimeout(sc.henGhiChu);
  document.querySelector(".ghi-chu-sc")?.remove();
}

// kq: kết quả lõi (dung_lai_phong_goc, phong_dung) hoặc mục đã lưu; moi: mục đã chốt (để báo chữ dài).
function baoPhong({t, g}, kq, moi, thu = false) {
  xoaGhiChuSc();
  const dung = kq.dung_lai_phong_goc ?? kq.dung_lai, ten = kq.phong_dung;
  const ds = [];
  if (!dung && ten) ds.push(thu ? `Phông gốc không dùng lại được, nếu sửa dòng này sẽ dùng ${ten}.` : `Phông gốc thiếu ký tự, dòng này sẽ dùng ${ten}.`);
  if (moi?.dai) ds.push("Chữ mới dài hơn chỗ cũ, có thể đè lên chữ bên cạnh.");
  if (!ds.length) return;
  const d = document.createElement("div");
  d.className = "ghi-chu-sc";
  d.setAttribute("role", "status");
  d.textContent = ds.join(" ");
  const he = xv().daVe;
  Object.assign(d.style, {left: `${Math.max(0, g.k_cu[0]) * he}px`, top: `${(g.k_cu[3] + 6) * he}px`});
  t.o.append(d);
  sc.henGhiChu = setTimeout(xoaGhiChuSc, 9000);
}

// Cảnh báo trước khi lưu: những dòng chữ mới thò ra quá chỗ cũ. Trả true nếu cứ lưu.
function xacNhanSuaChu(ds) {
  const dai = ds.flatMap(m => (m.ct || []).filter(c => c.loai === "sua-dong" && c.dai && !c.an).map(c => c.chu));
  if (!dai.length) return true;
  const ten = dai.slice(0, 3).map(c => `"${c.length > 40 ? c.slice(0, 40) + "…" : c}"`).join(", ");
  return confirm(`${dai.length} dòng chữ đã sửa dài hơn chỗ cũ (${ten}${dai.length > 3 ? ", ..." : ""}), có thể đè lên chữ bên cạnh. Vẫn lưu?`);
}
