"use strict";
// Chú thích trên PDF. Mỗi trang giữ danh sách m.ct, toạ độ tính bằng pt theo trang đang nhìn thấy, nên không phụ thuộc zoom.
// Vẽ ra màn hình, ra bản in và ra file đều dùng chung veCt, veTrinhBay. Lúc lưu, lớp chú thích thành ảnh trong suốt đóng lên trang.

const NHOM_CHU = new Set(["to-sang", "gach-chan", "gach-ngang"]);  // đánh dấu theo chữ đã bôi đen
const NHOM_KEO = new Set(["but", "duong-thang", "mui-ten", "chu-nhat", "tron"]);  // kéo chuột để vẽ
const NHOM_BAM = new Set(["hop-chu", "ghi-chu"]);  // bấm một điểm rồi gõ chữ
// Kiểu nét: mảng nét đứt theo độ dày w (pt). Nét tròn đầu nên đoạn đặc dài thêm w, khoảng hở ngắn đi w.
const KIEU_GACH = {lien: () => [], gach: w => [3 * w + 2, 2 * w + 4], cham: w => [0.01, 2 * w + 2], "gach-cham": w => [3 * w + 2, 2 * w + 2, 0.01, 2 * w + 2]};
const CO_CHU = 12, CO_DAU_GHI_CHU = 14, DO_NET_LOP = 3;
const PHONG_CT = '"Be Vietnam Pro","Segoe UI",sans-serif';

let mauCt = "#c0262d";  // màu chung cho chữ; màu nét vẽ từng công cụ nằm ở net-ve.js
const lichCt = [];  // các thay đổi để Ctrl+Z bỏ lại: {m, ct cũ, v}

function veMuiTen(ctx, [x0, y0], [x1, y1], net) {
  const goc = Math.atan2(y1 - y0, x1 - x0), dai = 6 + net * 2;
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - dai * Math.cos(goc - 0.45), y1 - dai * Math.sin(goc - 0.45));
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - dai * Math.cos(goc + 0.45), y1 - dai * Math.sin(goc + 0.45));
}

function veMot1(ctx, c) {
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = c.mau;
  ctx.lineWidth = c.net || 1;
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.setLineDash(KIEU_GACH[c.kieu]?.(ctx.lineWidth) ?? []);  // chú thích cũ không có kieu thì nét liền
  ctx.beginPath();
  if (c.loai === "to-sang") {
    ctx.globalAlpha = c.trong ?? 0.35;
    c.khung.forEach(k => ctx.rect(...k));  // gộp một đường để chỗ chồng nhau không đậm lên
    ctx.fill();
  } else if (c.loai === "gach-chan" || c.loai === "gach-ngang") {
    const he = c.loai === "gach-chan" ? 0.95 : 0.55;
    c.khung.forEach(([x, y, w, h]) => { ctx.moveTo(x, y + h * he); ctx.lineTo(x + w, y + h * he); });
    ctx.lineWidth = c.net ?? 1;
    ctx.setLineDash(KIEU_GACH[c.kieu]?.(ctx.lineWidth) ?? []);
    ctx.stroke();
  } else if (c.loai === "chu-nhat" || c.loai === "tron") {
    const [[x0, y0], [x1, y1]] = c.d, w = x1 - x0, h = y1 - y0;
    if (c.loai === "chu-nhat") ctx.rect(x0, y0, w, h);
    else ctx.ellipse(x0 + w / 2, y0 + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, 2 * Math.PI);
    if (c.nen) {  // tô nền cùng màu, nhạt
      ctx.globalAlpha = 0.18;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.stroke();
  } else if (c.d) {
    c.d.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    if (c.loai === "mui-ten") {  // đầu mũi tên luôn là nét liền dù thân đứt
      ctx.setLineDash([]);
      ctx.beginPath();
      veMuiTen(ctx, c.d[0], c.d[1], c.net);
      if (c.dau === 2) veMuiTen(ctx, c.d[1], c.d[0], c.net);
      ctx.stroke();
    }
  } else if (c.loai === "hop-chu") {
    veHopChu(ctx, c);
  } else if (c.loai === "ghi-chu") {
    const s = CO_DAU_GHI_CHU;
    ctx.fillStyle = "#f2c86b";
    ctx.strokeStyle = "#17302a";
    ctx.lineWidth = 0.8;
    ctx.rect(c.x, c.y, s, s * 0.8);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c.x + 3, c.y + s * 0.3);
    ctx.lineTo(c.x + s - 3, c.y + s * 0.3);
    ctx.moveTo(c.x + 3, c.y + s * 0.55);
    ctx.lineTo(c.x + s - 3, c.y + s * 0.55);
    ctx.stroke();
  }
  ctx.restore();
}

