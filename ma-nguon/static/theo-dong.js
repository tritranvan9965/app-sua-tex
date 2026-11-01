"use strict";
// Chế độ Theo dòng: hiện cả file thành các khối (mục, lý thuyết, bài, câu) và từng dòng đã hiện công thức.
// Mỗi dòng nhớ vị trí trong file, nên sửa ở đây là sửa thẳng vào nội dung file, lưu và xuất vẫn đi qua app.js như bình thường.
// Khối chỉ vẽ khi gần khung nhìn và được bỏ khi đi xa, để file ngân hàng dài không chậm.

const MOI_DONG_MOT_HANG = /^(align|gather|equation)\*?$/;  // các dòng công thức, tách theo dấu \\
const GIU_NGUYEN = /^(tikzpicture|tabular|tabularx|longtable|figure|minipage)\*?$/;  // giữ nguyên cả khối
const DANH_SACH = /^(cacy|enumerate|itemize|choices)\*?$/;
const BO_DONG = /^(?:\\(?:newpage|clearpage|pagebreak|baimoi|noindent|medskip|bigskip|smallskip|centering|hfill|par|maketitle|tableofcontents|newline)(?![a-zA-Z])|\\[vh]space\*?\{[^{}]*\}|\\(?:setcounter|addtocounter)\{[^{}]*\}\{[^{}]*\}|\s)+$/;  // chỉ là lệnh trình bày, không có chữ

// Môi trường nào là một khối. Tên viết thường, không có dấu *. Khối của dự án (cau.moi_truong) tính là Bài.
const KHOI_BAI = {bt: "Bài", bai: "Bài", baitap: "Bài", exercise: "Bài", problem: "Bài", ex: "Câu", cau: "Câu", cauhoi: "Câu", question: "Câu",
  vd: "Ví dụ", vidu: "Ví dụ", example: "Ví dụ"};
const KHOI_LT = {kienthuc: "Kiến thức", lythuyet: "Lý thuyết", phuongphap: "Phương pháp", dinhnghia: "Định nghĩa", definition: "Định nghĩa",
  dinhly: "Định lý", theorem: "Định lý", tinhchat: "Tính chất", property: "Tính chất", menhde: "Mệnh đề", proposition: "Mệnh đề", hequa: "Hệ quả",
  corollary: "Hệ quả", bode: "Bổ đề", lemma: "Bổ đề", chuy: "Chú ý", remark: "Chú ý", note: "Chú ý", nhanxet: "Nhận xét", proof: "Chứng minh", chungminh: "Chứng minh"};
const CAP_MUC = {chapter: 0, part: 0, tieude: 0, section: 1, phan: 1, subsection: 2, dang: 2, subsubsection: 3, paragraph: 3};
const LENH_LOI_GIAI = ["\\giai{", "\\huongdan{", "\\loigiai{"];

