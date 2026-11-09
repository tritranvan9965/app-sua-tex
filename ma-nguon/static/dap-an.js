"use strict";
// Ẩn, hiện đáp án. Ẩn đáp án = chọn bản HS (bản thứ hai của dự án): biên dịch ra PDF bản HS, Theo dòng không hiện lời giải,
// Toàn bộ code gập các khối lời giải thành một nhãn nhỏ. Văn bản trong file không đổi, lưu vẫn ghi đủ.

// Dự án có đúng hai bản thì bản đầu có đáp án, bản sau ẩn đáp án. Nhiều bản hơn thì không suy ra được bản nào ẩn.
const anDapAn = () => tt.dsBan.length === 2 && tt.ban === tt.dsBan[1];
const coNutDapAn = () => tt.dsBan.length === 2;
const hauToPdf = () => (tt.ban && tt.ban !== tt.khongHauTo ? `_${tt.ban}` : "");

let dapAnTep = null;  // file mà các nhớ tạm bên dưới thuộc về
tt.giaiMo = new Set();  // khối đã bấm xem tạm lời giải ở Theo dòng (chỉ số khối)
let dapAnMoCode = [];  // chỗ đã mở ở Toàn bộ code: đánh dấu chỗ, tự dời theo khi sửa văn bản
let henGap = 0;

// Cập nhật nút, gợi ý và mọi nơi hiện đáp án theo bản đang chọn.
function dapAnCapNhat(veLai = true) {
  const co = coNutDapAn(), an = anDapAn();
  const nut = $("tich-ban");
  if (nut && co) {
    const ban = tt.ban, kia = tt.dsBan[an ? 0 : 1];
    nut.setAttribute("aria-pressed", an);
    nut.dataset.goiY = an
      ? `Đang ẩn đáp án (bản ${ban}). Bấm để hiện lại đáp án (bản ${kia}). Chạy thử và Lưu ra PDF cho bản đang chọn. Phím tắt Ctrl+Shift+H.`
      : `Đang hiện đáp án (bản ${ban}). Bấm để ẩn đáp án (bản ${kia}): lời giải ẩn khỏi khung sửa, Chạy thử ra PDF bản HS. File .tex không đổi. Phím tắt Ctrl+Shift+H.`;
    nut.querySelector("svg").innerHTML = BT[an ? "mat-gach" : "mat"];
  }
  if (typeof capNhatRibbon === "function") capNhatRibbon();
  if (!veLai) return;
  if (dapAnTep !== tt.tep) {
    dapAnTep = tt.tep;
    tt.giaiMo.clear();
    dapAnMoCode = [];
  }
  if (tt.cheDo === "dong" && tt.tep?.la_tex) { khoaDong = null; veTheoDong(true); }
  dapAnGap();
}

function batTatDapAn() {
  if (!coNutDapAn()) return bao("Dự án này có nhiều bản PDF, chọn bản ở các nút phía trên.", true);
  chonBan(tt.dsBan[anDapAn() ? 0 : 1]);
}

// Đổi bản thì quên các chỗ đã mở tạm.
const dapAnQuenMo = () => { tt.giaiMo.clear(); dapAnMoCode = []; };

// ---------- Toàn bộ code: gập khối lời giải ----------

function dapAnXoaGap() {
  for (const m of soan.getAllMarks()) if (m.dapAn) m.clear();
}

// Gập hay mở khối làm chiều cao đổi, nên giữ nguyên chỗ đang nhìn: lấy dòng con trỏ (nếu đang trong khung nhìn)
// hoặc dòng đầu khung nhìn làm mốc, vẽ xong thì cuộn lại cho mốc đứng đúng chỗ cũ.
function dapAnGap() {
  const nhin = soan.getScrollInfo(), cao = soan.getScrollerElement().clientHeight;
  let mocDong = soan.getCursor("head").line;
  const yCt = soan.heightAtLine(mocDong, "local") - nhin.top;
  if (yCt < 0 || yCt > cao) mocDong = soan.lineAtHeight(nhin.top, "local");
  const yMoc = soan.heightAtLine(mocDong, "local") - nhin.top;
  dapAnGapVe();
  const lech = soan.heightAtLine(mocDong, "local") - soan.getScrollInfo().top - yMoc;
  if (lech) soan.scrollTo(null, soan.getScrollInfo().top + lech);
}

function dapAnGapVe() {
  clearTimeout(henGap);
  dapAnXoaGap();
  if (!anDapAn() || !tt.tep?.la_tex || tt.cheDo !== "code") return;
  const chu = soan.getValue(), m = matNa(chu);
  const mo = new Set(dapAnMoCode.map(b => b.find()).filter(Boolean).map(p => soan.indexFromPos(p)));
  const dsLenh = [...new Set([...LENH_LOI_GIAI, LOI_GIAI])];
  const dau = soan.getCursor("from"), cuoi = soan.getCursor("to");
  const vung = [];
  for (const lenh of dsLenh) {
    for (let i = m.indexOf(lenh); i >= 0; i = m.indexOf(lenh, i + lenh.length)) {
      const k = dongNgoac(m, i + lenh.length - 1);
      if (k > 0) vung.push([i, k + 1]);
    }
  }
  vung.sort((a, b) => a[0] - b[0]);
  let het = -1;
  for (const [a, b] of vung) {
    if (a < het || mo.has(a)) continue;  // nằm trong khối đã gập, hoặc người dùng đang mở
    const tu = soan.posFromIndex(a), den = soan.posFromIndex(b);
    if (dapAnChua(tu, den, dau) || dapAnChua(tu, den, cuoi)) continue;  // con trỏ đang ở trong: đang sửa thì không gập
    het = b;
    const nhan = document.createElement("span");
    nhan.className = "gap-giai";
    nhan.textContent = "[Lời giải đã ẩn]";
    nhan.title = "Bấm để xem và sửa lời giải này";
    const dau1 = m.slice(a, b).split("\n").length - 1;
    if (dau1) nhan.dataset.dong = `${dau1 + 1} dòng`;
    const mark = soan.markText(tu, den, {replacedWith: nhan, handleMouseEvents: true});
    mark.dapAn = true;
    nhan.onclick = () => {
      const vt = mark.find();
      if (!vt) return;
      dapAnMoCode.push(soan.setBookmark(vt.from));
      mark.clear();
      soan.setCursor(vt.from);
      soan.focus();
    };
  }
}

const dapAnSoPos = (a, b) => a.line - b.line || a.ch - b.ch;
const dapAnChua = (tu, den, p) => dapAnSoPos(p, tu) > 0 && dapAnSoPos(p, den) < 0;

// Sửa văn bản xong thì tính lại chỗ gập. Hẹn giờ để gõ liên tục không bị giật.
const dapAnHen = () => {
  if (!anDapAn()) return;
  clearTimeout(henGap);
  henGap = setTimeout(dapAnGap, 400);
};
soan.on("change", dapAnHen);
soan.on("cursorActivity", dapAnHen);  // con trỏ rời khỏi lời giải đang sửa thì gập lại

addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "h") {
    e.preventDefault();
    if (tt.tep?.la_tex && !dangPdf()) batTatDapAn();
  }
});
