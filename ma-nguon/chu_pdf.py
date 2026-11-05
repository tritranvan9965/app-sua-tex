"""Chữ thật trong PDF: (A) thêm chữ có phông, cỡ, màu, đậm, nghiêng, gạch chân; (B) tìm và sửa dòng chữ có sẵn như Foxit "Edit Text".

Tọa độ giao diện: điểm (x, y) tính bằng pt, gốc ở góc trên-trái của trang ĐANG NHÌN THẤY (đã tính /Rotate), giống chú thích hiện tại.

Cách làm, để phần không sửa giữ nguyên từng byte:
- Chữ thêm vào là các content stream riêng nối vào cuối trang (mỗi mục một stream, có khóa /SuaTexChuId), kèm một mảng
  /SuaTexChu trong trang giữ thuộc tính (id, nội dung, phông, cỡ, màu...) để đọc lại và sửa. Bỏ một mục là bỏ stream đó.
- Sửa chữ có sẵn: pdfium chỉ dùng để tìm đối tượng chữ (vị trí, phông, cỡ, màu). Việc xóa làm trên content stream bằng pikepdf,
  chỉ thay đúng các lệnh hiện chữ của dòng đó. Không dùng FPDFPage_GenerateContent vì nó viết lại cả trang.
- Mọi lần ghi đều dựng ảnh trang trước/sau bằng pdfium và so: ngoài vùng sửa phải giống nhau, nếu không thì hủy, không ghi file."""
import ctypes
import os
from io import BytesIO
import re
import secrets
from pathlib import Path

import pikepdf
from pikepdf import Array, Dictionary, Name, String

import phong_chu
from phong_chu import LoiChu

KHOA_ID = "/SuaTexChuId"
KHOA_BAO_VE = "/SuaTexBaoVe"
KHOA_MANG = "/SuaTexChu"
CO_MAC_DINH = 12.0
GIAN_DONG_MAC_DINH = 1.3  # bằng giãn dòng của hộp chữ hiện tại (CO_CHU * 1.3)
GOC_NGHIENG = 0.2126  # tan 12 độ, để giả lập chữ nghiêng
DO_DAM_GIA = 0.035  # nét viền (theo cỡ chữ) để giả lập chữ đậm


# ---------- Hình học ----------

def _nhan(a, b):
    """Áp a rồi áp b (ma trận PDF [a b c d e f], vectơ hàng)."""
    return (a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
            a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5])


def _diem(m, x, y):
    return x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]


def _thuoc_tinh_ke_thua(trang, ten, mac_dinh=None):
    o = trang.obj
    while o is not None:
        if ten in o:
            return o[ten]
        o = o.get("/Parent")
    return mac_dinh


def _hop(trang):
    return [float(v) for v in (_thuoc_tinh_ke_thua(trang, "/CropBox") or _thuoc_tinh_ke_thua(trang, "/MediaBox"))]


def _xoay(trang) -> int:
    return int(_thuoc_tinh_ke_thua(trang, "/Rotate", 0)) % 360


def _ban_do(hop, r):
    """(đổi từ tọa độ nhìn thấy (x, y xuống) sang tọa độ trang gốc, đổi ngược lại). Cùng công thức với cong_cu_pdf._them_ghi_chu."""
    x0, y0, x1, y1 = hop
    xuoi = {0: lambda x, y: (x0 + x, y1 - y), 90: lambda x, y: (x0 + y, y0 + x),
            180: lambda x, y: (x1 - x, y0 + y), 270: lambda x, y: (x1 - y, y1 - x)}[r]
    nguoc = {0: lambda X, Y: (X - x0, y1 - Y), 90: lambda X, Y: (Y - y0, X - x0),
             180: lambda X, Y: (x1 - X, Y - y0), 270: lambda X, Y: (y1 - Y, x1 - X)}[r]
    return xuoi, nguoc


def _mau_rgb(mau: str):
    m = re.fullmatch(r"#?([0-9a-fA-F]{6})", (mau or "#000000").strip())
    if not m:
        raise LoiChu(f"Màu chữ '{mau}' không đúng dạng #rrggbb.")
    h = m.group(1)
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def _so(v: float) -> str:
    s = f"{v:.4f}".rstrip("0").rstrip(".")
    return "0" if s in ("", "-0") else s


def _hex_mau(r, g, b) -> str:
    return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))


# ---------- Content stream của trang ----------

def _ds_luong(trang) -> list:
    c = trang.obj.get("/Contents")
    if c is None:
        return []
    if isinstance(c, pikepdf.Array):
        return list(c)
    return [c]


def _co_bao_ve(trang) -> bool:
    return any(KHOA_BAO_VE in s for s in _ds_luong(trang))


def _dam_bao_bao_ve(pdf, trang) -> None:
    """Bọc nội dung gốc trong q ... Q để trạng thái đồ họa còn sót lại của trang không ảnh hưởng chữ nối thêm."""
    if _co_bao_ve(trang):
        return
    dau = pdf.make_stream(b"q\n")
    dau[KHOA_BAO_VE] = True
    cuoi = pdf.make_stream(b"\nQ\n")
    cuoi[KHOA_BAO_VE] = True
    trang.obj.Contents = Array([dau, *_ds_luong(trang), cuoi])


def _them_luong(pdf, trang, du_lieu: bytes, id_: str) -> None:
    s = pdf.make_stream(du_lieu)
    s[KHOA_ID] = String(id_)
    trang.obj.Contents = Array([*_ds_luong(trang), s])


def _ten_phong_trong(du_lieu: bytes) -> set:
    return {t.decode("latin1") for t in re.findall(rb"/(SuaTexF[A-Za-z0-9_]+)\s", du_lieu)}


def _go_luong(trang, ids) -> list:
    """Bỏ các stream chữ đã thêm có id nằm trong ids; trả các id đã bỏ. Phông của chúng cũng bỏ khỏi tài nguyên trang."""
    ids = set(ids)
    giu, da_bo, ten_phong = [], [], set()
    for s in _ds_luong(trang):
        if KHOA_ID in s and str(s[KHOA_ID]) in ids:
            da_bo.append(str(s[KHOA_ID]))
            ten_phong |= _ten_phong_trong(s.read_bytes())
        else:
            giu.append(s)
    if da_bo:
        trang.obj.Contents = Array(giu)
        phong = trang.obj.get("/Resources", {}).get("/Font")
        for t in ten_phong:
            if phong is not None and "/" + t in phong:
                del phong["/" + t]
        mang = trang.obj.get(KHOA_MANG)
        if mang is not None:
            trang.obj[KHOA_MANG] = Array([m for m in mang if str(m.get("/Id")) not in da_bo])
    return da_bo


# ---------- (A) Thêm chữ ----------