// File không dùng môi trường: nhận theo chữ ở đầu dòng, ví dụ "Câu 1.", "Bài 3:", "Phần II", "Lý thuyết".
const DAU_DONG = /^[ \t]*(?:\\textbf\{|\{\\bf\s+)?\s*(?:(Câu|Bài tập|Bài|Ví dụ)\s+(\d+)|((?:Phần|Chương|Chuyên đề|Dạng)\s+[\dIVXLA-Z]|Lý thuyết|Lí thuyết|Kiến thức|Bài tập)(?!\p{L}))/gimu;

// Che ghi chú và verbatim bằng dấu cách cùng độ dài, để tìm lệnh không vấp vào đó mà vị trí vẫn đúng với file.
const che = s => s.replace(/[^\n]/g, " ");
const matNa = chu => chu.replace(/(?<!\\)%.*$/gm, che).replace(/\\begin\{verbatim\}[\s\S]*?\\end\{verbatim\}/g, che);

function quetVung(chu, a, b, phan, ds) {
  let i = a, batDau = a, math = false, sau = 0, nhan = "";
  const dsMuc = [];  // danh sách đang mở, để biết \item hiện a) hay dấu chấm
  const dong = (cuoi, kieu = "chu") => {
    let d = batDau, c = cuoi;
    while (d < c && /\s/.test(chu[d])) d++;
    while (c > d && /\s/.test(chu[c - 1])) c--;
    if (c > d && chu[d] !== "%" && !BO_DONG.test(chu.slice(d, c))) ds.push({dau: d, cuoi: c, phan, kieu, nhan});  // dòng chỉ có ghi chú thì không hiện
    nhan = "";
  };
  while (i < b) {
    const ch = chu[i];
    if (ch === "%") { const h = chu.indexOf("\n", i); i = h < 0 || h > b ? b : h; continue; }
    if (ch === "$") { math = !math; i++; continue; }
    if (ch === "{") { sau++; i++; continue; }
    if (ch === "}") { sau--; i++; continue; }
    if (ch === "\n" && !math && sau === 0) { dong(i); batDau = ++i; continue; }
    if (ch !== "\\") { i++; continue; }
    if (chu.startsWith("\\\\", i)) {
      if (!math && sau === 0) { dong(i); i += 2; batDau = i; } else i += 2;
      continue;
    }
    if (!math && sau === 0) {
      if (chu.startsWith("\\[", i)) {
        const e = chu.indexOf("\\]", i);
        i = e < 0 ? b : e + 2;
        continue;
      }
      // Phương án trắc nghiệm: mỗi phương án một dòng riêng, chỉ sửa phần chữ, không đụng ngoặc của lệnh.
      const tn = chu.slice(i, i + 12).match(/^\\(paaa|paa|pa|choice)(?![a-zA-Z])/);
      if (tn) {
        let j = i + tn[0].length;
        while (/\s/.test(chu[j] || "")) j++;
        if (chu[j] === "{") {
          dong(i);
          let so = 0;
          while (chu[j] === "{" && j < b) {
            const k = dongNgoac(chu, j);
            if (k < 0) break;
            const raw = chu.slice(j + 1, k);
            ds.push({dau: j + 1, cuoi: k, phan, kieu: "chu", nhan: `${String.fromCharCode(65 + so++)}.`, pa: true, dung: /\\(?:dung|True)(?![a-zA-Z])/.test(raw)});
            j = k + 1;
            while (/\s/.test(chu[j] || "")) j++;
          }
          i = j;
          batDau = j;
          continue;
        }
      }
      const m = chu.slice(i, i + 40).match(/^\\(begin|end)\{([^}]*)\}/);
      if (m && m[1] === "begin" && GIU_NGUYEN.test(m[2])) {
        const e = chu.indexOf(`\\end{${m[2]}}`, i);
        i = e < 0 ? b : e + m[2].length + 6;
        continue;
      }
      if (m && m[1] === "begin" && MOI_DONG_MOT_HANG.test(m[2])) {
        dong(i);
        const dauTrong = i + m[0].length, e = chu.indexOf(`\\end{${m[2]}}`, i);
        if (e < 0) { i = b; batDau = b; continue; }
        batDau = dauTrong;
        let j = dauTrong, ngoac = 0;
        while (j < e) {
          if (chu[j] === "{") ngoac++;
          else if (chu[j] === "}") ngoac--;
          if (chu[j] === "\\") {
            if (chu[j + 1] === "\\" && ngoac === 0) { dong(j, "align"); j += 2; batDau = j; continue; }
            j += 2;
            continue;
          }
          j++;
        }
        dong(e, "align");
        i = e + m[2].length + 6;
        batDau = i;
        continue;
      }
      if (m) {  // khung như cacy, enumerate: ẩn đi, không hiện thành hàng
        dong(i);
        i += m[0].length;
        const thamSo = chu.slice(i, i + 40).match(/^\s*[([][^)\]\n]*[)\]]/);
        if (m[1] === "begin" && thamSo) i += thamSo[0].length;
        if (DANH_SACH.test(m[2])) {
          if (m[1] === "begin") dsMuc.push({ten: m[2], so: 0}); else dsMuc.pop();
        }
        batDau = i;
        continue;
      }
      if (chu.startsWith("\\item", i) && !/[a-zA-Z]/.test(chu[i + 5] || "")) {
        dong(i);
        i += 5;
        batDau = i;
        const t = dsMuc[dsMuc.length - 1];
        nhan = !t || t.ten === "itemize" ? "•" : `${String.fromCharCode(97 + t.so++)})`;
        continue;
      }
    }
    i += 2;
  }
  dong(b);
}

