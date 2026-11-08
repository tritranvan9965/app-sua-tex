"use strict";
const $ = id => document.getElementById(id);
pdfjsLib.GlobalWorkerOptions.workerSrc = "/static/vendor/pdfjs/pdf.worker.min.js";

// Đặt theo dự án đang mở (napDuAn).
let DAU = "", MAU_ID = null, LOI_GIAI = "\\loigiai{", MAU_PDF = "", MACRO = {}, LENH = [];
const tt = {tep: null, chuGoc: "", khoi: [], dong: [], soDongDau: 0, hienTai: null, ban: "", pdf: null, trangBai: {}, mocPdf: {}, soLanPdf: 0, daThuDich: new Set(), dangXuat: false, xuatLai: false, nhanBan: {}, dsBan: [], dangBan: false,
  cheDo: "dong", dangSua: null, viec: "", pdfDaLuu: false};

const soan = CodeMirror.fromTextArea($("o-soan"), {mode: "stex", lineNumbers: true, lineWrapping: true, tabSize: 2, autofocus: false});
$("vung-soan").hidden = true;

// ---------- Gọi máy chủ ----------

async function goi(duong, than) {
  const tuy = than ? {method: "POST", headers: {"Content-Type": "application/json", "X-App": "tritex"}, body: JSON.stringify(than)} : {};
  const tl = await fetch(duong, tuy);
  const kq = await tl.json();
  if (!tl.ok) throw new Error(kq.loi || "Không làm được việc này.");
  return kq;
}

let henBao;
function bao(chu, loi = false) {
  const o = $("bao");
  o.textContent = chu;
  o.className = loi ? "loi" : "";
  o.hidden = false;
  clearTimeout(henBao);
  henBao = setTimeout(() => { o.hidden = true; }, loi ? 8000 : 3000);
}

// ---------- Cây thư mục ----------

// Nhớ thư mục nào đang mở rộng, vì đổi thư mục hay đóng thư mục đều tải lại trang.
const KHOA_CAY = "sua-tex-cay";
let moCay = {};
try { moCay = JSON.parse(sessionStorage.getItem(KHOA_CAY)) || {}; } catch {}

function ganMoCay(md, khoa, macDinh) {
  md.open = moCay[khoa] ?? macDinh;
  md.ontoggle = () => {
    moCay[khoa] = md.open;
    try { sessionStorage.setItem(KHOA_CAY, JSON.stringify(moCay)); } catch {}
  };
}

// Mỗi loại file một nhãn màu: PDF, TEX, mẫu (.sty, .cls), các loại khác hiện đúng đuôi file.
function nhanLoaiTep(duong) {
  const duoi = (duong.match(/\.([^.\\/]+)$/)?.[1] || "").toLowerCase();
  const s = document.createElement("span");
  s.className = `nhan-tep ${duoi === "pdf" || duoi === "tex" ? duoi : duoi === "sty" || duoi === "cls" ? "mau" : "khac"}`;
  s.textContent = duoi.toUpperCase().slice(0, 4);
  return s;
}

function dauThuMuc(ten, so) {
  const tom = document.createElement("summary"), c = document.createElement("span");
  tom.innerHTML = `${bieuTuong("tro-phai")}${bieuTuong("thu-muc")}${bieuTuong("mo")}`;
  c.className = "ten-tm";
  c.textContent = ten;
  c.title = ten;
  tom.append(c);
  if (so) {
    const d = document.createElement("span");
    d.className = "dem";
    d.textContent = so;
    tom.append(d);
  }
  return tom;
}

function veThuMuc(nut, moRong, goc) {
  const md = document.createElement("details");
  md.className = "tm";
  md.dataset.duong = nut.duong;
  ganMoCay(md, nut.duong, moRong);
  md.append(dauThuMuc(nut.ten, nut.con.length));
  if (nut.thieu || !nut.con.length) {
    const t = document.createElement("div");
    t.className = "thieu";
    t.textContent = "Chưa có file";
    md.append(t);
  } else {
    const ul = document.createElement("ul");
    nut.con.forEach(c => ul.append(veNut(c, false, goc)));
    md.append(ul);
  }
  return md;
}

function veNut(nut, moRong, goc) {
  const li = document.createElement("li");
  if (nut.thu_muc) li.append(veThuMuc(nut, moRong, goc));
  else if (nut.thieu) {
    li.innerHTML = '<div class="thieu"></div>';
    li.firstChild.textContent = `${nut.ten}: không tìm thấy file`;
  } else {
    const b = document.createElement("button"), c = document.createElement("span");
    b.className = "nut-tep";
    c.textContent = nut.ten;
    b.title = nut.ten;
    b.dataset.duong = nut.duong;
    b.append(nhanLoaiTep(nut.duong), c);
    b.onclick = () => (/\.pdf$/i.test(nut.duong) ? moFilePdf(nut.duong) : goc.duong === gocHien ? moTep(nut.duong) : doiGoc(goc, nut.duong));
    li.append(b);
  }
  return li;
}