def _chuan_hoa_muc(m: dict) -> dict:
    chu = str(m.get("chu", "")).replace("\r\n", "\n").replace("\r", "\n")
    return {"id": m.get("id") or secrets.token_hex(6), "x": float(m["x"]), "y": float(m["y"]), "chu": chu,
            "phong": m.get("phong") or "Times New Roman", "co": float(m.get("co") or CO_MAC_DINH),
            "mau": m.get("mau") or "#000000", "dam": bool(m.get("dam")), "nghieng": bool(m.get("nghieng")),
            "gach_chan": bool(m.get("gach_chan")), "gian_dong": float(m.get("gian_dong") or GIAN_DONG_MAC_DINH)}


def _noi_dung_chu(pdf, trang, m: dict, hop, r) -> tuple:
    """Dựng content stream của một mục chữ. Trả (bytes, meta, thông tin phông dùng)."""
    xuoi, nguoc = _ban_do(hop, r)
    dong = m["chu"].split("\n")
    mat = phong_chu.tim_phong(m["phong"], m["dam"], m["nghieng"])
    if not mat:
        raise LoiChu(f"Máy không có phông {m['phong']}.")
    ph = phong_chu.PhongPdf(pdf, mat, set(m["chu"]))
    if ph.thieu:
        raise LoiChu(f"Phông {mat['ho']} không có ký tự: {''.join(sorted(ph.thieu))}")
    ten = trang.add_resource(ph.obj, Name.Font, prefix="SuaTexF")
    co = m["co"]
    cach_dong = co * m["gian_dong"]
    mau = _mau_rgb(m["mau"])
    o = xuoi(0, 0)
    ex = (xuoi(1, 0)[0] - o[0], xuoi(1, 0)[1] - o[1])
    ey = (xuoi(0, 1)[0] - o[0], xuoi(0, 1)[1] - o[1])
    ten_s = str(ten).lstrip("/")
    ra = [f"/SuaTexChu <</Id ({m['id']})>> BDC"]
    rong_max = 0.0
    for k, d in enumerate(dong):
        w = ph.rong(d) * co
        rong_max = max(rong_max, w)
        if not d.strip():
            continue
        yb = m["y"] + ph.asc * co + k * cach_dong
        goc = xuoi(m["x"], yb)
        # Hệ cục bộ: x theo hướng chữ, y hướng lên; gốc ở đầu đường cơ sở.
        ra.append(f"q {_so(ex[0])} {_so(ex[1])} {_so(-ey[0])} {_so(-ey[1])} {_so(goc[0])} {_so(goc[1])} cm")
        ra.append(f"{_so(mau[0])} {_so(mau[1])} {_so(mau[2])} rg {_so(mau[0])} {_so(mau[1])} {_so(mau[2])} RG")
        gia_dam = mat["dam_gia"]
        if gia_dam:
            ra.append(f"2 Tr {_so(co * DO_DAM_GIA)} w")
        xien = GOC_NGHIENG if mat["nghieng_gia"] else 0
        ra.append(f"BT /{ten_s} {_so(co)} Tf 1 0 {_so(xien)} 1 0 0 Tm <{ph.ma_hoa(d).hex().upper()}> Tj ET")
        if m["gach_chan"] and w > 0:
            day = max(co * 0.05, 0.4)
            ra.append(f"{_so(0)} {_so(-co * 0.12 - day / 2)} {_so(w)} {_so(day)} re f")
        ra.append("Q")
    ra.append("EMC")
    tren_trai = (m["x"], m["y"])
    cao = len(dong) * cach_dong
    u = xuoi(*tren_trai)
    meta = Dictionary(Id=String(m["id"]), Chu=String(m["chu"]), Phong=String(m["phong"]), PhongDung=String(mat["ho"]), Co=m["co"],
                      Mau=String(m["mau"]), Dam=m["dam"], Nghieng=m["nghieng"], GachChan=m["gach_chan"], GianDong=m["gian_dong"],
                      ToaDo=Array([u[0], u[1]]), Xoay=r, Rong=rong_max, Cao=cao)
    return ("\n".join(ra) + "\n").encode("latin1"), meta, {"phong_dung": mat["ho"], "dam_gia": mat["dam_gia"], "nghieng_gia": mat["nghieng_gia"]}


def ap_dung_vao_trang(pdf, trang, them=(), xoa=(), r: int = None) -> list:
    """Thêm các mục chữ `them` vào trang pikepdf và bỏ các mục có id trong `xoa`. r là góc xoay hiện tại của trang (mặc định lấy /Rotate).
    Dùng cho cả them_chu() và cong_cu_pdf.ghep(). Trả thông tin từng mục đã thêm."""
    ra = []
    if xoa:
        _go_luong(trang, xoa)
    if not them:
        return ra
    r = _xoay(trang) if r is None else r % 360
    hop = _hop(trang)
    _dam_bao_bao_ve(pdf, trang)
    for t in them:
        m = _chuan_hoa_muc(t)
        _go_luong(trang, [m["id"]])  # cùng id thì thay thế
        if not m["chu"].strip():
            continue
        nd, meta, tt = _noi_dung_chu(pdf, trang, m, hop, r)
        _them_luong(pdf, trang, nd, m["id"])
        mang = trang.obj.get(KHOA_MANG)
        trang.obj[KHOA_MANG] = Array([*(mang or []), pdf.make_indirect(meta)])
        ra.append({"id": m["id"], **tt})
    return ra


def _mo_pdf(duong):
    try:
        return pikepdf.open(duong)
    except pikepdf.PasswordError:
        raise LoiChu("File PDF có mật khẩu nên app chưa mở được.")
    except pikepdf.PdfError:
        raise LoiChu("Không đọc được file PDF.")


def _mo_ra_an_toan(pdf_vao, pdf_ra) -> Path:
    vao, ra = Path(pdf_vao).resolve(), Path(pdf_ra).resolve()
    if vao == ra:
        raise LoiChu("Không ghi đè file gốc. Chọn tên file khác để lưu.")
    return ra


def _luu_an_toan(pdf, ra: Path, kiem_tra=None) -> None:
    """Ghi file tạm, kiểm tra, rồi mới đổi tên. Lỗi giữa chừng không để lại file hỏng."""
    tam = ra.with_name(ra.name + ".tam-chu")
    ra.parent.mkdir(parents=True, exist_ok=True)
    try:
        pdf.save(tam)
        if kiem_tra:
            kiem_tra(tam)
        os.replace(tam, ra)
    finally:
        tam.unlink(missing_ok=True)


