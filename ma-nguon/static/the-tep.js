"use strict";
// Mở nhiều file cùng lúc: mỗi file một thẻ. Màn hình chỉ hiện một thẻ, các thẻ khác giữ trạng thái trong t.s,
// nên đổi thẻ không mất nội dung chưa lưu, lịch sử hoàn tác hay chú thích trên PDF.

const the = {ds: [], hien: null, so: 0};
let daBaoChuaLuu = false;

const theChuaLuu = t => (t === the.hien ? (t.loai === "pdf" ? pt.doi : !!coThayDoi())
  : t.loai === "pdf" ? t.s.doi : !!t.s && t.s.doc.getValue() !== t.s.chuGoc);
const coTheChuaLuu = () => the.ds.some(theChuaLuu);

function veThe() {
  const o = $("the-tep");
  o.hidden = !the.ds.length;
  o.replaceChildren(...the.ds.map(t => {
    const d = document.createElement("div"), b = document.createElement("button"), x = document.createElement("button"), c = document.createElement("span");
    d.className = "the";
    d.setAttribute("role", "presentation");
    b.type = x.type = "button";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", t === the.hien);
    b.title = t.duong;
    c.textContent = t.ten;
    c.classList.toggle("chua-luu-ten", theChuaLuu(t));
    b.append(nhanLoaiTep(t.loai === "pdf" ? ".pdf" : t.duong), c);
    b.onclick = () => chonThe(t);
    x.className = "dong-the";
    x.innerHTML = bieuTuong("dong");
    x.dataset.ten = "Đóng file này";
    x.setAttribute("aria-label", `Đóng ${t.ten}`);
    x.onclick = () => dongThe(t);
    d.onauxclick = e => { if (e.button === 1) dongThe(t); };
    d.append(b, x);
    t.o = c;
    return d;
  }));
  danhDauCay();
  apBoCuc();
}

// Mỗi lần trạng thái đổi: cập nhật chữ nghiêng trên thẻ và báo máy chủ để lúc đóng cửa sổ còn biết mà hỏi.
function capNhatThe() {
  for (const t of the.ds) t.o?.classList.toggle("chua-luu-ten", theChuaLuu(t));
  const doi = coTheChuaLuu();
  if (doi !== daBaoChuaLuu) { daBaoChuaLuu = doi; goi("/api/chua-luu", {co: doi}).catch(() => {}); }
}

function danhDauCay() {
  const duong = the.hien?.duong;
  document.querySelectorAll(".nut-tep").forEach(b => b.setAttribute("aria-current", b.dataset.duong === duong));
  danhDauCat();
}

// Cất trạng thái thẻ đang hiện trước khi rời khỏi nó. Có thể gọi lại sau khi đã đổi dự án, khi đó tt.ban là của dự án kia.
function luuThe() {
  const t = the.hien;
  if (!t) return;
  if (t.loai === "tex") {
    chotDong();
    t.s = {tep: tt.tep, chuGoc: tt.chuGoc, doc: soan.getDoc(), pdf: tt.pdf, trangBai: tt.trangBai, mocPdf: tt.mocPdf, pdfDaLuu: tt.pdfDaLuu,
      ban: t.goc === gocHien ? tt.ban : t.s?.ban ?? tt.ban, trang: xvTex.trang.map(x => x.m), tb: xvTex.tb, trangXem: xvTex.hien, cuonDong: $("vung-dong").scrollTop};
  } else t.s = {ds: pt.ds, tep: pt.tep, xem: pt.xem, nhap: pt.nhap, doi: pt.doi, ten: pt.ten, nguon: pt.nguon, thuMuc: pt.thuMuc, tb: xvPdf.tb};
}

// Phải tính lại bố cục ngay sau khi thoát chế độ PDF: hai chế độ có số cột khác nhau, sai cột là các vùng đè lên nhau.
function thoatPdf() {
  document.body.classList.remove("che-do-pdf");
  if (tabHienTai === "trang") chuyenTab("chu");
  apBoCuc();
}

async function hienTheTex(t) {
  const s = t.s;
  thoatPdf();
  if (t.goc !== gocHien) await doiDuAn(t.goc);
  if (t !== the.hien) return;  // người dùng đã bấm sang thẻ khác trong lúc đổi dự án
  Object.assign(tt, {tep: s.tep, chuGoc: s.chuGoc, pdf: s.pdf, trangBai: s.trangBai, mocPdf: s.mocPdf, pdfDaLuu: s.pdfDaLuu, ban: s.ban, hienTai: null, dangSua: null});
  khoaDong = null;
  datDauBan(s.ban);
  soan.swapDoc(s.doc);
  $("tim").value = "";
  $("mo-dau").hidden = true;
  $("ten-tep").textContent = s.tep.ten;
  $("cd-nhom").hidden = $("chon-ban").hidden = !s.tep.la_tex;
  apDungCheDo();
  xvTex.tb = s.tb;
  tt.cuonDen = s.cuonDong || 0;  // nội dung cũ còn trên màn hình, cuộn ngay bây giờ sẽ bị giới hạn theo độ dài của nó
  capNhat();
  tt.soLanPdf++;  // bỏ lần nạp PDF của thẻ trước nếu còn dở
  if (!s.pdf) return napPdf();
  await xvTex.mo(s.trang);
  if (t === the.hien) xvTex.den(s.trangXem);
}

