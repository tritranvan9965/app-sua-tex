"""Kiểm thử chu_pdf.py và phong_chu.py. Chạy: .venv\\Scripts\\python.exe ma-nguon\\kiem_tra_chu_pdf.py
File thử được chép ra thư mục tạm, không đụng file trong du-lieu-thu. File thử nào không có trên máy thì bỏ qua và báo rõ."""
import re
import shutil
import sys
import tempfile
import traceback
from pathlib import Path

GOC = Path(__file__).resolve().parent
sys.path.insert(0, str(GOC))
import pikepdf  # noqa: E402
import pypdfium2 as pdfium  # noqa: E402
from PIL import ImageChops  # noqa: E402

import chu_pdf  # noqa: E402
import phong_chu  # noqa: E402
from phong_chu import LoiChu  # noqa: E402

DU_LIEU = [GOC.parent / "du-lieu-thu", Path(r"C:\DATA\Vibe Coding\app-sua-tex\du-lieu-thu")]
FILE_THU = {
    "latex-CD2": ["2_XUONG/04_san-pham/2-chuyen-de/CD2_GV.pdf", "3_THANH-PHAM/2_Chuyen-de/GV/CD2_GV.pdf"],
    "latex-CD06": ["2_XUONG/02_ngan-hang/13CD/CD06_GV.pdf"],
    "word": ["Buổi 01_Tính đơn điệu của hàm số_GV.pdf"],
}
KET_QUA = []


def kiem(ten, dieu_kien, chi_tiet=""):
    KET_QUA.append((ten, bool(dieu_kien), chi_tiet))
    print(("  ok   " if dieu_kien else "  LOI  ") + ten + (f"  [{chi_tiet}]" if chi_tiet and not dieu_kien else ""))


def tim_file(ten):
    for m in FILE_THU[ten]:
        for g in DU_LIEU:
            if (g / m).is_file():
                return g / m
    return None


def van_ban(pdf, so=None) -> str:
    d = pdfium.PdfDocument(str(pdf))
    try:
        trang = range(len(d)) if so is None else [so - 1]
        return "\n".join(d[i].get_textpage().get_text_range() for i in trang)
    finally:
        d.close()


def gon(s):
    return re.sub(r"\s+", " ", s)


def nen_trang(pdf):
    """Nội dung gốc của từng trang (bỏ stream chữ đã thêm và stream bảo vệ do app thêm), để so các trang không sửa."""
    ra = []
    with pikepdf.open(pdf) as p:
        for tr in p.pages:
            ra.append(b"".join(s.read_bytes() for s in chu_pdf._ds_luong(tr) if chu_pdf.KHOA_ID not in s and chu_pdf.KHOA_BAO_VE not in s))
    return ra


def dau_trang(pdf):
    """Số trang, mục lục, số liên kết mỗi trang."""
    with pikepdf.open(pdf) as p:
        with p.open_outline() as o:
            def duyet(ds):
                return [(str(m.title), duyet(m.children)) for m in ds]
            muc_luc = duyet(o.root)
        lk = [sum(1 for a in (tr.obj.get("/Annots") or []) if str(a.get("/Subtype")) == "/Link") for tr in p.pages]
        return len(p.pages), muc_luc, lk


def anh_trang(pdf, so, ti_le=1.3):
    d = pdfium.PdfDocument(str(pdf))
    try:
        return d[so - 1].render(scale=ti_le).to_pil().convert("L")
    finally:
        d.close()


def khung_ma_thay_doi(pdf_a, pdf_b, so, ti_le=1.3):
    """Hộp chứa các điểm ảnh khác nhau giữa hai file ở trang so, theo pt trang nhìn thấy, hoặc None nếu trùng."""
    kh = ImageChops.difference(anh_trang(pdf_a, so, ti_le), anh_trang(pdf_b, so, ti_le)).point(lambda g: 255 if g > 40 else 0).getbbox()
    return tuple(v / ti_le for v in kh) if kh else None


