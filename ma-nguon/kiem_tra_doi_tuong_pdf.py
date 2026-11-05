"""Kiểm thử doi_tuong_pdf.py (sửa đối tượng) và chu_pdf.ds_dong. Chạy: .venv\\Scripts\\python.exe -X utf8 ma-nguon\\kiem_tra_doi_tuong_pdf.py
File thử được chép/tạo trong thư mục tạm, không đụng file trong du-lieu-thu. File thử nào không có trên máy thì bỏ qua và báo rõ."""
import shutil
import sys
import tempfile
import time
import traceback
from pathlib import Path

GOC = Path(__file__).resolve().parent
sys.path.insert(0, str(GOC))
import pikepdf  # noqa: E402
import pypdfium2 as pdfium  # noqa: E402
from PIL import ImageChops  # noqa: E402

import chu_pdf  # noqa: E402
import cong_cu_pdf  # noqa: E402
import doi_tuong_pdf  # noqa: E402
from phong_chu import LoiChu  # noqa: E402

DU_LIEU = [GOC.parent / "du-lieu-thu", Path(r"C:\DATA\Vibe Coding\app-sua-tex\du-lieu-thu")]
FILE_THU = {
    "latex-CD2": ["2_XUONG/04_san-pham/2-chuyen-de/CD2_GV.pdf", "3_THANH-PHAM/2_Chuyen-de/GV/CD2_GV.pdf"],
    "latex-CD06": ["2_XUONG/02_ngan-hang/13CD/CD06_GV.pdf"],
    "word": ["Buổi 01_Tính đơn điệu của hàm số_GV.pdf"],
    "co-anh": ["4 file PDF-moi.pdf"],
}
KET_QUA = []
TL = 1.3


def kiem(ten, dieu_kien, chi_tiet=""):
    KET_QUA.append((ten, bool(dieu_kien), chi_tiet))
    print(("  ok   " if dieu_kien else "  LOI  ") + ten + (f"  [{chi_tiet}]" if chi_tiet and not dieu_kien else ""))


def tim_file(ten):
    for m in FILE_THU[ten]:
        for g in DU_LIEU:
            if (g / m).is_file():
                return g / m
    return None


def anh(pdf, so):
    d = pdfium.PdfDocument(str(pdf))
    try:
        return d[so - 1].render(scale=TL).to_pil().convert("RGB")
    finally:
        d.close()


def anh_xam(pdf, so):
    return anh(pdf, so).convert("L")


def hop_mau(im, mau, dung_sai=40):
    """Hộp (pt) chứa các điểm ảnh gần màu `mau` (r, g, b), None nếu không có."""
    r, g, b = mau
    a = im.point(lambda v: 255)  # ảnh trắng cùng cỡ
    kenh = [c.point(lambda v, m=m: 255 if abs(v - m) <= dung_sai else 0) for c, m in zip(im.split(), (r, g, b))]
    kh = ImageChops.multiply(ImageChops.multiply(kenh[0], kenh[1]), kenh[2]).getbbox()
    del a
    return tuple(v / TL for v in kh) if kh else None


def khac(pdf_a, pdf_b, so):
    kh = ImageChops.difference(anh_xam(pdf_a, so), anh_xam(pdf_b, so)).point(lambda g: 255 if g > 40 else 0).getbbox()
    return tuple(v / TL for v in kh) if kh else None


def gan(a, b, dung_sai=2.5):
    return a is not None and all(abs(x - y) <= dung_sai for x, y in zip(a, b))


def dau_trang(pdf):
    with pikepdf.open(pdf) as p:
        with p.open_outline() as o:
            def duyet(ds):
                return [(str(m.title), duyet(m.children)) for m in ds]
            muc_luc = duyet(o.root)
        lk = [sum(1 for a in (tr.obj.get("/Annots") or []) if str(a.get("/Subtype")) == "/Link") for tr in p.pages]
        return len(p.pages), muc_luc, lk


# ---------- File tự tạo ----------

