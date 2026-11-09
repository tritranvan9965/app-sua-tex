"use strict";
// Ảnh trong Theo dòng: hiện ảnh thật, bấm để chọn (kéo núm đổi cỡ, thay, căn, cắt, xóa), dán hoặc kéo thả ảnh vào câu để chèn.
// Ảnh của file X.tex nằm ở hinh/X/h001.png... cạnh file .tex (máy chủ đặt tên, xem anh_dong.py). Mọi thay đổi văn bản là đúng một
// soan.operation nên Ctrl+Z hoàn tác trọn vẹn. Ảnh không còn được dùng thì máy chủ đưa vào Thùng rác khi Lưu.
// Tên cấp ngoài cùng đều có tiền tố "anh" (các file static/*.js dùng chung phạm vi toàn cục).

const ANH_MAC_DINH = {hinh: 0.5, hinhphai: 0.4, hinhtrai: 0.4, hinhgoc: 0.6};
const ANH_DAU_LENH = /\\(includegraphics|hinhgoc|hinhphai|hinhtrai|hinh)(?![a-zA-Z])/g;
const ANH_MAU = /\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{[^}]*\b(?:tritoan|toan\d*)\b[^}]*\}/;  // file dùng mẫu tritoan (có \hinh)
const ANH_MOI_TRUONG = /\\begin\{(center|flushright|flushleft)\}\s*$/;
let anhCho = [];  // HTML chỗ giữ ảnh của lần vẽ đang chạy (veNoiDung điền, veChu đổi chỗ dấu thành HTML)
let anhChon = null;  // {dau, tep}: lệnh ảnh đang chọn, theo vị trí trong file
let anhDangSua = false;  // đang tự sửa văn bản, đừng bỏ chọn
let anhLop = null;
const anhBoNho = new Map();  // địa chỉ ảnh -> Promise của dữ liệu đã tải

const anhSo = r => String(+r.toFixed(2));
const anhGp = chu => {
  const m = matNa(chu).match(/\\graphicspath\s*\{((?:\s*\{[^{}]*\})+)\s*\}/);
  return m ? [...m[1].matchAll(/\{([^{}]*)\}/g)].map(x => x[1]) : [];
};
const anhCoMau = chu => ANH_MAU.test(matNa(chu));

// ---------- Đọc lệnh ảnh trong một đoạn văn bản ----------

// Vị trí tính trong đoạn raw. ten_cuoi: sau tên lệnh (và dấu *); opt: trong [..]; ref: đường dẫn; nd: nội dung đi kèm (\hinhphai, \hinhtrai).
function anhTim(raw) {
  const m = matNa(raw), ds = [];
  for (const t of m.matchAll(new RegExp(ANH_DAU_LENH))) {
    if (ds.length && t.index < ds[ds.length - 1].cuoi) continue;
    let j = t.index + t[0].length;
    if (m[j] === "*") j++;
    const tenCuoi = j, bo = () => { while (/\s/.test(m[j] || "")) j++; };
    bo();
    let opt = null;
    if (m[j] === "[") {
      const e = m.indexOf("]", j);
      if (e < 0) continue;
      opt = {dau: j + 1, cuoi: e};
      j = e + 1;
      bo();
    }
    if (m[j] !== "{") continue;
    const k = dongNgoac(m, j);
    if (k < 0) continue;
    const c = {ten: t[1], dau: t.index, cuoi: k + 1, ten_cuoi: tenCuoi, opt, ref: {dau: j + 1, cuoi: k}, nd: null};
    if (/^hinh(?:goc|phai|trai)$/.test(c.ten)) {
      j = k + 1;
      bo();
      if (m[j] !== "{") continue;
      const k2 = dongNgoac(m, j);
      if (k2 < 0) continue;
      c.cuoi = k2 + 1;
      if (c.ten !== "hinhgoc") c.nd = {dau: j + 1, cuoi: k2};
    }
    ds.push(c);
  }
  return ds;
}

// Tỉ lệ so với độ rộng dòng, hoặc null nếu lệnh không ghi (ảnh hiện cỡ thật).
function anhTiLe(c, raw) {
  const opt = c.opt ? raw.slice(c.opt.dau, c.opt.cuoi) : "";
  if (c.ten === "includegraphics") {
    const w = opt.match(/(?:^|,)\s*(?:max\s+)?width\s*=\s*([^,]+)/)?.[1]?.trim();
    if (!w) return null;
    let t = w.match(/^(\d*\.?\d*)\s*\\(?:line|text|column)width$/);
    if (t) return Math.min(1, t[1] === "" ? 1 : +t[1] || null);
    t = w.match(/^(\d*\.?\d+)\s*(cm|mm|pt|in)$/);
    return t ? Math.min(1, +t[1] / {cm: 16, mm: 160, pt: 455, in: 6.3}[t[2]]) : null;
  }
  const x = parseFloat(opt);
  return x > 0 ? Math.min(1, x) : ANH_MAC_DINH[c.ten];
}

