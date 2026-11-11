"use strict";
// Ribbon kiểu Word: mỗi lệnh khai một lần ở dsRibbon. Nút chỉ có biểu tượng, lệnh chính (to: true) có thêm chữ.
// Lệnh chưa làm dùng sapCo(): vẫn hiện đủ, bấm vào thì báo sắp có. Làm xong lệnh nào, đổi dòng đó thành lệnh thật.

const coTex = () => !!tt.tep?.la_tex && !dangPdf();
const coTrang = () => dangPdf() && pt.ds.length > 0;
const coChon = () => dangPdf() && pt.ds.some(x => x.chon);
const ranh = () => !tt.viec;
const coXem = () => xv().trang.length > 0;
const coSuaChu = () => dangPdf() && coXem();

// Lý do khi nút bị khoá, hiện ở dòng cuối gợi ý. Lệnh có điều kiện riêng thì khai khoa (chuỗi hoặc hàm trả chuỗi),
// không thì lấy theo hàm bat ở LY_DO_CHUNG.
const LD_TEX = () => (dangPdf() ? "Đang xem PDF. Mở một file .tex để dùng lệnh này." : "Chưa mở file .tex nào. Mở một file .tex để dùng lệnh này.");
const LD_CHON = () => "Chưa chọn trang nào. Bấm chọn trang ở dải trang, hoặc gõ số trang rồi Enter.";
const LD_TRANG = () => "Chưa mở PDF nào. Mở một file PDF để dùng lệnh này.";
const LD_XEM = () => "Chưa có PDF để xem. Mở file PDF, hoặc bấm Chạy thử (F5) với file .tex.";
const LD_RANH = () => "Đang chạy việc khác, chờ xong đã.";
const LD_CHEN = "Lệnh soạn LaTeX, chỉ dùng khi mở file .tex.";
const LY_DO_CHUNG = new Map([[coTex, LD_TEX], [coChon, LD_CHON], [coTrang, LD_TRANG], [coXem, LD_XEM], [ranh, LD_RANH]]);
// Khai theo thứ tự kiểm tra: điều kiện nào chưa đạt thì báo lý do của nó.
const khoaTheo = (...ds) => () => ds.find(([ok]) => !ok())?.[1]();

const TEN_CT = {chu: "Chọn chữ", vung: "Chọn vùng", "sua-chu": "Sửa chữ", "sua-dt": "Sửa đối tượng"};  // tên công cụ đang dùng, hiện ở thanh dưới
const sapCo = (ten, ic, to = false, tenNgan) => ({ten, ic, to, tenNgan, sapCo: true});
const lenhCt = (ten, ic, ma, to = false, goiY, tenNgan) => {
  TEN_CT[ma] = ten;
  return {ten, ic, to, goiY, tenNgan, lam: () => datCongCu(congCu === ma ? "chu" : ma), tich: () => coXem() && congCu === ma, bat: coXem};  // bấm lần hai vào công cụ đang bật thì tắt, về Chọn chữ
};
// Tab Chèn là lệnh soạn LaTeX: xem PDF thì mờ hết.
const lenhChen = x => ({...x, bat: () => !dangPdf(), khoa: LD_CHEN});

