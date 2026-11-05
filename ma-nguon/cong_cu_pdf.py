"""Công cụ PDF: đọc số trang và ghép các trang thành một file mới, kèm xoay và chú thích. Tách và gộp đều là ghép trang."""
import os
import zlib
from io import BytesIO
from pathlib import Path

import pikepdf
from pikepdf import Array, Dictionary, Name, String
from PIL import Image


def thong_tin(p: Path) -> dict:
    try:
        with pikepdf.open(p) as pdf:
            return {"duong": str(p), "ten": p.name, "so_trang": len(pdf.pages)}
    except pikepdf.PasswordError:
        raise ValueError(f"{p.name} có mật khẩu nên app chưa mở được.")
    except pikepdf.PdfError:
        raise ValueError(f"{p.name} không phải file PDF đọc được.")


def _dong_anh(pdf, trang, anh: bytes, r: int) -> None:
    """Đóng ảnh trong suốt lên trang. Ảnh vẽ theo trang đang nhìn thấy nên phải xoay ngược về hướng gốc của trang."""
    x0, y0, x1, y1 = [float(v) for v in trang.cropbox]
    im = Image.open(BytesIO(anh)).convert("RGBA")
    if r:
        im = im.rotate(r, expand=True)
    hop = im.getbbox()
    if not hop:
        return
    he_x, he_y = (x1 - x0) / im.width, (y1 - y0) / im.height
    w, h = (hop[2] - hop[0]) * he_x, (hop[3] - hop[1]) * he_y
    x, y = x0 + hop[0] * he_x, y1 - hop[3] * he_y
    im = im.crop(hop)
    mat_na = pdf.make_stream(b"", Type=Name.XObject, Subtype=Name.Image, Width=im.width, Height=im.height,
                             ColorSpace=Name.DeviceGray, BitsPerComponent=8)
    mat_na.write(zlib.compress(im.getchannel("A").tobytes()), filter=Name.FlateDecode)
    hinh = pdf.make_stream(b"", Type=Name.XObject, Subtype=Name.Image, Width=im.width, Height=im.height,
                           ColorSpace=Name.DeviceRGB, BitsPerComponent=8, SMask=mat_na)
    hinh.write(zlib.compress(im.convert("RGB").tobytes()), filter=Name.FlateDecode)
    ten = trang.add_resource(hinh, Name.XObject, prefix="SuaTex")
    trang.contents_add(b"q\n", prepend=True)
    trang.contents_add(f"Q\nq {w:.3f} 0 0 {h:.3f} {x:.3f} {y:.3f} cm {ten} Do Q\n".encode("ascii"))


def _them_ghi_chu(pdf, trang, ds: list, r: int) -> None:
    """Ghi chú thành chú thích PDF thật, mở bằng Phantom hay trình đọc khác vẫn đọc được nội dung."""
    x0, y0, x1, y1 = [float(v) for v in trang.cropbox]
    doi = {0: lambda x, y: (x0 + x, y1 - y), 90: lambda x, y: (x0 + y, y0 + x),
           180: lambda x, y: (x1 - x, y0 + y), 270: lambda x, y: (x1 - y, y1 - x)}[r]
    for c in ds:
        x, y = doi(float(c["x"]), float(c["y"]))
        dau = pdf.make_indirect(Dictionary(Type=Name.Annot, Subtype=Name.Text, Rect=[x, y - 18, x + 18, y],
                                           Contents=String(str(c["chu"])), Name=Name.Comment, F=28, C=[0.95, 0.78, 0.42]))
        trang.obj.Annots = pdf.make_indirect(Array([*trang.obj.get("/Annots", []), dau]))  # mảng mới, không dùng chung với trang nhân bản


def trang_trong(rong: float, cao: float, dich: Path) -> None:
    if dich.is_file():
        return
    pdf = pikepdf.new()
    pdf.add_blank_page(page_size=(rong, cao))
    dich.parent.mkdir(parents=True, exist_ok=True)
    pdf.save(dich)


def _trang_cua_muc(pdf, muc, chi_so_trang: dict):
    """Số thứ tự trang (từ 0) mà một mục dấu trang trỏ tới, None nếu không xác định được. Đích có thể là mảng, tên hay hành động GoTo."""
    dich = muc.destination
    if dich is None and muc.action is not None:
        dich = muc.action.get("/D")
    if isinstance(dich, (String, Name)) and "/Names" in pdf.Root and "/Dests" in pdf.Root.Names:
        try:
            dich = pikepdf.NameTree(pdf.Root.Names.Dests)[str(dich)]
        except KeyError:
            return None
        dich = dich.get("/D") if isinstance(dich, Dictionary) else dich
    elif isinstance(dich, Name) and "/Dests" in pdf.Root:
        dich = pdf.Root.Dests.get(str(dich))
        dich = dich.get("/D") if isinstance(dich, Dictionary) else dich
    if isinstance(dich, Array) and len(dich) and isinstance(dich[0], pikepdf.Object) and dich[0].objgen != (0, 0):
        return chi_so_trang.get(dich[0].objgen)
    return None


