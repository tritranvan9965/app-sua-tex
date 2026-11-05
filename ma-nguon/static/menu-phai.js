"use strict";
// Menu chuột phải cho thanh file và trang PDF, cùng hộp cài đặt phông chữ.

// ---------- Thanh file ----------

let tepDangCat = null;  // chỉ để làm mờ file trên thanh file và xử lý thẻ đang mở sau khi dán

const lamCay = (viec, than, baoXong) => goi(viec, than).then(kq => { if (baoXong) bao(baoXong); return kq; }).catch(e => { bao(e.message, true); return null; });

function danhDauCat() {
  document.querySelectorAll(".nut-tep").forEach(b => b.classList.toggle("dang-cat", b.dataset.duong === tepDangCat));
}

async function chepTep(duong, cat) {
  if (!await lamCay("/api/chep-tep", {duong, cat}, cat ? "Đã cắt file. Bấm Dán ở thư mục cần chuyển đến." : "Đã sao chép file")) return;
  tepDangCat = cat ? duong : null;
  danhDauCat();
}

async function danTep(duong) {
  const cu = tepDangCat && the.ds.find(t => t.duong === tepDangCat);
  if (cu && theChuaLuu(cu)) return bao(`${cu.ten} có thay đổi chưa lưu. Lưu file đó trước khi chuyển.`, true);
  const kq = await lamCay("/api/dan-tep", {duong});
  if (!kq) return;
  if (kq.cat) {
    tepDangCat = null;
    for (const {cu: a, moi} of kq.doi) {
      const t = the.ds.find(x => x.duong === a);
      if (t) await dongThe(t, false).then(() => (t.loai === "pdf" ? moFilePdf(moi) : moTep(moi)));
    }
  }
  await lamMoiCay();
  bao(kq.doi.length ? `Đã dán ${kq.doi.length} mục` : "File đã ở đúng thư mục này");
}

async function xoaTep(duong) {
  const ten = tenFile(duong), t = the.ds.find(x => x.duong === duong);
  const them = t && theChuaLuu(t) ? " File đang có thay đổi chưa lưu, các thay đổi đó sẽ mất." : "";
  if (!confirm(`Chuyển ${ten} vào Thùng rác?${them}`)) return;
  if (!await lamCay("/api/xoa-tep", {duong})) return;
  if (t) await dongThe(t, false);
  if (tepDangCat === duong) tepDangCat = null;
  await lamMoiCay();
  bao(`Đã chuyển ${ten} vào Thùng rác`);
}

// Sửa tên ngay trên thanh file. Enter để đổi, Esc để thôi, bấm ra ngoài cũng là đổi như File Explorer.
function batDoiTen(nut) {
  const duong = nut.dataset.duong, ten = tenFile(duong), chu = nut.querySelector("span:last-child");
  const o = document.createElement("input");
  o.className = "o-doi-ten";
  o.value = ten;
  o.setAttribute("aria-label", `Tên mới của ${ten}`);
  chu.replaceWith(o);
  o.focus();
  o.setSelectionRange(0, ten.lastIndexOf(".") > 0 ? ten.lastIndexOf(".") : ten.length);
  let xong = false;
  const ket = async luu => {
    if (xong) return;
    xong = true;
    const moi = o.value.trim();
    if (luu && moi && moi !== ten) await doiTenTep(duong, moi);
    o.replaceWith(chu);
    await lamMoiCay();
  };
  o.onclick = e => e.stopPropagation();
  o.onkeydown = e => {
    e.stopPropagation();
    if (e.key === "Enter") ket(true);
    else if (e.key === "Escape") ket(false);
  };
  o.onblur = () => ket(true);
}

async function doiTenTep(duong, ten) {
  const t = the.ds.find(x => x.duong === duong);
  if (t?.loai === "pdf" && theChuaLuu(t)) return bao(`${t.ten} có thay đổi chưa lưu. Lưu trước khi đổi tên.`, true);
  const kq = await lamCay("/api/doi-ten", {duong, ten});
  if (!kq) return;
  bao(`Đã đổi tên thành ${kq.ten}`);
  if (!t) return;
  if (t.loai === "pdf") return dongThe(t, false).then(() => moFilePdf(kq.duong));
  // Thẻ .tex giữ nguyên nội dung và lịch sử hoàn tác, chỉ đổi đường dẫn.
  t.duong = kq.duong;
  t.ten = kq.ten;
  const tep = t === the.hien ? tt.tep : t.s?.tep;
  if (tep) Object.assign(tep, {duong: kq.duong, ten: kq.ten});
  if (t === the.hien) $("ten-tep").textContent = kq.ten;
  veThe();
  capNhatRibbon();
}