// boChu: bỏ hộp chữ, vì lúc lưu hộp chữ thành chữ thật trong file chứ không vào ảnh.
// Chỗ sửa chữ có sẵn (nền trắng che chữ cũ + chữ mới) vẽ trước, để chú thích khác nằm lên trên. boChu cũng bỏ chúng vì lõi ghi chữ thật.
const veCt = (ctx, ct, boChu = false) => {
  if (!boChu) ct?.forEach(c => { if (c.loai === "sua-dong") veSuaDong(ctx, c); });
  ct?.forEach(c => { if (c.loai !== "sua-dong" && !(boChu && c.loai === "hop-chu")) veMot1(ctx, c); });
};

// Đầu trang, chân trang, số trang, dấu mờ áp cho cả tài liệu. i tính từ 0.
function veTrinhBay(ctx, tb, i, n, w, h) {
  if (!tb) return;
  ctx.save();
  ctx.fillStyle = "#17302a";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `10px ${PHONG_CT}`;
  if (tb.dau) ctx.fillText(tb.dau, w / 2, 22);
  if (tb.chan) ctx.fillText(tb.chan, w / 2, h - 22);
  if (tb.so) {
    ctx.textAlign = tb.so;
    ctx.fillText(`Trang ${i + 1} / ${n}`, tb.so === "right" ? w - 36 : tb.so === "left" ? 36 : w / 2, h - (tb.chan ? 36 : 22));
  }
  if (tb.mo) {
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-Math.PI / 4);
    ctx.globalAlpha = 0.12;
    ctx.textAlign = "center";
    ctx.font = `700 ${Math.min(72, w * 1.1 / Math.max(tb.mo.length * 0.62, 1))}px ${PHONG_CT}`;
    ctx.fillText(tb.mo, 0, 0);
  }
  ctx.restore();
}

// Lớp chú thích của một trang thành ảnh PNG trong suốt, để máy chủ đóng lên trang lúc lưu.
function lopPng(v, t, i) {
  const cv = document.createElement("canvas"), ctx = cv.getContext("2d");
  cv.width = Math.round(t.w * DO_NET_LOP);
  cv.height = Math.round(t.h * DO_NET_LOP);
  ctx.scale(DO_NET_LOP, DO_NET_LOP);
  veCt(ctx, t.m.ct, true);
  veTrinhBay(ctx, v.tb, i, v.trang.length, t.w, t.h);
  return new Promise(xong => xong(cv.toDataURL("image/png").split(",")[1]));
}

// Danh sách trang gửi máy chủ để ghi file. Trang không có chú thích thì không tạo ảnh.
async function gomTrang(v, loc = () => true, duong) {
  const ra = [];
  for (const [i, t] of v.trang.entries()) {
    if (!loc(t.m)) continue;
    const ct = t.m.ct || [];
    ra.push({duong: duong || t.m.duong, so: t.m.so, xoay: t.m.xoay || 0,
      anh: ct.some(c => c.loai !== "hop-chu" && c.loai !== "sua-dong") || v.tb ? await lopPng(v, t, i) : null,
      ghi_chu: ct.filter(c => c.loai === "ghi-chu").map(c => ({x: c.x, y: c.y, chu: c.chu})),
      chu: ct.filter(c => c.loai === "hop-chu" && c.chu.trim()).map(mucHc), xoa_chu: t.m.chuCu || [],
      sua_dong: ct.filter(c => c.loai === "sua-dong" && !c.an).map(c => ({dong_id: c.dong_id, chu_moi: c.chu, thuoc_tinh: c.tt}))});
  }
  return ra;
}

// ---------- Xoay trang kéo theo chú thích ----------

function xoayCt(ct, cw, w, h) {
  const moi = cw ? ([x, y]) => [h - y, x] : ([x, y]) => [y, w - x];
  for (const c of ct || []) {
    if (c.d) c.d = c.d.map(moi);
    if (c.khung) c.khung = c.khung.map(([x, y, kw, kh]) => {
      const [a, b] = moi([x, y]), [e, f] = moi([x + kw, y + kh]);
      return [Math.min(a, e), Math.min(b, f), Math.abs(e - a), Math.abs(f - b)];
    });
    if (c.loai === "hop-chu") {  // chữ vẫn đứng thẳng, nên xoay cả khung rồi lấy góc trên-trái mới
      const k = khungHc(c), [a, b] = moi([k.x, k.y]), [e, f] = moi([k.x + k.w, k.y + k.h]);
      [c.x, c.y] = [Math.min(a, e), Math.min(b, f)];
    } else if (c.x !== undefined) [c.x, c.y] = moi([c.x, c.y]);
  }
}

// ---------- Thêm, bỏ chú thích ----------

function daDoiCt(v) {
  if (v === xvPdf) pt.doi = true; else tt.pdfDaLuu = false;
  capNhatRibbon();
}