// Trước khi vẽ một dòng: thay mỗi lệnh ảnh bằng một dấu riêng, veChu đổi dấu đó thành HTML. Nội dung đi kèm \hinhphai ở lại trong dòng.
function anhThayCho(s) {
  const ds = anhTim(s);
  if (!ds.length) return s;
  anhCho = [];
  let ra = "", vt = 0;
  ds.forEach((c, n) => {
    ra += s.slice(vt, c.dau);
    const ti = anhTiLe(c, s), lop = c.ten === "hinhphai" ? "anh-phai" : c.ten === "hinhtrai" ? "anh-trai" : c.ten === "includegraphics" ? "anh-ik" : "anh-giua";
    anhCho[n] = `<span class="anh-dong ${lop}${ti ? " co-ti" : ""}" data-n="${n}" data-ref="${encodeURIComponent(s.slice(c.ref.dau, c.ref.cuoi).trim())}"${ti ? ` style="--ti:${ti}"` : ""}></span>`;
    ra += `${n}`;
    if (c.nd) ra += s.slice(c.nd.dau, c.nd.cuoi);
    vt = c.cuoi;
  });
  return ra + s.slice(vt);
}

// ---------- Tải và vẽ ảnh ----------

function anhUrl(ref) {
  return `/api/anh?duong=${encodeURIComponent(tt.tep.duong)}&ref=${encodeURIComponent(ref)}&gp=${encodeURIComponent(anhGp(soan.getValue()).join("|"))}`;
}

async function anhTai(url) {
  const tl = await fetch(url);
  if (!tl.ok) throw new Error("Không tìm thấy ảnh.");
  const blob = await tl.blob();
  if (tl.headers.get("Content-Type") === "application/pdf") return {pdf: await pdfjsLib.getDocument({data: await blob.arrayBuffer()}).promise, blob};
  return {url: URL.createObjectURL(blob), blob};
}

function anhLay(url) {
  let mot = anhBoNho.get(url);
  if (!mot) {
    mot = anhTai(url);
    anhBoNho.set(url, mot);
    mot.catch(() => setTimeout(() => anhBoNho.delete(url), 4000));  // ảnh thiếu: nhớ vài giây để vẽ lại không gọi máy chủ liên tục
  }
  return mot;
}

async function anhVe(n, hs = 2) {
  if (n.url) {
    const i = new Image();
    i.src = n.url;
    i.alt = "";
    i.draggable = false;
    return i;
  }
  const tr = await n.pdf.getPage(1), v = tr.getViewport({scale: hs}), c = document.createElement("canvas");
  c.width = v.width;
  c.height = v.height;
  c.style.width = `${Math.round(v.width / hs * 4 / 3)}px`;  // cỡ thật: 1 điểm PDF = 4/3 điểm ảnh
  await tr.render({canvasContext: c.getContext("2d"), viewport: v}).promise;
  return c;
}

async function anhNap(span) {
  const ref = decodeURIComponent(span.dataset.ref);
  try {
    const nguon = await anhLay(anhUrl(ref)), e = await anhVe(nguon);
    if (!span.isConnected) return;
    e.onload = () => span.classList.contains("chon") && anhVeLop();
    span.replaceChildren(e);
    tdDatNeo();  // ảnh vào chỗ làm dòng cao lên: giữ chỗ đang nhìn (ảnh <img> thì load tự gọi lại khi tải xong)
  } catch {
    if (!span.isConnected) return;
    span.classList.add("thieu");
    span.textContent = `Không tìm thấy ảnh: ${ref}`;
  }
  if (span.classList.contains("chon")) anhVeLop();
}

// Gọi từ nutDong sau khi dòng có HTML: ghi vị trí lệnh vào từng ảnh rồi nạp ảnh.
function anhGan(nut, chu, d) {
  const ds = nut.querySelectorAll(".anh-dong");
  if (!ds.length) return;
  const cmds = anhTim(chu.slice(d.dau, d.cuoi));
  ds.forEach(s => {
    const c = cmds[+s.dataset.n];
    if (!c) return;
    s.dataset.dau = d.dau + c.dau;
    if (anhChon?.tep === tt.tep && anhChon.dau === d.dau + c.dau) s.classList.add("chon");
    anhNap(s);
  });
}

// ---------- Lệnh đang chọn ----------

// Tìm lại lệnh theo vị trí đã nhớ trong văn bản hiện tại. Toạ độ trả về là của cả file.
function anhLenh() {
  if (!anhChon || anhChon.tep !== tt.tep) return null;
  const chu = soan.getValue(), d = tt.dong.find(x => anhChon.dau >= x.dau && anhChon.dau < x.cuoi);
  if (!d) return null;
  const raw = chu.slice(d.dau, d.cuoi), c = anhTim(raw).find(x => d.dau + x.dau === anhChon.dau);
  if (!c) return null;
  const A = x => d.dau + x, kh = x => x && [A(x.dau), A(x.cuoi)];
  return {chu, d, c, dau: A(c.dau), cuoi: A(c.cuoi), tenCuoi: A(c.ten_cuoi), ref: raw.slice(c.ref.dau, c.ref.cuoi).trim(), refA: kh(c.ref), opt: kh(c.opt), nd: kh(c.nd), ti: anhTiLe(c, raw)};
}