// Dòng của một khối: phần đề, rồi lời giải nếu có.
function tachDong(chu, m, a, b, ds) {
  const dsGiai = [...LENH_LOI_GIAI, LOI_GIAI].map(l => [l, m.indexOf(l, a)]).filter(([, d]) => d >= 0 && d < b).sort((x, y) => x[1] - y[1]);
  if (!dsGiai.length) return quetVung(chu, a, b, "de", ds);
  const [lenh, d] = dsGiai[0], k = dongNgoac(m, d + lenh.length - 1);
  if (k < 0 || k > b) return quetVung(chu, a, b, "de", ds);
  quetVung(chu, a, d, "de", ds);
  quetVung(chu, d + lenh.length, k, "giai", ds);
  quetVung(chu, k + 1, b, "giai", ds);
}

const gonTen = s => s.replace(/\\[a-zA-Z]+\*?|[{}$\\]/g, " ").replace(/\s+/g, " ").trim();

function idTruoc(chu, d) {
  if (!MAU_ID) return null;
  let c = d;
  while (c > 0 && /\s/.test(chu[c - 1])) c--;
  const ma = chu.slice(chu.lastIndexOf("\n", c - 1) + 1, c).match(MAU_ID);
  return ma ? ma[1] : null;
}

// Tách cả file thành các khối theo thứ tự. loai là muc (tiêu đề), bai, lt (lý thuyết) hoặc tu-do (phần còn lại).
function phanTichFile(chu) {
  const m = matNa(chu), khoi = [], dong = [], dem = {};
  const dauTL = m.indexOf("\\begin{document}"), cuoiTL = m.lastIndexOf("\\end{document}");
  const a = dauTL < 0 ? 0 : dauTL + 16, b = cuoiTL < a ? chu.length : cuoiTL;
  const dem1 = ten => (dem[ten] = (dem[ten] || 0) + 1);
  const them = (k, lam) => {
    k.tu = dong.length;
    lam();
    k.den = dong.length;
    if (k.tu < k.den || k.loai !== "tu-do") k.i = khoi.push(k) - 1;
  };
  const themMuc = (cap, nhan, ten, dau, cuoi, oDau, oCuoi) => them({loai: "muc", cap, nhan, ten, dau, cuoi}, () => dong.push({dau: oDau, cuoi: oCuoi, phan: "muc", kieu: "chu", nhan}));
  const themBai = (ten, so, dau, cuoi, vungA, vungB, thongTin = {}) => them({loai: "bai", nhan: `${ten} ${so}`, ten: `${ten} ${so}`, dau, cuoi, ...thongTin}, () => tachDong(chu, m, vungA, vungB, dong));

  const tuDo = (x, y) => {
    const moc = [];
    for (const t of m.slice(x, y).matchAll(DAU_DONG)) moc.push({vt: x + t.index, t});
    let vt = x;
    moc.forEach(({vt: d, t}, i) => {
      const het = moc[i + 1]?.vt ?? y;
      them({loai: "tu-do", dau: vt, cuoi: d}, () => quetVung(chu, vt, d, "de", dong));
      if (t[1]) {
        const ten = t[1][0].toUpperCase() + t[1].slice(1).toLowerCase();
        themBai(ten === "Bài tập" ? "Bài" : ten, +t[2], d, het, d, het);
        vt = het;
        return;
      }
      let c = m.indexOf("\n", d);
      if (c < 0 || c > het) c = het;
      let dau = d;
      while (/\s/.test(chu[dau])) dau++;
      const ch = chu.slice(dau, c).trimEnd();
      if (ch.length > 100) {  // câu dài bắt đầu bằng chữ đó, không phải tiêu đề
        them({loai: "tu-do", dau: d, cuoi: het}, () => quetVung(chu, d, het, "de", dong));
        vt = het;
        return;
      }
      themMuc(1, "", gonTen(ch), d, c, dau, dau + ch.length);
      vt = c;
    });
    them({loai: "tu-do", dau: vt, cuoi: y}, () => quetVung(chu, vt, y, "de", dong));
  };

  const MAU = /\\(?:(chapter|part|section|subsection|subsubsection|paragraph|phan|dang|tieude|baimoi)(?![a-zA-Z])\*?|begin\{([A-Za-z]+)\*?\})/g;
  MAU.lastIndex = a;
  let vt = a;
  for (let t; (t = MAU.exec(m)) && t.index < b;) {
    const d = t.index;
    if (t[1] === "baimoi") {
      tuDo(vt, d);
      vt = MAU.lastIndex;
      for (const k of Object.keys(dem)) dem[k] = 0;
      continue;
    }
    if (t[1]) {
      let j = MAU.lastIndex;
      const bo = () => { while (/\s/.test(m[j] || "")) j++; };
      bo();
      if (m[j] === "[") { j = m.indexOf("]", j) + 1; bo(); }
      if (m[j] !== "{") continue;
      let k = dongNgoac(m, j);
      if (k < 0) continue;
      const oDau = t[1] === "tieude" && m[k + 1] === "{" ? k + 1 : j;
      if (oDau !== j) k = dongNgoac(m, oDau);
      if (k < 0) continue;
      tuDo(vt, d);
      const ten = chu.slice(oDau + 1, k), hieu = t[1] === "dang" ? `Dạng ${dem1("Dạng")}.` : "";
      themMuc(CAP_MUC[t[1]], hieu, gonTen(ten), d, k + 1, oDau + 1, k);
      vt = k + 1;
      MAU.lastIndex = vt;
      continue;
    }
    const ten = t[2], tenThuong = ten.toLowerCase();
    const nhom = KHOI_BAI[tenThuong] || (`\\begin{${ten}}` === DAU ? "Bài" : null), lt = KHOI_LT[tenThuong];
    if (!nhom && !lt) continue;
    // Tìm \end đúng cặp, vì khối có thể lồng khối cùng tên.
    const CAP = new RegExp(`\\\\(begin|end)\\{${ten}\\*?\\}`, "g");
    CAP.lastIndex = MAU.lastIndex;
    let sau = 1, het = -1;
    for (let c; (c = CAP.exec(m));) {
      sau += c[1] === "begin" ? 1 : -1;
      if (!sau) { het = c.index; break; }
    }
    if (het < 0) continue;
    tuDo(vt, d);
    let dauTrong = MAU.lastIndex;
    const ts = m.slice(dauTrong, dauTrong + 40).match(/^\s*\[([^\]\n]*)\]/);
    if (ts) dauTrong += ts[0].length;
    const cuoi = CAP.lastIndex;
    if (nhom) {
      themBai(nhom, dem1(nhom), d, cuoi, dauTrong, het, {id: idTruoc(chu, d), muc: ts?.[1] || "", tn: /\\(?:paaa?|pa|choice)(?![a-zA-Z])/.test(m.slice(d, cuoi))});
    } else them({loai: "lt", nhan: lt, ten: lt, dau: d, cuoi}, () => tachDong(chu, m, dauTrong, het, dong));
    vt = cuoi;
    MAU.lastIndex = vt;
  }
  tuDo(vt, b);
  return {khoi, dong, soDongDau: dauTL < 0 ? 0 : chu.slice(0, dauTL).split("\n").length};
}

