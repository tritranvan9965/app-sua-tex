// Hộp thoại In: chọn máy in, khổ giấy, co giãn trang và xem trước bản in. Máy chủ ghép PDF tạm rồi đưa xuống máy in (vector).
const IN_KHOA = "sua-tex-in", IN_KHO_XEM = {rong: 300, cao: 400};
const inTt = {ds: [], v: null, pdf: false, xem: 0, ten: "", may: "", kn: null, khung: new Map(), anh: new Map(), seq: 0};
const inDoc = () => { try { return JSON.parse(localStorage.getItem(IN_KHOA)) || {}; } catch { return {}; } };
const inVal = id => $(id).value;
const inCo = () => document.querySelector("input[name=in-co]:checked").value;
const inPhamVi = () => document.querySelector("input[name=in-pham-vi]:checked").value;

function inLuu() {
  try {
    localStorage.setItem(IN_KHOA, JSON.stringify({may: inTt.may, che_do: inCo(), ti_le: inVal("in-ti-le-nhap"), giua: $("in-giua").checked,
      huong: inVal("in-huong"), den_trang: $("in-den-trang").checked, hai_mat: inVal("in-hai-mat")}));
  } catch { /* bộ nhớ trình duyệt bị chặn thì lần sau đặt lại từ đầu */ }
}

// "1-3, 5" thành [1, 2, 3, 5]; sai khuôn hoặc ngoài dãy thì trả null.
function inDai(ph, n) {
  const ra = [];
  for (const phan of ph.split(/[,;]/)) {
    if (!phan.trim()) continue;
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(phan.trim());
    if (!m) return null;
    const dau = +m[1], cuoi = +(m[2] || m[1]);
    if (dau < 1 || cuoi > n || dau > cuoi) return null;
    for (let i = dau; i <= cuoi; i++) ra.push(i);
  }
  return ra.length ? ra : null;
}

function inGonDai(so) {
  const ra = [];
  for (let i = 0; i < so.length; i++) {
    let j = i;
    while (so[j + 1] === so[j] + 1) j++;
    ra.push(j > i ? `${so[i]}-${so[j]}` : `${so[i]}`);
    i = j;
  }
  return ra.join(", ");
}

// Các trang sẽ in, theo số thứ tự bắt đầu từ 1, đã áp tập con và thứ tự ngược. Sai khuôn thì trả null.
function inChonTrang() {
  const n = inTt.ds.length;
  let ra = inPhamVi() === "xem" ? [inTt.xem + 1] : inPhamVi() === "dai" ? inDai(inVal("in-dai"), n) : Array.from({length: n}, (_, i) => i + 1);
  if (!ra) return null;
  const tap = inVal("in-tap-con");
  if (tap) ra = ra.filter(i => (i % 2 === 1) === (tap === "le"));
  if ($("in-dao").checked) ra.reverse();
  return ra;
}

const inHuong = t => (inVal("in-huong") === "ngang" || (inVal("in-huong") === "tu_dong" && t.w > t.h) ? 2 : 1);

async function inKhung(huong) {
  const khoa = `${inTt.may}|${inVal("in-giay")}|${huong}`;
  if (!inTt.khung.has(khoa)) inTt.khung.set(khoa, goi("/api/in-khung", {may_in: inTt.may, giay: +inVal("in-giay") || null, huong}));
  try { return await inTt.khung.get(khoa); } catch (e) { inTt.khung.delete(khoa); throw e; }
}

// Vị trí và cỡ trang trên tờ giấy (pt), cùng công thức với máy chủ.
function inHinh(t, kh) {
  const [x0, y0, x1, y1] = kh.vung, W = x1 - x0, H = y1 - y0, che = inCo();
  let he = che === "tuy_y" ? (+inVal("in-ti-le-nhap") || 100) / 100 : 1;
  if (che === "vua") he = Math.min(W / t.w, H / t.h);
  else if (che === "thu") he = Math.min(1, W / t.w, H / t.h);
  const w = t.w * he, h = t.h * he, giua = che === "vua" || $("in-giua").checked;
  return {he, w, h, x: giua ? x0 + (W - w) / 2 : x0, y: giua ? y0 + (H - h) / 2 : y0};
}

async function inAnhTrang(i) {
  if (!inTt.anh.has(i)) {
    const cv = document.createElement("canvas");
    await veCanvas(cv, inTt.ds[i].m, 700, "display", {tb: inTt.v.tb, i, n: inTt.ds.length}, true);
    inTt.anh.set(i, cv);
  }
  return inTt.anh.get(i);
}