function dsRibbon() {
  return [
    {ma: "chu", ten: "Trang chủ", nhom: [
      ["Tệp", [
        {ten: "Mở file", ic: "mo", to: true, phim: "Ctrl+O", lam: () => moKhac("tep")},
        {ten: "Lưu", ic: "luu", to: true, phim: "Ctrl+S", lam: luuVaXuat,
          bat: () => (dangPdf() ? pt.ds.length > 0 : !!coThayDoi()) && !tt.dangBan,
          khoa: () => (tt.dangBan ? "Đang lưu, chờ xong đã." : dangPdf() ? "Chưa mở PDF nào." : !tt.tep ? "Chưa mở file nào." : "Chưa có thay đổi cần lưu.")},
        {ten: "Mở thư mục", ic: "thu-muc", lam: () => moKhac("thu_muc")},
        {ten: "In", ic: "in", phim: "Ctrl+P", lam: inPdf, bat: ranh},
        {ten: "Đóng file", ic: "dong", phim: "Ctrl+W", lam: dongTheHien, bat: () => !!the.hien, khoa: "Chưa mở file nào."},
      ]],
      ["Hoàn tác", [
        {ten: "Hoàn tác", ic: "hoan-tac", phim: "Ctrl+Z", lam: () => hoanTac(false), bat: () => !!tt.tep, khoa: "Chưa mở file nào."},
        {ten: "Làm lại", ic: "lam-lai", phim: "Ctrl+Y", lam: () => hoanTac(true), bat: () => !!tt.tep, khoa: "Chưa mở file nào."},
      ]],
      ["LaTeX", [
        {ten: "Chạy thử (Xem PDF)", ic: "bien-dich", to: true, phim: "F5", goiY: "Tạo bản PDF để xem thử ngay. Chưa ghi ra file PDF dùng thật", lam: () => bienDich(), bat: () => coTex() && ranh(), khoa: khoaTheo([coTex, LD_TEX], [ranh, LD_RANH])},
        {ten: "Lưu ra file PDF", ic: "xuat", to: true, phim: "Ctrl+E", goiY: "Tạo file PDF dùng thật, đủ các bản", lam: xuatDung, bat: () => coTex() && ranh(), khoa: khoaTheo([coTex, LD_TEX], [ranh, LD_RANH])},
        {ten: "Thư viện mẫu", ic: "thu-vien", lam: moThuVien},
        {ten: "Tách, gộp trang của PDF đang xem", tenNgan: "Tách, gộp trang", ic: "hai-trang", lam: sapTrangTuBienDich, bat: coTex, khoa: () => (dangPdf() ? "Đang xem PDF. Mở file .tex rồi bấm Chạy thử để tách, gộp trang." : LD_TEX())},
      ]],
      ["Tìm", [
        {o: "tim"},
        sapCo("Thay thế", "thay-the"),
      ]],
    ]},
    {ma: "chen", ten: "Chèn", nhom: ([
      ["Bài", [
        sapCo("Câu mới", "cau-moi", true),
        sapCo("Lời giải", "loi-giai", true),
      ]],
      ["Công thức", [
        sapCo("Phân số", "phan-so"), sapCo("Căn bậc hai", "can"), sapCo("Mũ", "mu"), sapCo("Chỉ số dưới", "chi-so"),
        sapCo("Hệ phương trình", "he"), sapCo("Góc", "goc"), sapCo("Tam giác", "tam-giac"), sapCo("Song song", "song-song"), sapCo("Vuông góc", "vuong-goc"),
      ]],
      ["Đối tượng", [
        {ten: "Ảnh", ic: "anh", to: true, goiY: "Chèn ảnh vào câu đang chọn. Cũng dán được bằng Ctrl+V hoặc kéo file thả vào câu", lam: () => anhChenTuHop()},
        sapCo("Bảng", "bang", true),
        sapCo("Hình vẽ", "hinh-ve", true),
        sapCo("Danh sách", "danh-sach"),
      ]],
      ["Định dạng", [
        sapCo("Chữ đậm", "dam"), sapCo("Chữ nghiêng", "nghieng"), sapCo("Gạch chân", "gach-chan"),
      ]],
      ["Đề thi", [
        sapCo("Trộn đề", "tron-de", true),
      ]],
    ]).map(([t, m]) => [t, m.map(lenhChen)])},
    {ma: "trang", ten: "Trang", nhom: [
      ["Gộp PDF", [
        {ten: "Chèn thêm file PDF", tenNgan: "Chèn thêm PDF", ic: "them-pdf", to: true, goiY: "Thêm một file PDF khác vào cuối dãy trang để gộp lại", lam: () => themPdf()},
      ]],
      ["Chọn trang", [
        {o: "khoang-trang"},
        {ten: "Chọn hết", ic: "chon-het", lam: () => chonHet(true), bat: coTrang},
        {ten: "Bỏ chọn", ic: "bo-chon", lam: () => chonHet(false), bat: coChon},
      ]],
      ["Sắp xếp", [
        {ten: "Xoay trái", ic: "xoay-trai", lam: () => xoayTrang(false), bat: coTrang},
        {ten: "Xoay phải", ic: "xoay-phai", lam: () => xoayTrang(true), bat: coTrang},
        {ten: "Thêm trang trắng", ic: "tep", goiY: "Thêm sau trang đang xem", lam: themTrangTrong, bat: coTrang},
        {ten: "Xóa trang", ic: "xoa", goiY: "Bỏ khỏi dãy, file gốc không đổi", lam: boTrang, bat: coChon},
        {ten: "Nhân bản trang", ic: "nhan-ban", lam: nhanBanTrang, bat: coTrang},
        {ten: "Đưa lên đầu", ic: "len-dau", lam: () => dichTrang(true), bat: coTrang},
        {ten: "Đưa xuống cuối", ic: "xuong-cuoi", lam: () => dichTrang(false), bat: coTrang},
        {ten: "Đảo thứ tự", ic: "dao", goiY: "Đảo các trang đã chọn, chưa chọn thì đảo cả dãy", lam: daoThuTu, bat: coTrang},
      ]],
      ["Khổ giấy", [
        sapCo("Cắt lề", "cat-le"), sapCo("Đổi khổ giấy", "kho-giay"),
        sapCo("Ghép 2 trang lên 1 tờ", "ghep-to", false, "Ghép 2 trang"),
      ]],
      ["Tách & Lưu PDF", [
        {ten: "Tách trang đã chọn", tenNgan: "Tách trang chọn", ic: "luu-chon", to: true, goiY: "Tách các trang đã chọn thành một file PDF mới", lam: () => luuTrang(true), bat: coChon},
        {ten: "Lưu toàn bộ PDF", ic: "luu-het", to: true, goiY: "Lưu cả dãy trang hiện có (đã gộp, sắp xếp) thành một file PDF", lam: () => luuTrang(false), bat: coTrang},
        sapCo("Tách mỗi N trang", "tach"),
        {ten: "Xuất ra ảnh", ic: "anh", goiY: "Mỗi trang thành một ảnh PNG. Đã chọn trang thì chỉ xuất các trang đó", lam: xuatAnh, bat: () => coXem() && ranh(), khoa: khoaTheo([coXem, LD_XEM], [ranh, LD_RANH])},
      ]],
    ]},
    {ma: "chu-thich", ten: "Chú thích", nhom: [
      ["Công cụ", [
        {ten: "Chọn chữ", ic: "chon-chu", phim: "Alt+1", goiY: "Bôi đen chữ trên PDF để sao chép", lam: () => datCongCu("chu"), tich: () => coXem() && congCu === "chu", bat: coXem},
        {ten: "Chọn vùng", ic: "chon-vung", phim: "Alt+2", goiY: "Kéo một khung trên PDF để sao chép thành ảnh", lam: () => datCongCu("vung"), tich: () => coXem() && congCu === "vung", bat: coXem},
        {ten: "Sửa chữ", ic: "sua-chu", to: true, phim: "Alt+3", goiY: "Mọi ô chữ trên trang hiện khung. Bấm vào ô để sửa tại chỗ, bấm ra ngoài là xong, Esc để hủy ô đang sửa. Chữ cũ bị xóa hẳn, chữ mới là chữ thật. Thiếu dấu tiếng Việt thì ô đó đổi sang phông gần giống",
          lam: () => datCongCu("sua-chu"), tich: () => coSuaChu() && congCu === "sua-chu", bat: coSuaChu,
          khoa: () => (!coXem() ? LD_XEM() : "Chỉ sửa chữ được khi mở file PDF. Mở một file PDF, hoặc bấm Tách, gộp trang để đưa PDF vừa biên dịch sang dải trang.")},
        {ten: "Sửa đối tượng", ic: "sua-dt", to: true, phim: "Alt+4", goiY: "Mọi ảnh, hình trên trang hiện khung. Bấm để chọn (Ctrl+bấm chọn thêm), kéo để dời, kéo núm ở góc để co (ảnh giữ tỉ lệ, hình giữ Shift để giữ tỉ lệ), phím mũi tên dời 1 pt (Shift: 10 pt), Delete để xóa, Ctrl+Z hoàn tác",
          lam: () => datCongCu(congCu === "sua-dt" ? "chu" : "sua-dt"), tich: () => coSuaChu() && congCu === "sua-dt", bat: coSuaChu,
          khoa: () => (!coXem() ? LD_XEM() : "Chỉ sửa đối tượng được khi mở file PDF. Mở một file PDF, hoặc bấm Tách, gộp trang để đưa PDF vừa biên dịch sang dải trang.")},
        sapCo("Kéo trang", "ban-tay"), lenhCt("Tẩy", "tay", "tay", false, "Bấm vào chú thích để xóa"),
      ]],
      ["Đánh dấu", [
        lenhCt("Tô sáng", "to-sang", "to-sang", true, "Bôi đen chữ để tô"),
        lenhCt("Gạch chân", "gach-chan", "gach-chan", false, "Bôi đen chữ để kẻ một đường dưới chân chữ"), lenhCt("Gạch ngang", "gach-ngang", "gach-ngang", false, "Bôi đen chữ để kẻ một đường ngang giữa chữ, như gạch bỏ"),
      ]],
      ["Vẽ", [
        lenhCt("Bút vẽ", "but", "but", true),
        lenhCt("Đường thẳng", "duong-thang", "duong-thang"), lenhCt("Mũi tên", "mui-ten", "mui-ten"), lenhCt("Hình chữ nhật", "chu-nhat", "chu-nhat"), lenhCt("Hình tròn", "tron", "tron"),
      ]],
      ["Ghi chú", [
        lenhCt("Ghi chú", "ghi-chu", "ghi-chu", true, "Bấm vào trang để ghi. Enter để xong"),
        lenhCt("Hộp chữ", "hop-chu", "hop-chu", false, "Bấm vào trang để gõ, chọn phông, cỡ, màu ở thanh hiện ra. Enter để xong, Shift+Enter xuống dòng. Bấm hộp chữ có sẵn để kéo, nhấp đúp để sửa, Delete để xóa"), sapCo("Đóng dấu", "dong-dau"), sapCo("Chữ ký", "chu-ky"),
      ]],
      ["Quản lý", [
        sapCo("Danh sách ghi chú", "ds-ghi-chu", false, "Các ghi chú"), {ten: "Xóa hết chú thích", tenNgan: "Xóa hết", ic: "xoa", lam: xoaHetCt, bat: coXem},
      ]],
    ]},
    {ma: "tai-lieu", ten: "Tài liệu", nhom: [
      ["Trình bày", [
        {ten: "Đầu trang, chân trang", ic: "dau-chan", to: true, lam: moTrinhBay, bat: coXem},
        {ten: "Đánh số trang", ic: "so-trang", to: true, lam: moTrinhBay, bat: coXem},
        {ten: "Dấu mờ", ic: "dau-mo", to: true, lam: moTrinhBay, bat: coXem},
        sapCo("Nền trang", "nen"),
      ]],
      ["Nhận dạng", [
        sapCo("OCR", "ocr", true),
        sapCo("Ảnh sang PDF", "anh-sang-pdf", true),
      ]],
      ["Tệp", [
        sapCo("Giảm dung lượng", "nho"), sapCo("Đặt mật khẩu", "khoa"), sapCo("Thông tin file", "thong-tin"),
      ]],
    ]},
    {ma: "xem", ten: "Xem", nhom: [
      ["Hiện, ẩn vùng", [
        {ten: "Thanh file", ic: "thanh-ben", phim: "Ctrl+B", lam: () => batTat("ban"), tich: () => bc.ban},
        {ten: "Mục lục", ic: "dai-bai", lam: () => batTat("le"), tich: () => bc.le},
        {ten: "Vùng bên trái", ic: "vung-soan", lam: () => batTat("soan"), tich: () => (dangPdf() ? bc.day : bc.soan)},
        {ten: "Vùng xem kết quả", tenNgan: "Vùng kết quả", ic: "vung-xem", lam: () => batTat("xem"), tich: () => bc.xem, bat: () => !dangPdf(), khoa: "Chỉ dùng khi mở file .tex. Đang xem PDF thì vùng bên trái là dải trang."},
      ]],
      ["Đáp án", [
        {ten: "Ẩn đáp án", ic: "mat", to: true, phim: "Ctrl+Shift+H", goiY: "Ẩn lời giải ở cả hai cách sửa và chọn bản HS để Chạy thử, Lưu ra PDF. File .tex không đổi", lam: batTatDapAn, tich: () => anDapAn(), bat: () => coTex() && coNutDapAn(), khoa: () => (coTex() ? "Dự án này có nhiều bản PDF, chọn bản ở các nút trên khung sửa." : LD_TEX())},
      ]],
      ["Cách sửa", [
        {ten: "Theo dòng", ic: "theo-dong", to: true, lam: () => datCheDo("dong"), tich: () => tt.cheDo === "dong", bat: coTex, khoa: "Chỉ dùng khi mở file .tex. Mở một file .tex để sửa theo dòng."},
        {ten: "Toàn bộ code", ic: "code", to: true, lam: () => datCheDo("code"), tich: () => tt.cheDo === "code", bat: coTex, khoa: "Chỉ dùng khi mở file .tex. Mở một file .tex để sửa toàn bộ code."},
      ]],
      ["Phông chữ", [
        {ten: "Chữ to hơn", ic: "chu-to", phim: "Ctrl+=", lam: () => doiCoChu(1)},
        {ten: "Chữ nhỏ hơn", ic: "chu-nho", phim: "Ctrl+-", lam: () => doiCoChu(-1)},
        {ten: "Cỡ chữ mặc định", tenNgan: "Cỡ chữ gốc", ic: "chu-goc", phim: "Ctrl+0", lam: () => doiCoChu(0)},
      ], {ten: "Cài đặt phông chữ, cỡ chữ", goiY: "Của code và thanh file", lam: () => moHopPhong()}],
      ["Trang PDF", [
        {ten: "Vừa chiều rộng", ic: "vua-rong", lam: () => xv().datKhop("rong"), tich: () => xv().kieu === "rong", bat: coXem},
        {ten: "Vừa cả trang", ic: "vua-trang", lam: () => xv().datKhop("trang"), tich: () => xv().kieu === "trang", bat: coXem},
        {ten: "Xem từng trang", ic: "xem-mot", lam: doiTungTrang, tich: () => xv().laTungTrang(), bat: coXem},
        sapCo("Xem hai trang", "hai-trang"),
      ]],
      ["Bố cục", [
        {ten: "Chia đều hai vùng", tenNgan: "Chia đều", ic: "chia-deu", lam: () => { bc.tiLe = 0.5; apBoCuc(); luuBoCuc(); capNhatVungPdf(); }},
        {ten: "Đặt lại bố cục", ic: "dat-lai", lam: () => datLaiBoCuc()},
        {ten: "Toàn màn hình", ic: "toan-man", phim: "F11", goiY: "Xem PDF kín màn hình, Esc để thoát", lam: () => batToanMan(), bat: coXem, khoa: "Chưa có PDF để xem toàn màn hình. Mở file PDF, hoặc bấm Chạy thử (F5) với file .tex."},
      ]],
    ]},
  ];
}