def tao_file(duong, xoay=0):
    """Trang 400 x 300 pt: ảnh đỏ 100x60 ở (50..150, trên 40..100), khung xanh dương nét, nhóm (ô xanh lá + viền + chéo) ở góc phải dưới,
    ảnh inline vàng, chữ "Xin chào" bằng Helvetica. Tọa độ nhìn thấy (khi xoay = 0) ghi trong kiểm thử."""
    pdf = pikepdf.new()
    pdf.add_blank_page(page_size=(400, 300))
    tr = pdf.pages[0]
    do = pdf.make_stream(bytes([255, 0, 0] * (50 * 30)), Type=pikepdf.Name.XObject, Subtype=pikepdf.Name.Image, Width=50, Height=30,
                         ColorSpace=pikepdf.Name.DeviceRGB, BitsPerComponent=8)
    tr.obj.Resources = pikepdf.Dictionary(XObject=pikepdf.Dictionary(Im0=do), Font=pikepdf.Dictionary(
        F1=pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica, Encoding=pikepdf.Name.WinAnsiEncoding)))
    nd = (
        b"q 100 0 0 60 50 200 cm /Im0 Do Q\n"                       # ảnh: y PDF 200..260 -> nhìn thấy 40..100
        b"0 0 1 RG 3 w 200 150 80 50 re S\n"                         # khung xanh: nhìn thấy y 100..150
        b"q 1 0 0 1 300 40 cm 0 1 0 rg 0 0 40 40 re f 0 0 0 RG 1 w 0 0 40 40 re S 0 0 m 40 40 l S Q\n"  # nhóm: nhìn thấy y 220..260, x 300..340
        b"q 30 0 0 20 100 100 cm BI /W 2 /H 2 /CS /RGB /BPC 8 ID \xff\xff\x00\xff\xff\x00\xff\xff\x00\xff\xff\x00 EI Q\n"
        b"BT /F1 14 Tf 50 30 Td (Xin chao the gioi) Tj ET\n")
    tr.obj.Contents = pdf.make_stream(nd)
    if xoay:
        tr.obj.Rotate = xoay
    pdf.save(duong)


def phan_loai(ds):
    return {d["loai"]: [x for x in ds if x["loai"] == d["loai"]] for d in ds}