function menuTep(nut, x, y) {
  const duong = nut.dataset.duong;
  moMenu(null, [
    {ten: "Sao chép", phim: "Ctrl+C", lam: () => chepTep(duong, false)},
    {ten: "Cắt", phim: "Ctrl+X", lam: () => chepTep(duong, true)},
    {ten: "Dán", phim: "Ctrl+V", lam: () => danTep(duong)},
    null,
    {ten: "Đổi tên", phim: "F2", lam: () => batDoiTen(nut)},
    {ten: "Xóa", phim: "Delete", nguy: true, lam: () => xoaTep(duong)},
    null,
    {ten: "Hiện trong File Explorer", lam: () => lamCay("/api/hien-tep", {duong})},
    {ten: "Sao chép đường dẫn", lam: () => lamCay("/api/chep-duong", {duong}, "Đã sao chép đường dẫn")},
  ], [x, y]);
}

function menuThuMuc(duong, x, y) {
  moMenu(null, [
    {ten: "Dán vào đây", lam: () => danTep(duong)},
    null,
    {ten: "Hiện trong File Explorer", lam: () => lamCay("/api/hien-tep", {duong})},
    {ten: "Sao chép đường dẫn", lam: () => lamCay("/api/chep-duong", {duong}, "Đã sao chép đường dẫn")},
  ], [x, y]);
}

$("cay").addEventListener("contextmenu", e => {
  const nut = e.target.closest(".nut-tep"), tm = e.target.closest("details");
  if (e.target.closest(".o-doi-ten") || (!nut && !tm)) return;
  e.preventDefault();
  anGoiY();
  if (nut) { nut.focus(); menuTep(nut, e.clientX, e.clientY); }
  else menuThuMuc(tm.dataset.duong, e.clientX, e.clientY);
});

$("cay").addEventListener("keydown", e => {
  const nut = e.target.closest(".nut-tep");
  if (!nut || e.target.closest(".o-doi-ten")) return;
  const duong = nut.dataset.duong, c = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  const lam = e.key === "F2" ? () => batDoiTen(nut) : e.key === "Delete" ? () => xoaTep(duong)
    : c && k === "c" ? () => chepTep(duong, false) : c && k === "x" ? () => chepTep(duong, true) : c && k === "v" ? () => danTep(duong) : null;
  if (lam) { e.preventDefault(); lam(); }
});

// ---------- Trang PDF ----------

// PDF biên dịch thì thao tác đổi trang phải đi qua thẻ Tách, gộp, để giữ quy tắc biên dịch lại là ghi đè.
async function trenThePdf(so, lam) {
  if (!dangPdf()) {
    await sapTrangTuBienDich();
    if (!dangPdf()) return;
  }
  const m = pt.ds.find(x => x.so === so);
  if (m) lam(m);
}

// Đang chọn nhiều trang mà bấm phải vào một trang trong nhóm đã chọn thì lệnh áp cho cả nhóm, chữ trong menu ghi rõ số trang.
function menuTrang(v, t, x, y) {
  const pdf = v === xvPdf, chonChu = String(getSelection()).trim(), so = t.m.so, m = t.m;
  const chon = pdf ? pt.ds.filter(c => c.chon) : [], nhom = m.chon && chon.length > 1 ? chon : [m], nhieu = nhom.length > 1;
  const cua = nhieu ? `${nhom.length} trang đã chọn` : `trang ${v.trang.indexOf(t) + 1}`;
  const doi = lam => (pdf ? lam(nhom) : trenThePdf(so, c => lam([c])));
  moMenu(null, [
    ...(chonChu ? [{ten: "Sao chép chữ", phim: "Ctrl+C", lam: () => document.execCommand("copy")}, null] : []),
    {ten: `Xuất ${cua} ra ảnh`, lam: () => (nhieu ? xuatAnh() : xuatAnh(t))},
    ...(pdf ? [{ten: `Tách ${cua} thành PDF`, lam: () => luuTrang(true, undefined, c => nhom.includes(c))}] : []),
    null,
    {ten: `Xoay trái ${cua}`, lam: () => doi(c => xoayTrang(false, c))},
    {ten: `Xoay phải ${cua}`, lam: () => doi(c => xoayTrang(true, c))},
    {ten: `Nhân bản ${cua}`, lam: () => doi(c => nhanBanTrang(c))},
    {ten: `Thêm trang trắng sau trang ${v.trang.indexOf(t) + 1}`, lam: () => (pdf ? themTrangTrong(m) : trenThePdf(so, c => themTrangTrong(c)))},
    null,
    {ten: `Xóa ${cua}`, nguy: true, lam: () => doi(c => boTrang(c))},
  ], [x, y]);
}