def them_chu(pdf_vao, pdf_ra, ds: list, kiem_tra: bool = True) -> dict:
    """ds = [{trang (từ 1), x, y, chu, phong, co, mau, dam, nghieng, gach_chan, gian_dong, id?}]. Ghi ra pdf_ra, không đụng pdf_vao."""
    ra = _mo_ra_an_toan(pdf_vao, pdf_ra)
    ket_qua, vung = [], {}
    try:
        with _mo_pdf(pdf_vao) as pdf:
            for t in ds:
                so = int(t["trang"])
                if not 1 <= so <= len(pdf.pages):
                    raise LoiChu(f"File không có trang {so}.")
                tr = pdf.pages[so - 1]
                tt = ap_dung_vao_trang(pdf, tr, [t])
                for x in tt:
                    ket_qua.append({"trang": so, **x})
                m = _chuan_hoa_muc(t)
                vung.setdefault(so, []).append((m["x"] - 2, m["y"] - 2, m["x"] + len(m["chu"]) * m["co"] * 1.2 + 2,
                                                m["y"] + (m["chu"].count("\n") + 1) * m["co"] * m["gian_dong"] + 2))
            kt = (lambda tam: _so_anh(pdf_vao, tam, vung)) if kiem_tra else None
            _luu_an_toan(pdf, ra, kt)
    except pikepdf.PdfError as e:
        raise LoiChu(f"Không ghi được PDF: {e}")
    return {"duong": str(ra), "ds": ket_qua}


def doc_chu_da_them(pdf) -> list:
    """Danh sách chữ đã thêm bằng app trong file (mọi trang). x, y là góc trên-trái hộp chữ theo trang đang nhìn thấy."""
    ra = []
    with _mo_pdf(pdf) as p:
        for so, tr in enumerate(p.pages, 1):
            mang = tr.obj.get(KHOA_MANG)
            if not mang:
                continue
            hop, r = _hop(tr), _xoay(tr)
            _, nguoc = _ban_do(hop, r)
            con_ids = {str(s[KHOA_ID]) for s in _ds_luong(tr) if KHOA_ID in s}
            for m in mang:
                if str(m.get("/Id")) not in con_ids:
                    continue
                x, y = nguoc(float(m.ToaDo[0]), float(m.ToaDo[1]))
                lech = (r - int(m.get("/Xoay", r))) % 360
                ra.append({"id": str(m.Id), "trang": so, "x": x, "y": y, "chu": str(m.Chu), "phong": str(m.Phong), "phong_dung": str(m.get("/PhongDung", m.Phong)),
                           "co": float(m.Co), "mau": str(m.Mau), "dam": bool(m.Dam), "nghieng": bool(m.Nghieng), "gach_chan": bool(m.GachChan),
                           "gian_dong": float(m.GianDong), "rong": float(m.Rong), "cao": float(m.Cao), "xoay_chu": lech})
    return ra


def ban_xem_khong_chu_da_them(pdf) -> tuple:
    """(ds, bytes): ds = chữ đã thêm bằng app còn sửa được (không bị xoay lệch so với trang), bytes = nội dung file đã bỏ những chữ đó
    (để trình xem chỉ vẽ chữ một lần, phần còn lại do lớp chú thích vẽ). bytes = None nếu file không có chữ nào như vậy."""
    ds = [c for c in doc_chu_da_them(pdf) if not c["xoay_chu"]]
    if not ds:
        return [], None
    ids = {c["id"] for c in ds}
    with _mo_pdf(pdf) as p:
        for tr in p.pages:
            _go_luong(tr, ids)
        bo = BytesIO()
        p.save(bo)
    return ds, bo.getvalue()


def xoa_chu_da_them(pdf_vao, pdf_ra, ids: list, kiem_tra: bool = True) -> dict:
    ra = _mo_ra_an_toan(pdf_vao, pdf_ra)
    ids = set(ids)
    da_xoa = []
    vung = {}
    with _mo_pdf(pdf_vao) as pdf:
        for so, tr in enumerate(pdf.pages, 1):
            for m in (tr.obj.get(KHOA_MANG) or []):
                if str(m.get("/Id")) in ids:
                    _, nguoc = _ban_do(_hop(tr), _xoay(tr))
                    x, y = nguoc(float(m.ToaDo[0]), float(m.ToaDo[1]))
                    vung.setdefault(so, []).append((x - 2, y - 2, x + float(m.Rong) + 2, y + float(m.Cao) + 2))
            da_xoa += _go_luong(tr, ids)
        if len(da_xoa) != len(ids):
            raise LoiChu("Không tìm thấy chữ cần xóa trong file.")
        kt = (lambda tam: _so_anh(pdf_vao, tam, vung)) if kiem_tra else None
        _luu_an_toan(pdf, ra, kt)
    return {"duong": str(ra), "da_xoa": da_xoa}


def sua_chu_da_them(pdf_vao, pdf_ra, id_: str, thuoc_tinh: dict, kiem_tra: bool = True) -> dict:
    """Đổi nội dung/vị trí/kiểu của một chữ đã thêm (kéo di chuyển = đổi x, y). thuoc_tinh chỉ cần các trường đổi."""
    cu = next((c for c in doc_chu_da_them(pdf_vao) if c["id"] == id_), None)
    if not cu:
        raise LoiChu("Không tìm thấy chữ cần sửa trong file.")
    moi = {k: cu[k] for k in ("trang", "x", "y", "chu", "phong", "co", "mau", "dam", "nghieng", "gach_chan", "gian_dong")}
    moi.update({k: v for k, v in thuoc_tinh.items() if k != "id"})
    moi["id"] = id_
    ra = _mo_ra_an_toan(pdf_vao, pdf_ra)
    with _mo_pdf(pdf_vao) as pdf:
        tr = pdf.pages[int(cu["trang"]) - 1]
        tt = ap_dung_vao_trang(pdf, tr, [moi], xoa=[id_])
        so = int(cu["trang"])
        m = _chuan_hoa_muc(moi)
        vung = {so: [(cu["x"] - 2, cu["y"] - 2, cu["x"] + cu["rong"] + 2, cu["y"] + cu["cao"] + 2),
                     (m["x"] - 2, m["y"] - 2, m["x"] + max(len(m["chu"]) * m["co"] * 1.2, cu["rong"]) + 2,
                      m["y"] + (m["chu"].count("\n") + 1) * m["co"] * m["gian_dong"] + 2)]}
        kt = (lambda tam: _so_anh(pdf_vao, tam, vung)) if kiem_tra else None
        _luu_an_toan(pdf, ra, kt)
    return {"duong": str(ra), "ds": tt}


# ---------- Kiểm tra ảnh trước/sau ----------