function veGoc(goc) {
  const md = document.createElement("details"), dong = document.createElement("button");
  md.className = "goc";
  md.dataset.duong = goc.thu_muc || "";
  ganMoCay(md, `goc|${goc.duong}`, true);
  const tom = dauThuMuc(goc.ten, 0);
  dong.type = "button";
  dong.className = "dong-goc";
  dong.innerHTML = bieuTuong("dong");
  dong.dataset.ten = "Đóng thư mục này, file trên máy không đổi";
  dong.setAttribute("aria-label", `Đóng ${goc.ten}`);
  dong.onclick = e => { e.preventDefault(); dongGoc(goc); };
  tom.append(dong);
  md.append(tom);
  if (goc.thieu) {
    const t = document.createElement("div");
    t.className = "thieu";
    t.textContent = "Không tìm thấy thư mục này";
    md.append(t);
    return md;
  }
  // Mở nhanh một thư mục thì cây chỉ có đúng thư mục đó, bỏ tầng trùng tên.
  const cay = goc.cay.length === 1 && goc.cay[0].thu_muc ? goc.cay[0].con : goc.cay;
  const ul = document.createElement("ul");
  cay.forEach(n => ul.append(veNut(n, cay === goc.cay, goc)));
  md.append(ul);
  return md;
}

async function doiGoc(goc, tep) {
  try {
    luuThe();
    await doiDuAn(goc.duong);
    await moTep(tep);
  } catch (e) { bao(e.message, true); }
}

// Đóng một thư mục thì đóng luôn các file của nó đang mở.
async function dongGoc(goc) {
  const ds = the.ds.filter(t => t.goc === goc.duong);
  if (ds.some(theChuaLuu) && !confirm(`${goc.ten} có file chưa lưu. Bỏ các thay đổi đó?`)) return;
  try {
    const kq = await goi("/api/dong-goc", {duong: goc.duong});
    for (const t of ds) await dongThe(t, false);
    if (kq.doi) await napCauHinh();
    else $("cay").querySelector(`[data-goc="${CSS.escape(goc.duong)}"]`)?.remove();
  } catch (e) { bao(e.message, true); }
}

let gocHien = null;  // thư mục đang là dự án hoạt động trên máy chủ

const thoatRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function datCauHinh(da) {
  const {moi_truong: ten, nhan, loi_giai} = da.cau;
  DAU = ten ? `\\begin{${ten}}` : "";
  MAU_ID = nhan ? new RegExp(`^${thoatRegex(nhan)}([^ |\\n]+)`) : null;
  LOI_GIAI = `\\${loi_giai}{`;
  MAU_PDF = da.cau.mau_pdf;
  MACRO = {...MACRO_CHUNG, ...da.xem_nhanh.macro};
  LENH = [...da.xem_nhanh.lenh, ...LENH_CHUNG];
  boNhoVe.clear();
  tt.ban = da.ban[0] || "";
  tt.nhanBan = da.nhan_ban || {};
  tt.dsBan = da.ban;
  // Hai bản thì là một dấu tích: tích là bản đầu (có đáp án), bỏ tích là bản sau. Nhiều bản hơn thì mới cần nút riêng cho từng bản.
  const hop = $("chon-ban"), tich = da.ban.length === 2;
  hop.className = tich ? "" : "chon-ban";
  if (tich) {
    const b = document.createElement("button");
    b.type = "button";
    b.id = "tich-ban";
    b.className = "nut-dau";
    b.innerHTML = `${bieuTuong("o-trong")}<span class="chu-nut"></span>`;
    b.dataset.chu = "x";
    b.onclick = () => chonBan(da.ban[tt.ban === da.ban[0] ? 1 : 0]);
    hop.replaceChildren(b);
  } else hop.replaceChildren(...da.ban.map(ban => {
    const b = document.createElement("button");
    b.textContent = tt.nhanBan[ban] || ban;
    b.dataset.ten = `Xem PDF bản ${ban}`;
    b.dataset.ban = ban;
    b.onclick = () => chonBan(ban);
    return b;
  }));
  datDauBan(tt.ban);
}

// Đọc lại dự án đang hoạt động trên máy chủ. Giữ bản đang chọn nếu dự án mới cũng có bản đó.
async function napCauHinh() {
  const da = await goi("/api/du-an"), ban = tt.ban;
  datCauHinh(da);
  if (tt.dsBan.includes(ban)) datDauBan(tt.ban = ban);
  document.title = `${da.ten} - TriTeX`;
  gocHien = da.goc_mo.find(g => g.dang_mo)?.duong ?? null;
  veCay(da);
  return da;
}

async function doiDuAn(duong) {
  await goi("/api/mo", {duong});
  return napCauHinh();
}