function anhCanHienTai(L) {
  if (L.c.ten === "hinhphai") return "phai";
  if (L.c.ten === "hinhtrai") return "trai";
  if (L.c.ten !== "includegraphics") return "giua";
  const m = ANH_MOI_TRUONG.exec(L.chu.slice(0, L.dau));
  return m ? (m[1] === "center" ? "giua" : m[1] === "flushright" ? "phai" : "trai") : "";
}

function anhBoChon() {
  if (!anhChon) return;
  anhChon = null;
  document.querySelectorAll("#vung-dong .anh-dong.chon").forEach(s => s.classList.remove("chon"));
  anhVeLop();
}

function anhDanhDau() {
  document.querySelectorAll("#vung-dong .anh-dong.chon").forEach(s => s.classList.remove("chon"));
  const s = anhChon && $("vung-dong").querySelector(`.anh-dong[data-dau="${anhChon.dau}"]`);
  s?.classList.add("chon");
  anhVeLop();
}

// Sửa văn bản bằng một hay nhiều đoạn (đã tính theo văn bản cũ) trong đúng một bước hoàn tác; chonDau là vị trí ảnh cần chọn sau đó.
function anhGhi(ds, chonDau = null) {
  anhDangSua = true;
  try {
    soan.operation(() => {
      for (const {a, b, moi} of [...ds].sort((x, y) => y.a - x.a)) soan.replaceRange(moi, soan.posFromIndex(a), soan.posFromIndex(b));
    });
  } finally { anhDangSua = false; }
  anhChon = chonDau === null ? null : {dau: chonDau, tep: tt.tep};
  khoaDong = null;
  capNhat();
  anhDanhDau();
}

// ---------- Thao tác ----------

function anhXoa() {
  const L = anhLenh();
  if (!L) return;
  const {chu} = L, rep = L.nd ? chu.slice(L.nd[0], L.nd[1]).trim() : "";
  let a = L.dau, b = L.cuoi;
  const dongA = chu.lastIndexOf("\n", a - 1) + 1;
  let dongB = chu.indexOf("\n", b);
  if (dongB < 0) dongB = chu.length;
  if (!rep && /^[ \t]*$/.test(chu.slice(dongA, a)) && /^[ \t]*$/.test(chu.slice(b, dongB))) { a = dongA; b = Math.min(dongB + 1, chu.length); }
  anhGhi([{a, b, moi: rep}]);
  bao("Đã xóa ảnh. Bấm Ctrl+Z để lấy lại. Lưu file thì ảnh mới được đưa vào Thùng rác.");
}

function anhDoiTiLe(r) {
  const L = anhLenh();
  if (!L) return;
  const {c, chu} = L, so = anhSo(Math.min(1, Math.max(0.05, r)));
  if (c.ten === "hinhgoc") {
    anhGhi([{a: L.dau, b: L.cuoi, moi: `\\hinh[${so}]{${L.ref}}`}], L.dau);
    return bao("Đã đổi \\hinhgoc thành \\hinh để chỉnh cỡ.");
  }
  if (c.ten === "includegraphics") {
    const w = `width=${so}\\linewidth`;
    if (!L.opt) return anhGhi([{a: L.tenCuoi, b: L.tenCuoi, moi: `[${w}]`}], L.dau);
    const phan = [];
    let sau = 0, tu = 0;
    const opt = chu.slice(L.opt[0], L.opt[1]);
    for (let i = 0; i <= opt.length; i++) {
      if (opt[i] === "{") sau++;
      else if (opt[i] === "}") sau--;
      else if ((opt[i] === "," && !sau) || i === opt.length) { phan.push(opt.slice(tu, i)); tu = i + 1; }
    }
    const giu = phan.filter(p => p.trim() && !/^\s*(?:max\s+width|width|height|totalheight|scale)\s*=/.test(p));
    return anhGhi([{a: L.opt[0], b: L.opt[1], moi: [w, ...giu.map(p => p.trim())].join(",")}], L.dau);
  }
  anhGhi(L.opt ? [{a: L.opt[0], b: L.opt[1], moi: so}] : [{a: L.tenCuoi, b: L.tenCuoi, moi: `[${so}]`}], L.dau);
}