function dsTep() {
  return [
    {ten: "Mở file...", phim: "Ctrl+O", lam: () => moKhac("tep")},
    {ten: "Mở thư mục...", lam: () => moKhac("thu_muc")},
    null,
    {ten: "Lưu", phim: "Ctrl+S", lam: luuVaXuat, bat: () => !!tt.tep || dangPdf()},
    {ten: "Chạy thử (Xem PDF)", phim: "F5", lam: () => bienDich(), bat: coTex},
    {ten: "Lưu ra file PDF", phim: "Ctrl+E", lam: xuatDung, bat: coTex},
    {ten: "In", phim: "Ctrl+P", lam: inPdf},
    null,
    {ten: "Đóng file", phim: "Ctrl+W", lam: dongTheHien, bat: () => !!the.hien},
    {ten: "Thư viện mẫu", lam: moThuVien},
    {ten: "Phím tắt", lam: moPhimTat},
    {ten: "Kiểm tra cập nhật", lam: () => cnMo(true)},
    null,
    {ten: "Thoát", lam: thoatApp},
  ];
}

// ---------- Dựng ribbon ----------

const NUT_RIBBON = [];
const THE_TAB = new Map();  // mã tab -> {nut, than}

function taoNut(x) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = x.to ? "nut-to" : "nut-nho";
  b.innerHTML = bieuTuong(x.ic);
  b.setAttribute("aria-label", x.ten);
  // Nút to: chữ nằm dưới biểu tượng. Nút nhỏ: chữ (tên ngắn nếu có) nằm bên phải, nhóm thiếu chỗ thì ẩn chữ đi.
  const s = document.createElement("span");
  s.textContent = x.tenNgan || x.ten;
  b.append(s);
  b.dataset.ten = x.ten;
  if (x.phim) b.dataset.phim = x.phim;
  if (x.goiY) b.dataset.goiY = x.goiY;
  if (x.sapCo) b.dataset.sapCo = "";
  // Không dùng thuộc tính disabled: nút mờ vẫn phải hiện gợi ý để biết đó là nút gì.
  b.onclick = () => {
    if (b.getAttribute("aria-disabled") === "true") return;
    if (x.sapCo) bao(`${x.ten}: chức năng này sắp có.`); else x.lam();
  };
  NUT_RIBBON.push({nut: b, x});
  return b;
}