async function napDuAn() {
  const da = await napCauHinh();
  if (da.chuyen_dau) moChuyen(da.chuyen_dau);
  else if (da.gop_dau) moGop(da.gop_dau);
  else if (da.pdf_dau) moFilePdf(da.pdf_dau);
  else if (da.tep_dau) moTep(da.tep_dau);
}

// File mở từ ngoài app (bấm đúp, chuột phải) khi cửa sổ đang chạy.
async function moTuNgoai(duong) {
  try {
    if (/\.pdf$/i.test(duong)) return await moFilePdf(duong);
    const co = the.ds.find(t => t.duong.toLowerCase() === duong.toLowerCase());
    if (co) return await chonThe(co);
    luuThe();
    await goi("/api/mo", {duong});
    const da = await napCauHinh();
    if (da.tep_dau) return await moTep(da.tep_dau);
    const t = the.hien;  // mở thư mục: file đang sửa vẫn thuộc dự án của nó
    if (t?.loai === "tex" && t.goc !== gocHien) await doiDuAn(t.goc);
  } catch (e) { bao(e.message, true); }
}

function veCay(da) {
  $("cay").replaceChildren(...da.goc_mo.map(g => {
    const o = veGoc(g);
    o.dataset.goc = g.duong;
    return o;
  }));
  danhDauCay();
}

// Lưu PDF xong thì file mới hiện ngay trên thanh file.
const lamMoiCay = () => goi("/api/du-an").then(veCay).catch(() => {});

// Mở file, thư mục hay dự án khác mà không tải lại trang, để các thẻ đang mở vẫn còn nguyên.
async function moKhac(kieu) {
  try {
    const kq = await goi("/api/chon-mo", {kieu});
    if (kq.huy) return;
    if (kq.tep) return moThePdf(kq.tep);
    luuThe();
    if (kq.khong_co_hop) {
      const duong = prompt(kieu === "thu_muc" ? "Dán đường dẫn thư mục:" : "Dán đường dẫn file .tex, .pdf hoặc file dự án .json:");
      if (!duong) return;
      const sach = duong.trim().replace(/^"|"$/g, "");
      if (/\.pdf$/i.test(sach)) return themPdf([sach]);
      await goi("/api/mo", {duong: sach});
    }
    const da = await napCauHinh();
    if (da.tep_dau) return moTep(da.tep_dau);
    // Chỉ thêm thư mục vào thanh file: file đang sửa vẫn thuộc dự án của nó, nên phải về lại dự án đó để lưu đúng chỗ.
    const t = the.hien;
    if (t?.loai === "tex" && t.goc !== gocHien) await doiDuAn(t.goc);
  } catch (e) { bao(e.message, true); }
}

// ---------- Mở file ----------

const coThayDoi = () => tt.tep && ((tt.dangSua && tt.dangSua.o.value !== tt.dangSua.goc) || soan.getValue() !== tt.chuGoc);

async function moTep(duong) {
  const co = the.ds.find(t => t.loai === "tex" && t.duong === duong);
  if (co) return chonThe(co);
  let tep;
  try {
    tep = await goi(`/api/tep?duong=${encodeURIComponent(duong)}`);
  } catch (e) { return bao(e.message, true); }
  luuThe();
  const t = {ma: ++the.so, loai: "tex", duong, ten: tep.ten, goc: gocHien, s: null};
  the.ds.push(t);
  the.hien = t;
  thoatPdf();
  tt.tep = tep;
  tt.chuGoc = tep.chu;
  tt.pdfDaLuu = false;
  xvTex.tb = null;
  tt.hienTai = null;
  tt.dangSua = null;
  khoaDong = null;
  $("vung-dong").scrollTop = 0;
  $("tim").value = "";
  $("mo-dau").hidden = true;
  $("ten-tep").textContent = tep.ten;
  $("cd-nhom").hidden = $("chon-ban").hidden = !tep.la_tex;
  soan.swapDoc(CodeMirror.Doc(tep.chu, "stex"));
  apDungCheDo();
  veThe();
  capNhat();
  napPdf();
}

// ---------- Mục lục và trạng thái ----------

let chuDaTach = null, tapGoc = new Set(), chuGocDaTach = null;

function capNhat() {
  const chu = soan.getValue();
  if (chu !== chuDaTach || !tt.tep) {
    chuDaTach = chu;
    Object.assign(tt, tt.tep?.la_tex ? phanTichFile(chu) : {khoi: [], dong: [], soDongDau: 0});
    veMucLuc(chu);
  }
  capNhatTrangThai();
  veTheoDong();
  danhDauBai();
}