// Cùng một nội dung thì không vẽ công thức lại. Đổi dự án thì macro đổi nên phải xoá (datCauHinh).
const boNhoVe = new Map();
function veDong(raw, kieu) {
  const khoa = `${kieu}|${raw}`;
  let html = boNhoVe.get(khoa);
  if (html === undefined) {
    html = kieu === "align" ? veCongThuc(`\\begin{aligned}${raw}\\end{aligned}`, true) : veNoiDung(raw);
    if (boNhoVe.size > 8000) boNhoVe.clear();
    boNhoVe.set(khoa, html);
  }
  return html;
}

function nutDong(chu, d, thuTu, nhanRieng) {
  const b = document.createElement("button");
  b.className = `dong${d.pa ? " pa" : ""}${d.dung ? " dung" : ""}`;
  b.innerHTML = '<span class="so"></span><span class="nd"></span>';
  b.firstChild.textContent = nhanRieng || d.nhan || "";
  b.lastChild.innerHTML = veDong(chu.slice(d.dau, d.cuoi), d.kieu);
  b.title = "Bấm để sửa dòng này";
  if (thuTu !== null) b.dataset.thuTu = thuTu;
  return b;
}

let khoaDong = null;
const caoKhoi = new Map();  // chiều cao đã đo của từng khối, để vẽ lại không làm trang nhảy
const quanKhoi = new IntersectionObserver(muc => muc.forEach(m => {
  const k = tt.khoi[+m.target.dataset.i];
  if (!k || k.o !== m.target) return;
  if (m.isIntersecting) veKhoi(k); else boKhoi(k);
}), {root: $("vung-dong"), rootMargin: "1000px"});