function themCt(v, t, c) {
  lichCt.push({v, t, ct: [...t.m.ct]});
  t.m.ct.push(c);
  v.veLop(t);
  daDoiCt(v);
}

function hoanTacCt() {
  const x = lichCt.pop();
  if (!x) return false;
  boChonHc(true);
  huySuaChu();
  chonNet = x.chonI !== undefined && x.ct[x.chonI] ? {v: x.v, t: x.t, c: x.ct[x.chonI]} : null;  // hoàn tác đổi thuộc tính vẫn giữ nét đang chọn
  x.t.m.ct = x.ct;
  x.v.veLop(x.t);
  daDoiCt(x.v);
  return true;
}

function xoaHetCt() {
  const v = xv();
  if (!confirm("Xóa hết chú thích trên mọi trang của file này?")) return;
  for (const t of v.trang) {
    if (t.m.ct?.length) lichCt.push({v, t, ct: t.m.ct});
    t.m.ct = [];
    v.veLop(t);
  }
  daDoiCt(v);
}

// Chú thích trên cùng tại điểm bấm, dùng cho công cụ Tẩy.
function ctTai(ct, x, y) {
  const trong = (a, b, c, d) => x >= a - 4 && x <= c + 4 && y >= b - 4 && y <= d + 4;
  for (let i = ct.length - 1; i >= 0; i--) {
    const c = ct[i];
    const trung = c.khung ? c.khung.some(([a, b, w, h]) => trong(a, b, a + w, b + h))
      : c.d ? trong(Math.min(...c.d.map(p => p[0])), Math.min(...c.d.map(p => p[1])), Math.max(...c.d.map(p => p[0])), Math.max(...c.d.map(p => p[1])))
      : c.loai === "hop-chu" ? (k => trong(k.x, k.y, k.x + k.w, k.y + k.h))(khungHc(c))
      : trong(c.x, c.y, c.x + CO_DAU_GHI_CHU, c.y + CO_CHU * 1.3);
    if (trung) return i;
  }
  return -1;
}

// Ô gõ chữ ngay trên trang cho Hộp chữ và Ghi chú.
function moNhapChu(v, t, x, y, loai) {
  document.querySelector(".o-nhap")?.remove();
  const o = document.createElement("textarea");
  o.className = "o-nhap";
  o.placeholder = loai === "ghi-chu" ? "Gõ ghi chú" : "Gõ chữ";
  o.style.left = `${x * v.daVe}px`;
  o.style.top = `${y * v.daVe}px`;
  o.onpointerdown = e => e.stopPropagation();
  let xong = false;
  const chot = luu => {
    if (xong) return;
    xong = true;
    const chu = o.value.trim();
    o.remove();
    if (luu && chu) themCt(v, t, loai === "ghi-chu" ? {loai, x, y, chu} : {loai, x, y, chu, mau: mauCt});
  };
  o.onblur = () => chot(true);
  o.onkeydown = e => {
    e.stopPropagation();
    if (e.key === "Escape") chot(false);
    else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); chot(true); }
  };
  t.o.append(o);
  o.focus();
}

// Biến đoạn chữ đang bôi đen thành tô sáng, gạch chân hoặc gạch ngang.
function danhDauChu(v, dau, loai) {
  const chon = getSelection();
  if (chon.isCollapsed) return;
  const t = v.trang[+dau.dataset.trang - 1], g = dau.getBoundingClientRect();
  const khung = [...chon.getRangeAt(0).getClientRects()]
    .filter(r => r.width > 0.5 && r.height > 0.5 && r.top < g.bottom && r.bottom > g.top)
    .map(r => [(r.left - g.left) / v.daVe, (r.top - g.top) / v.daVe, r.width / v.daVe, r.height / v.daVe]);
  chon.removeAllRanges();
  if (khung.length) themCt(v, t, {loai, ...thuocTinhMoi(loai), khung});
}

function datMauCt(mau) {
  mauCt = mau;
  capNhatRibbon();
}

// ---------- Hộp đầu trang, chân trang, số trang, dấu mờ ----------

function moTrinhBay() {
  const tb = xv().tb || {};
  $("tb-dau").value = tb.dau || "";
  $("tb-chan").value = tb.chan || "";
  $("tb-so").value = tb.so || "";
  $("tb-mo").value = tb.mo || "";
  $("hop-tb").showModal();
}

$("hop-tb").querySelector("form").onsubmit = e => {
  e.preventDefault();
  $("hop-tb").close();
  if (e.submitter?.value !== "ap") return;
  const v = xv(), tb = {dau: $("tb-dau").value.trim(), chan: $("tb-chan").value.trim(), so: $("tb-so").value, mo: $("tb-mo").value.trim()};
  v.tb = Object.values(tb).some(Boolean) ? tb : null;
  v.trang.forEach(t => v.veLop(t));
  daDoiCt(v);
};

$("o-mau").onchange = e => datMauCt(e.target.value);