function taoNhom([ten, muc, moRong]) {
  const nhom = document.createElement("section"), hang = document.createElement("div"), nhan = document.createElement("div");
  nhom.className = "nhom";
  nhom.setAttribute("role", "group");
  nhom.setAttribute("aria-label", ten);
  hang.className = "nhom-than";
  nhan.className = "nhom-ten";
  nhan.textContent = ten;
  let cot = null;  // các nút nhỏ liền nhau xếp thành lưới hai hàng
  for (const x of muc) {
    if (x.to) { cot = null; hang.append(taoNut(x)); continue; }
    if (!cot) {
      cot = document.createElement("div");
      cot.className = "nhom-nho";
      hang.append(cot);
    }
    if (x.o) {
      cot.append(document.getElementById(x.o));
    } else cot.append(taoNut(x));
  }
  if (moRong) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mo-rong-nhom";
    b.innerHTML = bieuTuong("mo-rong");
    b.setAttribute("aria-label", moRong.ten);
    b.dataset.ten = moRong.ten;
    b.dataset.goiY = moRong.goiY;
    b.onclick = moRong.lam;
    nhan.append(b);
  }
  nhom.append(hang, nhan);
  return nhom;
}

function taoRibbon() {
  const hang = document.getElementById("ribbon-tab"), than = document.getElementById("ribbon-than");
  const tep = document.createElement("button");
  tep.id = "tab-tep";
  tep.type = "button";
  tep.textContent = "Tệp";
  tep.setAttribute("aria-haspopup", "menu");
  tep.setAttribute("aria-expanded", "false");
  tep.onclick = () => { if (menuMo) dongMenu(); else moMenu(tep, dsTep()); };
  hang.append(tep);
  const ds = document.createElement("div");
  ds.className = "ds-tab";
  ds.setAttribute("role", "tablist");
  ds.setAttribute("aria-label", "Các nhóm lệnh");
  hang.append(ds);
  for (const t of dsRibbon()) {
    const nut = document.createElement("button"), o = document.createElement("div");
    nut.type = "button";
    nut.id = `rb-tab-${t.ma}`;
    nut.textContent = t.ten;
    nut.setAttribute("role", "tab");
    nut.setAttribute("aria-controls", `rb-${t.ma}`);
    nut.onclick = () => bamTab(t.ma);
    nut.ondblclick = doiThuGon;
    o.id = `rb-${t.ma}`;
    o.className = "bang-lenh";
    o.setAttribute("role", "tabpanel");
    o.setAttribute("aria-labelledby", nut.id);
    o.append(...t.nhom.map(taoNhom));
    ds.append(nut);
    than.append(o);
    THE_TAB.set(t.ma, {nut, than: o});
  }
  ds.onkeydown = e => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const dsNut = [...ds.children], i = dsNut.indexOf(document.activeElement);
    dsNut[(i + (e.key === "ArrowRight" ? 1 : -1) + dsNut.length) % dsNut.length].click();
    ds.querySelector("[aria-selected=true]").focus();
  };
  document.querySelectorAll("[data-ic]").forEach(b => {
    b.insertAdjacentHTML("afterbegin", bieuTuong(b.dataset.ic));
    if (b.dataset.chu) b.insertAdjacentHTML("beforeend", `<span class="chu-nut">${b.dataset.chu}</span>`);
  });
  $("nut-gon").onclick = doiThuGon;
  $("nut-hien-thi").onclick = () => { if (menuMo?.nut === $("nut-hien-thi")) dongMenu(); else moMenuHienThi(); };
  $("ribbon-than").addEventListener("click", e => {
    const b = e.target.closest("button");
    if (b && b.id !== "nut-gon" && b.getAttribute("aria-disabled") !== "true") moTamRibbon(false);  // chạy xong một lệnh thì ẩn ribbon hiện tạm
  });
  document.getElementById("bd-mo-file").onclick = () => moKhac("tep");
  document.getElementById("bd-mo-thu-muc").onclick = () => moKhac("thu_muc");
  document.getElementById("luu-tep").onclick = e => { if (e.currentTarget.getAttribute("aria-disabled") !== "true") luuVaXuat(); };
  document.getElementById("luu-pdf").onclick = e => {
    if (e.currentTarget.getAttribute("aria-disabled") === "true") return;
    if (dangPdf()) luuVaXuat(); else luuPdfTex();
  };
  document.getElementById("mui-ben").onclick = () => batTat("ban");
  document.getElementById("nut-trai").onclick = () => batTat("soan");
  document.getElementById("nut-phim").onclick = moPhimTat;
  chuyenTab("chu");
}