async function inVeXem() {
  const seq = ++inTt.seq, i = inTt.xem, t = inTt.ds[i];
  $("in-so-trang").textContent = `Trang ${i + 1} / ${inTt.ds.length}`;
  $("in-trang").value = i + 1;
  try {
    const [kh, anh] = await Promise.all([inKhung(inHuong(t)), inAnhTrang(i)]);
    if (seq !== inTt.seq) return;
    const [pw, ph] = kh.giay, k = Math.min(IN_KHO_XEM.rong / pw, IN_KHO_XEM.cao / ph), cv = $("in-canvas"), ctx = cv.getContext("2d");
    cv.width = Math.round(pw * k);
    cv.height = Math.round(ph * k);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cv.width, cv.height);
    const [x0, y0, x1, y1] = kh.vung, h = inHinh(t, kh);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k);
    ctx.clip();
    ctx.drawImage(anh, h.x * k, h.y * k, h.w * k, h.h * k);
    ctx.restore();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = "#9db4a8";
    ctx.strokeRect(x0 * k + .5, y0 * k + .5, (x1 - x0) * k - 1, (y1 - y0) * k - 1);
    ctx.setLineDash([]);
    ctx.strokeStyle = "#c7d3cb";
    ctx.strokeRect(.5, .5, cv.width - 1, cv.height - 1);
    const mm = v => `${Math.round(v / 72 * 25.4)}`;
    $("in-ti-le").textContent = `Tỉ lệ ${(h.he * 100).toFixed(1).replace(".", ",")}%. Trang ${mm(t.w)} × ${mm(t.h)} mm, giấy ${mm(pw)} × ${mm(ph)} mm.`;
    $("in-ok").disabled = false;
  } catch (e) {
    if (seq !== inTt.seq) return;
    $("in-ti-le").textContent = e.message;
    $("in-ok").disabled = true;
  }
}

async function inNapKhaNang(giuGiay) {
  const kn = inTt.kn = await goi("/api/in-kha-nang", {may_in: inTt.may}), cu = giuGiay ? inVal("in-giay") : "";
  const g = $("in-giay");
  g.replaceChildren(...kn.giay.map(x => new Option(x.ten, x.id)));
  g.value = kn.giay.some(x => String(x.id) === cu) ? cu : kn.giay.some(x => x.id === 9) ? "9" : kn.giay[0]?.id ?? "";
  $("in-hai-mat").disabled = !kn.hai_mat;
  if (!kn.hai_mat) $("in-hai-mat").value = "1";
  $("in-den-trang").disabled = !kn.mau;
  if (!kn.mau) $("in-den-trang").checked = true;
}

async function inMo() {
  const pdf = dangPdf();
  if (!pdf && !tt.pdf) return bao("Chưa có PDF để in. Bấm Chạy thử (F5) trước.", true);
  const v = xv(), ds = v.trang;
  if (!ds.length) return bao("Chưa có trang nào để in.", true);
  Object.assign(inTt, {ds, v, pdf, ten: pdf ? pt.ten : `${tt.tep.ten.replace(/\.[^.]+$/, "")}.pdf`, anh: new Map(), khung: new Map(), seq: 0});
  inTt.xem = Math.max(0, pdf ? ds.findIndex(t => t.m === pt.xem) : v.hien || 0);
  const luu = inDoc(), chon = pdf ? ds.flatMap((t, i) => (t.m.chon ? [i + 1] : [])) : [];
  try {
    const may = await goi("/api/in-may", {});
    if (!may.ds.length) return bao("Máy này chưa cài máy in nào.", true);
    $("in-may").replaceChildren(...may.ds.map(x => new Option(x, x)));
    inTt.may = $("in-may").value = may.ds.includes(luu.may) ? luu.may : may.mac_dinh;
    await inNapKhaNang(false);
  } catch (e) { return bao(e.message, true); }
  $("in-trang").max = ds.length;
  $("in-tong").textContent = `/ ${ds.length}`;
  $("in-dai").value = chon.length ? inGonDai(chon) : "";
  document.querySelector(`input[name=in-pham-vi][value=${chon.length ? "dai" : "het"}]`).checked = true;
  document.querySelector(`input[name=in-co][value=${luu.che_do || "vua"}]`).checked = true;
  $("in-ti-le-nhap").value = luu.ti_le || 100;
  $("in-giua").checked = luu.giua !== false;
  $("in-huong").value = luu.huong || "tu_dong";
  if (!$("in-den-trang").disabled) $("in-den-trang").checked = !!luu.den_trang;
  if (!$("in-hai-mat").disabled && luu.hai_mat) $("in-hai-mat").value = luu.hai_mat;
  $("in-so-ban").value = 1;
  $("in-tap-con").value = "";
  $("in-dao").checked = false;
  $("hop-in").showModal();
  $("in-ok").focus();  // Enter là in; showModal không tự chọn nút này vì nút Đóng đứng trước
  inVeXem();
}