function taoKhoi(k, chu) {
  const o = document.createElement("section");
  o.className = `khoi ${k.loai}${k.loai === "muc" ? ` cap-${k.cap}` : ""}`;
  o.dataset.i = k.i;
  k.daVe = false;
  o.style.height = `${caoKhoi.get(chu.slice(k.dau, k.cuoi)) || 34 + (k.den - k.tu) * 30}px`;
  k.o = o;
  return o;
}

function veKhoi(k) {
  if (k.daVe) return;
  k.daVe = true;
  const chu = soan.getValue(), o = k.o;
  o.replaceChildren();
  o.style.height = "";
  if (k.loai === "bai" || k.loai === "lt") {
    const dau = document.createElement("div"), ten = document.createElement("strong");
    dau.className = "dau-khoi";
    ten.textContent = k.nhan;
    dau.append(ten);
    for (const [co, chuNhan] of [[k.tn, "Trắc nghiệm"], [k.muc, `Mức ${k.muc}`], [k.id, k.id]]) {
      if (!co) continue;
      const s = document.createElement("span");
      s.textContent = chuNhan;
      dau.append(s);
    }
    o.append(dau);
  }
  let phan = "de";
  for (let i = k.tu; i < k.den; i++) {
    const d = tt.dong[i];
    if (d.phan === "giai" && phan !== "giai") {
      const h = document.createElement("div");
      h.className = "ten-phan";
      h.textContent = "Lời giải";
      o.append(h);
    }
    phan = d.phan;
    o.append(nutDong(chu, d, i));
  }
  caoKhoi.set(chu.slice(k.dau, k.cuoi), o.offsetHeight);
}

function boKhoi(k) {
  if (!k.daVe || tt.dangSua?.khoi === k) return;
  k.daVe = false;
  const cao = k.o.offsetHeight;
  caoKhoi.set(soan.getValue().slice(k.dau, k.cuoi), cao);
  k.o.replaceChildren();
  k.o.style.height = `${cao}px`;
}

function veTheoDong(ep = false) {
  if (tt.cheDo !== "dong" || tt.dangSua || $("tim").value.trim()) return;
  const chu = soan.getValue();
  if (!ep && chu === khoaDong) return;
  khoaDong = chu;
  const o = $("vung-dong"), cuon = tt.cuonDen ?? o.scrollTop;
  tt.cuonDen = null;
  quanKhoi.disconnect();
  if (!tt.tep?.la_tex) {
    o.innerHTML = '<p class="trong">Chọn một file ở thanh bên trái để sửa.</p>';
    return;
  }
  if (!tt.dong.length) {
    o.innerHTML = '<p class="trong">File này chưa có nội dung. Chuyển sang Toàn bộ code để gõ.</p>';
    return;
  }
  const ds = [];
  if (tt.soDongDau) {
    const nut = document.createElement("button");
    nut.className = "dau-file";
    nut.textContent = `Phần khai báo đầu file (${tt.soDongDau} dòng), bấm để xem ở Toàn bộ code`;
    nut.onclick = () => { soan.setCursor(0, 0); datCheDo("code"); };
    ds.push(nut);
  }
  ds.push(...tt.khoi.map(k => taoKhoi(k, chu)));
  o.replaceChildren(...ds);
  o.scrollTop = cuon;
  // Vẽ ngay phần đang nhìn để không nháy trắng, phần còn lại để bộ quan sát lo.
  const day = cuon + o.clientHeight + 200;
  for (const k of tt.khoi) {
    if (k.o.offsetTop > day) break;
    if (k.o.offsetTop + k.o.offsetHeight > cuon - 200) veKhoi(k);
  }
  o.scrollTop = cuon;
  tt.khoi.forEach(k => quanKhoi.observe(k.o));
}

function khoiCuaDong(thuTu) {
  return tt.khoi.find(k => thuTu >= k.tu && thuTu < k.den) || null;
}

$("vung-dong").addEventListener("click", e => {
  const nut = e.target.closest?.(".dong[data-thu-tu]");
  if (nut) moDong(+nut.dataset.thuTu);
});

