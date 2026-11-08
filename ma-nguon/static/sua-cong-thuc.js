"use strict";
// Sửa công thức trực quan (kiểu MathType) trong khung sửa dòng của chế độ Theo dòng, bằng MathLive.
// Dòng được cắt thành đoạn chữ (sửa như chữ) và đoạn công thức (math-field). Văn bản chỉ được ghi lại
// từ MathLive cho đoạn công thức mà người dùng thật sự đã sửa; đoạn khác giữ nguyên từng ký tự.
// Tiền tố tên cấp ngoài: ctm. theo-dong.js chỉ gọi ctmGan(...) một lần trong moDong.

const CTM_DUONG_DAN = "/static/vendor/mathlive/";
const CTM_NUT = [
  ["Phân số", "\\dfrac{#@}{#?}", "Phân số: gõ / cũng ra phân số"],
  ["Căn", "\\sqrt{#@}", "Căn bậc hai"],
  ["Căn bậc n", "\\sqrt[#?]{#@}", "Căn bậc n"],
  ["Mũ", "^", "Số mũ (gõ ^)", "moveToSuperscript"],
  ["Chỉ số", "_", "Chỉ số dưới (gõ _)", "moveToSubscript"],
  ["Hệ", "\\begin{cases}#?\\\\#?\\end{cases}", "Hệ phương trình"],
  ["|x|", "\\left|#@\\right|", "Giá trị tuyệt đối"],
  ["≤", "\\le "], ["≥", "\\ge "], ["≠", "\\ne "], ["±", "\\pm "], ["⇔", "\\Leftrightarrow "], ["⇒", "\\Rightarrow "], ["∈", "\\in "], ["∞", "\\infty "],
  ["Góc", "\\widehat{#@}", "Góc, ví dụ góc ABC"],
  ["Độ", "^\\circ", "Dấu độ"],
  ["Vectơ", "\\overrightarrow{#@}", "Vectơ"],
  ["∫", "\\displaystyle\\int_{#?}^{#?}#@\\,\\mathrm{d}x", "Tích phân"],
  ["lim", "\\lim_{x\\to #?}", "Giới hạn"],
];

let ctmTai = null;  // lời hứa nạp MathLive, chỉ nạp khi cần lần đầu
function ctmNap() {
  if (window.MathfieldElement) return Promise.resolve();
  ctmTai ||= new Promise((xong, loi) => {
    const s = document.createElement("script");
    s.src = `${CTM_DUONG_DAN}mathlive.min.js`;
    s.onload = () => {
      try {
        MathfieldElement.fontsDirectory = `${CTM_DUONG_DAN}fonts`;
        MathfieldElement.soundsDirectory = null;  // tắt âm bàn phím
        xong();
      } catch (e) { loi(e); }
    };
    s.onerror = () => { ctmTai = null; loi(new Error("Không nạp được MathLive")); };
    document.head.append(s);
  });
  return ctmTai;
}

function ctmLuuCheDo(v) { try { localStorage.setItem("suaTexCongThuc", v); } catch { /* bỏ qua */ } }
function ctmDocCheDo() { try { return localStorage.getItem("suaTexCongThuc") === "code" ? "code" : "truc-quan"; } catch { return "truc-quan"; } }