async function inGui() {
  const so = inChonTrang();
  if (!so?.length) return bao(inPhamVi() === "dai" ? `Các trang cần in chưa đúng. Gõ kiểu 1-3, 5 trong dãy 1-${inTt.ds.length}.` : "Không có trang nào để in.", true);
  inLuu();
  const tuy = {may_in: inTt.may, giay: +inVal("in-giay") || null, huong: inVal("in-huong"), hai_mat: +inVal("in-hai-mat"), so_ban: Math.max(1, +inVal("in-so-ban") || 1),
    che_do: inCo(), ti_le: +inVal("in-ti-le-nhap") || 100, can_giua: $("in-giua").checked};
  if (!$("in-den-trang").disabled) tuy.mau = !$("in-den-trang").checked;
  datViec("Đang chuẩn bị bản in...");
  try {
    let duong;
    if (!inTt.pdf) duong = (await goi("/api/pdf-nhap", {duong: tt.tep.duong, ban: tt.ban})).tep[0].duong;  // bản sao riêng, lần biên dịch sau không ghi đè
    const trang = [];
    for (const i of so) trang.push(...await gomTrang(inTt.v, m => m === inTt.ds[i - 1].m, duong));
    await goi("/api/pdf-in", {trang, ten: inTt.ten, tuy});
    bao(`Đã gửi ${so.length} trang tới ${inTt.may}.`);
  } catch (e) { bao(e.message, true); }
  datViec("");
}

function inDoiTrang(i) {
  inTt.xem = Math.max(0, Math.min(inTt.ds.length - 1, i));
  inVeXem();
}

$("in-form").onsubmit = e => {
  if (e.submitter?.value !== "in") return;
  e.preventDefault();
  if (!inChonTrang()?.length) return bao("Các trang cần in chưa đúng. Gõ kiểu 1-3, 5.", true);
  $("hop-in").close();
  inGui();
};
$("in-may").onchange = async () => {
  inTt.may = inVal("in-may");
  try { await inNapKhaNang(false); } catch (e) { bao(e.message, true); }
  inVeXem();
};
$("in-tuy-chon").onclick = async () => {
  try {
    const hien = {may_in: inTt.may, giay: +inVal("in-giay") || null, hai_mat: +inVal("in-hai-mat")};
    if (inVal("in-huong") !== "tu_dong") hien.huong = inVal("in-huong") === "ngang" ? 2 : 1;
    if (!$("in-den-trang").disabled) hien.mau = !$("in-den-trang").checked;
    const kq = await goi("/api/in-tuy-chon", hien);  // bảng của driver, chờ người dùng đóng
    if (!kq.giay) return;
    inTt.khung.clear();
    await inNapKhaNang(false);
    if ([...$("in-giay").options].some(o => +o.value === kq.giay)) $("in-giay").value = kq.giay;
    if (!$("in-hai-mat").disabled && kq.hai_mat >= 1 && kq.hai_mat <= 3) $("in-hai-mat").value = kq.hai_mat;
    if (!$("in-den-trang").disabled) $("in-den-trang").checked = !kq.mau;
    if (inVal("in-huong") !== "tu_dong") $("in-huong").value = kq.huong === 2 ? "ngang" : "doc";
    inVeXem();
  } catch (e) { bao(e.message, true); }
};
$("in-dong").onclick = () => $("hop-in").close();
$("in-truoc").onclick = () => inDoiTrang(inTt.xem - 1);
$("in-sau").onclick = () => inDoiTrang(inTt.xem + 1);
$("in-trang").oninput = e => inDoiTrang(+e.target.value - 1);
$("in-dai").oninput = () => { document.querySelector("input[name=in-pham-vi][value=dai]").checked = true; };
for (const id of ["in-giay", "in-huong", "in-ti-le-nhap", "in-giua"]) $(id).onchange = () => inVeXem();
for (const x of document.querySelectorAll("input[name=in-co]")) x.onchange = () => inVeXem();
$("in-ti-le-nhap").oninput = () => {
  document.querySelector("input[name=in-co][value=tuy_y]").checked = true;
  inVeXem();
};
$("hop-in").addEventListener("close", () => { inTt.seq++; inTt.anh.clear(); });

const inPdf = () => inMo();