let henCuonDong = 0;
$("vung-dong").addEventListener("scroll", () => {
  henCuonDong ||= requestAnimationFrame(() => { henCuonDong = 0; danhDauBai(); });
});

// Khối ở đầu khung nhìn, để biết đang đọc tới đâu.
function khoiTaiCuon() {
  const y = $("vung-dong").scrollTop + 8;
  let hien = null;
  for (const k of tt.khoi) {
    if (!k.o?.isConnected || k.o.offsetTop > y) break;
    if (k.nhan || k.ten) hien = k;
  }
  return hien ?? tt.khoi.find(k => k.nhan || k.ten) ?? null;
}

const CHEN = [["Phân số", "\\dfrac{▮}{}"], ["Căn", "\\sqrt{▮}"], ["Mũ", "^{▮}"], ["≠", "\\ne "], ["≤", "\\le "], ["≥", "\\ge "],
  ["⇔", "\\Leftrightarrow "], ["⇒", "\\Rightarrow "], ["±", "\\pm "]];

function kiemTraDong(s) {
  const sach = s.replace(/\\./g, "");
  let sau = 0;
  for (const ch of sach) {
    if (ch === "{") sau++;
    else if (ch === "}" && --sau < 0) return "Thừa dấu } trong dòng này.";
  }
  if (sau > 0) return "Thiếu dấu } trong dòng này.";
  if ((sach.match(/\$/g) || []).length % 2) return "Thiếu một dấu $ để đóng công thức.";
  return "";
}

function chenVao(o, mau) {
  const dau = o.selectionStart, cuoi = o.selectionEnd, chon = o.value.slice(dau, cuoi);
  const trongCT = (o.value.slice(0, dau).replace(/\\\$/g, "").match(/\$/g) || []).length % 2 === 1;
  const moc = mau.indexOf("▮");
  let chen = mau.replace("▮", chon), vt = moc < 0 ? chen.length : moc + chon.length;
  if (!trongCT && tt.dangSua.d.kieu !== "align") { chen = `$${chen}$`; vt++; }
  o.setRangeText(chen, dau, cuoi, "end");
  o.selectionStart = o.selectionEnd = dau + vt;
  o.focus();
  o.dispatchEvent(new Event("input"));
}

function moDong(thuTu) {
  chotDong();
  const d = tt.dong[thuTu], k = khoiCuaDong(thuTu);
  if (!d || !k) return;
  veKhoi(k);
  soan.setCursor(soan.posFromIndex(d.dau));
  const goc = soan.getValue().slice(d.dau, d.cuoi);
  const khung = document.createElement("div");
  khung.className = "sua";
  khung.innerHTML = '<div class="ve"></div><textarea spellcheck="false" aria-label="Nội dung dòng"></textarea>' +
    '<div class="chen"></div><p class="canh-bao"></p>' +
    '<div class="nut-sua"><button class="chinh">Xong</button><button>Bỏ sửa</button></div>';
  const [ve, o, chen, cb, nut] = khung.children;
  const veLai = () => {
    ve.innerHTML = veDong(o.value, d.kieu);
    cb.textContent = kiemTraDong(o.value) || (ve.querySelector(".katex-error") ? "Công thức chưa viết đúng, xem chỗ chữ đỏ ở khung trên." : "");
    o.style.height = "auto";
    o.style.height = `${o.scrollHeight + 2}px`;
    capNhatTrangThai();
  };
  o.value = goc;
  o.oninput = veLai;
  o.onkeydown = e => {
    if (e.key === "Escape") { e.preventDefault(); boDong(); }
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); chotDong(); }
  };
  CHEN.forEach(([ten, mau]) => {
    const b = document.createElement("button");
    b.textContent = ten;
    b.onclick = () => chenVao(o, mau);
    chen.append(b);
  });
  nut.children[0].onclick = () => chotDong();
  nut.children[1].onclick = boDong;
  k.o.querySelector(`.dong[data-thu-tu="${thuTu}"]`).replaceWith(khung);
  tt.dangSua = {d, o, goc, khoi: k};
  veLai();
  o.focus();
  khung.scrollIntoView({block: "nearest"});
}