// ---------- Đổi tab, thu gọn ----------

let tabHienTai = "chu";

function chuyenTab(ma) {
  tabHienTai = ma;
  for (const [k, t] of THE_TAB) {
    t.nut.setAttribute("aria-selected", k === ma);
    t.nut.tabIndex = k === ma ? 0 : -1;
    t.than.hidden = k !== ma;
  }
  vuaRibbon();
}

// Ba chế độ hiển thị ribbon như Office: "du" (tab và lệnh), "tab" (chỉ tab, bấm tab thì lệnh hiện tạm đè lên trang), "an" (ẩn cả hàng tab, bấm thanh tiêu đề để hiện tạm).
const CHE_DO_RIBBON = [["du", "Hiện đủ ribbon"], ["tab", "Chỉ hiện tab"], ["an", "Tự ẩn ribbon"]];

// Ribbon hiện tạm: bấm ra ngoài hay chạy xong một lệnh thì ẩn lại.
function moTamRibbon(bat) {
  $("ribbon").classList.toggle("mo-tam", !!bat && bc.ribbon !== "du");
  capNhatNutGon();
  vuaRibbon();
}

function bamTab(ma) {
  chuyenTab(ma);
  moTamRibbon(true);
}

function capNhatNutGon() {
  const nut = $("nut-gon"), ghim = bc.ribbon !== "du";
  nut.dataset.ten = ghim ? "Ghim ribbon" : "Thu gọn ribbon";
  nut.setAttribute("aria-label", nut.dataset.ten);
  nut.querySelector("svg").innerHTML = BT[ghim ? "tro-xuong" : "tro-len"];
}