for (const v of [xvTex, xvPdf]) {
  v.o.addEventListener("contextmenu", e => {
    const dau = e.target.closest(".to-trang");
    if (!dau || e.target.closest(".o-nhap")) return;
    e.preventDefault();
    anGoiY();
    menuTrang(v, v.trang[+dau.dataset.trang - 1], e.clientX, e.clientY);
  });
}

$("ds-trang").addEventListener("contextmenu", e => {
  const o = e.target.closest(".o-trang"), m = o && pt.ds.find(x => x.id === +o.dataset.id), t = m && xvPdf.trang.find(x => x.m === m);
  if (!t) return;
  e.preventDefault();
  anGoiY();
  menuTrang(xvPdf, t, e.clientX, e.clientY);
});

// ---------- Hộp phông chữ ----------

const MAC_DINH_PHONG = {code: "Consolas", ui: "Be Vietnam Pro"};
let daNapPhong = false, bcTruoc = null;

function dienPhong(ds = []) {
  for (const [id, gia, mac] of [["ph-code", bc.phongCode, MAC_DINH_PHONG.code], ["ph-ui", bc.phongUi, MAC_DINH_PHONG.ui]]) {
    const o = $(id), cac = [...new Set([...ds, gia].filter(Boolean))].filter(t => t !== mac);
    o.replaceChildren(...[["", `${mac} (mặc định)`], ...cac.map(t => [t, t])].map(([val, chu]) => {
      const c = document.createElement("option");
      c.value = val;
      c.textContent = chu;
      if (val) c.style.fontFamily = `"${val}"`;  // tên phông viết bằng chính phông đó
      return c;
    }));
    o.value = gia || "";
  }
}

function docHopPhong() {
  $("so-inter").checked = bc.soInter !== false;
  $("co-ui").value = String(bc.coUi || 100);
  $("co-code").value = bc.co;
  $("co-ban").value = bc.coBan;
}

async function moHopPhong() {
  bcTruoc = {...bc};
  dienPhong();
  docHopPhong();
  $("hop-phong").showModal();
  if (daNapPhong) return;
  try {
    const {ds} = await goi("/api/phong");
    daNapPhong = true;
    dienPhong(ds);
  } catch (e) { bao(e.message, true); }
}

// Áp ngay để xem trước, chưa lưu; ribbon tính lại độ rộng vì chữ đổi có thể làm tràn.
function apPhong() {
  bc.phongCode = $("ph-code").value;
  bc.phongUi = $("ph-ui").value;
  bc.soInter = $("so-inter").checked;
  bc.coUi = +$("co-ui").value || 100;
  bc.co = Math.min(24, Math.max(11, +$("co-code").value || BO_CUC_GOC.co));
  bc.coBan = Math.min(18, Math.max(9, +$("co-ban").value || BO_CUC_GOC.coBan));
  apBoCuc();
  requestAnimationFrame(() => { vuaRibbon(); datTayKeo(); });
  document.fonts?.ready.then(vuaRibbon);
}

for (const id of ["ph-code", "ph-ui", "so-inter", "co-ui", "co-code", "co-ban"]) $(id).onchange = apPhong;
$("dat-lai-phong").onclick = () => {
  Object.assign(bc, {phongCode: "", phongUi: "", soInter: true, coUi: 100, co: BO_CUC_GOC.co, coBan: BO_CUC_GOC.coBan});
  dienPhong();
  docHopPhong();
  apPhong();
};
$("hop-phong").addEventListener("close", () => {
  if ($("hop-phong").returnValue === "ap") luuBoCuc();
  else if (bcTruoc) { Object.assign(bc, bcTruoc); apBoCuc(); requestAnimationFrame(() => { vuaRibbon(); datTayKeo(); }); }
  bcTruoc = null;
  $("hop-phong").returnValue = "";
});