def thu_tu_tao(tmp, log):
    print("\n== File tự tạo ==")
    f = tmp / "tao.pdf"
    tao_file(f)
    ds = doi_tuong_pdf.ds_doi_tuong(f, 1)
    kiem("tự tạo: liệt kê đúng 4 đối tượng (2 ảnh, 1 hình, 1 nhóm)", sorted(d["loai"] for d in ds) == ["anh", "anh", "hinh", "nhom"], str([(d["loai"], d["khung"]) for d in ds]))
    a0 = next(d for d in ds if d["nguon"] == "anh")
    hinh = next(d for d in ds if d["loai"] == "hinh")
    nhom = next(d for d in ds if d["loai"] == "nhom")
    ai = next(d for d in ds if d["nguon"] == "anh-inline")
    kiem("tự tạo: khung ảnh đúng (50,40)-(150,100)", gan(a0["khung"], (50, 40, 150, 100), 1.0), str(a0["khung"]))
    kiem("tự tạo: khung hình có cả nét viền (≈ 198.5,98.5)-(281.5,151.5)", gan(hinh["khung"], (198.5, 98.5, 281.5, 151.5), 1.0), str(hinh["khung"]))
    kiem("tự tạo: nhóm gồm 3 nét, khung (300,220)-(340,260)", nhom["so_phan_tu"] == 3 and gan(nhom["khung"], (300, 220, 340, 260), 1.5), str(nhom))
    kiem("tự tạo: ảnh inline có khung (100,180)-(130,200)", gan(ai["khung"], (100, 180, 130, 200), 1.0), str(ai["khung"]))
    kiem("tự tạo: mọi mục sửa được, id đúng dạng trang:a-b", all(d["sua_duoc"] and d["id"].startswith("1:") for d in ds))
    kiem("tự tạo: ảnh có rộng/cao px", a0.get("rong_px") == 50 and a0.get("cao_px") == 30)
    chi_tiet = doi_tuong_pdf.ds_doi_tuong(f, 1, chi_tiet=True)
    kiem("tự tạo: chi_tiet trả từng nét (1 ảnh + 1 hình + 3 nét nhóm + ảnh inline = 6)", len(chi_tiet) == 6, str(len(chi_tiet)))
    kiem("tự tạo: nhóm có phan_tu khớp id chi tiết", set(nhom["phan_tu"]) <= {d["id"] for d in chi_tiet})
    dong = chu_pdf.ds_dong(f, 1)
    kiem("tự tạo: ds_dong thấy dòng chữ", len(dong) == 1 and dong[0]["chu"].strip() == "Xin chao the gioi" and dong[0]["sua_duoc"], str(dong))

    g = anh(f, 1)
    kiem("tự tạo: ảnh gốc có đỏ ở đúng chỗ", gan(hop_mau(g, (255, 0, 0)), (50, 40, 150, 100), 2))

    # --- dời ảnh 50 pt ---
    r = tmp / "tao_doi.pdf"
    kq = doi_tuong_pdf.sua_doi_tuong(f, r, [{"trang": 1, "id": a0["id"], "viec": {"loai": "doi", "dx": 50, "dy": 0}}])
    g2 = anh(r, 1)
    kiem("dời ảnh 50 pt: ảnh ở chỗ mới (100,40)-(200,100)", gan(hop_mau(g2, (255, 0, 0)), (100, 40, 200, 100), 2), str(hop_mau(g2, (255, 0, 0))))
    kiem("dời ảnh: khung_cu/khung_moi trả về đúng", gan(kq["doi_tuong"][0]["khung_moi"], (100, 40, 200, 100), 1.0))
    # chỗ cũ trống: vùng x 50..100 phải trắng (ngoài vùng ảnh mới)
    vung_cu = g2.crop((int(52 * TL), int(42 * TL), int(98 * TL), int(98 * TL))).convert("L").getextrema()
    kiem("dời ảnh: chỗ cũ trống", vung_cu[0] >= 250, str(vung_cu))
    kh = khac(f, r, 1)
    kiem("dời ảnh: phần khác không đổi (chỉ khác trong vùng 50..200 x 40..100)", kh and kh[0] >= 49 and kh[2] <= 201 and kh[1] >= 39 and kh[3] <= 101, str(kh))
    dr = doi_tuong_pdf.ds_doi_tuong(r, 1)
    kiem("dời ảnh: chữ còn nguyên, ds_doi_tuong thấy ảnh ở chỗ mới", "Xin chao the gioi" in chu_pdf.ds_dong(r, 1)[0]["chu"]
         and any(d["nguon"] == "anh" and gan(d["khung"], (100, 40, 200, 100), 1.0) for d in dr), str([(d["nguon"], d["khung"]) for d in dr]))

    # --- co ảnh ---
    r = tmp / "tao_co.pdf"
    doi_tuong_pdf.sua_doi_tuong(f, r, [{"trang": 1, "id": a0["id"], "viec": {"loai": "co", "khung_moi": [50, 40, 100, 70]}}])
    kiem("co ảnh: ảnh nằm trong khung mới (50,40)-(100,70)", gan(hop_mau(anh(r, 1), (255, 0, 0)), (50, 40, 100, 70), 2), str(hop_mau(anh(r, 1), (255, 0, 0))))
    r = tmp / "tao_co2.pdf"
    doi_tuong_pdf.sua_doi_tuong(f, r, [{"trang": 1, "id": a0["id"], "viec": {"loai": "co", "khung_moi": [50, 40, 250, 70], "giu_ti_le": True}}])
    kiem("co ảnh giữ tỉ lệ: lấy cạnh nhỏ nhất (30/60=0.5 -> 50x30)", gan(hop_mau(anh(r, 1), (255, 0, 0)), (50, 40, 100, 70), 2), str(hop_mau(anh(r, 1), (255, 0, 0))))

    # --- xóa hình ---
    r = tmp / "tao_xoa.pdf"
    doi_tuong_pdf.sua_doi_tuong(f, r, [{"trang": 1, "id": hinh["id"], "viec": {"loai": "xoa"}}])
    kiem("xóa hình: khung xanh biến mất", hop_mau(anh(r, 1), (0, 0, 255)) is None and hop_mau(g, (0, 0, 255)) is not None)
    kiem("xóa hình: ảnh đỏ và nhóm xanh lá còn", hop_mau(anh(r, 1), (255, 0, 0)) and hop_mau(anh(r, 1), (0, 255, 0)))
    kiem("xóa hình: danh sách còn 3", len(doi_tuong_pdf.ds_doi_tuong(r, 1)) == 3)

    # --- dời nhóm có nhiều nét, trạng thái đồ họa không rò rỉ ---
    r = tmp / "tao_nhom.pdf"
    doi_tuong_pdf.sua_doi_tuong(f, r, [{"trang": 1, "id": nhom["id"], "viec": {"loai": "doi", "dx": -100, "dy": -30}}])
    kiem("dời nhóm: ô xanh lá sang (200,190)-(240,230)", gan(hop_mau(anh(r, 1), (0, 255, 0)), (200, 190, 240, 230), 2.5), str(hop_mau(anh(r, 1), (0, 255, 0))))
    kiem("dời nhóm: chữ sau nhóm vẫn đen đúng chỗ", gan(chu_pdf.ds_dong(r, 1)[0]["khung"], chu_pdf.ds_dong(f, 1)[0]["khung"], 0.5))

    # --- sửa chữ và sửa đối tượng cùng một lần ---
    r = tmp / "tao_chung.pdf"
    kq = doi_tuong_pdf.ap_sua(f, r, sua_dong=[{"trang": 1, "dong_id": dong[0]["dong_id"], "chu_moi": "Da sua chu"}],
                              sua_doi_tuong=[{"trang": 1, "id": a0["id"], "viec": {"loai": "doi", "dx": 0, "dy": 100}},
                                             {"trang": 1, "id": hinh["id"], "viec": {"loai": "xoa"}}])
    kiem("sửa chung: chữ đã đổi", "Da sua chu" in chu_pdf.ds_dong(r, 1)[0]["chu"] and "Xin chao" not in chu_pdf.ds_dong(r, 1)[0]["chu"])
    gc = anh(r, 1)
    kiem("sửa chung: ảnh đã dời xuống 100 pt, khung xanh đã xóa", gan(hop_mau(gc, (255, 0, 0)), (50, 140, 150, 200), 2) and hop_mau(gc, (0, 0, 255)) is None, str(hop_mau(gc, (255, 0, 0))))
    kiem("sửa chung: kết quả có cả ds và doi_tuong", len(kq["ds"]) == 1 and len(kq["doi_tuong"]) == 2)
    # --- sửa chữ rồi sửa đối tượng: id gốc vẫn dùng được trong một lần ---
    r1 = tmp / "tao_chu_truoc.pdf"
    chu_pdf.sua_nhieu_dong(f, r1, [{"trang": 1, "dong_id": dong[0]["dong_id"], "chu_moi": "Chu truoc"}])
    kiem("sửa chữ cũ vẫn chạy với dong_id của ds_dong", "Chu truoc" in chu_pdf.ds_dong(r1, 1)[0]["chu"])

    # --- lỗi ---
    def loi(ten, ham):
        try:
            ham()
            kiem(ten, False, "không báo lỗi")
        except LoiChu as e:
            kiem(ten, True)
            log.append((ten, str(e)))
        except Exception as e:
            kiem(ten, False, f"lỗi khác: {e!r}")
    loi("lỗi: id không còn trong trang", lambda: doi_tuong_pdf.sua_doi_tuong(f, tmp / "l1.pdf", [{"trang": 1, "id": "1:900-901", "viec": {"loai": "xoa"}}]))
    loi("lỗi: id sai trang", lambda: doi_tuong_pdf.sua_doi_tuong(f, tmp / "l2.pdf", [{"trang": 1, "id": "2:0-1", "viec": {"loai": "xoa"}}]))
    loi("lỗi: không ghi đè file gốc", lambda: doi_tuong_pdf.sua_doi_tuong(f, f, [{"trang": 1, "id": a0["id"], "viec": {"loai": "xoa"}}]))
    loi("lỗi: việc không hợp lệ", lambda: doi_tuong_pdf.sua_doi_tuong(f, tmp / "l3.pdf", [{"trang": 1, "id": a0["id"], "viec": {"loai": "quay"}}]))
    loi("lỗi: khung mới quá nhỏ", lambda: doi_tuong_pdf.sua_doi_tuong(f, tmp / "l4.pdf", [{"trang": 1, "id": a0["id"], "viec": {"loai": "co", "khung_moi": [0, 0, 0.1, 0.1]}}]))
    loi("lỗi: hai đối tượng chồng nhau (nhóm và nét con)", lambda: doi_tuong_pdf.sua_doi_tuong(
        f, tmp / "l5.pdf", [{"trang": 1, "id": nhom["id"], "viec": {"loai": "xoa"}}, {"trang": 1, "id": nhom["phan_tu"][0], "viec": {"loai": "doi", "dx": 5, "dy": 0}}]))
    loi("lỗi: trang không tồn tại", lambda: doi_tuong_pdf.sua_doi_tuong(f, tmp / "l6.pdf", [{"trang": 5, "id": "5:0-1", "viec": {"loai": "xoa"}}]))
    kiem("lỗi: không để lại file dở", not list(tmp.glob("l*.pdf*")))
    t = doi_tuong_pdf.xem_thu(f, 1, a0["id"], {"loai": "doi", "dx": 10, "dy": 20})
    kiem("xem thử: không ghi file, trả khung mới", gan(t["khung_moi"], (60, 60, 160, 120), 1.0) and t["sua_duoc"])

    # --- trang xoay 90 và 180 ---
    for goc_xoay in (90, 180, 270):
        fr = tmp / f"tao_{goc_xoay}.pdf"
        tao_file(fr, goc_xoay)
        dsr = doi_tuong_pdf.ds_doi_tuong(fr, 1)
        ar = next(d for d in dsr if d["nguon"] == "anh")
        gr = anh(fr, 1)
        kh_do = hop_mau(gr, (255, 0, 0))
        kiem(f"xoay {goc_xoay}: khung ảnh khớp vị trí vẽ thật", gan(ar["khung"], kh_do, 2.0), f"{ar['khung']} vs {kh_do}")
        rr = tmp / f"tao_{goc_xoay}_doi.pdf"
        doi_tuong_pdf.sua_doi_tuong(fr, rr, [{"trang": 1, "id": ar["id"], "viec": {"loai": "doi", "dx": 30, "dy": 20}}])
        moi = hop_mau(anh(rr, 1), (255, 0, 0))
        kiem(f"xoay {goc_xoay}: dời (+30, +20) theo trang nhìn thấy", gan(moi, (kh_do[0] + 30, kh_do[1] + 20, kh_do[2] + 30, kh_do[3] + 20), 2.5), f"{moi} vs {kh_do}")
        rr = tmp / f"tao_{goc_xoay}_co.pdf"
        kc = ar["khung"]
        doi_tuong_pdf.sua_doi_tuong(fr, rr, [{"trang": 1, "id": ar["id"], "viec": {"loai": "co", "khung_moi": [kc[0], kc[1], kc[0] + 40, kc[1] + 20]}}])
        moi = hop_mau(anh(rr, 1), (255, 0, 0))
        kiem(f"xoay {goc_xoay}: co về khung 40x20", gan(moi, (kc[0], kc[1], kc[0] + 40, kc[1] + 20), 2.5), f"{moi}")
        dr = chu_pdf.ds_dong(fr, 1)
        rc = tmp / f"tao_{goc_xoay}_chung.pdf"
        doi_tuong_pdf.ap_sua(fr, rc, sua_dong=[{"trang": 1, "dong_id": dr[0]["dong_id"], "chu_moi": "Xoay"}], sua_doi_tuong=[{"trang": 1, "id": ar["id"], "viec": {"loai": "xoa"}}])
        kiem(f"xoay {goc_xoay}: sửa chữ + xóa ảnh cùng lúc", hop_mau(anh(rc, 1), (255, 0, 0)) is None and "Xoay" in chu_pdf.ds_dong(rc, 1)[0]["chu"])

    # --- nhóm có chữ bên trong và xung đột với sửa chữ ---
    fn = tmp / "nhom_chu.pdf"
    pdf = pikepdf.new()
    pdf.add_blank_page(page_size=(400, 300))
    tr = pdf.pages[0]
    tr.obj.Resources = pikepdf.Dictionary(Font=pikepdf.Dictionary(
        F1=pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica, Encoding=pikepdf.Name.WinAnsiEncoding)))
    tr.obj.Contents = pdf.make_stream(
        b"q 1 0 0 rg 100 100 80 40 re f 0 0 1 RG 100 100 80 40 re S BT /F1 12 Tf 110 115 Td (Nhan A) Tj ET Q\n"
        b"BT /F1 12 Tf 50 30 Td (Ngoai nhom) Tj ET\n")
    pdf.save(fn)
    dsn = doi_tuong_pdf.ds_doi_tuong(fn, 1)
    g1 = next((d for d in dsn if d["loai"] == "nhom"), None)
    kiem("nhóm có chữ: nhận ra, co_chu = True, khung gồm cả chữ", g1 and g1["co_chu"] and g1["sua_duoc"], str(dsn))
    dn = chu_pdf.ds_dong(fn, 1)
    kiem("nhóm có chữ: ds_dong có 2 dòng", len(dn) == 2)
    rn = tmp / "nhom_chu_doi.pdf"
    doi_tuong_pdf.sua_doi_tuong(fn, rn, [{"trang": 1, "id": g1["id"], "viec": {"loai": "doi", "dx": 100, "dy": 50}}])
    kc = chu_pdf.ds_dong(rn, 1)
    kiem("nhóm có chữ: dời nhóm kéo theo chữ bên trong", any(abs(d["khung"][0] - 210) < 2 and d["chu"].strip() == "Nhan A" for d in kc), str([d["khung"] for d in kc]))
    dong_trong = next(d for d in dn if d["chu"].strip() == "Nhan A")
    loi("nhóm có chữ: sửa chữ trong nhóm đang dời thì báo lỗi", lambda: doi_tuong_pdf.ap_sua(
        fn, tmp / "l7.pdf", sua_dong=[{"trang": 1, "dong_id": dong_trong["dong_id"], "chu_moi": "B"}], sua_doi_tuong=[{"trang": 1, "id": g1["id"], "viec": {"loai": "xoa"}}]))
    dong_ngoai = next(d for d in dn if d["chu"].strip() == "Ngoai nhom")
    rn2 = tmp / "nhom_chu_chung.pdf"
    doi_tuong_pdf.ap_sua(fn, rn2, sua_dong=[{"trang": 1, "dong_id": dong_ngoai["dong_id"], "chu_moi": "Ngoai da sua"}], sua_doi_tuong=[{"trang": 1, "id": g1["id"], "viec": {"loai": "xoa"}}])
    kiem("nhóm có chữ: xóa nhóm + sửa chữ ngoài nhóm cùng lúc", [d["chu"].strip() for d in chu_pdf.ds_dong(rn2, 1)] == ["Ngoai da sua"])

    # --- ghep() với nhiều trang, qua app ---
    try:
        import app
        thu = tmp / "ghep"
        thu.mkdir()
        trang = [{"duong": str(f), "so": 1, "anh": None, "sua_doi_tuong": [{"id": a0["id"], "viec": {"loai": "doi", "dx": 50, "dy": 0}}],
                  "sua_dong": [{"dong_id": dong[0]["dong_id"], "chu_moi": "Qua app"}]},
                 {"duong": str(f), "so": 1, "anh": None, "sua_doi_tuong": [{"id": a0["id"], "viec": {"loai": "doi", "dx": 50, "dy": 0}}],
                  "sua_dong": [{"dong_id": dong[0]["dong_id"], "chu_moi": "Qua app"}], "xoay": 90}]
        goc = app.ap_sua_trang(trang, thu)
        kq = cong_cu_pdf.ghep(trang, tmp / "ghep_ra.pdf")
        kiem("app.ap_sua_trang + ghep: 2 trang, trang nhân bản đều có sửa", kq["so_trang"] == 2 and len(goc) == 1
             and gan(hop_mau(anh(tmp / "ghep_ra.pdf", 1), (255, 0, 0)), (100, 40, 200, 100), 2) and "Qua app" in chu_pdf.ds_dong(tmp / "ghep_ra.pdf", 1)[0]["chu"])
        trang2 = [{"duong": str(f), "so": 1, "anh": None, "sua_doi_tuong": [{"id": a0["id"], "viec": {"loai": "doi", "dx": 50, "dy": 0}}]},
                  {"duong": str(f), "so": 1, "anh": None, "sua_doi_tuong": [{"id": a0["id"], "viec": {"loai": "xoa"}}]}]
        try:
            app.ap_sua_trang(trang2, thu)
            kiem("app: hai bản nhân bản sửa khác nhau thì báo lỗi", False)
        except app.LoiApp:
            kiem("app: hai bản nhân bản sửa khác nhau thì báo lỗi", True)
        kiem("app.dt_ds: trả đối tượng qua API", True) if (app.PDF_DA_CHON.add(str(f)) or True) and len(app.dt_ds({"duong": str(f), "trang": 1})["ds"]) == 4 else kiem("app.dt_ds", False)
        kiem("app.chu_ds_dong: có goi_y_phong", all("goi_y_phong" in d for d in app.chu_ds_dong({"duong": str(f), "trang": 1})["ds"]))
        t = app.dt_thu({"duong": str(f), "trang": 1, "id": a0["id"], "viec": {"loai": "doi", "dx": 1, "dy": 1}})
        kiem("app.dt_thu: trả khung", t["sua_duoc"] and t["khung_moi"])
    except ImportError as e:
        print(f"  bỏ qua kiểm thử app: {e}")