def mot_file_that(ten, tmp, log):
    nguon = tim_file(ten)
    if not nguon:
        print(f"  bỏ qua {ten}: không có file thử trên máy")
        return
    pdf = tmp / f"{ten}.pdf"
    shutil.copy(nguon, pdf)
    print(f"\n== {ten} ({nguon.name}) ==")
    so0, ml0, lk0 = dau_trang(pdf)
    goc_trang = nen_trang(pdf)

    # --- A: thêm chữ ---
    ds = [dict(trang=1, x=120, y=300, chu="Thêm chữ thật: Việt Nam ăâđêôơư ỹ\nDòng hai Ạ ặ ỡ", phong="Times New Roman", co=16, mau="#cc0000",
               dam=True, nghieng=True, gach_chan=True),
          dict(trang=1, x=120, y=360, chu="Arial thường tiếng Việt: ừ ữ ở", phong="Arial", co=12, mau="#0033aa")]
    ra = tmp / f"{ten}_a.pdf"
    r = chu_pdf.them_chu(pdf, ra, ds)
    vb = gon(van_ban(ra, 1))
    kiem(f"{ten}: chữ thêm tìm được bằng pdfium, đúng dấu", "Thêm chữ thật: Việt Nam ăâđêôơư ỹ" in vb and "Dòng hai Ạ ặ ỡ" in vb and "Arial thường tiếng Việt: ừ ữ ở" in vb)
    so1, ml1, lk1 = dau_trang(ra)
    kiem(f"{ten}: thêm chữ giữ số trang, mục lục, liên kết", (so1, ml1, lk1) == (so0, ml0, lk0))
    kiem(f"{ten}: thêm chữ không đổi nội dung gốc các trang", nen_trang(ra) == goc_trang)
    kh = khung_ma_thay_doi(pdf, ra, 1)
    kiem(f"{ten}: chữ thêm nằm đúng chỗ (x=120, y=300 pt)", kh and abs(kh[0] - 120) < 6 and 300 <= kh[1] <= 322 and kh[3] < 440, str(kh))
    for t in range(2, so0 + 1, max(1, so0 // 3)):
        if khung_ma_thay_doi(pdf, ra, t):
            kiem(f"{ten}: trang {t} không đổi", False)
            break
    else:
        kiem(f"{ten}: các trang khác không đổi ảnh", True)
    da = chu_pdf.doc_chu_da_them(ra)
    kiem(f"{ten}: đọc lại danh sách chữ đã thêm", len(da) == 2 and da[0]["chu"] == ds[0]["chu"] and da[0]["dam"] and da[0]["gach_chan"]
         and abs(da[0]["x"] - 120) < 0.01 and abs(da[0]["y"] - 300) < 0.01 and da[1]["phong"] == "Arial" and da[0]["mau"] == "#cc0000", str(da[:1]))
    tl = chu_pdf.tim_dong(ra, 1, 125, 306)
    kiem(f"{ten}: bấm vào chữ đã thêm thì nhận ra là chữ đã thêm", tl and tl["loai"] == "chu-da-them" and tl["id_chu_da_them"] == da[0]["id"], str(tl))
    # kéo di chuyển + sửa nội dung
    r2 = tmp / f"{ten}_a2.pdf"
    chu_pdf.sua_chu_da_them(ra, r2, da[0]["id"], {"x": 200, "y": 420, "chu": "Đã sửa và dời", "co": 20})
    da2 = chu_pdf.doc_chu_da_them(r2)
    kiem(f"{ten}: sửa/dời chữ đã thêm", len(da2) == 2 and any(d["chu"] == "Đã sửa và dời" and abs(d["x"] - 200) < 0.01 and abs(d["y"] - 420) < 0.01 and d["co"] == 20 for d in da2))
    vb2 = gon(van_ban(r2, 1))
    kiem(f"{ten}: chữ cũ mất, chữ mới có sau khi sửa", "Thêm chữ thật" not in vb2 and "Đã sửa và dời" in vb2)
    r3 = tmp / f"{ten}_a3.pdf"
    chu_pdf.xoa_chu_da_them(r2, r3, [next(d["id"] for d in da2 if d["chu"] == "Đã sửa và dời")])
    kiem(f"{ten}: xóa chữ đã thêm", len(chu_pdf.doc_chu_da_them(r3)) == 1 and "Đã sửa và dời" not in van_ban(r3, 1))
    r4 = tmp / f"{ten}_a4.pdf"
    chu_pdf.xoa_chu_da_them(r3, r4, [chu_pdf.doc_chu_da_them(r3)[0]["id"]])
    kiem(f"{ten}: xóa hết thì ảnh trang như file gốc", khung_ma_thay_doi(pdf, r4, 1) is None)
    try:
        chu_pdf.them_chu(pdf, pdf, ds)
        kiem(f"{ten}: không ghi đè file gốc", False)
    except LoiChu:
        kiem(f"{ten}: không ghi đè file gốc", True)

    # --- B: sửa chữ có sẵn ---
    d = pdfium.PdfDocument(str(pdf))
    muc = None
    try:
        with pikepdf.open(pdf) as k:
            for so in range(1, min(so0, 6) + 1):
                tr = k.pages[so - 1]
                for o in chu_pdf._doc_doi_tuong(d[so - 1], chu_pdf._hop(tr), chu_pdf._xoay(tr)):
                    c = o["chu"].strip()
                    if muc is None and re.match(r"^(Bài|Câu|Bước|Hàm số|Nếu)\b", c) and o["khung"][2] - o["khung"][0] > 20:
                        muc = (so, o)
    finally:
        d.close()
    if not muc:
        kiem(f"{ten}: có dòng chữ để sửa", False)
        return
    so, o = muc
    x, y = (o["khung"][0] + o["khung"][2]) / 2, (o["khung"][1] + o["khung"][3]) / 2
    dong = chu_pdf.tim_dong(pdf, so, x, y)
    kiem(f"{ten}: tim_dong trả dòng, phông, cỡ, màu", dong and dong["loai"] == "chu-co-san" and dong["co"] > 4 and re.match(r"#[0-9a-f]{6}", dong["mau"]) and dong["phong"], str(dong))
    chu_cu = dong["chu"]
    chu_moi = re.sub(r"^(Bài|Câu|Bước)", lambda m: {"Bài": "Câu", "Câu": "Bài", "Bước": "Cách"}[m.group(1)], chu_cu.strip()) if re.match(r"^(Bài|Câu|Bước)", chu_cu.strip()) else "Sửa " + chu_cu.strip()
    ra = tmp / f"{ten}_b.pdf"
    kq = chu_pdf.sua_dong(pdf, ra, so, dong["id"], chu_moi)
    truoc, sau = gon(van_ban(pdf, so)), gon(van_ban(ra, so))
    kiem(f"{ten}: chữ cũ mất ('{chu_cu.strip()[:12]}'), chữ mới có ('{chu_moi.strip()[:12]}')",
         sau.count(chu_cu.strip()) < truoc.count(chu_cu.strip()) and gon(chu_moi).strip() in sau, f"{truoc.count(chu_cu.strip())}->{sau.count(chu_cu.strip())}")
    kiem(f"{ten}: sửa dòng trả phông đã dùng", kq["phong_dung"], str(kq))
    so1, ml1, lk1 = dau_trang(ra)
    kiem(f"{ten}: sửa dòng giữ số trang, mục lục, liên kết", (so1, ml1, lk1) == (so0, ml0, lk0))
    nt = nen_trang(ra)
    kiem(f"{ten}: sửa dòng không đụng trang khác", all(nt[i] == goc_trang[i] for i in range(so0) if i != so - 1))
    kh = khung_ma_thay_doi(pdf, ra, so)
    kiem(f"{ten}: ảnh chỉ đổi quanh dòng sửa", kh and kh[0] >= dong["khung"][0] - 6 and kh[1] >= dong["khung"][1] - 6 and kh[3] <= dong["khung"][3] + 6, f"{kh} vs {dong['khung']}")
    for t in range(1, so0 + 1, max(1, so0 // 4)):
        if t != so and khung_ma_thay_doi(pdf, ra, t):
            kiem(f"{ten}: trang {t} không đổi", False)
            break
    else:
        kiem(f"{ten}: các trang khác không đổi ảnh", True)
    dong2 = chu_pdf.tim_dong(ra, so, x, y)
    kiem(f"{ten}: sửa lại lần hai được", dong2 and dong2["loai"] == "chu-co-san")
    if dong2:
        rb = tmp / f"{ten}_b2.pdf"
        chu_pdf.sua_dong(ra, rb, so, dong2["id"], chu_moi.strip() + " nữa")
        kiem(f"{ten}: sửa lần hai ghi đúng", gon(chu_moi).strip() + " nữa" in gon(van_ban(rb, so)))
    rx = tmp / f"{ten}_x.pdf"
    chu_pdf.sua_dong(pdf, rx, so, dong["id"], "")
    kiem(f"{ten}: xóa dòng (chữ rỗng)", gon(van_ban(rx, so)).count(chu_cu.strip()) < truoc.count(chu_cu.strip()))
    # phông tùy chọn: ép dùng phông máy, đậm, màu đỏ
    rp = tmp / f"{ten}_p.pdf"
    kq = chu_pdf.sua_dong(pdf, rp, so, dong["id"], chu_moi, {"phong": "Arial", "dam": True, "mau": "#ff0000", "co": dong["co"]})
    kiem(f"{ten}: ép đổi sang phông máy Arial đậm", kq["phong_dung"] == "Arial" and not kq["dung_lai_phong_goc"] and gon(chu_moi).strip() in gon(van_ban(rp, so)), str(kq))
    # thêm chữ rồi sửa dòng có sẵn trên cùng trang: chữ thêm còn nguyên
    rk = tmp / f"{ten}_k.pdf"
    chu_pdf.them_chu(pdf, rk, [dict(trang=so, x=100, y=500, chu="Chữ thêm trước", phong="Arial", co=12)])
    rk2 = tmp / f"{ten}_k2.pdf"
    chu_pdf.sua_dong(rk, rk2, so, dong["id"], chu_moi)
    kiem(f"{ten}: sửa dòng trên trang đã có chữ thêm vẫn giữ chữ thêm", len(chu_pdf.doc_chu_da_them(rk2)) == 1 and "Chữ thêm trước" in van_ban(rk2, so))
    dd = chu_pdf.tim_dong(rk2, so, 105, 506)
    kiem(f"{ten}: tim_dong sau khi sửa vẫn nhận chữ thêm", dd and dd["loai"] == "chu-da-them", str(dd))


# ---------- PDF tự tạo: xoay trang, Tm có tỉ lệ, chữ nối tiếp, lệnh ' ----------

def tao_pdf_tu_tao(duong: Path) -> None:
    pdf = pikepdf.new()
    font = pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica,
                                                 Encoding=pikepdf.Name.WinAnsiEncoding, FirstChar=32, LastChar=126, Widths=pikepdf.Array([556] * 95)))

    def trang(xoay, noi_dung):
        pdf.add_blank_page(page_size=(612, 792))
        tr = pdf.pages[-1]
        tr.Resources = pikepdf.Dictionary(Font=pikepdf.Dictionary(F1=font))
        tr.Contents = pdf.make_stream(noi_dung.encode("latin1"))
        if xoay:
            tr.Rotate = xoay
        return tr

    p1 = trang(0, "BT /F1 12 Tf 72 700 Td (Bai 1. Cho hinh ) Tj (chu nhat ABCD) Tj ET\n"
                  "BT /F1 1 Tf 12 0 0 12 72 660 Tm (Scaled text here) Tj ET\n"
                  "BT /F1 12 Tf 72 620 Td 14 TL (Line one) Tj (Line two) ' ET\n"
                  "BT /F1 12 Tf 72 560 Td [(Kern) -300 (ed text)] TJ 0 -20 Td (Next) Tj ET\n")
    p1.Annots = pikepdf.Array([pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.Annot, Subtype=pikepdf.Name.Link, Rect=[72, 695, 200, 712],
                                                                      Border=[0, 0, 0], A=pikepdf.Dictionary(S=pikepdf.Name.URI, URI=pikepdf.String("https://example.com"))))])
    # Trang xoay: chữ vẽ sao cho khi nhìn thấy là nằm ngang, bắt đầu ở điểm nhìn thấy (100, 100) (y xuống)
    trang(90, "BT /F1 12 Tf 0 1 -1 0 100 100 Tm (Rotated ninety) Tj ET\n")
    trang(180, "BT /F1 12 Tf -1 0 0 -1 512 100 Tm (Rotated one eighty) Tj ET\n")
    trang(270, "BT /F1 12 Tf 0 -1 1 0 512 692 Tm (Rotated two seventy) Tj ET\n")
    with pdf.open_outline() as o:
        o.root.extend([pikepdf.OutlineItem("Muc mot", 0), pikepdf.OutlineItem("Muc hai", 1)])
    pdf.save(duong)


