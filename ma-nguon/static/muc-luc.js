"use strict";
// Mục lục (dàn bài) có sẵn trong PDF, hiện ở thanh bên trái thay cho trang thu nhỏ. Bấm là xem tới trang, bấm đúp là chọn các trang của mục đó.

const ML_KHOA = "sua-tex-ben-pdf";
const ml = {che: "trang", hang: [], seq: 0, gap: new Set(), dang: null};

try { ml.che = localStorage.getItem(ML_KHOA) === "muc" ? "muc" : "trang"; } catch { /* không đọc được thì hiện trang thu nhỏ */ }

// Cây dàn bài của một file PDF thành danh sách phẳng {tieu, so, cap}, so là số trang bắt đầu từ 1 (null nếu mục không trỏ tới trang).
async function mlLayMuc(duong) {
  const t = pt.tep.get(duong);
  if (!t.muc) {
    t.muc = (async () => {
      const ra = [];
      const di = async (ds, cap) => {
        for (const m of ds || []) {
          let so = null;
          try {
            let dich = m.dest;
            if (typeof dich === "string") dich = await t.doc.getDestination(dich);
            if (Array.isArray(dich)) so = (typeof dich[0] === "object" ? await t.doc.getPageIndex(dich[0]) : dich[0]) + 1;
          } catch { /* đích hỏng thì mục vẫn hiện nhưng không bấm được */ }
          ra.push({tieu: m.title || "(không tên)", so, cap});
          await di(m.items, cap + 1);
        }
      };
      await di(await t.doc.getOutline(), 0);
      // Mục chạy từ trang của nó tới trước trang của mục kế cùng cấp hoặc cấp cao hơn, mục cuối chạy tới hết file.
      ra.forEach((m, i) => {
        const ke = m.so === null ? null : ra.slice(i + 1).find(x => x.cap <= m.cap && x.so !== null);
        m.den = m.so === null ? null : ke ? Math.max(m.so, ke.so - 1) : t.doc.numPages;
        m.co_con = ra[i + 1]?.cap > m.cap;
      });
      return ra;
    })();
  }
  return t.muc;
}

const mlTrangCua = (duong, tu, den) => pt.ds.filter(x => x.duong === duong && x.so >= tu && x.so <= den);

function mlDatChe(che) {
  ml.che = che;
  try { localStorage.setItem(ML_KHOA, che); } catch { /* chỉ là tiện lợi, không lưu được cũng không sao */ }
  $("ben-trang").setAttribute("aria-pressed", che === "trang");
  $("ben-muc").setAttribute("aria-pressed", che === "muc");
  $("ds-trang").hidden = che === "muc";
  $("ds-muc").hidden = che !== "muc";
  if (che === "muc") veMucLuc();
}

async function veMucLuc() {
  if (ml.che !== "muc") return;
  const seq = ++ml.seq, o = $("ds-muc"), cuon = o.scrollTop;
  const tep = [...new Set(pt.ds.map(x => x.duong))];
  const muc = await Promise.all(tep.map(mlLayMuc));
  if (seq !== ml.seq) return;
  ml.hang = [];
  const ra = [];
  tep.forEach((duong, k) => {
    const ds = muc[k];
    if (tep.length > 1) {
      const ten = document.createElement("div");
      ten.className = "ten-tep";
      ten.textContent = pt.tep.get(duong).ten;
      ra.push(ten);
    }
    if (!ds.length) {
      const trong = document.createElement("div");
      trong.className = "trong";
      trong.textContent = tep.length > 1 ? "Không có mục lục." : "PDF này chưa có mục lục.";
      ra.push(trong);
      return;
    }
    let an = null;  // đang nằm trong mục bị thu gọn, cấp của mục đó
    ds.forEach((m, i) => {
      if (an !== null && m.cap > an) return;
      an = null;
      const khoa = `${duong}|${i}`, dong = ml.gap.has(khoa);
      if (dong && m.co_con) an = m.cap;
      const hang = document.createElement("div"), gap = document.createElement("button"), td = document.createElement("button"), so = document.createElement("span");
      hang.className = "mm";
      hang.style.paddingLeft = `${m.cap * 14}px`;
      gap.type = td.type = "button";
      gap.className = m.co_con ? "gap" : "gap rong";
      gap.setAttribute("aria-expanded", !dong);
      gap.setAttribute("aria-label", dong ? "Mở mục con" : "Thu gọn mục con");
      gap.tabIndex = m.co_con ? 0 : -1;
      gap.onclick = () => {
        if (ml.gap.has(khoa)) ml.gap.delete(khoa); else ml.gap.add(khoa);
        veMucLuc();
      };
      td.className = "tieu-de";
      so.className = "so-tr";
      so.textContent = m.so ?? "";
      td.append(document.createTextNode(m.tieu), so);
      const trang = m.so === null ? [] : mlTrangCua(duong, m.so, m.den);
      td.disabled = !trang.length;
      td.title = trang.length ? `${m.tieu}\nBấm để xem, bấm đúp để chọn ${trang.length} trang của mục này` : "Trang của mục này không còn trong dãy";
      td.onclick = () => xemTrang(trang.find(x => x.so === m.so) || trang[0]);
      td.ondblclick = e => mlChon(m, trang, e.ctrlKey || e.shiftKey);
      hang.append(gap, td);
      ra.push(hang);
      ml.hang.push({el: hang, duong, m, trang});
    });
  });
  o.replaceChildren(...ra);
  o.scrollTop = cuon;
  capNhatMucLuc(true);
}

// Chọn các trang của mục. Giữ Ctrl hoặc Shift thì thêm vào phần đã chọn, không thì thay.
function mlChon(m, trang, them) {
  const tap = new Set(trang);
  pt.ds.forEach(x => { x.chon = tap.has(x) || (them && x.chon); });
  document.querySelectorAll("#ds-trang .o-trang").forEach(d => {
    const x = pt.ds.find(y => y.id === +d.dataset.id);
    if (x) d.querySelector("input").checked = x.chon;
  });
  capNhatChon();
  bao(`Đã chọn ${trang.length} trang của "${m.tieu}"`);
}

// Tô mục đang xem và các mục đã chọn đủ trang, không dựng lại cây.
function capNhatMucLuc(cuonToi = false) {
  if (ml.che !== "muc" || !ml.hang.length) return;
  const xem = pt.xem;
  const dang = xem ? ml.hang.filter(h => h.duong === xem.duong && h.m.so !== null && h.m.so <= xem.so && xem.so <= h.m.den).pop() : null;
  for (const h of ml.hang) {
    h.el.classList.toggle("da-chon", h.trang.length > 0 && h.trang.every(x => x.chon));
    h.el.classList.toggle("dang-xem", h === dang);
  }
  if (dang && dang !== ml.dang || cuonToi && dang) dang.el.scrollIntoView({block: "nearest"});
  ml.dang = dang;
}

$("ben-trang").onclick = () => mlDatChe("trang");
$("ben-muc").onclick = () => mlDatChe("muc");
mlDatChe(ml.che);