def _so_anh(pdf_truoc, pdf_sau, vung: dict, ti_le: float = 1.3, nguong_diem: int = 40) -> None:
    """Dựng lại các trang có sửa; ngoài các vùng `vung` ({trang: [(x0,y0,x1,y1) nhìn thấy, pt]}) hai ảnh phải gần như trùng.
    Cũng so số trang. Không đạt thì ném LoiChu."""
    import pypdfium2 as pdfium
    from PIL import ImageChops, ImageDraw
    a = pdfium.PdfDocument(str(pdf_truoc))
    b = pdfium.PdfDocument(str(pdf_sau))
    try:
        if len(a) != len(b):
            raise LoiChu("Số trang sau khi sửa khác ban đầu. Đã hủy, không ghi file.")
        for so, ds in vung.items():
            ia = a[so - 1].render(scale=ti_le).to_pil().convert("L")
            ib = b[so - 1].render(scale=ti_le).to_pil().convert("L")
            if ia.size != ib.size:
                raise LoiChu("Kích thước trang đổi sau khi sửa. Đã hủy, không ghi file.")
            for im in (ia, ib):
                v = ImageDraw.Draw(im)
                for x0, y0, x1, y1 in ds:
                    v.rectangle([x0 * ti_le - 3, y0 * ti_le - 3, x1 * ti_le + 3, y1 * ti_le + 3], fill=255)
            kh = ImageChops.difference(ia, ib).point(lambda g: 255 if g > nguong_diem else 0)
            so_diem = kh.histogram()[255]
            if so_diem > 12:
                raise LoiChu(f"Trang {so} bị đổi ngoài vùng sửa ({so_diem} điểm ảnh). Đã hủy, không ghi file.")
    finally:
        a.close()
        b.close()


# ---------- (B) Tìm và sửa chữ có sẵn ----------