def thu_tu_tao(tmp):
    print("\n== PDF tự tạo ==")
    f = tmp / "tu-tao.pdf"
    tao_pdf_tu_tao(f)
    so0, ml0, lk0 = dau_trang(f)
    d = pdfium.PdfDocument(str(f))
    for i in range(4):
        pass
    d.close()
    # chữ nối tiếp: sửa riêng đối tượng đầu, đối tượng sau phải đứng yên
    with pikepdf.open(f) as k:
        tr = k.pages[0]
        hop, r = chu_pdf._hop(tr), chu_pdf._xoay(tr)
    d = pdfium.PdfDocument(str(f))
    ds = chu_pdf._doc_doi_tuong(d[0], hop, r)
    d.close()
    kiem("tự tạo: đọc đủ đối tượng chữ", [o["chu"] for o in ds[:3]] == ["Bai 1. Cho hinh ", "chu nhat ABCD", "Scaled text here"], str([o["chu"] for o in ds]))
    nho = ds[1]["goc"]
    ra = tmp / "tt_b1.pdf"
    kq = chu_pdf.sua_dong(f, ra, 1, "1:0", "Cau 2. Tinh")
    d = pdfium.PdfDocument(str(ra))
    sau = chu_pdf._doc_doi_tuong(d[0], hop, r)
    d.close()
    dich = next(o for o in sau if o["chu"] == "chu nhat ABCD")
    kiem("tự tạo: chữ nối tiếp đứng yên sau khi xóa đối tượng đứng trước", abs(dich["goc"][0] - nho[0]) < 0.05 and abs(dich["goc"][1] - nho[1]) < 0.05, f"{nho} -> {dich['goc']}")
    kiem("tự tạo: chữ mới có, chữ cũ mất", "Cau 2. Tinh" in van_ban(ra, 1) and "Bai 1. Cho" not in van_ban(ra, 1), kq["phong_dung"] or "")
    # Tm có tỉ lệ (Tf 1, Tm 12)
    dg = chu_pdf.tim_dong(f, 1, 90, 792 - 660 - 3)
    kiem("tự tạo: tim_dong với Tm tỉ lệ cho cỡ chữ hợp lý", dg and dg["loai"] == "chu-co-san", str(dg))
    if dg:
        rb = tmp / "tt_b2.pdf"
        chu_pdf.sua_dong(f, rb, 1, dg["id"], "Scaled TEXT")
        kiem("tự tạo: sửa chữ có Tm tỉ lệ", "Scaled TEXT" in van_ban(rb, 1) and "Scaled text" not in van_ban(rb, 1))
    # lệnh '
    dg = chu_pdf.tim_dong(f, 1, 80, 792 - 606 + 14 - 3 + 2)
    d = pdfium.PdfDocument(str(f))
    ds1 = chu_pdf._doc_doi_tuong(d[0], hop, r)
    d.close()
    k_dong2 = next(o["k"] for o in ds1 if o["chu"] == "Line two")
    rq = tmp / "tt_b3.pdf"
    chu_pdf.sua_dong(f, rq, 1, f"1:{k_dong2}", "Dong hai")
    kiem("tự tạo: sửa chữ lệnh ' (T* giữ nguyên)", "Dong hai" in van_ban(rq, 1) and "Line two" not in van_ban(rq, 1) and "Line one" in van_ban(rq, 1))
    # TJ có kern
    k_k = next(o["k"] for o in ds1 if o["chu"].startswith("Kern"))
    rk = tmp / "tt_b4.pdf"
    chu_pdf.sua_dong(f, rk, 1, f"1:{k_k}", "Moi chu")
    kiem("tự tạo: sửa dòng TJ có kern, dòng Td sau đó đứng yên", "Moi chu" in van_ban(rk, 1) and "Next" in van_ban(rk, 1))
    # thêm chữ trên trang xoay 0, 90, 180, 270
    ds_t = [dict(trang=t, x=100, y=200, chu="Chữ xoay Việt", phong="Times New Roman", co=18) for t in (1, 2, 3, 4)]
    ra = tmp / "tt_a.pdf"
    chu_pdf.them_chu(f, ra, ds_t)
    for t in (1, 2, 3, 4):
        kh = khung_ma_thay_doi(f, ra, t)
        w = 612 if t != 2 and t != 4 else 792
        kiem(f"tự tạo: trang {t} (xoay {[0, 90, 180, 270][t - 1]}) chữ thêm đúng chỗ và nằm ngang", kh and abs(kh[0] - 100) < 5 and 200 <= kh[1] <= 225 and 70 < kh[2] - kh[0] < 130 and kh[3] - kh[1] < 30, str(kh))
        kiem(f"tự tạo: trang {t} chữ thêm tìm được", "Chữ xoay Việt" in gon(van_ban(ra, t)))
    # sửa dòng trên trang xoay
    for t, goc_chu in ((2, "Rotated ninety"), (3, "Rotated one eighty"), (4, "Rotated two seventy")):
        with pikepdf.open(f) as k:
            tr = k.pages[t - 1]
            hop, r = chu_pdf._hop(tr), chu_pdf._xoay(tr)
        d = pdfium.PdfDocument(str(f))
        o = chu_pdf._doc_doi_tuong(d[t - 1], hop, r)[0]
        d.close()
        dg = chu_pdf.tim_dong(f, t, (o["khung"][0] + o["khung"][2]) / 2, (o["khung"][1] + o["khung"][3]) / 2)
        kiem(f"tự tạo: tim_dong trên trang xoay {r}", dg and dg["chu"] == goc_chu, str(dg and dg["chu"]))
        if dg:
            rs = tmp / f"tt_r{t}.pdf"
            chu_pdf.sua_dong(f, rs, t, dg["id"], "Doi xoay")
            kh = khung_ma_thay_doi(f, rs, t)
            kiem(f"tự tạo: sửa dòng trên trang xoay {r} đúng chỗ", "Doi xoay" in van_ban(rs, t) and goc_chu not in van_ban(rs, t) and kh and abs(kh[0] - 100) < 6 and 80 < kh[1] < 105,
                 str(kh))
    so1, ml1, lk1 = dau_trang(ra)
    kiem("tự tạo: giữ mục lục, liên kết", (so1, ml1, lk1) == (so0, ml0, lk0))