async function hienThePdf(t) {
  const s = t.s;
  Object.assign(pt, {ds: s.ds, tep: s.tep, xem: s.xem, nhap: s.nhap, doi: s.doi, ten: s.ten, nguon: s.nguon, thuMuc: s.thuMuc});
  xvPdf.tb = s.tb;
  vaoPdf();
  veDsTrang();
  await xvPdf.sanSang;
  if (pt.xem && t === the.hien) xemTrang(pt.xem);
}

async function chonThe(t) {
  if (t === the.hien) return;
  luuThe();
  the.hien = t;
  veThe();
  try {
    await (t.loai === "pdf" ? hienThePdf(t) : hienTheTex(t));
  } catch (e) { bao(e.message, true); }
  capNhatRibbon();
}

// Màn hình bắt đầu: file và thư mục mở gần đây, bấm để mở lại.
async function veGanDay() {
  let ds;
  try { ds = (await goi("/api/gan-day")).ds.filter(x => !/\.json$/i.test(x.duong)); } catch { return; }
  $("gan-day").hidden = !ds.length;
  $("ds-gan-day").replaceChildren(...ds.map(x => {
    const li = document.createElement("li"), b = document.createElement("button"), ten = document.createElement("span"), duong = document.createElement("span");
    b.type = "button";
    ten.className = "ten";
    ten.textContent = x.ten;
    duong.className = "duong";
    duong.textContent = x.thu_muc;
    duong.title = x.duong;
    b.title = x.duong;
    b.insertAdjacentHTML("afterbegin", x.loai === "thu_muc" ? bieuTuong("thu-muc") : "");
    if (x.loai !== "thu_muc") b.prepend(nhanLoaiTep(x.duong));
    b.append(ten, duong);
    b.onclick = () => moTuNgoai(x.duong);
    li.append(b);
    return li;
  }));
}

// Không còn thẻ nào thì trở về màn hình trống.
function xoaManHinh() {
  veGanDay();
  thoatPdf();
  Object.assign(pt, {ds: [], tep: new Map(), xem: null, nhap: false, doi: false, ten: "", nguon: null});
  xvPdf.xoa();
  xvPdf.tb = null;
  $("ds-trang").replaceChildren();
  $("xem-trang").replaceChildren();
  boTepTex();
  $("mo-dau").hidden = false;
  capNhat();
}

function boTepTex() {
  Object.assign(tt, {tep: null, chuGoc: "", pdf: null, hienTai: null, dangSua: null, pdfDaLuu: false});
  soan.swapDoc(CodeMirror.Doc("", "stex"));
  $("ten-tep").textContent = "Chưa mở file";
  $("cd-nhom").hidden = $("chon-ban").hidden = true;
  apDungCheDo();
  thongBaoPdf("Mở một file .tex để xem PDF.");
}

async function dongThe(t, hoi = true) {
  if (hoi && theChuaLuu(t) && !confirm(`${t.ten} có thay đổi chưa lưu. Bỏ các thay đổi đó?`)) return;
  const i = the.ds.indexOf(t);
  the.ds.splice(i, 1);
  if (t !== the.hien) {
    // Thẻ PDF đang hiện vẫn giữ tt của file .tex cuối cùng, đóng file đó thì phải xoá theo.
    if (t.loai === "tex" && tt.tep === t.s?.tep) boTepTex();
    return veThe();
  }
  const sau = the.ds[i] || the.ds[i - 1];
  the.hien = null;
  if (sau) return chonThe(sau);
  xoaManHinh();
  veThe();
  capNhatRibbon();
}

const dongTheHien = () => the.hien && dongThe(the.hien);

// Thẻ mới cho một hay nhiều file PDF. khoa để bấm Tách, gộp lần nữa thì về thẻ cũ thay vì mở thêm.
async function moThePdf(tep, khoa) {
  luuThe();
  const t = {ma: ++the.so, loai: "pdf", duong: khoa || tep[0].duong, ten: tep[0].ten, s: null};
  Object.assign(pt, {ds: [], tep: new Map(), xem: null, nhap: false, doi: false, nguon: null, thuMuc: null});
  xvPdf.tb = null;
  xvPdf.xoa();
  the.ds.push(t);
  the.hien = t;
  await nhanTep(tep);
  t.ten = pt.ten;
  veThe();
  return t;
}

// Ctrl+Tab nhảy sang thẻ kế tiếp.
function theKeTiep(buoc) {
  const n = the.ds.length;
  if (n > 1) chonThe(the.ds[(the.ds.indexOf(the.hien) + buoc + n) % n]);
}

addEventListener("DOMContentLoaded", veGanDay);
addEventListener("beforeunload", e => { if (coTheChuaLuu()) e.preventDefault(); });
addEventListener("keydown", e => {
  const c = e.ctrlKey || e.metaKey;
  if (c && e.key.toLowerCase() === "w") { e.preventDefault(); dongTheHien(); }
  if (c && e.key === "Tab") { e.preventDefault(); theKeTiep(e.shiftKey ? -1 : 1); }
});