// MACRO của app ({"\\heva": "...#1..."}) sang dạng macros của MathLive ({heva: {def, args}}).
let ctmMacroGoc = null, ctmMacroDa = {};
function ctmMacro() {
  if (ctmMacroGoc === MACRO) return ctmMacroDa;
  ctmMacroGoc = MACRO;
  ctmMacroDa = {};
  for (const [ten, def] of Object.entries(MACRO)) {
    if (typeof def !== "string") continue;
    const so = Math.max(0, ...[...def.matchAll(/#(\d)/g)].map(m => +m[1]));
    ctmMacroDa[ten.replace(/^\\/, "")] = so ? {def, args: so} : def;
  }
  return ctmMacroDa;
}

// Cắt dòng thành các đoạn: chữ thường, công thức ($..$, $$..$$, \(..\), \[..\]). Dòng kiểu align cả dòng là công thức.
function ctmTach(s, kieu) {
  if (kieu === "align") return [{loai: "ct", mo: "", dong: "", ruot: s, align: true}];
  const ds = [];
  let chu = 0, i = 0;
  const cap = [["$$", "$$"], ["$", "$"], ["\\(", "\\)"], ["\\[", "\\]"]];
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\" && !s.startsWith("\\(", i) && !s.startsWith("\\[", i)) { i += 2; continue; }
    if (ch === "%") { const h = s.indexOf("\n", i); i = h < 0 ? s.length : h; continue; }
    const c = cap.find(([m]) => s.startsWith(m, i));
    if (!c) { i++; continue; }
    let e = i + c[0].length;
    for (; e < s.length; e++) {
      if (s[e] === "\\" && !s.startsWith(c[1], e)) { e++; continue; }
      if (s.startsWith(c[1], e)) break;
    }
    if (e >= s.length) break;  // không có dấu đóng: phần còn lại để như chữ
    if (i > chu) ds.push({loai: "chu", ruot: s.slice(chu, i)});
    ds.push({loai: "ct", mo: c[0], dong: c[1], ruot: s.slice(i + c[0].length, e)});
    i = chu = e + c[1].length;
  }
  if (chu < s.length) ds.push({loai: "chu", ruot: s.slice(chu)});
  return ds;
}

// MathLive không hiểu công thức nếu còn lệnh lạ (không phải macro của dự án) hoặc cú pháp sai.
function ctmCoLoi(mf, nguon) {
  if (/\\error\b/.test(mf.getValue("latex")) || mf.shadowRoot?.querySelector(".ML__error")) return true;
  const macro = ctmMacro();
  return MathLive.validateLatex(nguon).some(e => !(e.code === "unknown-command" && (e.arg === "\\\\" || macro[String(e.arg).replace(/^\\/, "")] !== undefined)));
}

// Mỗi lần gọi từ moDong: dựng bộ sửa trực quan cạnh textarea. o là textarea gốc, vẫn là nơi giữ nội dung thật.
function ctmGan(khung, o, d, ve, chen, veLai) {
  const goc = o.value;
  let cheDo = ctmDocCheDo();
  const kv = document.createElement("div"), thanh = document.createElement("div"), vung = document.createElement("div"), nhac = document.createElement("p");
  kv.className = "ct-kv";
  thanh.className = "ct-thanh";
  vung.className = "ct-vung";
  nhac.className = "ct-nhac";
  vung.setAttribute("aria-label", "Dòng với công thức sửa trực quan");
  kv.append(thanh, vung, nhac);
  const nutCheDo = document.createElement("button");
  nutCheDo.className = "ct-che-do";
  nutCheDo.type = "button";
  nutCheDo.title = "Đổi giữa sửa trực quan và sửa code";
  const dau = document.createElement("div");
  dau.className = "ct-dau";
  dau.append(nutCheDo);
  khung.insertBefore(dau, khung.firstChild);
  ve.after(kv);

  let doan = [], mfCuoi = null, chuCuoi = null, daNap = false, dung = false;
  const dungXong = () => { dung = true; try { window.mathVirtualKeyboard?.hide(); } catch { /* bỏ qua */ } clearInterval(gac); };
  const gac = setInterval(() => { if (!khung.isConnected) dungXong(); }, 400);  // khung bị thay khi Xong / Bỏ sửa

  const ctmDfrac = (() => {
    const t = soan.getValue();
    return (t.match(/\\dfrac(?![a-zA-Z])/g) || []).length >= (t.match(/\\frac(?![a-zA-Z])/g) || []).length;
  })();

  function xuatCT(g) {
    if (!g.mf) return g.mo + g.ruot + g.dong;
    if (g.ruot !== "" && g.mf.getValue("latex") === g.v0) return g.mo + g.ruot + g.dong;
    let l = g.mf.getValue("latex").replace(/\\placeholder(\[[^\]]*\])?\{[^{}]*\}/g, "");
    l = l.replace(/\^\{\\prime\}/g, "'");  // MathLive viết \Delta' thành \Delta^{\prime}
    if (g.align) l =l.replace(/^\\begin\{aligned\}\s*/, "").replace(/\s*\\end\{aligned\}$/, "");
    if (ctmDfrac && !(/\\frac(?![a-zA-Z])/.test(g.ruot || "") && !/\\dfrac/.test(g.ruot || ""))) l = l.replace(/\\frac(?![a-zA-Z])/g, "\\dfrac");
    if (!l.trim()) return "";
    return g.mo + l + g.dong;
  }

  function ghiLai() {
    const t = doan.map(g => {
      if (g.loai === "ct" && g.mf) return xuatCT(g);
      if (g.el && g.sua) return g.el.textContent;
      return g.loai === "ct" ? g.mo + g.ruot + g.dong : g.ruot;
    }).join("");
    if (o.value !== t) { o.value = t; o.dispatchEvent(new Event("input")); }
  }

  function taoChu(g) {
    const el = document.createElement("span");
    el.className = `ct-chu${g.loi ? " ct-loi" : ""}`;
    el.contentEditable = "plaintext-only";
    el.spellcheck = false;
    el.textContent = g.loai === "ct" ? g.mo + g.ruot + g.dong : g.ruot;
    el.addEventListener("input", () => { g.sua = true; ghiLai(); });
    g.el = el;
    return el;
  }

  function taoCT(g) {
    const mf = new MathfieldElement();
    mf.mathVirtualKeyboardPolicy = "manual";
    mf.smartFence = true;
    mf.setAttribute("aria-label", "Công thức");
    g.mf = mf;
    mf.addEventListener("input", () => { g.sua = true; ghiLai(); });
    mf.addEventListener("focus", () => { mfCuoi = mf; });
    g.el = mf;
    return mf;
  }

  // Đặt nội dung sau khi math-field đã nằm trong trang (MathLive chỉ đọc/ghi được khi đã gắn).
  function datCT(g) {
    g.mf.macros = {...g.mf.macros, ...ctmMacro()};
    g.mf.value = g.align ? `\\begin{aligned}${g.ruot}\\end{aligned}` : g.ruot;
    g.v0 = g.mf.getValue("latex");
    g.sua = false;
  }

  function dungLai() {
    const l = [...doan];
    doan = [];
    for (const g of l) g.mf?.remove();
    vung.replaceChildren();
    mfCuoi = chuCuoi = null;
    nhac.textContent = "";
    const ds = ctmTach(o.value, d.kieu);
    let loi = 0;
    ds.forEach((g, i) => {
      if (g.loai === "ct") {
        taoCT(g);
      }
      doan.push(g);
      // giữa hai công thức, hoặc ở đầu, cuối dòng cần một chỗ để bấm vào gõ chữ
      if (d.kieu !== "align" && g.loai === "ct" && (i === 0 || ds[i - 1].loai === "ct")) doan.splice(doan.length - 1, 0, {loai: "chu", ruot: "", rong: true});
    });
    if (d.kieu !== "align" && doan.length && doan[doan.length - 1].loai === "ct") doan.push({loai: "chu", ruot: "", rong: true});
    for (const g of doan) vung.append(g.loai === "ct" ? g.mf : taoChu(g));
    for (const g of doan) {
      if (g.loai !== "ct") continue;
      datCT(g);
      if (ctmCoLoi(g.mf, g.align ? `\\begin{aligned}${g.ruot}\\end{aligned}` : g.ruot)) {  // MathLive không hiểu: công thức này sửa như code
        g.mf.replaceWith(taoChu(Object.assign(g, {loi: true})));
        g.mf = null;
        loi++;
      }
    }
    if (loi) nhac.textContent = `Có ${loi} công thức dùng lệnh MathLive chưa hiểu, nên để dạng code (khung nét đứt). Sửa như chữ, hoặc chuyển sang Code.`;
  }

  // Chèn công thức vào chỗ con trỏ: nếu đang trong một công thức thì chèn vào đó, nếu đang ở chữ thì tạo công thức mới.
  function chenMau(mau, lenh) {
    let mf = mfCuoi && mfCuoi.isConnected && vung.contains(mfCuoi) ? mfCuoi : null;
    if (!mf || (document.activeElement !== mf && chuCuoi)) {
      const sel = getSelection();
      const el = chuCuoi && chuCuoi.isConnected ? chuCuoi : null;
      if (el && d.kieu !== "align") {
        const g = doan.find(x => x.el === el);
        let vt = el.textContent.length;
        if (sel.rangeCount && el.contains(sel.anchorNode)) {
          const r = document.createRange();
          r.selectNodeContents(el);
          r.setEnd(sel.anchorNode, sel.anchorOffset);
          vt = r.toString().length;
        }
        const truoc = el.textContent.slice(0, vt), sau = el.textContent.slice(vt);
        el.textContent = truoc;
        const gm = {loai: "ct", mo: "$", dong: "$", ruot: "", sua: true}, gs = {loai: "chu", ruot: sau, sua: true};
        const i = doan.indexOf(g);
        doan.splice(i + 1, 0, gm, gs);
        g.sua = true;
        const m = taoCT(gm);
        gm.sua = true;
        el.after(m, taoChu(gs));
        datCT(gm);
        mf = m;
      } else mf = doan.find(x => x.mf)?.mf;
    }
    if (!mf) return;
    mf.focus();
    if (lenh) mf.executeCommand(lenh);
    else mf.insert(mau, {format: "latex", selectionMode: "placeholder", focus: true});
    ghiLai();
  }

  function dungThanh() {
    thanh.replaceChildren();
    for (const [ten, mau, tip, lenh] of CTM_NUT) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = ten;
      b.title = tip || ten;
      b.onmousedown = e => e.preventDefault();  // giữ con trỏ đang ở công thức
      b.onclick = () => chenMau(mau, lenh);
      thanh.append(b);
    }
    const bp = document.createElement("button");
    bp.type = "button";
    bp.textContent = "⌨ Bàn phím";
    bp.title = "Bật / tắt bàn phím ảo";
    bp.className = "ct-ban-phim";
    bp.onmousedown = e => e.preventDefault();
    bp.onclick = () => {
      const k = window.mathVirtualKeyboard;
      if (!k) return;
      if (k.visible) k.hide(); else { (mfCuoi || vung.querySelector("math-field"))?.focus(); k.show(); }
    };
    thanh.append(bp);
  }

  function hienCheDo() {
    const truc = cheDo === "truc-quan" && daNap;
    kv.hidden = !truc;
    ve.hidden = truc;
    o.hidden = truc;
    chen.hidden = truc;
    nutCheDo.textContent = truc ? "Sửa code" : "Sửa trực quan";
    nutCheDo.hidden = !daNap;
    if (!truc) try { window.mathVirtualKeyboard?.hide(); } catch { /* bỏ qua */ }
  }

  function doiCheDo(moi) {
    if (moi === cheDo) return;
    if (moi === "truc-quan") dungLai(); else ghiLai();
    cheDo = moi;
    ctmLuuCheDo(moi);
    hienCheDo();
    veLai();
    if (moi === "truc-quan") (vung.querySelector("math-field") || vung.querySelector(".ct-chu"))?.focus();
    else o.focus();
  }

  nutCheDo.onclick = () => doiCheDo(cheDo === "truc-quan" ? "code" : "truc-quan");
  vung.addEventListener("focusin", e => { if (e.target.classList?.contains("ct-chu")) chuCuoi = e.target; });
  vung.addEventListener("keydown", e => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); ctmDong(false); }
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); ctmDong(true); }
  }, true);
  const ctmDong = ok => { ghiLai(); dungXong(); if (ok) chotDong(); else boDong(); };

  hienCheDo();  // trong lúc nạp MathLive vẫn dùng textarea như cũ
  ctmNap().then(() => {
    if (dung || !khung.isConnected) return;
    daNap = true;
    dungThanh();
    dungLai();
    hienCheDo();
    if (cheDo === "truc-quan") (vung.querySelector("math-field") || vung.querySelector(".ct-chu"))?.focus();
  }).catch(e => { console.error("Sửa công thức trực quan:", e); cheDo = "code"; hienCheDo(); });
}
