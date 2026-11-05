"use strict";
// Bố cục: ẩn hiện từng vùng, kéo đổi kích thước, cỡ chữ. Cài đặt lưu ở máy chủ vì cổng của app đổi mỗi lần mở.

const BO_CUC_GOC = {ban: true, le: true, soan: true, xem: true, rongBan: 216, tiLe: 0.5, co: 14, cheDo: "dong", thuGon: false, day: true, rongDay: 170, coBan: 12, phongCode: "", phongUi: "", soInter: true, coUi: 100};
const RONG_LE = 132, MIN_VUNG = 260;
let bc = {...BO_CUC_GOC};
let henLuuBoCuc;

function luuBoCuc() {
  clearTimeout(henLuuBoCuc);
  henLuuBoCuc = setTimeout(() => goi("/api/cai-dat", bc).catch(() => {}), 400);
}

const PHONG_CODE_GOC = 'Consolas,"Cascadia Mono",monospace';
const PHONG_UI_DU_PHONG = '"Be Vietnam Pro","Segoe UI",system-ui,sans-serif';

function apBoCuc() {
  const b = document.body, hep = innerWidth <= 900;
  const pdf = b.classList.contains("che-do-pdf");
  for (const k of ["ban", "le", "soan", "xem"]) b.classList.toggle(`an-${k}`, !bc[k]);
  b.classList.toggle("an-day", pdf && !bc.day);
  const goc = document.documentElement.style;
  goc.setProperty("--co-soan", `${bc.co}px`);
  goc.setProperty("--co-ban", `${bc.coBan}px`);
  if (bc.phongCode) goc.setProperty("--phong-code", `"${bc.phongCode}",${PHONG_CODE_GOC}`); else goc.removeProperty("--phong-code");
  // Phông giao diện: chữ số vẫn dùng Inter cho thẳng cột nếu còn tích; thanh file theo phông giao diện.
  if (bc.phongUi) goc.setProperty("--phong", `${bc.soInter ? '"So Inter",' : ""}"${bc.phongUi}",${PHONG_UI_DU_PHONG}`);
  else if (bc.soInter) goc.removeProperty("--phong"); else goc.setProperty("--phong", PHONG_UI_DU_PHONG);
  goc.setProperty("--co-ui", `${(bc.coUi || 100) / 100}`);
  const cot = [];
  if (bc.ban) cot.push(`${bc.rongBan}px`);
  if (bc.le && !b.classList.contains("khong-bai") && !b.classList.contains("che-do-pdf")) cot.push(`${RONG_LE}px`);
  // Mở PDF: bên trái chỉ là dải trang hẹp, phần còn lại để xem trang.
  if (pdf) cot.push(...(bc.day ? [`${bc.rongDay}px`] : []), "minmax(0,1fr)");
  else if (bc.soan && bc.xem) cot.push(`minmax(0,${bc.tiLe}fr)`, `minmax(0,${1 - bc.tiLe}fr)`);
  else cot.push("minmax(0,1fr)");
  b.style.gridTemplateColumns = hep ? "" : cot.join(" ");
  $("the-tep").style.gridColumn = bc.ban && !hep ? "2 / -1" : "1 / -1";  // thẻ chỉ nằm trên vùng file đang mở, không đè lên thanh file
  datTayKeo();
  if (bc.soan) soan.refresh();
  capNhatRibbon();
}

function capNhatVungPdf() {
  xv().khop();
}

// ---------- Tay kéo giữa các vùng ----------

const tayBan = document.createElement("div"), tayGiua = document.createElement("div");

function datTayKeo() {
  const hep = innerWidth <= 900;
  const dat = (tay, hien, x, tren) => {
    tay.hidden = !hien || hep;
    tay.style.top = `${tren}px`;
    if (hien) tay.style.left = `${x - 3}px`;
  };
  const ban = document.querySelector(".ban").getBoundingClientRect(), soan_ = document.querySelector(".soan").getBoundingClientRect();
  dat(tayBan, bc.ban, ban.right, ban.top);
  dat(tayGiua, dangPdf() ? bc.day : bc.soan && bc.xem, soan_.right, soan_.top);
  datMuiBen(bc.ban ? ban.right : 0, hep);
  datViTriNav();
}

// Phần số trang nằm đúng dưới vùng PDF. Vùng PDF hẹp hơn thanh điều hướng thì lùi sang trái cho khỏi tràn ra ngoài cửa sổ.
function datViTriNav() {
  const nav = $("nav-pdf"), hep = innerWidth <= 900;
  nav.style.left = "";
  if (hep) return;
  const trai = document.querySelector(".xem").getBoundingClientRect().left;
  nav.style.left = `${trai}px`;
  const du = trai + nav.offsetWidth - innerWidth;
  if (du > 0 && !nav.hidden) nav.style.left = `${Math.max(0, trai - du)}px`;
}

// Mũi tên nằm giữa cạnh phải thanh file. Thanh file ẩn thì mũi tên nằm sát mép trái cửa sổ để bấm hiện lại.
function datMuiBen(x, hep) {
  const m = $("mui-ben"), ten = bc.ban ? "Ẩn thanh file" : "Hiện thanh file";
  m.hidden = hep;
  m.style.left = `${x}px`;
  m.dataset.ten = ten;
  m.setAttribute("aria-label", ten);
  m.querySelector("svg").innerHTML = BT[bc.ban ? "tro-trai" : "tro-phai"];
}