// kieu: "giua" hay "phai". File dùng mẫu tritoan thì đổi giữa \hinh và \hinhphai, file khác thì dùng center/flushright.
function anhCan(kieu) {
  const L = anhLenh();
  if (!L || anhCanHienTai(L) === kieu) return;
  const {chu, c} = L;
  if (anhCoMau(chu) || c.ten.startsWith("hinh")) {
    const so = anhSo(L.ti ?? ANH_MAC_DINH[kieu === "phai" ? "hinhphai" : "hinh"]);
    const nd = L.nd ? chu.slice(L.nd[0], L.nd[1]).trim() : "";
    if (kieu === "giua") return anhGhi([{a: L.dau, b: L.cuoi, moi: `${nd ? nd + "\n" : ""}\\hinh[${so}]{${L.ref}}`}], L.dau + (nd ? nd.length + 1 : 0));
    // Sang bên phải: chữ ngay phía trên (cùng khối, cùng phần) thành nội dung đi kèm, để chữ và ảnh nằm cạnh nhau.
    let a = L.dau, chuKem = nd;
    const i = tt.dong.indexOf(L.d), truoc = tt.dong[i - 1], rieng = !chu.slice(L.d.dau, L.dau).trim() && !chu.slice(L.cuoi, L.d.cuoi).trim();
    if (!nd && rieng && truoc && truoc.phan === L.d.phan && truoc.kieu === "chu" && !truoc.pa && !truoc.nhan && khoiCuaDong(i - 1) === khoiCuaDong(i)
      && !anhTim(chu.slice(truoc.dau, truoc.cuoi)).length && (chu.slice(truoc.cuoi, L.dau).match(/\n/g) || []).length <= 1 && !chu.slice(truoc.cuoi, L.dau).trim()) {
      a = truoc.dau;
      chuKem = chu.slice(truoc.dau, truoc.cuoi);
    }
    return anhGhi([{a, b: L.cuoi, moi: `\\hinhphai[${so}]{${L.ref}}{${chuKem}}`}], a);
  }
  const ten = kieu === "giua" ? "center" : "flushright", mo = ANH_MOI_TRUONG.exec(chu.slice(0, L.dau)), dong = /^\s*\\end\{(center|flushright|flushleft)\}/.exec(chu.slice(L.cuoi));
  if (mo && dong && mo[1] === dong[1]) {
    const d1 = mo.index + 7, d2 = L.cuoi + dong[0].lastIndexOf("{") + 1;
    return anhGhi([{a: d1, b: d1 + mo[1].length, moi: ten}, {a: d2, b: d2 + dong[1].length, moi: ten}], L.dau + ten.length - mo[1].length);
  }
  const lenh = chu.slice(L.dau, L.cuoi), mo2 = `\\begin{${ten}}`;
  anhGhi([{a: L.dau, b: L.cuoi, moi: `${mo2}${lenh}\\end{${ten}}`}], L.dau + mo2.length);
}

function anhSuaCode() {
  const L = anhLenh();
  if (!L) return;
  const i = tt.dong.indexOf(L.d);
  anhBoChon();
  moDong(i);
}

// ---------- Lấy file ảnh, đổi định dạng, gửi lên máy chủ ----------

const anhBase64 = blob => new Promise((ok, loi) => {
  const r = new FileReader();
  r.onload = () => ok(r.result.split(",")[1]);
  r.onerror = () => loi(new Error("Không đọc được ảnh."));
  r.readAsDataURL(blob);
});
const anhCanvasRa = (c, kieu = "image/png", chatLuong) => new Promise((ok, loi) => c.toBlob(b => (b ? ok(b) : loi(new Error("Không tạo được ảnh."))), kieu, chatLuong));

// PNG, JPG, PDF giữ nguyên; WEBP, BMP, GIF đổi sang PNG.
async function anhChuanHoa(file) {
  const loai = (file.type || "").toLowerCase(), ten = (file.name || "").toLowerCase();
  let duoi = loai === "image/png" || /\.png$/.test(ten) ? "png" : loai === "image/jpeg" || /\.jpe?g$/.test(ten) ? "jpg"
    : loai === "application/pdf" || /\.pdf$/.test(ten) ? "pdf" : /^image\//.test(loai) || /\.(webp|bmp|gif)$/.test(ten) ? "doi" : null;
  if (!duoi) throw new Error("Chỉ nhận ảnh PNG, JPG hoặc PDF. WEBP, BMP, GIF sẽ tự đổi sang PNG.");
  let blob = file;
  if (duoi === "doi") {
    const bm = await createImageBitmap(file), c = document.createElement("canvas");
    c.width = bm.width;
    c.height = bm.height;
    c.getContext("2d").drawImage(bm, 0, 0);
    blob = await anhCanvasRa(c);
    duoi = "png";
  }
  return {du_lieu: await anhBase64(blob), duoi};
}

const anhDaThem = new Set();  // ảnh app vừa thêm vào trong phiên (kể cả khi đã bỏ khỏi bài trước khi Lưu)

// Ảnh file đã dùng: có trong bản lúc mở hoặc lúc lưu trước, và ảnh app vừa thêm. Máy chủ chỉ dọn ảnh nằm trong danh sách này.
const anhDaDung = () => [...new Set([...anhTim(tt.chuGoc || "").map(c => tt.chuGoc.slice(c.ref.dau, c.ref.cuoi).trim()), ...anhDaThem])];

async function anhTaiLen(file) {
  const {du_lieu, duoi} = await anhChuanHoa(file);
  const ref = (await goi("/api/anh-them", {duong: tt.tep.duong, chu: soan.getValue(), du_lieu, duoi})).ref;
  anhDaThem.add(ref);
  return ref;
}

function anhChonQuaInput() {
  return new Promise(ok => {
    const o = document.createElement("input");
    o.type = "file";
    o.accept = "image/*,.pdf";
    o.onchange = () => ok(o.files[0] || null);
    o.oncancel = () => ok(null);
    o.click();
  });
}