def thu_nhieu_dong(tmp):
    """sua_nhieu_dong trên PDF tự tạo (nhiều dòng cùng trang, mã dòng xen kẽ) và ghep() có chữ thật."""
    print("\n== Nhiều dòng một lượt, nối vào ghep() ==")
    import cong_cu_pdf
    f = tmp / "tt-nhieu.pdf"
    tao_pdf_tu_tao(f)
    ra = tmp / "tt-nhieu-ra.pdf"
    chu_pdf.sua_nhieu_dong(f, ra, [{"trang": 1, "dong_id": "1:2", "chu_moi": "Scale lai"}, {"trang": 1, "dong_id": "1:0.1", "chu_moi": "Dong dau moi"},
                                   {"trang": 1, "dong_id": "1:4", "chu_moi": "Line 2 moi"}])
    vb = gon(van_ban(ra, 1))
    kiem("nhiều dòng: cả ba chỗ sửa đều có, chữ cũ mất", all(x in vb for x in ("Scale lai", "Dong dau moi", "Line 2 moi")) and "Scaled text" not in vb and "Bai 1." not in vb and "Line two" not in vb, vb[:200])
    kiem("nhiều dòng: dòng không sửa còn nguyên", "Line one" in vb and "Kern" in vb)
    # ghep(): trang 1 và trang 3 của file, trang 3 xoay thêm 90, kèm chữ thật
    out = tmp / "ghep.pdf"
    cong_cu_pdf.ghep([{"duong": str(f), "so": 1, "xoay": 0, "chu": [dict(x=100, y=100, chu="Ghép chữ Việt", phong="Arial", co=14)]},
                      {"duong": str(f), "so": 3, "xoay": 90, "chu": [dict(x=100, y=300, chu="Trang xoay thêm", phong="Arial", co=14)]},
                      {"duong": str(f), "so": 2, "xoay": 0}], out)
    kiem("ghep: chữ thật vào đúng trang, có tìm được", "Ghép chữ Việt" in van_ban(out, 1) and "Trang xoay thêm" in van_ban(out, 2) and "Ghép" not in van_ban(out, 3))
    da = chu_pdf.doc_chu_da_them(out)
    kiem("ghep: đọc lại chữ đã thêm sau khi ghép", [d["trang"] for d in da] == [1, 2] and da[1]["chu"] == "Trang xoay thêm")
    out2 = tmp / "ghep2.pdf"
    cong_cu_pdf.ghep([{"duong": str(out), "so": 1, "xoay": 0, "xoa_chu": [da[0]["id"]]}, {"duong": str(out), "so": 2, "xoay": 0}], out2)
    kiem("ghep: xoa_chu bỏ đúng chữ", "Ghép chữ Việt" not in van_ban(out2, 1) and "Trang xoay thêm" in van_ban(out2, 2))