function ganTayKeo(tay, ten, khiKeo, datLai) {
  tay.className = "tay-keo";
  tay.setAttribute("role", "separator");
  tay.title = `Kéo để đổi độ rộng ${ten}, bấm đúp để đặt lại`;
  tay.onpointerdown = e => {
    e.preventDefault();
    tay.setPointerCapture(e.pointerId);
    document.body.classList.add("dang-keo");
    const di = ev => { khiKeo(ev.clientX); apBoCuc(); };
    const xong = () => {
      tay.removeEventListener("pointermove", di);
      document.body.classList.remove("dang-keo");
      luuBoCuc();
      capNhatVungPdf();
    };
    tay.addEventListener("pointermove", di);
    tay.addEventListener("pointerup", xong, {once: true});
    tay.addEventListener("pointercancel", xong, {once: true});
  };
  tay.ondblclick = () => { datLai(); apBoCuc(); luuBoCuc(); capNhatVungPdf(); };
  document.body.append(tay);
}

ganTayKeo(tayBan, "thanh bên", x => { bc.rongBan = Math.min(420, Math.max(150, Math.round(x))); }, () => { bc.rongBan = BO_CUC_GOC.rongBan; });
ganTayKeo(tayGiua, "vùng soạn thảo và vùng xem", x => {
  const trai = document.querySelector(".soan").getBoundingClientRect().left;
  if (dangPdf()) { bc.rongDay = Math.min(420, Math.max(130, Math.round(x - trai))); return; }
  const tong = innerWidth - trai;
  const mep = Math.min(0.45, MIN_VUNG / Math.max(tong, 1));
  bc.tiLe = Math.min(1 - mep, Math.max(mep, (x - trai) / Math.max(tong, 1)));
}, () => { if (dangPdf()) bc.rongDay = BO_CUC_GOC.rongDay; else bc.tiLe = 0.5; });

// ---------- Lệnh ----------

function batTat(k) {
  if (k === "soan" && dangPdf()) {
    bc.day = !bc.day;
    apBoCuc();
    luuBoCuc();
    return capNhatVungPdf();
  }
  if (k === "soan" || k === "xem") {
    const kia = k === "soan" ? "xem" : "soan";
    if (bc[k] && !bc[kia]) return bao("Cần giữ lại ít nhất một vùng, soạn thảo hoặc xem kết quả.", true);
    if (k === "soan") chotDong();
  }
  bc[k] = !bc[k];
  apBoCuc();
  luuBoCuc();
  capNhatVungPdf();
}

function doiCoChu(buoc) {
  bc.co = buoc ? Math.min(24, Math.max(11, bc.co + buoc)) : BO_CUC_GOC.co;
  apBoCuc();
  luuBoCuc();
}

function datLaiBoCuc() {
  bc = {...BO_CUC_GOC, cheDo: bc.cheDo, net: bc.net};  // thuộc tính nét vẽ không phải bố cục
  apBoCuc();
  luuBoCuc();
  capNhatVungPdf();
}

function hoanTac(lai) {
  if (tt.dangSua) { tt.dangSua.o.focus(); document.execCommand(lai ? "redo" : "undo"); return; }
  if (lai) soan.redo(); else soan.undo();
}

function moTim() {
  if (!bc.soan) batTat("soan");
  if (tt.cheDo !== "dong") datCheDo("dong");
  chuyenTab("chu");
  if (bc.thuGon) $("ribbon").classList.add("mo-tam");
  $("tim").focus();
  $("tim").select();
}

async function thoatApp() {
  try {
    const kq = await goi("/api/thoat", {});
    if (kq.khong_co_cua_so) bao("App đang chạy trong trình duyệt. Đóng thẻ này để thoát.");
  } catch (e) { bao(e.message, true); }
}

addEventListener("resize", () => { apBoCuc(); });
addEventListener("keydown", e => {
  if (e.key === "Escape" && menuMo) { const n = menuMo.nut; dongMenu(); n?.focus(); return; }
  const c = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  const lam = e.key === "F5" ? () => { if (coTex()) bienDich(); }
    : !c ? null
    : k === "f1" ? doiThuGon
    : k === "o" ? () => moKhac("tep")
    : k === "e" ? () => { if (coTex()) xuatDung(); }
    : k === "p" ? inPdf
    : k === "b" ? () => batTat("ban")
    : k === "f" ? () => { if (coTex()) moTim(); }
    : k === "=" || k === "+" ? () => doiCoChu(1)
    : k === "-" ? () => doiCoChu(-1)
    : k === "0" ? () => doiCoChu(0)
    : null;
  if (lam) { e.preventDefault(); lam(); }
});

// Cài đặt nạp chậm hơn lúc mở trang một chút, nên áp bố cục mặc định trước rồi đổi theo cài đặt đã lưu.
apBoCuc();
goi("/api/cai-dat").then(cd => {
  bc = {...BO_CUC_GOC, ...cd};
  if (!(bc.tiLe > 0 && bc.tiLe < 1)) bc.tiLe = BO_CUC_GOC.tiLe;
  napThuocTinhNet(bc.net);
  apThuGon();
  apBoCuc();
  if (bc.cheDo !== tt.cheDo) {
    tt.cheDo = bc.cheDo;
    apDungCheDo();
    if (bc.cheDo === "dong") veTheoDong(true);
  }
}).catch(() => {});