function apThuGon() {
  if (!CHE_DO_RIBBON.some(([ma]) => ma === bc.ribbon)) bc.ribbon = bc.thuGon ? "tab" : "du";  // cài đặt cũ chỉ có thuGon
  delete bc.thuGon;
  const r = $("ribbon");
  r.classList.toggle("thu-gon", bc.ribbon !== "du");
  r.classList.toggle("tu-an", bc.ribbon === "an");
  moTamRibbon(false);
  $("nut-hien-thi").setAttribute("aria-expanded", "false");
}

function datCheDoRibbon(ma) {
  bc.ribbon = ma;
  apThuGon();
  apBoCuc();
  capNhatVungPdf();
  luuBoCuc();
  requestAnimationFrame(() => { apBoCuc(); capNhatVungPdf(); });  // khung xem tính lại sau khi bố cục đã đổi chỗ
}

// Nhấp đúp tab, Ctrl+F1: qua lại giữa hiện đủ và chỉ hiện tab; đang tự ẩn thì hiện đủ.
function doiThuGon() {
  datCheDoRibbon(bc.ribbon === "du" ? "tab" : "du");
}

function moMenuHienThi() {
  moMenu($("nut-hien-thi"), CHE_DO_RIBBON.map(([ma, ten]) => ({ten, tich: bc.ribbon === ma, lam: () => datCheDoRibbon(ma)})));
}