// Hộp chọn file của app (Windows); chạy bằng trình duyệt thì dùng hộp của trình duyệt.
async function anhChonFile() {
  const kq = await goi("/api/anh-chon", {});
  if (kq.huy) return null;
  if (kq.khong_co_hop) return anhChonQuaInput();
  const loai = {png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", pdf: "application/pdf"}[kq.duoi] || "";
  return new File([Uint8Array.from(atob(kq.du_lieu), c => c.charCodeAt(0))], kq.ten, {type: loai});
}

async function anhThayBang(file) {
  try {
    const ref = await anhTaiLen(file), L = anhLenh();
    if (!L) return;
    anhGhi([{a: L.refA[0], b: L.refA[1], moi: ref}], L.dau);
    bao("Đã thay ảnh. Ảnh cũ sẽ vào Thùng rác khi Lưu.");
  } catch (e) { bao(e.message, true); }
}

async function anhThay() {
  try {
    const f = await anhChonFile();
    if (f) await anhThayBang(f);
  } catch (e) { bao(e.message, true); }
}

// ---------- Chèn ảnh vào cuối phần đề của câu ----------

// Chỗ chèn: sau chữ cuối của phần đề, trước lời giải, trước phương án trắc nghiệm và trước \end của khối.
function anhViTriChen(chu, k) {
  const m = matNa(chu);
  let b = k.cuoi;
  const ket = m.slice(k.dau, k.cuoi).lastIndexOf("\\end{");
  if (k.loai !== "tu-do" && ket >= 0) b = k.dau + ket;
  for (const l of [...LENH_LOI_GIAI, LOI_GIAI]) {
    const j = m.indexOf(l, k.dau);
    if (j >= 0 && j < b) b = j;
  }
  const pa = /\\(?:paaa|paa|pa|choice)(?![a-zA-Z])/g;
  pa.lastIndex = k.dau;
  const t = pa.exec(m);
  if (t && t.index < b) b = t.index;
  while (b > k.dau && /\s/.test(chu[b - 1])) b--;
  return b;
}

async function anhChen(file, i) {
  try {
    chotDong();
    const ref = await anhTaiLen(file);
    chotDong();
    const k = tt.khoi[i];
    if (!k || k.loai === "muc") return bao("Không tìm thấy câu để chèn ảnh.", true);
    const chu = soan.getValue(), p = anhViTriChen(chu, k), mau = anhCoMau(chu), ds = [];
    const truoc = mau ? "" : "\\begin{center}", lenh = mau ? `\\hinh[0.5]{${ref}}` : `\\includegraphics[width=0.5\\linewidth]{${ref}}`;
    let dich = p + 1 + truoc.length;
    ds.push({a: p, b: p, moi: `\n${truoc}${lenh}${mau ? "" : "\\end{center}"}`});
    const dc = !mau && !/\\usepackage(?:\[[^\]]*\])?\{[^}]*graphicx/.test(matNa(chu)) && matNa(chu).match(/\\documentclass[^\n]*/);
    if (dc) {
      const e = dc.index + dc[0].length;
      ds.push({a: e, b: e, moi: "\n\\usepackage{graphicx}"});
      dich += "\n\\usepackage{graphicx}".length;
    }
    anhGhi(ds, dich);
    setTimeout(() => {  // ảnh mới chèn nằm ngoài khung nhìn thì mới cuộn tới; để ảnh tải xong, đo xong rồi mới cuộn, và thôi giữ neo cũ
      const s = $("vung-dong").querySelector(`.anh-dong[data-dau="${dich}"]`);
      if (s) { tdHuyNeo(); s.scrollIntoView({block: "nearest"}); }
    }, 500);
    bao("Đã chèn ảnh vào cuối phần đề của câu.");
  } catch (e) { bao(e.message, true); }
}

// Câu nhận ảnh: câu của ảnh đang chọn, câu đang sửa dòng, hoặc câu duy nhất đang chọn bằng Ctrl+bấm.
function anhKhoiDich() {
  if (tt.cheDo !== "dong" || !tt.tep?.la_tex || $("vung-dong").hidden) return null;
  const L = anhChon && anhLenh();
  const k = (L && khoiCuaDong(tt.dong.indexOf(L.d))) || tt.dangSua?.khoi || (() => {
    const c = typeof keoDaChon === "function" ? keoDaChon() : null;
    return c && c.tap.size === 1 ? tt.khoi[[...c.tap][0]] : null;
  })() || tdKhoiConTro();  // sau cùng: con trỏ chèn, lấy câu đứng ngay trên vạch
  return k && k.loai !== "muc" ? k : null;
}

async function anhChenTuHop() {
  const k = anhKhoiDich();
  if (!k) return bao("Bấm vào một dòng của câu (hoặc Ctrl+bấm để chọn câu) rồi chèn ảnh.", true);
  try {
    const f = await anhChonFile();
    if (f) await anhChen(f, k.i);
  } catch (e) { bao(e.message, true); }
}

// ---------- Lớp nút nổi quanh ảnh đang chọn ----------