def _doc_doi_tuong(trang_pdfium, hop, r) -> list:
    """Các đối tượng chữ của trang theo thứ tự trong content stream (pdfium). Khung và gốc tính theo trang đang nhìn thấy."""
    import pypdfium2.raw as raw
    _, nguoc = _ban_do(hop, r)
    tp = trang_pdfium.get_textpage()
    ra = []
    for j in range(raw.FPDFPage_CountObjects(trang_pdfium.raw)):
        o = raw.FPDFPage_GetObject(trang_pdfium.raw, j)
        if raw.FPDFPageObj_GetType(o) != raw.FPDF_PAGEOBJ_TEXT:
            continue
        L, B, R, T = (ctypes.c_float() for _ in range(4))
        raw.FPDFPageObj_GetBounds(o, L, B, R, T)
        m = raw.FS_MATRIX()
        raw.FPDFPageObj_GetMatrix(o, m)
        font = raw.FPDFTextObj_GetFont(o)
        co = ctypes.c_float()
        raw.FPDFTextObj_GetFontSize(o, co)
        n = raw.FPDFFont_GetBaseFontName(font, None, 0)
        b = ctypes.create_string_buffer(max(n, 1))
        raw.FPDFFont_GetBaseFontName(font, b, n)
        ten = b.value.decode("latin1")
        n = raw.FPDFTextObj_GetText(o, tp.raw, None, 0)
        bt = (ctypes.c_ushort * (n // 2 + 2))()
        raw.FPDFTextObj_GetText(o, tp.raw, bt, n)
        chu = bytes(bt).decode("utf-16le", "ignore").split("\0")[0]
        mr, mg, mb, ma = (ctypes.c_uint() for _ in range(4))
        raw.FPDFPageObj_GetFillColor(o, mr, mg, mb, ma)
        goc = nguoc(m.e, m.f)
        cac_goc = [nguoc(x, y) for x, y in ((L.value, B.value), (R.value, B.value), (L.value, T.value), (R.value, T.value))]
        xs, ys = [p[0] for p in cac_goc], [p[1] for p in cac_goc]
        ten_sach = ten.split("+", 1)[-1]
        ra.append({"k": len(ra), "j": j, "khung": (min(xs), min(ys), max(xs), max(ys)), "goc": goc, "m": (m.a, m.b, m.c, m.d, m.e, m.f),
                   "co": co.value, "ten": ten, "ten_sach": ten_sach, "chu": chu, "mau": (mr.value / 255, mg.value / 255, mb.value / 255),
                   "tap_con": bool(re.match(r"^[A-Z]{6}\+", ten)), "nhung": bool(raw.FPDFFont_GetIsEmbedded(font)),
                   "dam": bool(re.search(r"bold|black|heavy|semibold|demi|cmbx|-bd\b", ten_sach, re.I)) or raw.FPDFFont_GetWeight(font) >= 600,
                   "nghieng": bool(re.search(r"italic|oblique|ital\b|slanted|cmti|cmsl|-it\b", ten_sach, re.I))})
    return ra


def _mo_pdfium(pdf, so_trang: int):
    import pypdfium2 as pdfium
    try:
        d = pdfium.PdfDocument(str(pdf))
    except pdfium.PdfiumError:
        raise LoiChu("Không đọc được file PDF.")
    if not 1 <= so_trang <= len(d):
        d.close()
        raise LoiChu(f"File không có trang {so_trang}.")
    return d, d[so_trang - 1]


def _luong_chu_da_them(trang) -> list:
    """[(id, số dòng chữ)] của các stream chữ đã thêm, theo thứ tự trong trang. Mỗi dòng có đúng một lệnh Tj."""
    return [(str(s[KHOA_ID]), s.read_bytes().count(b" Tj ")) for s in _ds_luong(trang) if KHOA_ID in s]


def tim_dong(pdf, trang: int, x: float, y: float, dung_sai: float = 1.5):
    """Dòng chữ ở điểm bấm (x, y) trên trang đang nhìn thấy, pt gốc trên-trái. Trả None nếu không có chữ ở đó.
    'Dòng' là đoạn chữ liền nhau cùng đường cơ sở, cùng phông và cỡ: công thức, chữ đậm/nghiêng ở giữa câu cắt đoạn ra."""
    with _mo_pdf(pdf) as k:
        if not 1 <= trang <= len(k.pages):
            raise LoiChu(f"File không có trang {trang}.")
        tr = k.pages[trang - 1]
        hop, r = _hop(tr), _xoay(tr)
        da_them = _luong_chu_da_them(tr)
    d, pg = _mo_pdfium(pdf, trang)
    try:
        ds = _doc_doi_tuong(pg, hop, r)
    finally:
        d.close()
    n_chinh = len(ds) - sum(n for _, n in da_them)  # chữ thêm bằng app luôn nằm sau cùng
    co_chu = [o for o in ds if o["khung"][2] - o["khung"][0] > 0.01 and o["chu"].strip()]
    trung = [o for o in co_chu if o["khung"][0] - dung_sai <= x <= o["khung"][2] + dung_sai and o["khung"][1] - dung_sai <= y <= o["khung"][3] + dung_sai]
    if not trung:
        return None
    goc = min(trung, key=lambda o: (o["k"] < n_chinh, (o["khung"][2] - o["khung"][0]) * (o["khung"][3] - o["khung"][1])))  # chữ thêm nằm trên nên ưu tiên
    if goc["k"] >= n_chinh:
        dau = n_chinh
        for id_, so in da_them:
            if dau <= goc["k"] < dau + so:
                return {"loai": "chu-da-them", "id_chu_da_them": id_, "chu": goc["chu"], "khung": list(goc["khung"])}
            dau += so
    co = goc["co"]
    cung = sorted((o for o in ds[:n_chinh] if o["ten"] == goc["ten"] and abs(o["co"] - co) < 0.05 and abs(o["goc"][1] - goc["goc"][1]) <= 0.12 * co),
                  key=lambda o: o["goc"][0])
    i = next(i for i, o in enumerate(cung) if o["k"] == goc["k"])
    a = b = i
    while a > 0 and cung[a]["khung"][0] - cung[a - 1]["khung"][2] <= 0.9 * co:
        a -= 1
    while b < len(cung) - 1 and cung[b + 1]["khung"][0] - cung[b]["khung"][2] <= 0.9 * co:
        b += 1
    nhom = cung[a:b + 1]
    chu, mep_phai = "", None
    for o in nhom:
        if chu and o["chu"].strip() and not chu[-1].isspace() and not o["chu"][0].isspace() and o["khung"][0] - mep_phai > 0.12 * co:
            chu += " "
        chu += o["chu"]
        if o["chu"].strip():
            mep_phai = o["khung"][2]
    kh = [min(o["khung"][0] for o in nhom), min(o["khung"][1] for o in nhom), max(o["khung"][2] for o in nhom), max(o["khung"][3] for o in nhom)]
    return {"loai": "chu-co-san", "id": f"{trang}:" + ".".join(str(o["k"]) for o in nhom), "chu": chu, "khung": kh,
            "phong": goc["ten"], "phong_sach": goc["ten_sach"], "co": co, "mau": _hex_mau(*goc["mau"]), "tap_con": goc["tap_con"],
            "nhung": goc["nhung"], "dam": goc["dam"], "nghieng": goc["nghieng"],
            "doi_tuong": [{"chi_so": o["k"], "chu": o["chu"], "khung": list(o["khung"])} for o in nhom]}


# --- Đọc content stream: tìm lệnh hiện chữ ---

class _TTPhong:
    """Độ rộng ký tự và số byte một mã của phông trong trang; rong_ma(mã) tính theo 1/1000 em, None nếu không đọc được."""

    def __init__(self, f):
        self.f = f
        self.loai = str(f.get("/Subtype", ""))
        self.nb, self.rong_ma = 1, None
        if self.loai == "/Type0":
            enc = f.get("/Encoding")
            self.nb = 2 if isinstance(enc, Name) and str(enc) in ("/Identity-H", "/Identity-V") else None
            d = f.DescendantFonts[0]
            dw, W = float(d.get("/DW", 1000)), {}
            w = d.get("/W")
            ds = list(w) if w is not None else []
            i = 0
            while i < len(ds):
                c, nxt = int(ds[i]), ds[i + 1]
                if isinstance(nxt, Array):
                    for j, v in enumerate(nxt):
                        W[c + j] = float(v)
                    i += 2
                else:
                    for cc in range(c, int(nxt) + 1):
                        W[cc] = float(ds[i + 2])
                    i += 3
            self.rong_ma = lambda code: W.get(code, dw)
        else:
            ws = f.get("/Widths")
            if ws is not None:
                dau = int(f.get("/FirstChar", 0))
                mo = f.get("/FontDescriptor")
                thieu = float(mo.get("/MissingWidth", 0)) if mo is not None else 0.0
                he = 1000 * float(f.FontMatrix[0]) if self.loai == "/Type3" and "/FontMatrix" in f else 1.0
                ds = [float(v) for v in ws]
                self.rong_ma = lambda code: (ds[code - dau] if 0 <= code - dau < len(ds) else thieu) * he


def _tien(tt, phan, fs, tc, tw, tz):
    """Độ dời ngang (đơn vị không gian chữ) của một lệnh hiện chữ, None nếu không đo được."""
    if tt is None or tt.rong_ma is None or tt.nb is None:
        return None
    tx = 0.0
    for p in phan:
        if isinstance(p, float):
            tx += -p / 1000 * fs * tz / 100
        else:
            for i in range(0, len(p), tt.nb):
                ma = int.from_bytes(p[i:i + tt.nb], "big")
                tx += (tt.rong_ma(ma) / 1000 * fs + tc + (tw if tt.nb == 1 and ma == 32 else 0)) * tz / 100
    return tx


def _phan_chuoi(lenh):
    o, a = str(lenh.operator), lenh.operands
    if o == "TJ":
        return [bytes(x) if isinstance(x, pikepdf.String) else float(x) for x in a[0]]
    return [bytes(a[-1])]


def _quet_lenh(ds_lenh, phong_trang) -> list:
    """Duyệt các lệnh, ghi lại từng lệnh hiện chữ (Tj, TJ, ', \") kèm trạng thái chữ và ma trận. Không đọc vào XObject."""
    I = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
    gs = {"tc": 0.0, "tw": 0.0, "tz": 100.0, "tl": 0.0, "tf": None, "fs": 0.0}
    ctm, stack, tm, tlm = I, [], I, I
    biet, da_hien = True, False
    cache_tt, ra = {}, []
    for i, l in enumerate(ds_lenh):
        o = str(getattr(l, "operator", ""))
        a = getattr(l, "operands", [])
        try:
            if o == "q":
                stack.append((ctm, dict(gs)))
            elif o == "Q":
                if stack:
                    ctm, gs = stack.pop()
            elif o == "cm":
                ctm = _nhan(tuple(float(v) for v in a), ctm)
            elif o == "BT":
                tm = tlm = I
                biet, da_hien = True, False
            elif o == "ET":
                da_hien = False
            elif o in ("Tc", "Tw", "Tz", "TL"):
                gs[o.lower()] = float(a[0])
            elif o == "Tf":
                gs["tf"], gs["fs"] = str(a[0]), float(a[1])
            elif o in ("Td", "TD"):
                if o == "TD":
                    gs["tl"] = -float(a[1])
                tlm = _nhan((1, 0, 0, 1, float(a[0]), float(a[1])), tlm)
                tm, biet, da_hien = tlm, True, False
            elif o == "Tm":
                tm = tlm = tuple(float(v) for v in a)
                biet, da_hien = True, False
            elif o in ("T*", "'", '"'):
                if o == '"':
                    gs["tw"], gs["tc"] = float(a[0]), float(a[1])
                tlm = _nhan((1, 0, 0, 1, 0, -gs["tl"]), tlm)
                tm, biet = tlm, True
                da_hien = False
            if o in ("Tj", "TJ", "'", '"'):
                phan = _phan_chuoi(l)
                ten = gs["tf"]
                if ten not in cache_tt:
                    f = phong_trang.get(ten) if phong_trang is not None else None
                    cache_tt[ten] = _TTPhong(f) if f is not None else None
                adv = _tien(cache_tt[ten], phan, gs["fs"], gs["tc"], gs["tw"], gs["tz"])
                goc = _diem(ctm, tm[4], tm[5]) if biet else None
                ra.append({"i": i, "op": o, "phan": phan, "co_chu": any(isinstance(p, bytes) and p for p in phan), "font": ten, "fs": gs["fs"],
                           "tc": gs["tc"], "tw": gs["tw"], "tz": gs["tz"], "ctm": ctm, "tm": tm, "goc": goc, "adv": adv,
                           "noi_tiep": da_hien and o in ("Tj", "TJ")})
                if adv is None:
                    biet = False
                else:
                    tm = _nhan((1, 0, 0, 1, adv, 0), tm)
                da_hien = True
        except (ValueError, TypeError, IndexError, AttributeError):
            raise LoiChu("Nội dung trang có lệnh chữ lạ, app chưa sửa được trang này.")
    return ra


def _lenh(ten, *toan_hang):
    return pikepdf.ContentStreamInstruction(list(toan_hang), pikepdf.Operator(ten))


def _thay_lenh(rec, can_tien: bool) -> list:
    """Lệnh thay cho một lệnh hiện chữ bị xóa: giữ phần dịch chuyển (T*, Tw, Tc) và độ dời ngang nếu chữ sau còn dựa vào đó."""
    ra = []
    if rec["op"] == '"':
        ra += [_lenh("Tw", rec["tw"]), _lenh("Tc", rec["tc"])]
    if rec["op"] in ("'", '"'):
        ra.append(_lenh("T*"))
    if can_tien:
        if rec["adv"] is None:
            raise LoiChu("Không đo được độ rộng chữ cũ nên không xóa gọn được dòng này.")
        if rec["fs"] * rec["tz"] == 0:
            raise LoiChu("Cỡ chữ bằng 0, không sửa được dòng này.")
        ra.append(_lenh("TJ", Array([-rec["adv"] * 1000 / (rec["fs"] * rec["tz"] / 100)])))
    return ra


# --- Chọn phông cho chữ mới ---

def _chuan(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _ung_vien_phong(ten_goc: str) -> list:
    """Danh sách họ phông máy nên thử, từ gần giống nhất đến an toàn nhất."""
    t = _chuan(ten_goc.split("+", 1)[-1])
    ra = []
    ho_co = {_chuan(m["ho"]): m["ho"] for m in phong_chu.danh_muc() if m["du_dau"]}
    khop = [ho for chuan, ho in ho_co.items() if len(chuan) >= 4 and t.startswith(chuan)]
    if khop:
        ra.append(max(khop, key=len))
    if re.search(r"mono|courier|consol|cmtt|typewriter|menlo|monaco|sourcecode|jetbrains", t):
        ra += ["Consolas", "Courier New"]
    elif re.search(r"cmss|lmsans|arial|helvet|calibri|segoe|verdana|tahoma|trebuchet|sans|gothic|myriad|roboto|opensans|inter|vietnam|dejavusans", t):
        ra += ["Arial", "Segoe UI", "Calibri"]
    elif re.search(r"^(cm|lm)|latinmodern|cmu|computermodern|texgyre|stix|xits|newcm", t):
        ra += ["Latin Modern Roman", "CMU Serif", "Cambria", "Times New Roman"]
    else:
        ra += ["Times New Roman", "Cambria", "Palatino Linotype"]
    ra += ["Times New Roman", "Arial"]
    thay = []
    for h in ra:
        if h not in thay:
            thay.append(h)
    return thay


def _doc_tounicode(f):
    tu = f.get("/ToUnicode")
    if tu is None:
        return None
    s = tu.read_bytes().decode("latin1")
    m = {}

    def chu(h):
        return bytes.fromhex(h).decode("utf-16-be", "replace")
    for blk in re.findall(r"beginbfchar(.*?)endbfchar", s, re.S):
        for a, b in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", blk):
            m[int(a, 16)] = chu(b)
    for blk in re.findall(r"beginbfrange(.*?)endbfrange", s, re.S):
        for lo, hi, ds in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]+>|\[[^\]]*\])", blk):
            lo, hi = int(lo, 16), int(hi, 16)
            if ds.startswith("<"):
                dau = chu(ds[1:-1])
                for c in range(lo, min(hi, lo + 70000) + 1):
                    m[c] = dau[:-1] + chr(ord(dau[-1]) + c - lo)
            else:
                for i, h in enumerate(re.findall(r"<([0-9A-Fa-f]+)>", ds)):
                    m[lo + i] = chu(h)
    return m


