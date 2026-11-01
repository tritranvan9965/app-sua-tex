"use strict";
// Trình xem PDF dùng chung cho PDF biên dịch và dãy trang: xem liên tục hoặc từng trang, zoom, bôi đen chữ, kéo chọn vùng.
// Trang chỉ vẽ khi gần khung nhìn và được bỏ khi đi xa, để file dài không ngốn bộ nhớ.

const LE_XEM = 12;
const PT_SANG_PX = 96 / 72;  // 100% là đúng khổ thật của trang
const ZOOM_MIN = 0.25, ZOOM_MAX = 5;
const SO_DIEM_ANH_TOI_DA = 16e6;
const DO_NET_ANH_VUNG = 3;  // điểm ảnh trên một pt, tức khoảng 216 dpi

const docCua = m => m.doc || pt.tep.get(m.duong).doc;

let congCu = "chu", vungChon = null;

class TrinhXem {
  constructor(o, khiBam, khiDoi) {
    Object.assign(this, {o, khiBam, khiDoi, trang: [], kieu: "rong", tiLe: 1, daVe: 0, hien: 0, lan: 0, sanSang: Promise.resolve(), henCuon: 0, bamTai: null});
    this.quan = new IntersectionObserver(muc => muc.forEach(m => {
      const t = this.trang[+m.target.dataset.trang - 1];
      if (!t) return;
      if (m.isIntersecting) this.veMot(t); else this.xoaVe(t);
    }), {root: o, rootMargin: "600px"});
    o.addEventListener("scroll", () => {
      this.henCuon ||= requestAnimationFrame(() => { this.henCuon = 0; this.theoCuon(); });
    });
    o.addEventListener("wheel", e => {
      if (!e.ctrlKey || !this.trang.length) return;
      e.preventDefault();
      this.doiZoom(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    }, {passive: false});
    o.addEventListener("pointerdown", e => this.batDauKeo(e));
    o.addEventListener("pointerup", e => this.bam(e));
  }

  mo(ds, {giu = false} = {}) {
    this.sanSang = this.moTrang(ds, giu);
    return this.sanSang;
  }

  async moTrang(ds, giu) {
    const lan = ++this.lan;
    const kich = await Promise.all(ds.map(async m => {
      const tr = await docCua(m).getPage(m.so), r = (tr.rotate + (m.xoay || 0)) % 360;
      const v = tr.getViewport({scale: 1, rotation: r});
      m.ct ??= [];
      return {m, tr, r, w: v.width, h: v.height};
    }));
    if (lan !== this.lan) return;
    const cuon = this.o.scrollTop / (this.o.scrollHeight || 1);  // theo tỉ lệ, vì số trang có thể đổi
    this.xoa();
    this.lan = lan;
    this.trang = kich.map((t, i) => {
      const d = document.createElement("div");
      d.className = "to-trang";
      d.dataset.trang = i + 1;
      return {...t, o: d, ve: false, tac: null};
    });
    this.hien = giu ? Math.min(this.hien, this.trang.length - 1) : 0;
    this.daVe = 0;
    this.o.replaceChildren(...this.trang.map(t => t.o));
    this.apTungTrang();
    this.khop();
    if (giu) this.o.scrollTop = cuon * this.o.scrollHeight;
    this.trang.forEach(t => this.quan.observe(t.o));
    capNhatNav();
  }

  // Bỏ hết trang đang vẽ, dùng khi khung chuyển sang báo lỗi hay đóng PDF.
  xoa() {
    this.lan++;
    this.quan.disconnect();
    this.trang.forEach(t => this.xoaVe(t));
    if (vungChon?.xem === this) xoaVung();
    this.trang = [];
    capNhatNav();
  }

  xoaVe(t) {
    t.tac?.cancel();
    t.tac = null;
    t.ve = false;
    if (vungChon?.t === t) xoaVung();
    t.o.replaceChildren();
  }

  // Tính lại cỡ trang theo khung. Đổi cỡ thì giữ nguyên chỗ đang đọc trên trang hiện tại.
  khop() {
    const t = this.trang[this.hien], o = this.o;
    if (!t || !o.clientWidth) return;
    const rong = o.clientWidth - 2 * LE_XEM, cao = o.clientHeight - 2 * LE_XEM;
    if (this.kieu === "rong") this.tiLe = rong / Math.max(...this.trang.map(x => x.w));
    else if (this.kieu === "trang") this.tiLe = Math.min(rong / t.w, cao / t.h);
    if (Math.abs(this.tiLe - this.daVe) > 0.001) {
      const dang = this.daVe ? (o.scrollTop - t.o.offsetTop) / t.o.offsetHeight : 0;
      this.daVe = this.tiLe;
      for (const x of this.trang) {
        this.xoaVe(x);
        x.o.style.width = `${x.w * this.tiLe}px`;
        x.o.style.height = `${x.h * this.tiLe}px`;
        this.quan.unobserve(x.o);
        this.quan.observe(x.o);
      }
      o.scrollTop = t.o.offsetTop + dang * t.o.offsetHeight;
    }
    capNhatNav();
  }

  async veMot(t) {
    if (t.ve) return;
    t.ve = true;
    const vp = t.tr.getViewport({scale: this.daVe, rotation: t.r});
    const net = Math.min(window.devicePixelRatio || 1, Math.sqrt(SO_DIEM_ANH_TOI_DA / (vp.width * vp.height)));
    const vpVe = t.tr.getViewport({scale: this.daVe * net, rotation: t.r}), cv = document.createElement("canvas");
    cv.width = vpVe.width;
    cv.height = vpVe.height;
    t.net = net;
    t.lop = document.createElement("canvas");
    t.lop.className = "lop-ct";
    t.o.append(cv, t.lop);
    this.veLop(t);
    t.tac = t.tr.render({canvasContext: cv.getContext("2d"), viewport: vpVe});
    try {
      await t.tac.promise;
    } catch { return; }  // trang bị bỏ giữa chừng vì đã cuộn đi xa hoặc đổi zoom
    t.tac = null;
    if (!t.ve || !cv.isConnected) return;
    const lop = document.createElement("div"), cuoi = document.createElement("div");
    lop.className = "textLayer";
    lop.style.setProperty("--scale-factor", vp.scale);
    cuoi.className = "endOfContent";
    t.o.append(lop);
    await pdfjsLib.renderTextLayer({textContentSource: t.tr.streamTextContent(), container: lop, viewport: vp}).promise;
    lop.append(cuoi);
  }

  // Vẽ lại lớp chú thích của một trang, trang chưa vẽ thì để lúc cuộn tới.
  veLop(t) {
    if (!t.lop?.isConnected) return;
    const ctx = t.lop.getContext("2d"), he = this.daVe * t.net;
    t.lop.width = Math.round(t.w * he);
    t.lop.height = Math.round(t.h * he);
    ctx.scale(he, he);
    veCt(ctx, t.m.ct);
    veTrinhBay(ctx, this.tb, this.trang.indexOf(t), this.trang.length, t.w, t.h);
  }

  den(i) {
    this.hien = Math.max(0, Math.min(this.trang.length - 1, i));
    this.apTungTrang();
    this.khop();
    const t = this.trang[this.hien];
    if (t) this.o.scrollTop = this.laTungTrang() ? 0 : t.o.offsetTop - LE_XEM;
    this.khiDoi?.(this.hien);
    capNhatNav();
  }

  laTungTrang() { return this.o.classList.contains("tung-trang"); }

  apTungTrang() {
    this.trang.forEach((t, i) => t.o.classList.toggle("hien", i === this.hien));
  }

  theoCuon() {
    if (this.laTungTrang() || !this.trang.length) return;
    const y = this.o.scrollTop + this.o.clientHeight * 0.4;
    let i = 0;
    while (i + 1 < this.trang.length && this.trang[i + 1].o.offsetTop <= y) i++;
    if (i === this.hien) return;
    this.hien = i;
    this.apTungTrang();
    this.khiDoi?.(i);
    capNhatNav();
  }

  datZoom(tiLe) {
    this.kieu = "tuy";
    this.tiLe = Math.min(ZOOM_MAX * PT_SANG_PX, Math.max(ZOOM_MIN * PT_SANG_PX, tiLe));
    this.khop();
  }

  doiZoom(he) { this.datZoom(this.tiLe * he); }

  datKhop(kieu) {
    this.kieu = kieu;
    this.khop();
    capNhatRibbon();
  }

  batDauKeo(e) {
    const dau = e.target.closest?.(".to-trang");
    this.bamTai = {x: e.clientX, y: e.clientY};
    if (!dau || e.button || e.target.closest(".thanh-vung, .o-nhap")) return;
    const t = this.trang[+dau.dataset.trang - 1], goc = dau.getBoundingClientRect();
    const px = (e.clientX - goc.left) / this.daVe, py = (e.clientY - goc.top) / this.daVe;
    if (NHOM_BAM.has(congCu)) { e.preventDefault(); return moNhapChu(this, t, px, py, congCu); }
    if (congCu === "tay") {
      const i = ctTai(t.m.ct, px, py);
      if (i >= 0) {
        lichCt.push({v: this, t, ct: [...t.m.ct]});
        t.m.ct.splice(i, 1);
        this.veLop(t);
        daDoiCt(this);
      }
      return;
    }
    if (NHOM_KEO.has(congCu)) return this.keoVe(e, dau, t, goc);
    if (congCu !== "vung") return;
    e.preventDefault();
    xoaVung();
    const khung = document.createElement("div");
    khung.className = "khung-vung";
    dau.append(khung);
    const toa = ev => [Math.max(0, Math.min(goc.width, ev.clientX - goc.left)), Math.max(0, Math.min(goc.height, ev.clientY - goc.top))];
    const [x0, y0] = toa(e);
    const di = ev => {
      const [x, y] = toa(ev);
      Object.assign(khung.style, {left: `${Math.min(x, x0)}px`, top: `${Math.min(y, y0)}px`, width: `${Math.abs(x - x0)}px`, height: `${Math.abs(y - y0)}px`});
    };
    di(e);
    dau.setPointerCapture(e.pointerId);
    dau.addEventListener("pointermove", di);
    dau.addEventListener("pointerup", ev => {
      dau.removeEventListener("pointermove", di);
      const [x, y] = toa(ev), w = Math.abs(x - x0), h = Math.abs(y - y0);
      if (w < 6 || h < 6) return khung.remove();
      vungChon = {xem: this, t, khung, x: Math.min(x, x0), y: Math.min(y, y0), w, h};
      khung.append(thanhVung());
    }, {once: true});
  }

  keoVe(e, dau, t, goc) {
    e.preventDefault();
    const toa = ev => [Math.max(0, Math.min(t.w, (ev.clientX - goc.left) / this.daVe)), Math.max(0, Math.min(t.h, (ev.clientY - goc.top) / this.daVe))];
    const dau0 = toa(e), c = {loai: congCu, mau: mauCt, net: netCt, d: [dau0, dau0]};
    const cu = [...t.m.ct];
    t.m.ct.push(c);
    const di = ev => {
      if (c.loai === "but") c.d.push(toa(ev)); else c.d = [dau0, toa(ev)];
      this.veLop(t);
    };
    dau.setPointerCapture(e.pointerId);
    dau.addEventListener("pointermove", di);
    dau.addEventListener("pointerup", ev => {
      dau.removeEventListener("pointermove", di);
      const [x, y] = toa(ev);
      if (c.d.length < 3 && Math.hypot(x - dau0[0], y - dau0[1]) < 2) {  // chỉ bấm chứ không kéo
        t.m.ct = cu;
        return this.veLop(t);
      }
      lichCt.push({v: this, t, ct: cu});
      daDoiCt(this);
    }, {once: true});
  }

  // Bấm vào PDF biên dịch là nhảy tới bài tương ứng. Vừa kéo bôi đen thì không tính là bấm.
  bam(e) {
    const dau = e.target.closest?.(".to-trang"), tu = this.bamTai;
    this.bamTai = null;
    if (NHOM_CHU.has(congCu) && dau) return danhDauChu(this, dau, congCu);
    if (!this.khiBam || congCu !== "chu" || !dau || !tu) return;
    if (Math.hypot(e.clientX - tu.x, e.clientY - tu.y) > 4 || !getSelection().isCollapsed) return;
    const g = dau.getBoundingClientRect();
    this.khiBam(+dau.dataset.trang, 1 - (e.clientY - g.top) / g.height);
  }
}

const xvTex = new TrinhXem($("xem-pdf"), (trang, tiLeY) => bamPdf(trang, tiLeY));
const xvPdf = new TrinhXem($("xem-trang"), null, i => {
  pt.xem = xvPdf.trang[i].m;
  danhDauXem();
});
const xv = () => (dangPdf() ? xvPdf : xvTex);

async function luuPdfTex() {
  datViec("Đang lưu PDF...");
  try {
    const tep = (await goi("/api/pdf-nhap", {duong: tt.tep.duong, ban: tt.ban})).tep[0];
    const kq = await goi("/api/pdf-ghi", {trang: await gomTrang(xvTex, undefined, tep.duong), nguon: {duong: tt.tep.duong, ban: tt.ban}});
    tt.pdfDaLuu = true;
    bao(`Đã lưu ${kq.ten} cạnh file .tex`);
    lamMoiCay();
  } catch (e) { bao(e.message, true); }
  datViec("");
}

// ---------- Chọn vùng ----------

function thanhVung() {
  const o = document.createElement("div"), sao = document.createElement("button"), dong = document.createElement("button");
  o.className = "thanh-vung";
  sao.type = dong.type = "button";
  sao.innerHTML = `${bieuTuong("nhan-ban")}<span>Sao chép ảnh</span>`;
  sao.onclick = saoVung;
  dong.innerHTML = bieuTuong("dong");
  dong.setAttribute("aria-label", "Bỏ vùng chọn");
  dong.onclick = xoaVung;
  o.append(sao, dong);
  return o;
}

function xoaVung() {
  vungChon?.khung.remove();
  vungChon = null;
}

async function anhVung({t, x, y, w, h, xem}) {
  const vp = t.tr.getViewport({scale: DO_NET_ANH_VUNG, rotation: t.r}), he = DO_NET_ANH_VUNG / xem.daVe;
  const ca = document.createElement("canvas"), cat = document.createElement("canvas");
  ca.width = vp.width;
  ca.height = vp.height;
  await t.tr.render({canvasContext: ca.getContext("2d"), viewport: vp, intent: "print"}).promise;
  const ctx = ca.getContext("2d");
  ctx.scale(DO_NET_ANH_VUNG, DO_NET_ANH_VUNG);
  veCt(ctx, t.m.ct);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  cat.width = Math.round(w * he);
  cat.height = Math.round(h * he);
  cat.getContext("2d").drawImage(ca, -x * he, -y * he);
  return new Promise((xong, hong) => cat.toBlob(b => (b ? xong(b) : hong(new Error("Không tạo được ảnh."))), "image/png"));
}

async function saoVung() {
  if (!vungChon) return;
  try {
    const dem = new FileReader(), anh = await anhVung(vungChon);
    const png = await new Promise((xong, hong) => {
      dem.onload = () => xong(dem.result.split(",")[1]);
      dem.onerror = () => hong(new Error("Không đọc được ảnh."));
      dem.readAsDataURL(anh);
    });
    await goi("/api/chep-anh", {png});
    bao("Đã sao chép vùng chọn. Dán vào Word hoặc Zalo bằng Ctrl+V.");
  } catch (e) { bao(e.message, true); }
}

function datCongCu(c) {
  congCu = c;
  xoaVung();
  getSelection().removeAllRanges();
  document.querySelector(".o-nhap")?.remove();
  document.body.classList.toggle("cc-vung", c === "vung" || NHOM_KEO.has(c) || NHOM_BAM.has(c) || c === "tay");
  capNhatRibbon();
}

// ---------- Thanh điều hướng dưới đáy ----------

function capNhatNav() {
  const v = xv(), n = v.trang.length;
  $("nav-pdf").hidden = !n || (!dangPdf() && !bc.xem);
  $("dieu-trang").hidden = $("dieu-zoom").hidden = !n;
  if (!n) return;
  if (document.activeElement !== $("o-trang")) $("o-trang").value = v.hien + 1;
  if (document.activeElement !== $("o-zoom")) $("o-zoom").value = `${Math.round(v.tiLe / PT_SANG_PX * 100)}%`;
  $("tong-trang").textContent = `/ ${n}`;
  $("ve-dau").disabled = $("trang-truoc").disabled = v.hien === 0;
  $("ve-cuoi").disabled = $("trang-sau").disabled = v.hien === n - 1;
  $("nav-chu").setAttribute("aria-pressed", congCu === "chu");
  $("nav-vung").setAttribute("aria-pressed", congCu === "vung");
  $("nav-mot").setAttribute("aria-pressed", v.laTungTrang());
  $("nav-rong").setAttribute("aria-pressed", v.kieu === "rong");
  $("nav-trang").setAttribute("aria-pressed", v.kieu === "trang");
}

// Cách xem là thói quen của người dùng, nên hai trình xem luôn đi cùng nhau.
function doiTungTrang() {
  const mot = !xv().laTungTrang();
  for (const v of [xvTex, xvPdf]) {
    v.o.classList.toggle("tung-trang", mot);
    if (v.trang.length) v.den(v.hien);
  }
  capNhatRibbon();
}

$("ve-dau").onclick = () => xv().den(0);
$("ve-cuoi").onclick = () => xv().den(Infinity);
$("trang-truoc").onclick = () => xv().den(xv().hien - 1);
$("trang-sau").onclick = () => xv().den(xv().hien + 1);
$("zoom-nho").onclick = () => xv().doiZoom(1 / 1.25);
$("zoom-to").onclick = () => xv().doiZoom(1.25);
$("nav-chu").onclick = () => datCongCu("chu");
$("nav-vung").onclick = () => datCongCu("vung");
$("nav-mot").onclick = doiTungTrang;
$("nav-rong").onclick = () => xv().datKhop("rong");
$("nav-trang").onclick = () => xv().datKhop("trang");
$("o-trang").onkeydown = e => {
  if (e.key !== "Enter") return;
  const so = parseInt(e.target.value, 10);
  e.target.blur();
  if (so) xv().den(so - 1);
};
$("o-zoom").onkeydown = e => {
  if (e.key !== "Enter") return;
  const so = parseFloat(e.target.value);
  e.target.blur();
  if (so > 0) xv().datZoom(so / 100 * PT_SANG_PX);
};
$("o-trang").onblur = $("o-zoom").onblur = capNhatNav;

let henKhop;
addEventListener("resize", () => {
  clearTimeout(henKhop);
  henKhop = setTimeout(() => xv().khop(), 150);
});
addEventListener("keydown", e => {
  if (e.key === "Escape" && vungChon) return xoaVung();
  if (vungChon && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") { e.preventDefault(); saoVung(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.target.closest?.("textarea, input, .CodeMirror") && hoanTacCt()) e.preventDefault();
  if (e.altKey && e.key === "1") { e.preventDefault(); datCongCu("chu"); }
  if (e.altKey && e.key === "2") { e.preventDefault(); datCongCu("vung"); }
});
// Khi đang bôi đen, lớp chữ phải phủ kín trang để kéo qua chỗ trống không làm nhảy vùng chọn.
addEventListener("pointerdown", e => e.target.closest?.(".textLayer")?.querySelector(".endOfContent")?.classList.add("active"));
addEventListener("pointerup", () => document.querySelectorAll(".endOfContent.active").forEach(x => x.classList.remove("active")));