const ANH_NUT = [["thay", "Thay ảnh", "Chọn file khác, hoặc dán ảnh (Ctrl+V), hoặc kéo file thả vào ảnh"], ["giua", "Căn giữa", "Ảnh nằm giữa dòng"],
  ["phai", "Bên phải đề", "Ảnh nằm bên phải chữ phía trên"], ["cat", "Cắt ảnh", "Kéo khung chọn vùng cần giữ, lưu thành ảnh mới"], ["code", "Sửa code", "Mở ô sửa dòng chứa ảnh"]];

function anhTaoLop() {
  if (anhLop) return anhLop;
  const l = anhLop = document.createElement("div");
  l.id = "anh-lop";
  l.hidden = true;
  l.innerHTML = '<div class="anh-khung"></div>' + ["tl", "tr", "bl", "br"].map(g => `<span class="anh-goc" data-g="${g}"></span>`).join("") + '<div class="anh-thanh" role="toolbar" aria-label="Công cụ ảnh"></div>';
  const thanh = l.lastChild;
  for (const [ma, ten, goiY] of ANH_NUT) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.viec = ma;
    b.textContent = ten;
    b.title = goiY;
    thanh.append(b);
  }
  const xoa = document.createElement("button");
  xoa.type = "button";
  xoa.dataset.viec = "xoa";
  xoa.className = "anh-xoa";
  xoa.innerHTML = bieuTuong("xoa");
  xoa.title = "Xóa ảnh (Delete)";
  xoa.setAttribute("aria-label", "Xóa ảnh");
  thanh.append(xoa);
  thanh.addEventListener("click", e => {
    const viec = e.target.closest("button")?.dataset.viec;
    if (viec) ({thay: anhThay, giua: () => anhCan("giua"), phai: () => anhCan("phai"), cat: anhCat, code: anhSuaCode, xoa: anhXoa})[viec]();
  });
  l.addEventListener("pointerdown", anhBatDauKeo);
  document.body.append(l);
  return l;
}

function anhVeLop() {
  const s = anhChon && anhChon.tep === tt.tep && tt.cheDo === "dong" && !$("vung-dong").hidden ? $("vung-dong").querySelector(`.anh-dong[data-dau="${anhChon.dau}"]`) : null;
  if (!s) { if (anhLop) anhLop.hidden = true; return; }
  const l = anhTaoLop(), r = s.getBoundingClientRect(), v = $("vung-dong").getBoundingClientRect();
  if (r.bottom < v.top + 12 || r.top > v.bottom - 12) { l.hidden = true; return; }
  l.hidden = false;
  Object.assign(l.style, {left: `${r.left}px`, top: `${r.top}px`, width: `${Math.max(r.width, 24)}px`, height: `${Math.max(r.height, 24)}px`});
  l.classList.toggle("duoi", r.top - v.top < 46);
  const L = anhLenh(), can = L ? anhCanHienTai(L) : "";
  l.querySelectorAll("[data-viec=giua],[data-viec=phai]").forEach(b => b.setAttribute("aria-pressed", b.dataset.viec === can));
  l.querySelector("[data-viec=cat]").disabled = s.classList.contains("thieu");
  l.classList.toggle("khong-doi-co", s.classList.contains("thieu"));
}

// Kéo núm ở góc để đổi cỡ: cỡ theo tỉ lệ độ rộng dòng, làm tròn 0.05 khi thả.
function anhBatDauKeo(e) {
  const g = e.target.closest?.(".anh-goc");
  const s = anhChon && $("vung-dong").querySelector(`.anh-dong[data-dau="${anhChon.dau}"]`);
  if (!g || !s || e.button !== 0) return;
  e.preventDefault();
  const nd = s.closest(".nd"), ref = Math.max(40, nd ? nd.clientWidth : 400), r0 = s.getBoundingClientRect(), x0 = e.clientX;
  const dau = g.dataset.g[1] === "r" ? 1 : -1, nhan = s.classList.contains("anh-giua") ? 2 : 1;
  let ti = Math.min(1, r0.width / ref);
  const di = ev => {
    ti = Math.min(1, Math.max(0.05, (r0.width + dau * nhan * (ev.clientX - x0)) / ref));
    s.style.setProperty("--ti", ti);
    s.classList.add("co-ti");
    anhVeLop();
  };
  const xong = ev => {
    removeEventListener("pointermove", di);
    removeEventListener("pointerup", xong);
    removeEventListener("pointercancel", xong);
    if (ev.type === "pointercancel") return anhDanhDau();
    anhDoiTiLe(Math.round(ti * 20) / 20);
  };
  addEventListener("pointermove", di);
  addEventListener("pointerup", xong);
  addEventListener("pointercancel", xong);
}

// ---------- Cắt ảnh ----------