class _PhongGoc:
    """Dùng lại phông đã nhúng trong PDF để viết chữ mới, nếu phông đó có đủ glyph (chỉ khi có ToUnicode để biết mã nào là ký tự nào)."""

    def __init__(self, f):
        self.tt = _TTPhong(f)
        sub = str(f.get("/Subtype", ""))
        mo = f.DescendantFonts[0].get("/FontDescriptor") if sub == "/Type0" else f.get("/FontDescriptor")
        nhung = mo is not None and any(k in mo for k in ("/FontFile", "/FontFile2", "/FontFile3"))
        tu = _doc_tounicode(f)
        self.dung_duoc = bool(nhung and tu and self.tt.nb and self.tt.rong_ma)
        self.nguoc = {}
        if self.dung_duoc:
            for ma, c in tu.items():
                if len(c) == 1 and c not in self.nguoc and self.tt.rong_ma(ma) > 0:
                    self.nguoc[c] = ma

    def thieu(self, chu: str) -> set:
        return {c for c in chu if c not in self.nguoc and not c.isspace()}

    def ma_hoa(self, c: str) -> bytes:
        return self.nguoc[c].to_bytes(self.tt.nb, "big")

    def rong1000(self, c: str) -> float:
        if c in self.nguoc:
            return self.tt.rong_ma(self.nguoc[c])
        return 250.0  # dấu cách LaTeX thường không nằm trong tập con nên bù bằng khoảng dịch


def _dung_tj(chu: str, ma_hoa, rong1000, ma_cach, them_moi_cach: float) -> tuple:
    """Mảng TJ cho chuỗi chữ mới. Dấu cách là mã thật (nếu phông có) hoặc khoảng dịch; them_moi_cach (1/1000 em) cộng vào mỗi dấu cách.
    Trả (mảng TJ dạng chuỗi, độ rộng theo 1/1000 em)."""
    ra, hien, rong = [], b"", 0.0
    for c in chu:
        if c == " ":
            rong += rong1000(" ") + them_moi_cach
            if ma_cach is not None:
                hien += ma_cach
                if them_moi_cach:
                    ra.append("<" + hien.hex().upper() + ">")
                    ra.append(_so(-them_moi_cach))
                    hien = b""
            else:
                if hien:
                    ra.append("<" + hien.hex().upper() + ">")
                    hien = b""
                ra.append(_so(-(rong1000(" ") + them_moi_cach)))
        else:
            hien += ma_hoa(c)
            rong += rong1000(c)
    if hien:
        ra.append("<" + hien.hex().upper() + ">")
    return "[" + " ".join(ra) + "]", rong