# ---------- File thật ----------

def file_that(ten, tmp, log):
    nguon = tim_file(ten)
    if not nguon:
        print(f"  bỏ qua {ten}: không có file thử trên máy")
        return
    pdf = tmp / f"{ten}.pdf"
    shutil.copy(nguon, pdf)
    print(f"\n== {ten} ({nguon.name}) ==")
    so0, ml0, lk0 = dau_trang(pdf)
    with pikepdf.open(pdf) as p:
        n_trang = len(p.pages)
    # ds_dong: thời gian + id dùng được
    for so in sorted({1, min(2, n_trang), min(5, n_trang)}):
        pdf2 = tmp / f"{ten}_t{so}.pdf"
        shutil.copy(pdf, pdf2)  # khác khóa bộ đệm: bắt buộc tính lại
        t = time.perf_counter()
        ds = chu_pdf.ds_dong(pdf2, so)
        ms = (time.perf_counter() - t) * 1000
        t = time.perf_counter()
        chu_pdf.ds_dong(pdf2, so)
        ms2 = (time.perf_counter() - t) * 1000
        print(f"    ds_dong trang {so}: {len(ds)} dòng, {ms:.0f} ms (lần hai {ms2:.1f} ms)")
        KET_QUA_THOI_GIAN.append((ten, so, len(ds), ms))
        kiem(f"{ten}: ds_dong trang {so} có dòng, mọi dòng đủ trường", ds and all({"dong_id", "chu", "khung", "phong", "co", "mau", "sua_duoc", "ly_do"} <= set(d) for d in ds))
        kiem(f"{ten}: ds_dong trang {so} đủ nhanh (< 1500 ms)", ms < 1500, f"{ms:.0f} ms")
        kiem(f"{ten}: ds_dong lần hai nhờ bộ đệm", ms2 < 20, f"{ms2:.1f} ms")
    ds = chu_pdf.ds_dong(pdf, 1)
    sua = [d for d in ds if d["sua_duoc"] and len(d["chu"].strip()) > 8][:3]
    if len(sua) >= 2:
        r = tmp / f"{ten}_nd.pdf"
        kq = chu_pdf.sua_nhieu_dong(pdf, r, [{"trang": 1, "dong_id": d["dong_id"], "chu_moi": "DONG SUA " + str(i)} for i, d in enumerate(sua)])
        vb = chu_pdf.ds_dong(r, 1)
        kiem(f"{ten}: sua_nhieu_dong nhận dong_id của ds_dong", sum(1 for d in vb if d["chu"].startswith("DONG SUA")) == len(sua), str(len(kq["ds"])))
        if ten == "word":  # Word đặt dấu cách là glyph 0 (.notdef, vẽ ô vuông): chữ mới không được dùng mã đó
            with pikepdf.open(r) as p:
                so_ma0 = sum(1 for l in pikepdf.parse_content_stream(p.pages[0]) if str(l.operator) in ("Tj", "TJ") for x in (list(l.operands[0]) if str(l.operator) == "TJ" else [l.operands[0]])
                             if isinstance(x, pikepdf.String) and any(bytes(x)[i:i + 2] == b"\x00\x00" for i in range(0, len(bytes(x)), 2)))
            kiem("word: chữ sửa không dùng mã 0000 (ô vuông .notdef) làm dấu cách", so_ma0 == 0, str(so_ma0))
        # sửa chữ qua ap_sua cùng kết quả
        r2 = tmp / f"{ten}_ap.pdf"
        doi_tuong_pdf.ap_sua(pdf, r2, sua_dong=[{"trang": 1, "dong_id": d["dong_id"], "chu_moi": "DONG SUA " + str(i)} for i, d in enumerate(sua)])
        kiem(f"{ten}: ap_sua chỉ sửa chữ ra cùng chữ như sua_nhieu_dong", sorted(d["chu"].strip() for d in chu_pdf.ds_dong(r, 1)) == sorted(d["chu"].strip() for d in chu_pdf.ds_dong(r2, 1)))
    ds_dt = {}
    for so in range(1, min(n_trang, 8) + 1):
        t = time.perf_counter()
        ds_dt[so] = doi_tuong_pdf.ds_doi_tuong(pdf, so)
        ms = (time.perf_counter() - t) * 1000
        kiem(f"{ten}: ds_doi_tuong trang {so} đủ nhanh (< 1500 ms)", ms < 1500, f"{ms:.0f} ms")
    print("    số đối tượng mỗi trang:", {so: len(v) for so, v in ds_dt.items()})
    # ảnh và Form thật: dời 50 pt thì nội dung ở chỗ mới giống hệt chỗ cũ, co thì vừa khung mới
    thay = [(so, d) for so in range(1, min(n_trang, 24) + 1) for d in doi_tuong_pdf.ds_doi_tuong(pdf, so)
            if d["sua_duoc"] and d["nguon"] in ("anh", "khoi") and 30 < d["khung"][2] - d["khung"][0] < 300 and 30 < d["khung"][3] - d["khung"][1] < 300
            and d["khung"][0] > 10 and d["khung"][2] < 400]
    for so, d in thay[:3]:
        x0, y0, x1, y1 = d["khung"]
        r = tmp / f"{ten}_anh_{so}.pdf"
        try:
            doi_tuong_pdf.sua_doi_tuong(pdf, r, [{"trang": so, "id": d["id"], "viec": {"loai": "doi", "dx": 50, "dy": 0}}])
        except LoiChu as e:
            kiem(f"{ten}: {d['nguon']} {d['id']} dời 50 pt", False, str(e))
            continue
        a, b = anh(pdf, so), anh(r, so)
        cu = a.crop((int(x0 * TL) + 2, int(y0 * TL) + 2, int(x1 * TL) - 2, int(y1 * TL) - 2))
        moi = b.crop((int((x0 + 50) * TL) + 2, int(y0 * TL) + 2, int((x1 + 50) * TL) - 2, int(y1 * TL) - 2))
        sai = ImageChops.difference(cu.convert("L"), moi.convert("L")).point(lambda g: 255 if g > 40 else 0).histogram()[255]
        kiem(f"{ten}: {d['nguon']} thật {d['id']} dời 50 pt: nội dung ở chỗ mới giống chỗ cũ", sai < max(30, 0.02 * cu.width * cu.height), f"{sai} điểm khác trên {cu.width * cu.height}")  # chữ nằm đè lên ảnh có thể khác chút
        r = tmp / f"{ten}_anh_co_{so}.pdf"
        doi_tuong_pdf.sua_doi_tuong(pdf, r, [{"trang": so, "id": d["id"], "viec": {"loai": "co", "khung_moi": [x0, y0, x0 + (x1 - x0) / 2, y0 + (y1 - y0) / 2]}}])
        d2 = [e for e in doi_tuong_pdf.ds_doi_tuong(r, so) if e["nguon"] == d["nguon"]]
        kiem(f"{ten}: {d['nguon']} thật {d['id']} co nửa: khung mới đúng", any(gan(e["khung"], (x0, y0, x0 + (x1 - x0) / 2, y0 + (y1 - y0) / 2), 1.5) for e in d2))
        r = tmp / f"{ten}_anh_xoa_{so}.pdf"
        doi_tuong_pdf.sua_doi_tuong(pdf, r, [{"trang": so, "id": d["id"], "viec": {"loai": "xoa"}}])
        kiem(f"{ten}: {d['nguon']} thật {d['id']} xóa: khung đã trống/đổi", khac(pdf, r, so) is not None)
    # trang có đối tượng lớn nhất: dời, xóa
    ung = [(so, d) for so, v in ds_dt.items() for d in v if d["sua_duoc"] and not d["nen_trang"]
           and (d["khung"][2] - d["khung"][0]) * (d["khung"][3] - d["khung"][1]) > 400]
    if not ung:
        print("    không có đối tượng đủ lớn để thử dời")
        return
    ung.sort(key=lambda t: -(t[1]["khung"][2] - t[1]["khung"][0]) * (t[1]["khung"][3] - t[1]["khung"][1]))
    thu_duoc = []
    for so, d in ung:
        if len(thu_duoc) == 4:
            break
        r = tmp / f"{ten}_xoa_{so}_{d['id'].replace(':', '_').replace('-', '_')}.pdf"
        try:
            doi_tuong_pdf.sua_doi_tuong(pdf, r, [{"trang": so, "id": d["id"], "viec": {"loai": "xoa"}}])
        except LoiChu as e:
            kiem(f"{ten}: trang {so} {d['id']}: xóa", False, str(e))
            continue
        kh = khac(pdf, r, so)
        x0, y0, x1, y1 = d["khung"]
        ten_dt = f"{ten}: trang {so} {d['loai']} {d['id']}"
        if kh is None:
            print(f"    (bỏ qua {ten_dt}: xóa không thấy khác, đối tượng vô hình)")
            continue
        thu_duoc.append((so, d))
        kiem(ten_dt + ": xóa, chỉ đổi trong khung", kh[0] >= x0 - 4 and kh[2] <= x1 + 4 and kh[1] >= y0 - 4 and kh[3] <= y1 + 4, f"{kh} khung {d['khung']}")
        r = tmp / f"{ten}_dt_{so}_{d['id'].replace(':', '_').replace('-', '_')}.pdf"
        try:
            doi_tuong_pdf.sua_doi_tuong(pdf, r, [{"trang": so, "id": d["id"], "viec": {"loai": "doi", "dx": 30, "dy": 0}}])
        except LoiChu as e:
            kiem(ten_dt + ": dời 30 pt", False, str(e))
            continue
        kh = khac(pdf, r, so)
        kiem(ten_dt + ": dời 30 pt, chỉ đổi quanh khung cũ và mới", kh and kh[0] >= x0 - 4 and kh[2] <= x1 + 34 and kh[1] >= y0 - 4 and kh[3] <= y1 + 4, f"{kh} khung {d['khung']}")
        so1, ml1, lk1 = dau_trang(r)
        kiem(ten_dt + ": giữ số trang, mục lục, liên kết", (so1, ml1, lk1) == (so0, ml0, lk0))
        d2 = doi_tuong_pdf.ds_doi_tuong(r, so)
        kiem(ten_dt + ": đọc lại thấy đối tượng ở chỗ mới", any(abs(e["khung"][0] - (x0 + 30)) < 1.5 and abs(e["khung"][1] - y0) < 1.5 for e in d2), str(d["khung"]))
        r = tmp / f"{ten}_co_{so}.pdf"
        try:
            doi_tuong_pdf.sua_doi_tuong(pdf, r, [{"trang": so, "id": d["id"], "viec": {"loai": "co", "khung_moi": [x0, y0, x0 + (x1 - x0) * 0.5, y0 + (y1 - y0) * 0.5]}}])
            kh = khac(pdf, r, so)
            kiem(ten_dt + ": co nửa, chỉ đổi trong khung cũ", kh and kh[0] >= x0 - 4 and kh[2] <= x1 + 4 and kh[1] >= y0 - 4 and kh[3] <= y1 + 4, f"{kh} khung {d['khung']}")
        except LoiChu as e:
            kiem(ten_dt + ": co", False, str(e))
    if not thu_duoc:
        return
    ung = thu_duoc
    # sửa chữ và đối tượng chung trên cùng trang
    so, d = ung[0]
    ds_so = chu_pdf.ds_dong(pdf, so)
    x0, y0, x1, y1 = d["khung"]
    ngoai = [e for e in ds_so if e["sua_duoc"] and len(e["chu"].strip()) > 8 and not (e["khung"][0] < x1 and e["khung"][2] > x0 and e["khung"][1] < y1 and e["khung"][3] > y0)]
    if ngoai:
        r = tmp / f"{ten}_chung.pdf"
        try:
            doi_tuong_pdf.ap_sua(pdf, r, sua_dong=[{"trang": so, "dong_id": ngoai[0]["dong_id"], "chu_moi": "CHUNG SUA"}],
                                 sua_doi_tuong=[{"trang": so, "id": d["id"], "viec": {"loai": "doi", "dx": 20, "dy": 0}}])
            kiem(f"{ten}: sửa chữ + dời đối tượng cùng trang trong một lần lưu", any(e["chu"].startswith("CHUNG SUA") for e in chu_pdf.ds_dong(r, so)))
        except LoiChu as e:
            kiem(f"{ten}: sửa chữ + dời đối tượng cùng trang", False, str(e))


KET_QUA_THOI_GIAN = []


def main():
    log = []
    with tempfile.TemporaryDirectory(prefix="kt-doi-tuong-") as t:
        tmp = Path(t)
        for ham in (lambda: thu_tu_tao(tmp, log),) + tuple((lambda n=n: file_that(n, tmp, log)) for n in FILE_THU):
            try:
                ham()
            except Exception:
                kiem("không ném lỗi bất ngờ", False, traceback.format_exc()[-600:])
        if log:
            print("\nCâu báo lỗi người dùng sẽ thấy:")
            for ten, m in log:
                print(f"  - {m}")
    n_dat = sum(1 for _, ok, _ in KET_QUA if ok)
    print(f"\n{n_dat}/{len(KET_QUA)} đạt")
    sys.exit(0 if n_dat == len(KET_QUA) else 1)


if __name__ == "__main__":
    main()