// Hiện ảnh to trong khung, người dùng kéo chọn vùng. Trả về {x, y, w, h} theo điểm ảnh của nguồn, hoặc null nếu bỏ.
function anhHopCat(nguon) {
  return new Promise(ok => {
    const W = nguon.width, H = nguon.height, tl = Math.min(1, innerWidth * 0.86 / W, innerHeight * 0.68 / H);
    const lop = document.createElement("div");
    lop.id = "anh-cat";
    lop.innerHTML = '<div class="anh-cat-hop" role="dialog" aria-modal="true" aria-label="Cắt ảnh"><p>Kéo chuột trên ảnh để chọn vùng cần giữ. Kéo góc để chỉnh, kéo bên trong để dời.</p>' +
      '<div class="anh-cat-khung"><div class="anh-cat-vung" hidden></div></div><div class="nut-sua"><button class="chinh" type="button" disabled>Cắt và dùng ảnh này</button><button type="button">Bỏ</button></div></div>';
    const khung = lop.querySelector(".anh-cat-khung"), vung = lop.querySelector(".anh-cat-vung"), [dong, bo] = lop.querySelectorAll("button");
    nguon.style.width = `${Math.round(W * tl)}px`;
    nguon.style.height = `${Math.round(H * tl)}px`;
    khung.prepend(nguon);
    const gioi = {w: Math.round(W * tl), h: Math.round(H * tl)};
    let r = null, che = null;  // r: {x0, y0, x1, y1} theo điểm ảnh của khung
    const cat = (v, a, b) => Math.min(b, Math.max(a, v));
    const hop = () => r && {x: Math.min(r.x0, r.x1), y: Math.min(r.y0, r.y1), w: Math.abs(r.x1 - r.x0), h: Math.abs(r.y1 - r.y0)};
    const ve = () => {
      const h = hop(), tot = !!h && h.w >= 8 && h.h >= 8;
      vung.hidden = !h;
      if (h) Object.assign(vung.style, {left: `${h.x}px`, top: `${h.y}px`, width: `${h.w}px`, height: `${h.h}px`});
      dong.disabled = !tot;
    };
    const diem = e => { const b = khung.getBoundingClientRect(); return {x: cat(e.clientX - b.left, 0, gioi.w), y: cat(e.clientY - b.top, 0, gioi.h)}; };
    khung.onpointerdown = e => {
      e.preventDefault();
      khung.setPointerCapture(e.pointerId);
      const p = diem(e), h = hop();
      che = {kieu: "moi", p};
      if (h) {
        const gan = (a, b) => Math.abs(p.x - a) < 14 && Math.abs(p.y - b) < 14;
        const goc = [[h.x, h.y, h.x + h.w, h.y + h.h], [h.x + h.w, h.y, h.x, h.y + h.h], [h.x, h.y + h.h, h.x + h.w, h.y], [h.x + h.w, h.y + h.h, h.x, h.y]].find(c => gan(c[0], c[1]));
        if (goc) { r = {x0: goc[2], y0: goc[3], x1: p.x, y1: p.y}; che = {kieu: "goc"}; }
        else if (p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) che = {kieu: "dom", p, h};
      }
      if (che.kieu === "moi") r = {x0: p.x, y0: p.y, x1: p.x, y1: p.y};
      ve();
    };
    khung.onpointermove = e => {
      if (!che) return;
      const p = diem(e);
      if (che.kieu === "dom") {
        const x = cat(che.h.x + p.x - che.p.x, 0, gioi.w - che.h.w), y = cat(che.h.y + p.y - che.p.y, 0, gioi.h - che.h.h);
        r = {x0: x, y0: y, x1: x + che.h.w, y1: y + che.h.h};
      } else { r.x1 = p.x; r.y1 = p.y; }
      ve();
    };
    khung.onpointerup = khung.onpointercancel = () => { che = null; const h = hop(); if (h && (h.w < 8 || h.h < 8)) { r = null; ve(); } };
    const dongHop = kq => { removeEventListener("keydown", phim, true); lop.remove(); ok(kq); };
    const phim = e => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); dongHop(null); }
      else if (e.key === "Enter" && !dong.disabled) { e.preventDefault(); e.stopPropagation(); dong.click(); }
    };
    dong.onclick = () => { const h = hop(); dongHop({x: Math.round(h.x / tl), y: Math.round(h.y / tl), w: Math.min(W, Math.round(h.w / tl)), h: Math.min(H, Math.round(h.h / tl))}); };
    bo.onclick = () => dongHop(null);
    lop.addEventListener("pointerdown", e => { if (e.target === lop) dongHop(null); });
    addEventListener("keydown", phim, true);
    document.body.append(lop);
    dong.focus();
  });
}

async function anhCat() {
  const L = anhLenh(), s = L && $("vung-dong").querySelector(`.anh-dong[data-dau="${anhChon.dau}"]`);
  if (!L || !s || s.classList.contains("thieu")) return;
  try {
    const n = await anhLay(anhUrl(L.ref)), nguon = document.createElement("canvas");
    if (n.url) {
      const bm = await createImageBitmap(n.blob);
      nguon.width = bm.width;
      nguon.height = bm.height;
      nguon.getContext("2d").drawImage(bm, 0, 0);
    } else {
      const c = await anhVe(n, Math.min(4, 3000 / (await n.pdf.getPage(1)).getViewport({scale: 1}).width));
      nguon.width = c.width;
      nguon.height = c.height;
      nguon.getContext("2d").drawImage(c, 0, 0);
    }
    const goc = document.createElement("canvas");
    goc.width = nguon.width;
    goc.height = nguon.height;
    goc.getContext("2d").drawImage(nguon, 0, 0);
    const v = await anhHopCat(nguon);
    if (!v) return;
    const ra = document.createElement("canvas");
    ra.width = v.w;
    ra.height = v.h;
    ra.getContext("2d").drawImage(goc, v.x, v.y, v.w, v.h, 0, 0, v.w, v.h);
    const jpg = n.url && n.blob.type === "image/jpeg";
    const blob = await anhCanvasRa(ra, jpg ? "image/jpeg" : "image/png", 0.92);
    await anhThayBang(new File([blob], jpg ? "cat.jpg" : "cat.png", {type: blob.type}));
  } catch (e) { bao(e.message, true); }
}