def _cat_tuyen_tinh(he) -> float:
    return abs(he[0] * he[3] - he[1] * he[2]) ** 0.5


def _khoi_chu_moi(pdf, tr, ops_chu, ks, ds, chu_moi, tt_in, giu_do_rong, phong_trang, tt) -> tuple:
    """Dựng đoạn content stream cho chữ mới. Trả (bytes, thông tin phông, khung nhìn thấy để so ảnh)."""
    dau, go, cuoi = ops_chu[ks[0]], ds[ks[0]], ds[ks[-1]]
    fs0 = dau["fs"]
    he = _nhan(dau["tm"][:4] + (0, 0), dau["ctm"][:4] + (0, 0))[:4]  # phần tuyến tính chữ -> trang (bỏ tịnh tiến)
    scale = _cat_tuyen_tinh(he)
    e, f = go["m"][4], go["m"][5]
    co_moi = fs0 * (float(tt_in["co"]) / go["co"] if tt_in.get("co") and go["co"] else 1.0)
    mau = _mau_rgb(tt_in["mau"]) if tt_in.get("mau") else go["mau"]
    dam = bool(tt_in["dam"]) if "dam" in tt_in else go["dam"]
    nghieng = bool(tt_in["nghieng"]) if "nghieng" in tt_in else go["nghieng"]
    phong_goc = _PhongGoc(phong_trang[dau["font"]]) if phong_trang is not None and dau["font"] in phong_trang else None
    chu_cuoi = ds[ks[-1]]["chu"]
    rong_cu = (cuoi["khung"][2] - go["goc"][0]) / scale if scale and chu_cuoi and not chu_cuoi[-1].isspace() else None
    dung_goc = bool(phong_goc and phong_goc.dung_duoc and not phong_goc.thieu(chu_moi) and not tt_in.get("phong")
                    and dam == go["dam"] and nghieng == go["nghieng"])
    gia_dam = gia_nghieng = False
    if dung_goc:
        ten_pdf = dau["font"]
        r1000, ma_hoa = phong_goc.rong1000, phong_goc.ma_hoa
        ma_cach = phong_goc.ma_hoa(" ") if " " in phong_goc.nguoc else None
        tt.update(phong_dung=go["ten_sach"], dung_lai_phong_goc=True)
    else:
        ph, thieu = None, set()
        for ho in ([tt_in["phong"]] if tt_in.get("phong") else _ung_vien_phong(go["ten"])):
            mat = phong_chu.tim_phong(ho, dam, nghieng)
            if not mat:
                continue
            thu = phong_chu.PhongPdf(pdf, mat, set(chu_moi))
            if not thu.thieu:
                ph = thu
                break
            thieu = thu.thieu
        if ph is None:
            raise LoiChu("Không có phông nào trên máy đủ ký tự: " + "".join(sorted(thieu)) if thieu else "Máy không có phông thay thế phù hợp.")
        ten_pdf = str(tr.add_resource(ph.obj, Name.Font, prefix="SuaTexF"))
        r1000 = lambda c: ph.rong(c) * 1000
        ma_hoa, ma_cach = ph.ma_hoa, ph.ma_hoa(" ")
        gia_dam, gia_nghieng = ph.mat["dam_gia"], ph.mat["nghieng_gia"]
        tt.update(phong_dung=ph.mat["ho"], dung_lai_phong_goc=False, dam_gia=gia_dam, nghieng_gia=gia_nghieng)
    # dàn khoảng cách giữa các từ cho vừa độ rộng cũ (lề đều)
    tj, rong = _dung_tj(chu_moi, ma_hoa, r1000, ma_cach, 0.0)
    n_cach = chu_moi.strip().count(" ")
    thay_doi_kieu = bool(tt_in.get("phong") or tt_in.get("co") or "dam" in tt_in or "nghieng" in tt_in)
    if giu_do_rong and rong_cu and n_cach and not thay_doi_kieu:
        d = (rong_cu - rong / 1000 * co_moi) / n_cach  # đơn vị không gian chữ
        if -0.12 * co_moi <= d <= 0.5 * co_moi:
            tj, rong = _dung_tj(chu_moi, ma_hoa, r1000, ma_cach, d / co_moi * 1000)
    ra = [f"q {_so(he[0])} {_so(he[1])} {_so(he[2])} {_so(he[3])} {_so(e)} {_so(f)} cm",
          f"{_so(mau[0])} {_so(mau[1])} {_so(mau[2])} rg {_so(mau[0])} {_so(mau[1])} {_so(mau[2])} RG"]
    if gia_dam:
        ra.append(f"2 Tr {_so(co_moi * DO_DAM_GIA)} w")
    ra.append(f"BT {ten_pdf} {_so(co_moi)} Tf 1 0 {_so(GOC_NGHIENG if gia_nghieng else 0)} 1 0 0 Tm {tj} TJ ET")
    ra.append("Q")
    w_vis = rong / 1000 * co_moi * scale
    ox, oy = go["goc"]
    kh = (ox - 2, oy - co_moi * scale * 1.05, ox + w_vis + 2, oy + co_moi * scale * 0.35)
    return ("\n".join(ra) + "\n").encode("latin1"), tt, kh