function chotDong() {
  const s = tt.dangSua;
  if (!s) return;
  tt.dangSua = null;
  if (s.o.value !== s.goc) soan.replaceRange(s.o.value, soan.posFromIndex(s.d.dau), soan.posFromIndex(s.d.cuoi));
  khoaDong = null;
  capNhat();
}

function boDong() {
  if (!tt.dangSua) return;
  tt.dangSua = null;
  khoaDong = null;
  capNhat();
}

function hienKetQuaTim() {
  chotDong();
  const tu = $("tim").value.trim().toLowerCase().normalize("NFC");
  if (!tu) return veTheoDong(true);
  quanKhoi.disconnect();
  const chu = soan.getValue(), o = $("vung-dong"), thay = [];
  tt.dong.forEach((d, i) => {
    if (chu.slice(d.dau, d.cuoi).toLowerCase().normalize("NFC").includes(tu)) thay.push({d, i});
  });
  const dau = document.createElement("p");
  dau.className = "ket-tim";
  dau.textContent = thay.length ? `Có ${thay.length} chỗ${thay.length > 40 ? ", hiện 40 chỗ đầu" : ""}.` : "Không thấy chỗ nào. Thử gõ ít chữ hơn.";
  o.replaceChildren(dau);
  thay.slice(0, 40).forEach(({d, i}) => {
    const k = khoiCuaDong(i), nhan = k?.nhan ? `${k.nhan}${d.phan === "giai" ? ", giải" : ""}` : `Dòng ${soan.posFromIndex(d.dau).line + 1}`;
    const nut = nutDong(chu, d, null, nhan);
    nut.classList.add("tim-thay");
    nut.firstChild.classList.add("rong");
    nut.onclick = () => {
      $("tim").value = "";
      veTheoDong(true);
      if (k) k.o.scrollIntoView({block: "start"});
      moDong(i);
    };
    o.append(nut);
  });
}

function apDungCheDo() {
  const dong = tt.cheDo === "dong" && tt.tep && tt.tep.la_tex;
  $("cd-dong").setAttribute("aria-pressed", tt.cheDo === "dong");
  $("cd-code").setAttribute("aria-pressed", tt.cheDo === "code");
  $("vung-dong").hidden = !dong;
  $("vung-soan").hidden = dong || !tt.tep;
  $("tim").disabled = !dong;
  if (!dong) soan.refresh();
  capNhatRibbon();
}

function datCheDo(m) {
  chotDong();
  tt.cheDo = m;
  bc.cheDo = m;
  luuBoCuc();
  apDungCheDo();
  if (m === "dong") veTheoDong(true);
  else soan.scrollIntoView(null, 120);
}

// Bấm vào PDF: tìm khối chứa chỗ bấm, rồi so chữ ở hàng đó với các dòng để mở đúng dòng.
function bamPdf(trang, tiLeY) {
  const t = tt.mocPdf[trang];
  if (!t) return bao("PDF đang đọc, bấm lại sau giây lát.");
  const y = t.cao * tiLeY;
  let nhan = null;
  for (let p = trang; p >= 1 && nhan === null; p--) {
    const ds = (tt.mocPdf[p]?.moc || []).filter(m => p < trang || m.y + 3 >= y);
    if (ds.length) nhan = ds[ds.length - 1].nhan;
  }
  $("tim").value = "";
  const k = tt.khoi.find(x => x.nhan === nhan && x.loai === "bai");
  if (k) denKhoi(k.i, false); else veTheoDong(true);
  if (tt.cheDo !== "dong") return;
  const tu = new Set(t.chu.filter(x => Math.abs(x.y - y) < 7).map(x => x.s).join(" ").toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const chu = soan.getValue();
  let tot = -1, diem = 1;
  for (let i = k ? k.tu : 0, het = k ? k.den : tt.dong.length; i < het; i++) {
    const d = tt.dong[i], ht = chu.slice(d.dau, d.cuoi).toLowerCase();
    const dd = [...tu].filter(w => ht.includes(w)).length;
    if (dd > diem) { diem = dd; tot = i; }
  }
  if (tot >= 0) {
    khoiCuaDong(tot)?.o.scrollIntoView({block: "nearest"});
    moDong(tot);
  } else bao(k ? `Đã đến ${k.nhan}. Chọn dòng cần sửa ở khung bên trái.` : "Chưa khớp được dòng nào. Tìm bằng ô Tìm chữ trong file.");
}