// Mỗi tiêu đề, lý thuyết, bài, câu là một hàng. Khối khác bản lúc mở file thì hiện màu đỏ.
function veMucLuc(chu) {
  if (tt.chuGoc !== chuGocDaTach) {
    chuGocDaTach = tt.chuGoc;
    tapGoc = new Set(tt.tep?.la_tex ? phanTichFile(tt.chuGoc).khoi.map(k => tt.chuGoc.slice(k.dau, k.cuoi)) : []);
  }
  const ds = tt.khoi.filter(k => k.loai !== "tu-do");
  if (document.body.classList.contains("khong-bai") === !!ds.length) {
    document.body.classList.toggle("khong-bai", !ds.length);
    apBoCuc();
  }
  $("ds-bai").replaceChildren(...ds.map(k => {
    const li = document.createElement("li"), b = document.createElement("button");
    const ten = k.loai === "muc" ? [k.nhan, k.ten].filter(Boolean).join(" ") : k.nhan;
    b.textContent = ten;
    b.title = k.id ? `${ten} (${k.id})` : ten;
    b.dataset.i = k.i;
    b.className = `muc-${k.loai}${k.loai === "muc" ? ` cap-${k.cap}` : ""}`;
    if (!tapGoc.has(chu.slice(k.dau, k.cuoi))) b.classList.add("da-sua");
    b.onclick = () => denKhoi(k.i);
    li.append(b);
    return li;
  }));
  tt.hienTai = null;
  $("vi-tri-bai").textContent = "";  // danhDauBai chỉ ghi lại khi có bài, không có thì phải tự xoá chữ của file trước
}

function capNhatTrangThai() {
  capNhatRibbon();
}

function baiTaiConTro() {
  const vt = soan.indexFromPos(soan.getCursor());
  let hien = null;
  for (const k of tt.khoi) {
    if (k.dau > vt) break;
    if (k.loai !== "tu-do") hien = k;
  }
  return hien;
}

function danhDauBai() {
  const c = tt.cheDo === "dong" && !tt.dangSua && !$("vung-dong").hidden ? khoiTaiCuon() : baiTaiConTro();
  if (c === tt.hienTai) return;
  tt.hienTai = c;
  document.querySelectorAll("#ds-bai button").forEach(b => {
    const dung = c && +b.dataset.i === c.i;
    b.setAttribute("aria-current", dung ? "true" : "false");
    if (dung) b.scrollIntoView({block: "nearest"});
  });
  $("vi-tri-bai").textContent = c ? [c.nhan, c.loai === "muc" ? c.ten : ""].filter(Boolean).join(" ") : "";
}

function denKhoi(i, cuon = true) {
  chotDong();
  const c = tt.khoi[i];
  if (!c) return;
  const vi = soan.posFromIndex(c.dau);
  soan.setCursor(vi);
  capNhat();
  if (tt.cheDo === "code") {
    soan.scrollIntoView({from: vi, to: soan.posFromIndex(c.cuoi)}, 80);
    soan.focus();
  } else {
    if ($("tim").value.trim()) { $("tim").value = ""; veTheoDong(true); }
    veKhoi(c);
    $("vung-dong").scrollTop = c.o.offsetTop - 6;
  }
  if (cuon) cuonPdf(c);
}

// ---------- Vẽ công thức bằng KaTeX cho Theo dòng ----------

const THOAT = {"&": "&amp;", "<": "&lt;", ">": "&gt;"};
const thoat = s => s.replace(/[&<>]/g, k => THOAT[k]);

// Chữ định dạng có thể chứa công thức, nên đổi sang dấu riêng trước khi tách công thức, rồi mới đổi thành thẻ HTML.
const THE_CHU = {"\uE000": "<b>", "\uE001": "</b>", "\uE002": "<i>", "\uE003": "</i>", "\uE004": "<u>", "\uE005": "</u>"};
const LENH_DINH_DANG = [["textbf", "\uE000", "\uE001"], ["textit", "\uE002", "\uE003"], ["emph", "\uE002", "\uE003"], ["underline", "\uE004", "\uE005"]];

