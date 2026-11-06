"use strict";
// Hàng tab của ribbon là thanh tiêu đề của cửa sổ app không viền: kéo, nhấp đúp, đổi cỡ bằng mép, ba nút hệ thống, hộp giới thiệu.
// Chạy trong trình duyệt (không có cửa sổ app) thì ba nút và vùng kéo ẩn đi, các phần khác vẫn chạy.

let csCoCuaSo = false;
let csDaKeo = false;

const CS_PHONG_TO = '<rect x=".5" y=".5" width="9" height="9"/>';
const CS_KHOI_PHUC = '<rect x=".5" y="2.5" width="7" height="7"/><path d="M2.5 2.5v-2h7v7h-2"/>';

const csGoi = (lenh, them = {}) => goi("/api/cua-so", {lenh, ...them}).then(kq => {
  if (kq.phong_to !== undefined) csDatPhongTo(kq.phong_to);
  return kq;
});

function csDatPhongTo(phongTo) {
  document.body.classList.toggle("phong-to", phongTo);
  const nut = $("cs-phong-to");
  nut.querySelector("svg").innerHTML = phongTo ? CS_KHOI_PHUC : CS_PHONG_TO;
  nut.dataset.ten = phongTo ? "Khôi phục" : "Phóng to";
  nut.setAttribute("aria-label", nut.dataset.ten);
}

// Vùng trống của hàng tab (không phải nút, tab, ô nhập) mới kéo được.
const csVungKeo = e => csCoCuaSo && e.button === 0 && !e.target.closest("button,input,a,[role=tab]");

$("ribbon-hang").addEventListener("mousedown", e => {
  if (!csVungKeo(e)) return;
  csDaKeo = false;
  const x = e.screenX, y = e.screenY;
  const dichuyen = ev => { if (Math.abs(ev.screenX - x) + Math.abs(ev.screenY - y) > 4) csDaKeo = true; };
  addEventListener("mousemove", dichuyen);
  addEventListener("mouseup", () => removeEventListener("mousemove", dichuyen), {once: true});
  csGoi("keo").catch(() => {});
});
$("ribbon-hang").addEventListener("dblclick", e => { if (csVungKeo(e)) csGoi("phong-to").catch(() => {}); });

// Đang tự ẩn ribbon: bấm vào thanh tiêu đề (không kéo) hay rê lâu lên thanh thì ribbon hiện tạm.
$("tieu-de").addEventListener("click", () => {
  if (bc.ribbon === "an" && !csDaKeo) moTamRibbon(!$("ribbon").classList.contains("mo-tam"));
});
let csHenRe;
$("ribbon-hang").addEventListener("pointerenter", () => {
  if (bc.ribbon !== "an") return;
  csHenRe = setTimeout(() => { if (bc.ribbon === "an") moTamRibbon(true); }, 600);
});
$("ribbon-hang").addEventListener("pointerleave", () => clearTimeout(csHenRe));

$("cs-thu-nho").onclick = () => csGoi("thu-nho").catch(() => {});
$("cs-phong-to").onclick = () => csGoi("phong-to").catch(() => {});
$("cs-dong").onclick = thoatApp;  // đi qua hộp Lưu / Không lưu / Hủy như Alt+F4

// Tám vùng mỏng quanh mép cửa sổ để đổi cỡ (cửa sổ không viền không còn khung của Windows).
for (const huong of ["t", "d", "l", "r", "tl", "tr", "dl", "dr"]) {
  const tay = document.createElement("div");
  tay.className = `cs-co cs-co-${huong}`;
  tay.addEventListener("mousedown", e => { if (e.button === 0) { e.preventDefault(); csGoi("co", {huong}).catch(() => {}); } });
  document.body.append(tay);
}

let csHenCo;
addEventListener("resize", () => {
  if (!csCoCuaSo) return;
  clearTimeout(csHenCo);
  csHenCo = setTimeout(() => csGoi("trang-thai").catch(() => {}), 80);
});

$("logo").onclick = async () => {
  try { $("gt-ban").textContent = (await goi("/api/thong-tin")).phien_ban; } catch { $("gt-ban").textContent = ""; }
  $("gt-nam").textContent = new Date().getFullYear();
  $("hop-gioi-thieu").showModal();
};

goi("/api/thong-tin").then(kq => {
  csCoCuaSo = !!kq.co_cua_so;
  document.body.classList.toggle("co-cua-so", csCoCuaSo);
  if (csCoCuaSo) csGoi("trang-thai").catch(() => {});
}).catch(() => {});
csDatPhongTo(false);