def sua_dong(pdf_vao, pdf_ra, trang: int, dong_id: str, chu_moi: str, thuoc_tinh: dict = None, giu_do_rong: bool = True,
             kiem_tra: bool = True) -> dict:
    """Sửa một dòng do tim_dong() trả về: xóa hẳn các lệnh hiện chữ cũ của dòng, ghi chữ mới ở cùng vị trí, cùng cỡ và màu.
    thuoc_tinh (tùy chọn): phong (họ phông máy), co (cỡ pt), mau (#rrggbb), dam, nghieng; có phong/dam/nghieng khác gốc thì dùng phông máy.
    Dùng lại phông gốc nếu nó nhúng đủ glyph, không thì chọn phông máy gần giống. chu_moi rỗng = xóa dòng.
    Trả {phong_dung, dung_lai_phong_goc, phong_goc, dam_gia, nghieng_gia, khung (chữ mới), khung_cu}."""
    thuoc_tinh = thuoc_tinh or {}
    ra = _mo_ra_an_toan(pdf_vao, pdf_ra)
    m = re.fullmatch(r"(\d+):([\d.]+)", str(dong_id))
    if not m or int(m.group(1)) != int(trang):
        raise LoiChu("Mã dòng không đúng trang.")
    ks = [int(v) for v in m.group(2).split(".")]
    chu_moi = str(chu_moi).replace("\r", "").replace("\n", " ")
    try:
        with _mo_pdf(pdf_vao) as pdf:
            if not 1 <= trang <= len(pdf.pages):
                raise LoiChu(f"File không có trang {trang}.")
            tr = pdf.pages[trang - 1]
            hop, r = _hop(tr), _xoay(tr)
            d, pg = _mo_pdfium(pdf_vao, trang)
            try:
                ds = _doc_doi_tuong(pg, hop, r)
            finally:
                d.close()
            if any(k >= len(ds) for k in ks):
                raise LoiChu("Dòng này không còn trong trang (file đã đổi). Bấm chọn lại dòng.")
            luong_them = [s for s in _ds_luong(tr) if KHOA_ID in s]
            luong_chinh = [s for s in _ds_luong(tr) if KHOA_ID not in s]
            lenh = pikepdf.parse_content_stream(pdf.make_stream(b"\n".join(s.read_bytes() for s in luong_chinh)))
            tl = _thuoc_tinh_ke_thua(tr, "/Resources")
            phong_trang = tl.get("/Font") if tl is not None else None
            ops = _quet_lenh(lenh, phong_trang)
            ops_chu = [o for o in ops if o["co_chu"]]
            n_them = sum(n for _, n in _luong_chu_da_them(tr))
            if len(ops_chu) != len(ds) - n_them:
                raise LoiChu("Trang này có chữ nằm trong khối con (XObject) hoặc cấu trúc lạ, app chưa sửa được chữ ở đây.")
            if any(k >= len(ops_chu) for k in ks):
                raise LoiChu("Đây là chữ đã thêm bằng app, hãy sửa bằng sua_chu_da_them.")
            muc_tieu = [ds[k] for k in ks]
            for k in ks:  # đối chiếu vị trí lệnh đọc từ content stream với vị trí pdfium báo
                g = ops_chu[k]["goc"]
                if g is not None and (abs(g[0] - ds[k]["m"][4]) > 0.6 or abs(g[1] - ds[k]["m"][5]) > 0.6):
                    raise LoiChu("Không khớp được dòng chữ với nội dung trang, đã hủy để khỏi làm hỏng file.")
            vi_tri = {id(o): n for n, o in enumerate(ops)}
            thay = {}
            for n in sorted(vi_tri[id(ops_chu[k])] for k in ks):
                tiep = ops[n + 1]["noi_tiep"] if n + 1 < len(ops) else False
                thay[ops[n]["i"]] = _thay_lenh(ops[n], tiep)
            moi = []
            for i, l in enumerate(lenh):
                moi.extend(thay[i] if i in thay else [l])
            nd_moi = pikepdf.unparse_content_stream(moi)
            hop_dong = (min(o["khung"][0] for o in muc_tieu), min(o["khung"][1] for o in muc_tieu),
                        max(o["khung"][2] for o in muc_tieu), max(o["khung"][3] for o in muc_tieu))
            chu_cu = "".join(o["chu"] for o in muc_tieu)
            vung = [(hop_dong[0] - 2, hop_dong[1] - 2, hop_dong[2] + 2, hop_dong[3] + 2)]
            khoi, tt = b"", {"phong_goc": ds[ks[0]]["ten_sach"], "phong_dung": None, "dung_lai_phong_goc": False, "dam_gia": False, "nghieng_gia": False}
            if chu_moi.strip():
                # giữ khoảng trắng đầu/cuối của chữ cũ (ví dụ "Điều kiện để " còn dấu cách trước công thức)
                if chu_cu[:1].isspace() and not chu_moi[:1].isspace():
                    chu_moi = chu_cu[:len(chu_cu) - len(chu_cu.lstrip())] + chu_moi
                if chu_cu[-1:].isspace() and not chu_moi[-1:].isspace():
                    chu_moi += chu_cu[len(chu_cu.rstrip()):]
                khoi, tt, v2 = _khoi_chu_moi(pdf, tr, ops_chu, ks, ds, chu_moi, thuoc_tinh, giu_do_rong, phong_trang, tt)
                vung.append(v2)
            boc = not _co_bao_ve(tr)
            main = pdf.make_stream((b"q\n" if boc else b"") + nd_moi + (b"\nQ\n" if boc else b"\n") + khoi)
            main[KHOA_BAO_VE] = True
            tr.obj.Contents = Array([main, *luong_them])
            kt = (lambda tam: _so_anh(pdf_vao, tam, {trang: vung})) if kiem_tra else None
            _luu_an_toan(pdf, ra, kt)
    except pikepdf.PdfError as e:
        raise LoiChu(f"Không ghi được PDF: {e}")
    tt["duong"] = str(ra)
    tt["khung"] = list(vung[-1])
    tt["khung_cu"] = list(vung[0])
    return tt


def sua_nhieu_dong(pdf_vao, pdf_ra, ds: list, kiem_tra: bool = True) -> dict:
    """Áp nhiều sửa dòng một lượt: ds = [{trang, dong_id, chu_moi, thuoc_tinh?}]. Mã dòng đều lấy từ file pdf_vao nguyên bản;
    hàm tự đổi số thứ tự khi các dòng trước đó đã bị xóa. Hết thảy thành công mới ghi pdf_ra."""
    import shutil
    import tempfile
    ra = _mo_ra_an_toan(pdf_vao, pdf_ra)
    viec = []
    for d in ds:
        m = re.fullmatch(r"(\d+):([\d.]+)", str(d["dong_id"]))
        if not m or int(m.group(1)) != int(d["trang"]):
            raise LoiChu("Mã dòng không đúng trang.")
        viec.append({**d, "trang": int(d["trang"]), "ks": [int(v) for v in m.group(2).split(".")]})
    viec.sort(key=lambda v: (v["trang"], -max(v["ks"])))
    if len({(v["trang"], k) for v in viec for k in v["ks"]}) != sum(len(v["ks"]) for v in viec):
        raise LoiChu("Hai chỗ sửa trùng cùng một đoạn chữ.")
    ket_qua = []
    with tempfile.TemporaryDirectory(prefix="sua-dong-") as t:
        hien = Path(pdf_vao)
        for n, v in enumerate(viec):
            moi = Path(t) / f"b{n}.pdf"
            ket_qua.append(sua_dong(hien, moi, v["trang"], f"{v['trang']}:" + ".".join(map(str, v["ks"])), v["chu_moi"], v.get("thuoc_tinh"),
                                    kiem_tra=False))
            for w in viec[n + 1:]:
                if w["trang"] == v["trang"]:
                    w["ks"] = [k - sum(1 for x in v["ks"] if x < k) for k in w["ks"]]
            hien = moi
        if kiem_tra:
            vung = {}
            for v, r in zip(viec, ket_qua):
                vung.setdefault(v["trang"], []).extend([tuple(r["khung_cu"]), tuple(r["khung"])])
            _so_anh(pdf_vao, hien, vung)
        ra.parent.mkdir(parents=True, exist_ok=True)
        tam = ra.with_name(ra.name + ".tam-chu")
        try:
            shutil.copyfile(hien, tam)
            os.replace(tam, ra)
        finally:
            tam.unlink(missing_ok=True)
    return {"duong": str(ra), "ds": [{k: v for k, v in r.items() if k != "duong"} for r in ket_qua]}