function veChu(s) {
  return thoat(s)
    .replace(/(^|[^\\])%.*$/gm, "$1")
    .replace(/(\d+)/g, (_, n) => anhCho[n] ?? "")  // lệnh ảnh đã được anhThayCho đổi thành dấu riêng
    .replace(/\\includegraphics(?:\[[^\]]*\])?\{([^}]*)\}/g,'<span class="hinh">[Hình: $1]</span>')
    .replace(/\\(?:sub)*section\*?\{([^{}]*)\}/g, "<b>$1</b>")
    .replace(/\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/g, '<span class="hinh">[Hình vẽ TikZ, xem ở PDF]</span>')
    .replace(/\\begin\{tabular\}[\s\S]*?\\end\{tabular\}/g, '<span class="hinh">[Bảng, xem ở PDF]</span>')
    .replace(/\\par\b/g, "<br>")
    .replace(/\\(?:begin|end)\{[^}]*\}(\[[^\]]*\])?/g, "")
    .replace(/\\item\b/g, "<br>• ")
    .replace(/\\\\/g, "<br>")
    .replace(/\n{2,}/g, "<br>")
    .replace(/\\input\{([^}]*)\}/g, '<span class="hinh">[Chèn file: $1]</span>')
    .replace(/\\([%&#_{}$])/g, "$1")
    .replace(/\\[ ,;:!]|~/g, " ")
    .replace(/ --- | -- /g, " – ")
    .replace(/[\uE000-\uE005]/g, k => THE_CHU[k]);
}

function dongNgoac(s, d) {
  let sau = 0;
  for (let i = d; i < s.length; i++) {
    if (s[i] === "\\") i++;
    else if (s[i] === "{") sau++;
    else if (s[i] === "}" && --sau === 0) return i;
  }
  return -1;
}

// Bung các lệnh riêng của dự án có đối số chứa công thức, trước khi tách công thức ra.
function moLenh(s, ten, soNhom, ra) {
  const mau = new RegExp(`\\\\${ten}(?=\\s*\\{)`);
  for (;;) {
    const m = s.match(mau);
    if (!m) return s;
    const nhom = [];
    let vt = m.index + m[0].length;
    for (let i = 0; i < soNhom; i++) {
      const d = s.indexOf("{", vt), c = d < 0 ? -1 : dongNgoac(s, d);
      if (c < 0) return s;
      nhom.push(s.slice(d + 1, c));
      vt = c + 1;
    }
    s = s.slice(0, m.index) + ra(nhom) + s.slice(vt);
  }
}

// Lệnh quen thuộc, dùng khi file dự án không khai cách hiện riêng.
const MACRO_CHUNG = {"\\heva": "\\left\\{\\begin{aligned}#1\\end{aligned}\\right.", "\\hoac": "\\left[\\begin{aligned}#1\\end{aligned}\\right."};
const LENH_CHUNG = [{ten: "dung", so_doi: 1, ra: "#1"}, {ten: "chuaro", so_doi: 1, ra: "#1"}, {ten: "dapso", so_doi: 1, ra: "\\\\Đáp số: #1"}, {ten: "hinhgoc", so_doi: 2, ra: "\\includegraphics{#1}"},
  {ten: "hinh", so_doi: 1, ra: "\\includegraphics{#1}"}, {ten: "hinhphai", so_doi: 2, ra: "#2 \\includegraphics{#1}"}, {ten: "hinhtrai", so_doi: 2, ra: "\\includegraphics{#1} #2"}];

function moLenhRieng(s) {
  s = s.replace(/\\True(?![a-zA-Z])\s*/g, "");
  for (const {ten, so_doi, ra} of LENH)
    for (const t of [ten].flat())
      s = moLenh(s, t, so_doi, n => ra.replace(/#(\d)/g, (_, k) => n[k - 1]));
  for (const [ten, mo, dong] of LENH_DINH_DANG) s = moLenh(s, ten, 1, n => mo + n[0] + dong);
  return s;
}

function veCongThuc(tex, hien) {
  return katex.renderToString(tex, {displayMode: hien, throwOnError: false, strict: false, macros: {...MACRO}});
}

function veNoiDung(s) {
  return moLenhRieng(anhThayCho(s)).split(/(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\begin\{(?:align|gather|equation)\*?\}[\s\S]*?\\end\{(?:align|gather|equation)\*?\}|\$(?:\\.|[^$\\])+\$)/).map((ph, i) => {
    if (i % 2 === 0) return veChu(ph);
    const hien = !ph.startsWith("$") || ph.startsWith("$$");
    const tex = ph.startsWith("\\begin") ? ph : ph.startsWith("$$") || !ph.startsWith("$") ? ph.slice(2, -2) : ph.slice(1, -1);
    return veCongThuc(tex, hien);
  }).join("");
}

// ---------- PDF ----------

function thongBaoPdf(chu) {
  const p = document.createElement("p");
  p.className = "trong";
  p.textContent = chu;
  xvTex.xoa();
  $("xem-pdf").replaceChildren(p);
}

// giuCuon: sau khi biên dịch lại thì giữ nguyên chỗ đang xem, trừ khi bài đang sửa nằm ngoài khung nhìn.
async function napPdf(giuCuon = false, tuDich = false) {
  const lan = ++tt.soLanPdf;
  tt.pdf = null;
  capNhatRibbon();
  tt.trangBai = {};
  tt.mocPdf = {};
  if (!tt.tep) return thongBaoPdf("Mở một file .tex để xem PDF.");
  if (!tt.tep.la_tex) return thongBaoPdf("Chỉ file .tex mới có PDF.");
  const ten = tt.ban ? ` bản ${tt.ban}` : "";
  const tl = await fetch(`/api/pdf?duong=${encodeURIComponent(tt.tep.duong)}&ban=${tt.ban}&t=${Date.now()}`);
  if (lan !== tt.soLanPdf) return;
  // Đổi bản PDF: bản đó chưa có hoặc cũ hơn file thì tự biên dịch. Mở file thì không, chỉ biên dịch khi người dùng bấm.
  // Mỗi nội dung chỉ thử một lần để lỗi LaTeX không lặp mãi.
  const khoa = `${tt.tep.duong}|${tt.tep.phien}|${tt.ban}`;
  if (tuDich && (!tl.ok || tl.headers.get("X-Pdf-Cu")) && !tt.daThuDich.has(khoa) && !coThayDoi()) {
    tt.daThuDich.add(khoa);
    if (!tl.ok) thongBaoPdf(`Đang biên dịch PDF${ten}...`);
    bienDich(true);
  }
  if (!tl.ok) {
    if (!tt.dangXuat) thongBaoPdf(`Chưa có PDF${ten}. Bấm Chạy thử (F5) để tạo.`);
    return;
  }
  let doc;
  try {
    doc = await pdfjsLib.getDocument({data: await tl.arrayBuffer()}).promise;
  } catch { return thongBaoPdf(`Không đọc được file PDF${ten}. Bấm Chạy thử (F5) để tạo lại.`); }
  if (lan !== tt.soLanPdf) return;
  tt.pdf = doc;
  capNhatRibbon();
  await xvTex.mo(Array.from({length: doc.numPages}, (_, i) => ({doc, so: i + 1})), {giu: giuCuon});
  if (lan !== tt.soLanPdf) return;
  const dem = {};
  for (let i = 1; i <= doc.numPages; i++) {
    const tr = await doc.getPage(i), nd = await tr.getTextContent();
    if (lan !== tt.soLanPdf) return;
    const viTri = [], moc = [];
    let chu = "";
    nd.items.forEach(x => { viTri.push([chu.length, x.transform[5]]); chu += `${x.str} `; });
    const yTai = vt => { let y = 0; for (const [d, v] of viTri) { if (d > vt) break; y = v; } return y; };
    for (const m of MAU_PDF ? chu.matchAll(new RegExp(MAU_PDF, "g")) : []) {
      const ten = m[2] ? m[1] : "Bài", so = +(m[2] || m[1]);
      if (so !== 1 && so !== (dem[ten] || 0) + 1) continue;  // số không nối tiếp là chữ trong bài, như tên "Bài 7. Căn bậc hai"
      dem[ten] = so;
      tt.trangBai[`${ten} ${so}`] ??= i;
      moc.push({nhan: `${ten} ${so}`, y: yTai(m.index)});
    }
    tt.mocPdf[i] = {moc, cao: tr.getViewport({scale: 1}).height, chu: nd.items.map(x => ({s: x.str, y: x.transform[5]}))};
  }
  if (tt.hienTai && !(giuCuon && dangThayTrang(tt.trangBai[tt.hienTai.nhan]))) cuonPdf(tt.hienTai);
}

function dangThayTrang(trang) {
  const cv = $("xem-pdf").querySelector(`[data-trang="${trang}"]`);
  if (!cv) return true;
  const a = cv.getBoundingClientRect(), b = $("xem-pdf").getBoundingClientRect();
  return a.bottom > b.top && a.top < b.bottom;
}

function cuonPdf(k) {
  const trang = tt.trangBai[k.nhan];
  if (!trang) return;
  xvTex.den(trang - 1);
}

function datDauBan(ban) {
  document.querySelectorAll("#chon-ban button[data-ban]").forEach(b => b.setAttribute("aria-pressed", b.dataset.ban === ban));
  const nut = $("tich-ban");
  if (nut) {
    const co = ban === tt.dsBan[0], ten = tt.nhanBan[ban] || ban;
    nut.setAttribute("aria-pressed", co);
    nut.setAttribute("aria-label", ten);
    nut.dataset.ten = ten;
    const kia = tt.nhanBan[tt.dsBan[co ? 1 : 0]] || tt.dsBan[co ? 1 : 0];
    nut.dataset.goiY = `Đang xem bản "${ten}". Bấm để chuyển sang bản "${kia}".`;
    nut.querySelector(".chu-nut").textContent = ten;
    nut.querySelector("svg").innerHTML = BT[co ? "chon-het" : "o-trong"];
  }
}

function chonBan(ban) {
  tt.ban = ban;
  datDauBan(ban);
  if (tt.tep && tt.tep.la_tex) napPdf(false, true);
}

function hienLoiLatex(nhatKy, viec) {
  const pre = document.createElement("pre");
  pre.textContent = nhatKy || "LaTeX dừng mà không ghi lý do.";
  xvTex.xoa();
  $("xem-pdf").replaceChildren(pre);
  const dongLoi = +(pre.textContent.match(/\bl\.(\d+)/) || [])[1];
  const c = dongLoi && tt.khoi.find(x => x.nhan && soan.posFromIndex(x.dau).line + 1 <= dongLoi && dongLoi <= soan.posFromIndex(x.cuoi).line + 1);
  if (c) { denKhoi(c.i, false); bao(`${viec} không thành công vì lỗi ở ${c.nhan}. Đã mở chỗ đó.`, true); }
  else if (dongLoi) bao(`${viec} không thành công vì lỗi ở dòng ${dongLoi}. Xem lỗi LaTeX ở khung PDF.`, true);
  else bao(`${viec} không thành công. Xem lỗi LaTeX ở khung PDF.`, true);
}

// Biên dịch chỉ để xem: dùng nội dung đang gõ, không lưu, PDF nằm ở thư mục tạm.
// imLang: biên dịch tự động sau khi lưu, thành công thì không báo gì thêm.
async function bienDich(imLang = false) {
  if (!tt.tep || !tt.tep.la_tex) return bao("Mở một file .tex trước khi biên dịch.", true);
  if (tt.dangXuat) { tt.xuatLai = true; return; }
  chotDong();
  tt.dangXuat = true;
  const duong = tt.tep.duong, ban = tt.ban;
  datViec("Đang chạy thử...");
  let napSau = false, conDung = false;
  try {
    const kq = await goi("/api/bien-dich", {duong, ban, chu: soan.getValue()});
    conDung = tt.tep?.duong === duong && tt.ban === ban;
    if (kq.ok || !conDung) {
      if (kq.ok) { tt.pdfDaLuu = false; xvTex.tb = null; }  // biên dịch lại là bỏ mọi sửa đổi trên PDF cũ
      if (kq.ok && !imLang && conDung) bao("Chạy thử xong, PDF ở khung bên phải");
      napSau = true;
    } else hienLoiLatex(kq.nhat_ky, "Chạy thử");
  } catch (e) { bao(e.message, true); }
  tt.dangXuat = false;
  datViec("");
  if (tt.xuatLai) { tt.xuatLai = false; return bienDich(true); }
  if (napSau) await napPdf(conDung);
}

// Lưu ra file PDF mới tạo file dùng thật, đủ các bản của dự án. Luôn lưu trước để file khớp nội dung.
async function xuatDung() {
  if (!tt.tep || !tt.tep.la_tex) return bao("Mở một file .tex trước khi lưu ra file PDF.", true);
  await luu();
  if (coThayDoi()) return;
  const cacBan = tt.dsBan.length ? tt.dsBan : [""];
  try {
    for (const ban of cacBan) {
      datViec(`Đang lưu ra file PDF${ban ? ` ${ban}` : ""}...`);
      const kq = await goi("/api/xuat", {duong: tt.tep.duong, ban});
      if (!kq.ok) { hienLoiLatex(kq.nhat_ky, `Lưu ra file PDF${ban ? ` bản ${ban}` : ""}`); return; }
    }
    tt.pdfDaLuu = true;
    bao(`Đã lưu ra file PDF${cacBan[0] ? `: ${cacBan.join(", ")}` : ""}`);
  } catch (e) { bao(e.message, true); }
  finally { datViec(""); }
}

// Giống Overleaf: lưu xong là biên dịch và hiện PDF. Không có gì đổi thì vẫn biên dịch lại.
async function luuVaXuat() {
  if (dangPdf()) return pt.ds.length && luuTrang(pt.ds.some(x => x.chon));
  if (!tt.tep) return;
  await luu();
  if (!coThayDoi() && tt.tep.la_tex) bienDich(true);
}

// ---------- Thư viện mẫu ----------

async function veThuVien() {
  const tv = await goi("/api/thu-vien");
  const ds = Object.entries(tv.ds);
  $("ds-mau").replaceChildren(...ds.map(([ten, tep]) => {
    const li = document.createElement("li"), s = document.createElement("span");
    li.textContent = ten;
    s.textContent = tep.join(", ");
    li.append(s);
    return li;
  }));
  if (!ds.length) $("ds-mau").textContent = "Chưa có mẫu nào.";
}

const moThuVien = () => veThuVien().then(() => $("hop-mau").showModal()).catch(e => bao(e.message, true));

async function themMau() {
  try {
    let kq = await goi("/api/them-mau", {});
    if (kq.khong_co_hop) {
      const duong = prompt("Dán đường dẫn thư mục chứa mẫu:");
      if (!duong) return;
      kq = await goi("/api/them-mau", {duong: duong.trim().replace(/^"|"$/g, "")});
    }
    if (kq.huy) return;
    if (kq.trung) {
      if (!confirm(`Thư viện đã có mẫu ${kq.trung}. Cập nhật mẫu này bằng thư mục vừa chọn?`)) return;
      kq = await goi("/api/them-mau", {duong: kq.duong, ghi_de: true});
    }
    await veThuVien();
    bao(`Đã thêm mẫu ${kq.ten}`);
  } catch (e) { bao(e.message, true); }
}

// ---------- Lưu ----------

const tenFile = d => d.split(/[\\/]/).pop();

function veHopLuu(pt) {
  const o = $("noi-dung-luu");
  o.replaceChildren();
  pt.doi.filter(x => x.ngan_hang || x.file_khac.length).forEach(x => {
    const m = document.createElement("div");
    m.className = "muc-luu";
    m.dataset.id = x.id;
    const h = document.createElement("h3");
    h.textContent = `Câu ${x.id}, dòng ${x.dong}`;
    m.append(h);
    if (x.ngan_hang) {
      [["file", "Chỉ sửa trong file này"], ["ngan-hang", `Sửa cả trong ngân hàng (${tenFile(x.ngan_hang)})`]].forEach(([gt, chu], i) => {
        const l = document.createElement("label"), r = document.createElement("input");
        r.type = "radio"; r.name = `pv-${x.id}`; r.value = gt; r.checked = i === 0;
        l.append(r, ` ${chu}`);
        m.append(l);
      });
      if (x.ngan_hang_lech) {
        const c = document.createElement("p");
        c.className = "canh-bao";
        c.textContent = "Câu trong ngân hàng đang khác câu cũ ở file này. Chọn sửa cả ngân hàng sẽ ghi đè bản đó.";
        m.append(c);
      }
    }
    x.file_khac.forEach(f => {
      const l = document.createElement("label"), r = document.createElement("input");
      r.type = "checkbox"; r.value = f;
      l.append(r, ` Sửa cả ở ${tenFile(f)}`);
      m.append(l);
    });
    o.append(m);
  });
  [[pt.xoa.length, `Sẽ xoá ${pt.xoa.length} câu khỏi file: ${pt.xoa.join(", ")}.`],
   [pt.moi.length, `Có ${pt.moi.length} bài chưa có id (dòng ${pt.moi.join(", ")}). App không theo dõi được các khối này.`]
  ].forEach(([co, chu]) => {
    if (!co) return;
    const p = document.createElement("p");
    p.className = "canh-bao";
    p.textContent = chu;
    o.append(p);
  });
  const hop = $("hop-luu");
  return new Promise(xong => {
    const form = hop.querySelector("form");
    form.onsubmit = e => { e.preventDefault(); hop.close(); xong(e.submitter?.value === "luu"); };
    hop.oncancel = () => xong(false);
    hop.showModal();
  });
}

function docLuaChon() {
  const lc = {};
  document.querySelectorAll("#noi-dung-luu .muc-luu").forEach(m => {
    const pv = m.querySelector("input[type=radio]:checked");
    lc[m.dataset.id] = {pham_vi: pv ? pv.value : "file",
      file_khac: [...m.querySelectorAll("input[type=checkbox]:checked")].map(r => r.value)};
  });
  return lc;
}

async function luu() {
  chotDong();
  if (!coThayDoi() || tt.dangBan) return;
  tt.dangBan = true;
  capNhatRibbon();
  const chu = soan.getValue();
  try {
    const pt = await goi("/api/phan-tich", {duong: tt.tep.duong, chu});
    const canHoi = pt.xoa.length || pt.moi.length || pt.doi.some(x => x.ngan_hang || x.file_khac.length);
    if (canHoi && !await veHopLuu(pt)) return;
    const kq = await goi("/api/luu", {duong: tt.tep.duong, phien: tt.tep.phien, chu, lua_chon: canHoi ? docLuaChon() : {}, anh_da_dung: anhDaDung()});
    tt.tep.phien = kq.phien;
    tt.chuGoc = chu;
    const them = [kq.ngan_hang && `${kq.ngan_hang} câu trong ngân hàng`, kq.file_khac && `${kq.file_khac} file khác`, kq.anh_xoa && `${kq.anh_xoa} ảnh vào Thùng rác`].filter(Boolean);
    bao(kq.canh_bao[0] || (them.length ? `Đã lưu, sửa thêm ${them.join(" và ")}` : "Đã lưu"), kq.canh_bao.length > 0);
  } catch (e) { bao(e.message, true); }
  finally { tt.dangBan = false; capNhat(); }
}

// ---------- Nối sự kiện ----------

let henSua;
soan.on("change", () => { clearTimeout(henSua); henSua = setTimeout(capNhat, 200); });
soan.on("cursorActivity", () => { clearTimeout(henSua); henSua = setTimeout(capNhat, 120); });
$("them-mau").onclick = () => themMau();
$("mo-thu-vien").onclick = () => goi("/api/mo-thu-vien", {}).catch(e => bao(e.message, true));
$("cd-dong").onclick = () => datCheDo("dong");
$("cd-code").onclick = () => datCheDo("code");
let henTim;
$("tim").oninput = () => { clearTimeout(henTim); henTim = setTimeout(hienKetQuaTim, 200); };
addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); luuVaXuat(); }
});

// Đợi mọi file script nạp xong, vì mở dự án dùng đến các phần ở file sau.
addEventListener("DOMContentLoaded", () => napDuAn().catch(e => bao(e.message, true)));
