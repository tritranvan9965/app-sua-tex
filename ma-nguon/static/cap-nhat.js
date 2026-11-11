// Tự cập nhật: thông báo nhỏ khi có bản mới, hộp xem ghi chú, tải bộ cài có thanh tiến độ rồi để máy chủ chạy bộ cài (xem cap_nhat.py).

let cnKq = null;  // kết quả kiểm tra gần nhất có bản mới
let cnDangTai = false;
const cnMB = n => `${(n / 1048576).toFixed(1)} MB`;

function cnHienBao(kq) {
  cnKq = kq;
  $("cn-bao-chu").textContent = `Có bản TriTeX ${kq.ban.phien_ban}`;
  $("cn-bao-cap").hidden = !kq.co_the_cap_nhat;
  $("cn-bao").hidden = false;
}

// Kiểm tra ngầm lúc mở app. Lỗi mạng hay GitHub bận thì bỏ qua, không báo gì.
async function cnTuDong() {
  try {
    const kq = await goi("/api/cap-nhat-kiem", {tu_dong: true});
    if (kq.co_ban_moi) cnHienBao(kq);
  } catch {}
}

// Điền hộp theo kết quả kiểm tra: có bản mới thì hiện ghi chú và nút Cập nhật.
function cnVeKetQua(kq) {
  const ghi = $("cn-ghi-chu"), cap = $("cn-cap");
  ghi.hidden = cap.hidden = true;
  $("cn-tien").hidden = true;
  $("cn-dong").textContent = "Đóng";
  if (kq.loi) { $("cn-noi").textContent = kq.loi; return; }
  const nguon = kq.ban_ma_nguon ? " (bản chạy từ mã nguồn)" : "";
  if (!kq.ban?.phien_ban) { $("cn-noi").textContent = `Bạn đang dùng TriTeX ${kq.hien_tai}${nguon}. Chưa có bản phát hành nào trên GitHub.`; return; }
  if (!kq.co_ban_moi) { $("cn-noi").textContent = `Bạn đang dùng bản mới nhất, TriTeX ${kq.hien_tai}${nguon}.`; return; }
  $("cn-noi").textContent = `Có bản TriTeX ${kq.ban.phien_ban}, bạn đang dùng ${kq.hien_tai}${nguon}.`
    + (kq.co_the_cap_nhat ? "" : kq.ban_ma_nguon ? " Bản chạy từ mã nguồn không tự cập nhật." : " Bản này chưa có bộ cài để tải.");
  if (kq.ban.ghi_chu) { ghi.textContent = kq.ban.ghi_chu; ghi.hidden = false; }
  cap.hidden = !kq.co_the_cap_nhat;
}

// Mở hộp. thuCong: hỏi lại GitHub ngay (mục Kiểm tra cập nhật); không thì hiện kết quả đã có (nút Xem thay đổi ở thông báo).
async function cnMo(thuCong) {
  const h = $("hop-cap-nhat");
  if (cnDangTai) { if (!h.open) h.showModal(); return; }
  $("hop-gioi-thieu").close();
  $("cn-tieu").textContent = thuCong ? "Kiểm tra cập nhật" : `TriTeX ${cnKq.ban.phien_ban}`;
  if (!h.open) h.showModal();
  if (!thuCong) return cnVeKetQua(cnKq);
  cnVeKetQua({loi: "Đang kiểm tra..."});
  try {
    const kq = await goi("/api/cap-nhat-kiem", {tu_dong: false});
    cnVeKetQua(kq);
    if (kq.co_ban_moi) cnHienBao(kq);
  } catch (e) { cnVeKetQua({loi: e.message}); }
}

// Hỏi lưu lần lượt từng file đang sửa dở bằng đúng hộp của app. false nếu người dùng Hủy hoặc lưu lỗi.
async function cnHoiLuu() {
  for (const t of the.ds.filter(theChuaLuu)) if (!await hoiRoiLuuThe(t, "Cần lưu trước khi cập nhật. App sẽ đóng rồi tự mở lại sau khi cài xong.")) return false;
  return true;
}

function cnVeTienDo(td) {
  const tong = td.tong || 0;
  $("cn-thanh").max = tong || 100;
  $("cn-thanh").value = tong ? td.da : 0;
  $("cn-so").textContent = tong ? `${cnMB(td.da)} / ${cnMB(tong)}` : cnMB(td.da);
}

async function cnCapNhat() {
  if (cnDangTai) return;
  if (!await cnHoiLuu()) return;
  cnDangTai = true;
  $("cn-cap").hidden = $("cn-ghi-chu").hidden = true;
  $("cn-tien").hidden = false;
  $("cn-dong").textContent = "Hủy";
  $("cn-noi").textContent = "Đang tải bộ cài...";
  cnVeTienDo({da: 0, tong: 0});
  if (!$("hop-cap-nhat").open) $("hop-cap-nhat").showModal();
  try {
    let td = await goi("/api/cap-nhat-tai", {});
    while (!td.loi && td.trang_thai === "tai" && cnDangTai) {
      cnVeTienDo(td);
      await new Promise(r => setTimeout(r, 300));
      td = await goi("/api/cap-nhat-tien-do", {});
    }
    if (!cnDangTai) return;  // người dùng đã hủy
    if (td.loi || td.trang_thai === "loi") throw new Error(td.loi || "Tải bộ cài không được.");
    cnVeTienDo(td);
    if (!await cnHoiLuu()) { cnKetThuc("Đã hủy cập nhật. Bộ cài đã tải, bấm Cập nhật lần nữa khi sẵn sàng."); return; }
    $("cn-noi").textContent = "Đang cài. TriTeX sẽ tự mở lại sau vài giây.";
    $("cn-dong").hidden = true;
    const kq = await goi("/api/cap-nhat-cai", {});
    if (kq.loi) { $("cn-dong").hidden = false; throw new Error(kq.loi); }
  } catch (e) {
    if (e instanceof TypeError) return;  // máy chủ đã thoát để bộ cài thay file
    cnKetThuc(e.message);
    $("cn-cap").hidden = false;
  }
}

function cnKetThuc(chu) {
  cnDangTai = false;
  $("cn-tien").hidden = true;
  $("cn-dong").textContent = "Đóng";
  $("cn-noi").textContent = chu;
  $("cn-cap").hidden = false;
}

$("cn-cap").onclick = cnCapNhat;
$("cn-bao-cap").onclick = async () => { $("cn-bao").hidden = true; await cnMo(false); cnCapNhat(); };
$("cn-bao-xem").onclick = () => cnMo(false);
$("cn-bao-de").onclick = () => { $("cn-bao").hidden = true; };
$("gt-cap-nhat").onclick = () => cnMo(true);
$("hop-cap-nhat").addEventListener("close", () => {
  if (!cnDangTai) return;
  cnDangTai = false;  // Hủy hoặc Esc giữa lúc tải
  goi("/api/cap-nhat-huy", {}).catch(() => {});
});

setTimeout(cnTuDong, 4000);  // để app mở xong việc chính rồi mới kiểm tra