def thu_phong():
    print("\n== Phông ==")
    ds = phong_chu.ds_phong_viet()
    ho = {g["ho"] for g in ds}
    kiem("phông: có Times New Roman và Arial đủ dấu tiếng Việt", {"Times New Roman", "Arial"} <= ho, str(sorted(ho)[:10]))
    tnr = phong_chu.tim_phong("Times New Roman", True, True)
    kiem("phông: Times New Roman đậm nghiêng ra file thật", tnr and Path(tnr["duong"]).is_file() and not tnr["dam_gia"] and not tnr["nghieng_gia"], str(tnr))
    kiem("phông: họ không có thì trả None", phong_chu.tim_phong("Phong Khong Ton Tai 123") is None)
    sf = phong_chu.Sfnt(tnr["duong"], tnr["chi_so"])
    kiem("phông: đủ glyph tiếng Việt", all(sf.gid(ord(c)) for c in "ăâđêôơưẠỹ"))
    gia = phong_chu.tim_phong("Consolas", True, True)
    kiem("phông: tìm không ra bản thì báo giả lập đúng cờ", gia is not None and isinstance(gia["dam_gia"], bool))


def main():
    thu_phong()
    with tempfile.TemporaryDirectory(prefix="chu-pdf-") as t:
        tmp = Path(t)
        for ten in FILE_THU:
            try:
                mot_file_that(ten, tmp, print)
            except Exception:
                kiem(f"{ten}: chạy không lỗi", False, traceback.format_exc()[-600:])
        try:
            thu_tu_tao(tmp)
        except Exception:
            kiem("tự tạo: chạy không lỗi", False, traceback.format_exc()[-600:])
        try:
            thu_nhieu_dong(tmp)
        except Exception:
            kiem("nhiều dòng/ghep: chạy không lỗi", False, traceback.format_exc()[-800:])
    loi = [k for k in KET_QUA if not k[1]]
    print(f"\n{len(KET_QUA) - len(loi)}/{len(KET_QUA)} đạt")
    for ten, _, ct in loi:
        print("LỖI:", ten, ct)
    sys.exit(1 if loi else 0)


if __name__ == "__main__":
    main()