def _chep_dau_trang(moi, nguon: dict, vi_tri_moi: dict) -> None:
    """Giữ mục lục (dấu trang) của file nguồn cho những trang còn lại. Mục trỏ vào trang đã bỏ thì bỏ, mục con được nâng lên cấp của cha."""
    with moi.open_outline() as dau:
        for duong, pdf in nguon.items():
            chi_so = {tr.objgen: i for i, tr in enumerate(pdf.pages)}

            def doi(ds):
                ra = []
                for m in ds:
                    cu = _trang_cua_muc(pdf, m, chi_so)
                    moi_so = vi_tri_moi.get((duong, cu + 1)) if cu is not None else None
                    con = doi(m.children)
                    if moi_so is None:
                        ra += con
                        continue
                    it = pikepdf.OutlineItem(str(m.title), moi_so, "Fit")
                    it.children.extend(con)
                    ra.append(it)
                return ra

            with pdf.open_outline() as goc:
                dau.root.extend(doi(goc.root))


def ghep(trang: list, dich: Path) -> dict:
    """trang = [{duong, so, xoay, anh, ghi_chu, chu, xoa_chu}], so tính từ 1, xoay là số độ thêm vào, anh là PNG lớp chú thích.
    chu = chữ thật thêm vào trang (xem chu_pdf.them_chu: x, y, chu, phong, co, mau, dam, nghieng, gach_chan, gian_dong, id?), tọa độ trên trang
    đã xoay; xoa_chu = id các chữ đã thêm trước đó cần bỏ. Cả hai tùy chọn, không có thì hành vi như cũ.
    Ghi qua file tạm rồi đổi tên, để lỗi giữa chừng không để lại file hỏng."""
    if not trang:
        raise ValueError("Chưa có trang nào để lưu.")
    if dich.resolve() in {Path(t["duong"]).resolve() for t in trang}:
        raise ValueError(f"{dich.name} đang là file nguồn. Chọn tên khác để không ghi đè file gốc.")
    moi, nguon = pikepdf.new(), {}
    tam = dich.with_name(dich.name + ".tam-app")
    try:
        da_chep = {}
        for t in trang:
            duong, so = t["duong"], t["so"]
            if duong not in nguon:
                nguon[duong] = pikepdf.open(duong)
            pdf = nguon[duong]
            if not 1 <= so <= len(pdf.pages):
                raise ValueError(f"{Path(duong).name} không có trang {so}.")
            # Trang nhân bản phải là bản riêng, nếu không thì xoay hay chú thích một trang sẽ dính sang trang kia.
            if (duong, so) in da_chep:
                moi.pages.append(moi.pages[da_chep[duong, so]])
            else:
                da_chep[duong, so] = len(moi.pages)
                moi.pages.append(pdf.pages[so - 1])
        # Chép đủ các trang rồi mới sửa, vì trang nhân bản được chép từ trang đầu tiên khi còn nguyên.
        for tr, t in zip(moi.pages, trang):
            r = (int(tr.obj.get("/Rotate", 0)) + int(t.get("xoay") or 0)) % 360
            tr.obj.Rotate = r
            if t.get("chu") or t.get("xoa_chu"):
                import chu_pdf
                chu_pdf.ap_dung_vao_trang(moi, tr, t.get("chu") or [], t.get("xoa_chu") or [], r)  # nằm dưới lớp chú thích vẽ tay
            if t.get("anh"):
                _dong_anh(moi, tr, t["anh"], r)
            if t.get("ghi_chu"):
                _them_ghi_chu(moi, tr, t["ghi_chu"], r)
        # Trang nhân bản chỉ tính lần đầu: mục lục trỏ về bản đầu tiên.
        try:
            _chep_dau_trang(moi, nguon, {(t["duong"], t["so"]): i for i, t in reversed(list(enumerate(trang)))})
        except (pikepdf.PdfError, KeyError, ValueError, TypeError, AttributeError):
            pass  # mục lục của file nguồn hỏng thì vẫn lưu được trang, chỉ không có mục lục
        dich.parent.mkdir(parents=True, exist_ok=True)
        moi.save(tam)
        os.replace(tam, dich)
    except pikepdf.PdfError as e:
        raise ValueError(f"Không ghi được PDF: {e}")
    finally:
        for pdf in nguon.values():
            pdf.close()
        moi.close()
        tam.unlink(missing_ok=True)
    return {"duong": str(dich), "ten": dich.name, "so_trang": len(trang)}