// Nhóm thiếu chỗ thì thu về chỉ biểu tượng, nhóm ít dùng thu trước, rồi đến các nhóm bên phải.
const NHOM_IT_DUNG = ["Khổ giấy", "Định dạng", "Quản lý", "Kiểu nét", "Bố cục", "Phông chữ", "Nhận dạng"];

function vuaRibbon() {
  const t = THE_TAB.get(tabHienTai), than = t?.than;
  if (!than || than.hidden || !than.clientWidth) return;
  const ds = [...than.querySelectorAll(".nhom")];
  ds.forEach(n => n.classList.remove("gon"));
  const hang = n => { const i = NHOM_IT_DUNG.indexOf(n.getAttribute("aria-label")); return i >= 0 ? i : 100 - ds.indexOf(n); };
  const xep = ds.filter(n => n.querySelector(".nut-nho")).sort((a, b) => hang(a) - hang(b));
  for (const n of xep) {
    if (than.scrollWidth <= than.clientWidth) break;
    n.classList.add("gon");
  }
  // Thu dư thì mở lại nhóm nào còn vừa, nhóm hay dùng mở trước.
  for (const n of xep.filter(n => n.classList.contains("gon")).reverse()) {
    n.classList.remove("gon");
    if (than.scrollWidth > than.clientWidth) n.classList.add("gon");
  }
}
new ResizeObserver(vuaRibbon).observe(document.getElementById("ribbon-than"));
document.fonts?.ready.then(vuaRibbon);

function capNhatRibbon() {
  for (const {nut, x} of NUT_RIBBON) {
    if (x.bat) {
      const khoa = !x.bat();
      nut.setAttribute("aria-disabled", khoa);
      const ly = khoa && (typeof x.khoa === "function" ? x.khoa() : x.khoa ?? LY_DO_CHUNG.get(x.bat)?.());
      if (ly) nut.dataset.khoa = ly; else delete nut.dataset.khoa;
    }
    if (x.tich) nut.setAttribute("aria-pressed", !!x.tich());
  }
  capNhatTen();
  capNhatNav();
  capNhatThe();
  capNhatThanhNet();
}

// Tên file trên đầu mỗi vùng: chữ nghiêng là bản chưa lưu. PDF biên dịch ra chỉ là bản nháp nên nghiêng đến khi được lưu.
function capNhatTen() {
  const dangMo = dangPdf() ? pt.ten : tt.tep?.ten;
  $("tieu-de").textContent = dangMo ? `${dangMo} - TriTeX` : "TriTeX";
  const pdf = dangPdf(), tenTep = $("ten-tep"), luuTep = $("luu-tep");
  tenTep.classList.toggle("chua-luu-ten", !!coThayDoi());
  luuTep.hidden = !tt.tep;
  luuTep.setAttribute("aria-disabled", !coThayDoi() || tt.dangBan);
  luuTep.dataset.khoa = tt.dangBan ? "Đang lưu, chờ xong đã." : "Chưa có thay đổi cần lưu.";
  $("nut-trai").hidden = pdf ? bc.day : !tt.tep;  // mở PDF thì nút ẩn nằm trên đầu dải trang, chỉ cần nút này để hiện lại
  const coPdf = pdf || !!tt.tep?.la_tex;
  $("dau-pdf").hidden = !coPdf;
  if (!coPdf) return;
  $("luu-pdf").setAttribute("aria-disabled", pdf ? !pt.ds.length : !tt.pdf);
  $("luu-pdf").dataset.khoa = pdf ? "Chưa mở PDF nào." : "Chưa có PDF. Bấm Biên dịch (F5) để tạo trước.";
  const ten = pdf ? pt.ten : `${tt.tep.ten.replace(/\.tex$/i, "")}${hauToPdf()}.pdf`;
  $("ten-pdf").textContent = ten;
  $("ten-pdf").title = ten;
  $("ten-pdf").classList.toggle("chua-luu-ten", pdf ? pt.nhap || pt.doi : !tt.pdfDaLuu);
}

function datViec(chu) {
  tt.viec = chu;
  document.getElementById("viec").textContent = chu;
  capNhatRibbon();
}

// ---------- Gợi ý khi rê chuột: nút chỉ có biểu tượng thì phải biết ngay nút đó là gì ----------

const goiY = document.getElementById("goi-y");
let henGoiY, vuaHienGoiY = 0;

