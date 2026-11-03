"use strict";
// Công cụ PDF: một dãy trang lấy từ một hay nhiều file. Gộp là lưu cả dãy, tách là lưu các trang đã chọn.

const pt = {tep: new Map(), ds: [], xem: null, keo: null, soId: 0, nhap: false, doi: false, ten: "", nguon: null, thuMuc: null};  // nhap: dãy lấy từ PDF biên dịch; doi: dãy đã đổi so với lúc mở; thuMuc: nơi gợi ý lưu của PDF chưa có file thật

const dangPdf = () => document.body.classList.contains("che-do-pdf");

function vaoPdf() {
  if (!dangPdf()) chuyenTab("trang");
  document.body.classList.add("che-do-pdf");
  document.querySelectorAll(".nut-tep").forEach(b => b.removeAttribute("aria-current"));
  bc.soan = bc.xem = true;
  apBoCuc();
}

async function napTep(t) {
  if (pt.tep.has(t.duong)) return;
  const tl = await fetch(`/api/pdf-tep?duong=${encodeURIComponent(t.duong)}`);
  if (!tl.ok) throw new Error(`Không đọc được ${t.ten}.`);
  pt.tep.set(t.duong, {ten: t.ten, doc: await pdfjsLib.getDocument({data: await tl.arrayBuffer()}).promise});
}

// File đã có trong dãy thì chỉ nhảy đến trang đầu của nó, chưa có thì thêm vào cuối dãy.
async function nhanTep(tep) {
  vaoPdf();
  let dau = null;
  for (const t of tep) {
    const cu = pt.ds.find(x => x.duong === t.duong);
    if (cu) { dau = cu; continue; }
    await napTep(t);
    for (let so = 1; so <= t.so_trang; so++) {
      pt.ds.push({id: ++pt.soId, duong: t.duong, so, chon: false});
      if (so === 1) dau = pt.ds[pt.ds.length - 1];
    }
  }
  pt.ten = pt.tep.size === 1 ? [...pt.tep.values()][0].ten : `${pt.tep.size} file PDF`;
  veDsTrang();
  if (dau) xemTrang(dau);
}

// Nút Thêm PDF: thêm vào dãy của thẻ PDF đang hiện để gộp, chưa có thẻ PDF thì mở thẻ mới.
async function themPdf(duong) {
  try {
    let kq = await goi("/api/pdf-chon", duong ? {duong} : {});
    if (kq.khong_co_hop) {
      const nhap = prompt("Dán đường dẫn file PDF:");
      if (!nhap) return;
      kq = await goi("/api/pdf-chon", {duong: [nhap.trim().replace(/^"|"$/g, "")]});
    }
    if (kq.huy) return;
    if (dangPdf()) { pt.doi = true; await nhanTep(kq.tep); the.hien.ten = pt.ten; veThe(); }
    else await moThePdf(kq.tep);
  } catch (e) { bao(e.message, true); }
}

// Bấm file PDF trên thanh file: đã mở thì về thẻ đó, chưa thì mở thẻ mới.
async function moFilePdf(duong) {
  const co = the.ds.find(t => t.loai === "pdf" && t.duong === duong);
  if (co) return chonThe(co);
  try {
    await moThePdf((await goi("/api/pdf-chon", {duong: [duong]})).tep);
  } catch (e) { bao(e.message, true); }
}

// Chọn nhiều file trong Explorer rồi bấm Gộp thành PDF: mở thành một thẻ để sắp xếp và gộp.
async function moGop(ds) {
  try {
    await moThePdf((await goi("/api/pdf-chon", {duong: ds})).tep);
  } catch (e) { bao(e.message, true); }
}

// Chuyển thành PDF và mở: mỗi file một thẻ, chưa lưu nên app còn hỏi trước khi đóng. Lưu thì gợi ý tên đó ở thư mục của file gốc.
async function moChuyen(ds) {
  for (const {duong, thu_muc} of ds) {
    try {
      await moThePdf((await goi("/api/pdf-chon", {duong: [duong]})).tep);
      pt.doi = true;
      pt.thuMuc = thu_muc;
      capNhatRibbon();
    } catch (e) { bao(e.message, true); }
  }
}