// ---------- Nối sự kiện ----------

soan.on("change", () => { if (!anhDangSua) anhBoChon(); });
$("vung-dong").addEventListener("scroll", () => anhVeLop(), {passive: true});
addEventListener("resize", () => anhVeLop());

// Bấm vào ảnh thì chọn ảnh, không mở ô sửa dòng (nghe ở pha bắt để chạy trước trình nghe của theo-dong.js).
$("vung-dong").addEventListener("click", e => {
  const s = e.target.closest?.(".anh-dong");
  if (!s || e.ctrlKey || e.metaKey || e.shiftKey || !s.dataset.dau) return;
  e.stopPropagation();
  e.preventDefault();
  const nut = s.closest(".dong[data-thu-tu]");
  if (!nut) return;
  const thuTu = +nut.dataset.thuTu, n = +s.dataset.n;
  chotDong();
  const d = tt.dong[thuTu], c = d && anhTim(soan.getValue().slice(d.dau, d.cuoi))[n];
  if (!c) return;
  if (typeof keoBoChon === "function") keoBoChon();
  anhChon = {dau: d.dau + c.dau, tep: tt.tep};
  anhDanhDau();
}, true);

// Bấm ra ngoài ảnh và các nút của nó thì bỏ chọn.
document.addEventListener("pointerdown", e => {
  if (anhChon && !e.target.closest?.(".anh-dong, #anh-lop, #anh-cat")) anhBoChon();
}, true);

document.addEventListener("keydown", e => {
  if (!anhChon || e.target.closest?.("input, textarea, select, dialog, .CodeMirror, #anh-cat") || document.querySelector(".bang-menu")) return;
  if (e.key === "Escape") anhBoChon();
  else if ((e.key === "Delete" || e.key === "Backspace") && !e.ctrlKey && !e.altKey) { e.preventDefault(); anhXoa(); }
});

const anhLaAnh = f => f && (/^image\//.test(f.type) || f.type === "application/pdf" || /\.(png|jpe?g|webp|bmp|gif|pdf)$/i.test(f.name));

// Đưa file ảnh vào đúng chỗ: ảnh đang chọn (thay), hay câu (chèn).
async function anhNhan(file, khoi) {
  if (khoi) return anhChen(file, khoi.i);
  if (tt.dangSua?.khoi && tt.dangSua.khoi.loai !== "muc") return anhChen(file, tt.dangSua.khoi.i);  // đang gõ trong một dòng thì chèn vào câu đó
  if (anhChon) return anhThayBang(file);
  const k = anhKhoiDich();
  if (k) return anhChen(file, k.i);
  bao("Bấm vào một dòng của câu (hoặc Ctrl+bấm để chọn câu) hoặc bấm vào ảnh cần thay, rồi dán lại.", true);
}

document.addEventListener("paste", e => {
  if (tt.cheDo !== "dong" || !tt.tep?.la_tex || $("vung-dong").hidden || e.target.closest?.("input, select, dialog, .CodeMirror")) return;
  const f = [...(e.clipboardData?.files || [])].find(anhLaAnh);
  if (!f) return;
  e.preventDefault();
  anhNhan(f, null);
});

let anhThaDen = null;
const anhBoTha = () => { anhThaDen?.classList.remove("anh-tha"); anhThaDen = null; };
$("vung-dong").addEventListener("dragover", e => {
  if (!e.dataTransfer?.types?.includes("Files")) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
  const o = e.target.closest?.(".anh-dong, .khoi.bai, .khoi.lt, .khoi.tu-do");
  if (o !== anhThaDen) { anhBoTha(); anhThaDen = o; o?.classList.add("anh-tha"); }
});
$("vung-dong").addEventListener("dragleave", e => { if (!$("vung-dong").contains(e.relatedTarget)) anhBoTha(); });
$("vung-dong").addEventListener("drop", e => {
  if (!e.dataTransfer?.types?.includes("Files")) return;
  e.preventDefault();
  anhBoTha();
  const f = [...e.dataTransfer.files].find(anhLaAnh);
  if (!f) return bao("Chỉ nhận ảnh PNG, JPG, PDF (WEBP, BMP, GIF tự đổi sang PNG).", true);
  const s = e.target.closest?.(".anh-dong"), o = e.target.closest?.(".khoi");
  if (s?.dataset.dau) {
    anhChon = {dau: +s.dataset.dau, tep: tt.tep};
    return anhThayBang(f);
  }
  const k = o && tt.khoi[+o.dataset.i];
  if (k && k.loai !== "muc") return anhChen(f, k.i);
  bao("Thả ảnh vào một câu hoặc vào ảnh cần thay.", true);
});