function hienGoiY(b) {
  goiY.replaceChildren();
  const ten = document.createElement("strong");
  ten.textContent = b.dataset.ten;
  goiY.append(ten);
  if (b.dataset.phim) {
    const k = document.createElement("kbd");
    k.textContent = b.dataset.phim;
    goiY.append(k);
  }
  const them = "sapCo" in b.dataset ? "Sắp có" : b.dataset.goiY;
  if (them) {
    const p = document.createElement("p");
    p.textContent = them;
    goiY.append(p);
  }
  if (b.getAttribute("aria-disabled") === "true" && b.dataset.khoa) {
    const p = document.createElement("p");
    p.className = "ly-do";
    p.textContent = b.dataset.khoa;
    goiY.append(p);
  }
  goiY.hidden = false;
  const o = b.getBoundingClientRect(), rong = goiY.offsetWidth;
  const trenDuoi = o.bottom + goiY.offsetHeight + 12 > innerHeight;
  goiY.style.left = `${Math.max(6, Math.min(innerWidth - rong - 6, o.left + o.width / 2 - rong / 2))}px`;
  goiY.style.top = `${trenDuoi ? o.top - goiY.offsetHeight - 6 : o.bottom + 6}px`;
}

function anGoiY() {
  clearTimeout(henGoiY);
  if (!goiY.hidden) vuaHienGoiY = Date.now();
  goiY.hidden = true;
}

addEventListener("pointerover", e => {
  const b = e.target.closest?.("[data-ten]");
  anGoiY();
  if (b) henGoiY = setTimeout(() => hienGoiY(b), Date.now() - vuaHienGoiY < 400 ? 0 : 350);
});
addEventListener("focusin", e => { if (e.target.matches("[data-ten]:focus-visible:not(input)")) hienGoiY(e.target); });
addEventListener("focusout", anGoiY);
addEventListener("pointerdown", anGoiY, true);

// ---------- Trình đơn Tệp ----------

let menuMo = null;

function dongMenu() {
  menuMo?.nut?.setAttribute("aria-expanded", "false");
  menuMo?.bang.remove();
  menuMo = null;
}

// Không có nút: menu chuột phải, hiện đúng chỗ bấm (toa là [x, y]).
function moMenu(nut, muc, toa) {
  dongMenu();
  const bang = document.createElement("div");
  bang.className = "bang-menu";
  bang.setAttribute("role", "menu");
  for (const x of muc) {
    if (!x) { bang.append(document.createElement("hr")); continue; }
    const b = document.createElement("button");
    b.setAttribute("role", "menuitem");
    b.disabled = x.bat ? !x.bat() : false;
    b.innerHTML = '<span class="ten"></span><span class="phim"></span>';
    b.children[0].textContent = x.ten;
    if (x.tich !== undefined) { b.setAttribute("role", "menuitemradio"); b.setAttribute("aria-checked", !!x.tich); }
    b.children[1].textContent = x.phim || "";
    if (x.nguy) b.classList.add("nguy");
    b.onclick = () => { dongMenu(); x.lam(); };
    bang.append(b);
  }
  document.body.append(bang);
  const o = nut?.getBoundingClientRect(), x = nut ? o.left : toa[0], y = nut ? o.bottom : toa[1];
  bang.classList.toggle("chuot-phai", !nut);
  bang.style.left = `${Math.max(4, Math.min(innerWidth - bang.offsetWidth - 4, x))}px`;
  bang.style.top = `${Math.max(4, Math.min(innerHeight - bang.offsetHeight - 4, y))}px`;
  nut?.setAttribute("aria-expanded", "true");
  menuMo = {nut, bang};
  bang.querySelector("button:not(:disabled)")?.focus();
  bang.onkeydown = e => {
    const ds = [...bang.querySelectorAll("button:not(:disabled)")], i = ds.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); ds[(i + 1) % ds.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); ds[(i - 1 + ds.length) % ds.length].focus(); }
  };
}

function moPhimTat() {
  const ds = [...dsTep().filter(x => x?.phim), ...NUT_RIBBON.map(n => n.x).filter(x => x.phim),
    {ten: "Hiện đủ ribbon / Chỉ hiện tab", phim: "Ctrl+F1"}];
  const daCo = new Set();
  $("ds-phim").replaceChildren(...ds.filter(x => !daCo.has(x.phim) && daCo.add(x.phim)).map(x => {
    const li = document.createElement("li"), k = document.createElement("kbd");
    li.textContent = x.ten;
    k.textContent = x.phim;
    li.append(k);
    return li;
  }));
  $("hop-phim").showModal();
}

addEventListener("pointerdown", e => {
  if (menuMo && !menuMo.bang.contains(e.target) && !menuMo.nut?.contains(e.target)) dongMenu();
  if (!$("ribbon").contains(e.target)) moTamRibbon(false);
});

taoRibbon();