// PDF biên dịch mở thành thẻ riêng để tách, gộp. Lưu ở thẻ này vẫn ghi vào vị trí đã định của file .tex.
async function sapTrangTuBienDich() {
  if (!tt.tep?.la_tex) return bao("Mở một file .tex hoặc một file PDF trước.", true);
  const khoa = `${tt.tep.duong}|${tt.ban}`, co = the.ds.find(t => t.duong === khoa);
  if (co) return chonThe(co);
  try {
    const nguon = {duong: tt.tep.duong, ban: tt.ban}, trangCu = xvTex.trang, tb = xvTex.tb;
    await moThePdf((await goi("/api/pdf-nhap", nguon)).tep, khoa);
    pt.nhap = true;
    pt.nguon = nguon;
    // Chú thích đã vẽ trên PDF biên dịch đi theo sang thẻ mới.
    trangCu.forEach((t, i) => { if (pt.ds[i] && t.m.ct?.length) pt.ds[i].ct = t.m.ct; });
    xvPdf.tb = tb;
    await xvPdf.sanSang;
    xvPdf.trang.forEach(t => xvPdf.veLop(t));
    capNhatRibbon();
  } catch (e) { bao(e.message, true); }
}

// lop: {tb, i, n} để vẽ thêm đầu trang, chân trang. dungCo: rong là số điểm ảnh thật, không nhân độ phân giải màn hình.
async function veCanvas(cv, muc, rong, intent = "display", lop = null, dungCo = false) {
  const tr = await (muc.doc || pt.tep.get(muc.duong).doc).getPage(muc.so);
  const rotation = (tr.rotate + (muc.xoay || 0)) % 360, goc = tr.getViewport({scale: 1, rotation});
  const he = rong / goc.width * (dungCo ? 1 : window.devicePixelRatio || 1);
  const vp = tr.getViewport({scale: he, rotation});
  cv.width = vp.width;
  cv.height = vp.height;
  cv.style.width = `${rong}px`;
  const ctx = cv.getContext("2d");
  await tr.render({canvasContext: ctx, viewport: vp, intent}).promise;
  ctx.setTransform(he, 0, 0, he, 0, 0);
  veCt(ctx, muc.ct);
  if (lop) veTrinhBay(ctx, lop.tb, lop.i, lop.n, goc.width, goc.height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function veDsTrang() {
  const o = $("ds-trang");
  const quan = new IntersectionObserver(muc => muc.forEach(m => {
    if (!m.isIntersecting) return;
    quan.unobserve(m.target);
    const id = +m.target.closest(".o-trang").dataset.id, x = pt.ds.find(d => d.id === id);
    if (x) veCanvas(m.target, x, Math.max(120, o.clientWidth - 32)).then(() => {
      m.target.style.aspectRatio = `${m.target.width} / ${m.target.height}`;
    });
  }), {root: o, rootMargin: "300px"});
  o.replaceChildren(...pt.ds.map((x, i) => {
    const d = document.createElement("div");
    d.className = "o-trang";
    d.dataset.id = x.id;
    d.draggable = true;
    d.classList.toggle("dang-xem", pt.xem?.id === x.id);
    const cv = document.createElement("canvas"), hop = document.createElement("label"), c = document.createElement("input");
    c.type = "checkbox";
    c.checked = x.chon;
    c.onchange = () => { x.chon = c.checked; capNhatChon(); };
    hop.append(c, ` ${i + 1}`);
    hop.title = `${pt.tep.get(x.duong).ten}, trang ${x.so}`;
    d.append(cv, hop);
    cv.onclick = () => xemTrang(x);
    d.ondragstart = () => { pt.keo = x; };
    d.ondragover = e => e.preventDefault();
    d.ondrop = e => {
      e.preventDefault();
      if (!pt.keo || pt.keo === x) return;
      pt.ds.splice(pt.ds.indexOf(pt.keo), 1);
      pt.ds.splice(pt.ds.indexOf(x), 0, pt.keo);
      pt.keo = null;
      pt.doi = true;
      veDsTrang();
    };
    quan.observe(cv);
    return d;
  }));
  capNhatChon();
  dongBoXem();
  window.veMucLuc?.();
}

function capNhatChon() {
  const n = pt.ds.filter(x => x.chon).length;
  $("so-chon").textContent = pt.ds.length ? `Đã chọn ${n} / ${pt.ds.length} trang` : "";
  $("chon-tat-ca").checked = n > 0 && n === pt.ds.length;
  $("chon-tat-ca").indeterminate = n > 0 && n < pt.ds.length;
  window.capNhatMucLuc?.();
  capNhatRibbon();
}

function danhDauXem() {
  document.querySelectorAll(".o-trang").forEach(d => {
    const dung = +d.dataset.id === pt.xem?.id;
    d.classList.toggle("dang-xem", dung);
    if (dung) d.scrollIntoView({block: "nearest"});
  });
  window.capNhatMucLuc?.();
}

async function xemTrang(x) {
  pt.xem = x;
  danhDauXem();
  if (!x) return;
  await xvPdf.sanSang;
  const i = xvPdf.trang.findIndex(t => t.m === x);
  if (i >= 0) xvPdf.den(i);
}

// Dãy đổi thứ tự hay bớt trang thì khung xem phải theo, còn chỉ đổi chọn thì không vẽ lại.
function dongBoXem() {
  const cu = xvPdf.trang.map(t => t.m);
  if (cu.length !== pt.ds.length || cu.some((m, i) => m !== pt.ds[i])) xvPdf.mo([...pt.ds], {giu: true});
}

// "1-3, 5" tính theo số thứ tự trong dãy trang đang hiện.
function chonTheoKhoang() {
  const nhap = $("khoang-trang").value.trim();
  if (!nhap) return;
  const chon = new Set();
  for (const ph of nhap.split(",")) {
    const m = ph.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) return bao(`Không hiểu "${ph.trim()}". Gõ kiểu 1-3, 5.`, true);
    const dau = +m[1], cuoi = +(m[2] || m[1]);
    if (dau < 1 || cuoi > pt.ds.length || dau > cuoi) return bao(`Dãy hiện chỉ có ${pt.ds.length} trang.`, true);
    for (let i = dau; i <= cuoi; i++) chon.add(i);
  }
  pt.ds.forEach((x, i) => { x.chon = chon.has(i + 1); });
  veDsTrang();
}

function chonHet(co) {
  pt.ds.forEach(x => { x.chon = co; });
  veDsTrang();
}

function boTrang(ds = pt.ds.filter(x => x.chon)) {
  pt.ds = pt.ds.filter(x => !ds.includes(x));
  pt.doi = true;
  veDsTrang();
  if (pt.xem && !pt.ds.includes(pt.xem)) xemTrang(pt.ds[0] || null);
}

async function luuTrang(chiChon, dich, loc = m => m.chon) {
  datViec("Đang lưu PDF...");
  try {
    const trang = await gomTrang(xvPdf, m => !chiChon || loc(m));
    const ten = pt.thuMuc && !chiChon ? pt.ten : `${pt.ten.replace(/\.pdf$/i, "")}-moi.pdf`, nguon = chiChon ? null : pt.nguon;
    let kq = await goi("/api/pdf-ghi", {trang, ten, dich, nguon, thu_muc: pt.thuMuc});
    if (kq.khong_co_hop) {
      const nhap = prompt("Dán đường dẫn file PDF sẽ lưu:");
      if (!nhap) return;
      kq = await goi("/api/pdf-ghi", {trang, ten, dich: nhap.trim().replace(/^"|"$/g, "")});
    }
    if (kq.huy) return;
    bao(`Đã lưu ${kq.so_trang} trang vào ${kq.ten}`);
    if (!chiChon) { pt.nhap = pt.doi = false; capNhatRibbon(); }
    if (nguon) {
      const tex = the.ds.find(t => t.loai === "tex" && t.duong === nguon.duong);
      if (tex?.s) tex.s.pdfDaLuu = true;
      if (tt.tep?.duong === nguon.duong) tt.pdfDaLuu = true;
      lamMoiCay();
    }
  } catch (e) { bao(e.message, true); }
  finally { datViec(""); }
}

// ---------- Thao tác trên trang: chưa chọn trang nào thì áp cho trang đang xem ----------

const trangTacDong = () => (pt.ds.some(x => x.chon) ? pt.ds.filter(x => x.chon) : pt.xem ? [pt.xem] : []);

function daDoiDay() {
  pt.doi = true;
  veDsTrang();
}

async function xoayTrang(cw, ds = trangTacDong()) {
  for (const m of ds) {
    const t = xvPdf.trang.find(x => x.m === m);
    xoayCt(m.ct, cw, t.w, t.h);
    m.xoay = ((m.xoay || 0) + (cw ? 90 : 270)) % 360;
  }
  await xvPdf.mo([...pt.ds], {giu: true});
  daDoiDay();
}

async function themTrangTrong(sau = pt.xem) {
  const t = xvPdf.trang.find(x => x.m === sau) || xvPdf.trang[xvPdf.hien];
  try {
    const tep = await goi("/api/pdf-trong", {rong: t?.w, cao: t?.h});
    await napTep(tep);
    const moi = {id: ++pt.soId, duong: tep.duong, so: 1, chon: false};
    pt.ds.splice(pt.ds.indexOf(sau) + 1, 0, moi);
    daDoiDay();
    xemTrang(moi);
  } catch (e) { bao(e.message, true); }
}

function nhanBanTrang(ds = trangTacDong()) {
  for (const m of ds) pt.ds.splice(pt.ds.indexOf(m) + 1, 0, {...m, id: ++pt.soId, chon: false, ct: structuredClone(m.ct || [])});
  daDoiDay();
}

function dichTrang(len) {
  const ds = trangTacDong();
  pt.ds = len ? [...ds, ...pt.ds.filter(x => !ds.includes(x))] : [...pt.ds.filter(x => !ds.includes(x)), ...ds];
  daDoiDay();
  xemTrang(pt.xem);
}

function daoThuTu() {
  const chon = pt.ds.some(x => x.chon);
  const dao = chon ? pt.ds.filter(x => x.chon).reverse() : [...pt.ds].reverse();
  let i = 0;
  pt.ds = chon ? pt.ds.map(x => (x.chon ? dao[i++] : x)) : dao;
  daDoiDay();
}

async function xuatAnh(chiTrang) {
  const v = xv(), n = v.trang.length;
  const loc = chiTrang ? t => t === chiTrang : dangPdf() && pt.ds.some(x => x.chon) ? t => t.m.chon : () => true;
  try {
    let kq = await goi("/api/chon-thu-muc", {});
    if (kq.khong_co_hop) {
      const nhap = prompt("Dán đường dẫn thư mục lưu ảnh:");
      if (!nhap) return;
      kq = {duong: nhap.trim().replace(/^"|"$/g, "")};
    }
    if (kq.huy) return;
    const goc = (dangPdf() ? pt.ten : tt.tep.ten).replace(/\.[^.]+$/, "");
    const ds = v.trang.filter(loc);
    for (const [i, t] of ds.entries()) {
      datViec(`Đang xuất ảnh ${i + 1} / ${ds.length}...`);
      const cv = document.createElement("canvas");
      await veCanvas(cv, t.m, t.w * 200 / 72, "print", {tb: v.tb, i: v.trang.indexOf(t), n}, true);
      await goi("/api/anh-ghi", {thu_muc: kq.duong, ten: `${goc}-trang-${v.trang.indexOf(t) + 1}`, png: cv.toDataURL("image/png").split(",")[1]});
    }
    bao(`Đã xuất ${ds.length} ảnh vào ${kq.duong}`);
  } catch (e) { bao(e.message, true); }
  finally { datViec(""); }
}

$("khoang-trang").onkeydown = e => { if (e.key === "Enter") chonTheoKhoang(); };
$("chon-tat-ca").onchange = e => chonHet(e.target.checked);
$("an-day").onclick = () => batTat("soan");
