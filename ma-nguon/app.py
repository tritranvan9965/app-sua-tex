"""Máy chủ cục bộ của app sửa .tex. Chỉ dùng thư viện chuẩn của Python.

Cách dùng: mo-app.bat (dữ liệu thử), hoặc
    python -I ma-nguon/app.py [du-an.json | file.tex | file.pdf | thư mục] [--cong 8765] [--khong-mo] [--trinh-duyet]
Bản đã cài chỉ có một cửa sổ: mở thêm file thì file đó được gửi sang cửa sổ đang chạy.
Mặc định mở cửa sổ app riêng; --trinh-duyet mở bằng trình duyệt, --khong-mo chỉ chạy máy chủ.
"""
import argparse
import base64
import ctypes
import http.client
import json
import mimetypes
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

GOC_APP = Path(__file__).resolve().parent
sys.path.insert(0, str(GOC_APP))
import bien_dich  # noqa: E402
import duong_app  # noqa: E402
import loi  # noqa: E402


class NapKhiDung:
    """pikepdf, pypdfium2 mất gần 0,1 giây để nạp mà lúc mở app chưa ai cần, nên nạp ở lần dùng đầu (hoặc nạp nền trong lúc cửa sổ đang dựng)."""
    def __init__(self, nap):
        self._nap = nap

    def __getattr__(self, ten):
        return getattr(self._nap(), ten)


def _nap_cong_cu_pdf():
    import cong_cu_pdf as m
    return m


def _nap_in_pdf():
    import in_pdf as m
    return m


def _nap_chu_pdf():
    import chu_pdf as m
    return m


def _nap_doi_tuong_pdf():
    import doi_tuong_pdf as m
    return m


def _nap_phong_chu():
    import phong_chu as m
    return m


cong_cu_pdf = NapKhiDung(_nap_cong_cu_pdf)
chu_pdf = NapKhiDung(_nap_chu_pdf)
doi_tuong_pdf = NapKhiDung(_nap_doi_tuong_pdf)
phong_chu = NapKhiDung(_nap_phong_chu)
in_pdf = NapKhiDung(_nap_in_pdf)

STATIC = GOC_APP / "static"
CAI_DAT = duong_app.DU_LIEU / "cai-dat.json"
DS_GAN_DAY = duong_app.DU_LIEU / "gan-day.json"
SO_GAN_DAY = 20
DS_GOC = duong_app.DU_LIEU / "thu-muc-da-mo.json"  # tách khỏi cai-dat.json vì file đó do trang ghi đè cả tệp
CONG_DANG_CHAY = duong_app.DU_LIEU / "cong-dang-chay.txt"  # để lần mở sau tìm được cửa sổ đang chạy
MAC_DINH = None if duong_app.DA_DONG_GOI else GOC_APP.parent / "du-lieu-thu" / "du-an-thu.json"
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("text/javascript", ".js")

DA = None
GOC_HIEN = None  # phần tử của DS_GOC ứng với dự án đang mở
PDF_DAU = None  # file PDF được truyền vào lúc mở app
GOP_DAU = None  # các file chọn từ menu chuột phải Gộp thành PDF, đã chuyển hết sang PDF
CHUYEN_DAU = None  # các file chọn từ menu chuột phải Chuyển thành PDF và mở: PDF tạm cùng thư mục gốc để gợi ý lúc lưu
TOAN_MAN = False  # cửa sổ app đang toàn màn hình
DM = loi.DanhMuc()
KHOA = threading.Lock()  # lưu và xuất lần lượt, không chồng lên nhau
CONG = 8765
PDF_DA_CHON = set()
CHUA_LUU = False  # trang báo về, vì lúc đóng cửa sổ không hỏi lại trang được (sẽ treo)
CUA_SO = None  # cửa sổ app; chạy bằng trình duyệt thì không có, nên không có hộp chọn file


class LoiApp(Exception):
    def __init__(self, ma: int, thong_bao: str):
        super().__init__(thong_bao)
        self.ma, self.thong_bao = ma, thong_bao


def tep_trong_du_an(duong: str) -> Path:
    """Chặn mọi đường dẫn ra ngoài dự án đang mở, kể cả khi trình duyệt gửi bậy."""
    p = Path(duong or "").resolve()
    if not p.is_relative_to(DA["goc"]) or p.suffix.lower() not in loi.DUOI_SUA:
        raise LoiApp(403, "File này nằm ngoài dự án đang mở.")
    if not p.is_file():
        raise LoiApp(404, f"Không còn file {p.name}. Có thể file đã bị đổi tên hoặc xoá.")
    return p


def phien(p: Path) -> str:
    return str(p.stat().st_mtime_ns)


def ghi_gan_day(duong, loai: str) -> None:
    """Nhớ file, thư mục vừa mở (mới nhất đứng đầu) cho màn hình bắt đầu. Lỗi ghi không được làm hỏng việc mở."""
    try:
        d = str(duong)
        ds = [x for x in doc_gan_day() if x["duong"].lower() != d.lower()]
        ghi = DS_GAN_DAY.with_name(DS_GAN_DAY.name + ".tam-app")
        ghi.write_text(json.dumps([{"duong": d, "loai": loai}, *ds][:SO_GAN_DAY], ensure_ascii=False, indent=1), encoding="utf-8")
        ghi.replace(DS_GAN_DAY)
    except OSError:
        pass


def doc_gan_day() -> list:
    try:
        ds = json.loads(DS_GAN_DAY.read_text(encoding="utf-8"))
        return [x for x in ds if isinstance(x, dict) and isinstance(x.get("duong"), str)] if isinstance(ds, list) else []
    except (OSError, ValueError):
        return []


def gan_day(_=None) -> dict:
    """Bỏ mục đã bị xoá hay đổi tên ngoài app."""
    ra = []
    for x in doc_gan_day():
        p = Path(x["duong"])
        if p.exists():
            ra.append({**x, "ten": p.name or x["duong"], "thu_muc": str(p if x["loai"] == "thu_muc" else p.parent)})
    return {"ds": ra}


def doc_tep(duong: str) -> dict:
    p = tep_trong_du_an(duong)
    chu = p.read_text(encoding="utf-8")
    ghi_gan_day(p, "tex")
    return {"duong": str(p), "ten": p.name, "chu": chu, "phien": phien(p),
            "la_tex": p.suffix.lower() == ".tex", "la_file_rap": loi.la_file_rap(p)}


def phan_tich(d: dict) -> dict:
    p = tep_trong_du_an(d.get("duong"))
    return loi.phan_tich_luu(DA, DM, p, d.get("chu", ""))


def luu(d: dict) -> dict:
    p = tep_trong_du_an(d.get("duong"))
    if phien(p) != d.get("phien"):
        raise LoiApp(409, f"{p.name} vừa bị đổi ngoài app. Mở lại file rồi sửa tiếp để không ghi đè thay đổi đó.")
    lua_chon = d.get("lua_chon") or {}
    for lc in lua_chon.values():
        lc["file_khac"] = [str(tep_trong_du_an(f)) for f in lc.get("file_khac", [])]
    with KHOA:
        kq = loi.luu(DA, DM, p, d.get("chu", ""), lua_chon)
    return {**kq, "phien": phien(p)}


def ban_xuat(ban) -> str:
    """Dự án một bản thì tên bản là rỗng. Trả về None nếu dự án không có bản này."""
    ds = DA["xuat"]["ban"]
    return (ban if ban in ds else None) if ds else ""


def bien_dich_xem(d: dict) -> dict:
    """Biên dịch để xem khi đang sửa: dùng nội dung đang gõ, không lưu file, không đụng vào thành phẩm."""
    p = tep_trong_du_an(d.get("duong"))
    ban = ban_xuat(d.get("ban"))
    if p.suffix.lower() != ".tex" or ban is None:
        raise LoiApp(400, "Chỉ biên dịch được file .tex, đúng bản của dự án.")
    chu = d["chu"] if isinstance(d.get("chu"), str) else p.read_text(encoding="utf-8")
    with KHOA:
        ok, nhat_ky = bien_dich.bien_dich(p, chu, ban, loi.duong_nhap(p, ban))
    return {"ok": ok, "nhat_ky": nhat_ky}


def xuat(d: dict) -> dict:
    p = tep_trong_du_an(d.get("duong"))
    ban = ban_xuat(d.get("ban"))
    if p.suffix.lower() != ".tex" or ban is None:
        raise LoiApp(400, "Chỉ xuất được file .tex, đúng bản của dự án.")
    with KHOA:
        ok, nhat_ky = bien_dich.bien_dich(p, p.read_text(encoding="utf-8"), ban)
    return {"ok": ok, "nhat_ky": nhat_ky}


def thong_tin_du_an() -> dict:
    """Những gì trang cần biết để tách câu và hiện công thức đúng kiểu của dự án."""
    global PDF_DAU, GOP_DAU, CHUYEN_DAU
    pdf, PDF_DAU = PDF_DAU, None
    gop, GOP_DAU = GOP_DAU, None
    chuyen, CHUYEN_DAU = CHUYEN_DAU, None
    return {"ten": DA["ten"], "goc_mo": cac_goc(), "cau": DA["cau"], "xem_nhanh": DA["xem_nhanh"],
            "ban": list(DA["xuat"]["ban"]), "nhan_ban": DA["xuat"].get("nhan_ban", {}), "tep_dau": DA["tep_dau"], "pdf_dau": pdf, "gop_dau": gop, "chuyen_dau": chuyen}


def doc_goc() -> list:
    try:
        ds = json.loads(DS_GOC.read_text(encoding="utf-8"))
        return ds if isinstance(ds, list) else []
    except (OSError, ValueError):
        return []


def ghi_goc(ds: list) -> None:
    tam = DS_GOC.with_name(DS_GOC.name + ".tam-app")
    tam.write_text(json.dumps(ds, ensure_ascii=False, indent=1), encoding="utf-8")
    tam.replace(DS_GOC)


def them_goc(duong: str, da: dict) -> str:
    """Thêm vào danh sách đã mở. Mở một file nằm trong dự án đã có thì dùng lại mục cũ, không thêm mục trùng."""
    ds = doc_goc()
    for x in ds:
        try:
            cu = loi.mo_duong(Path(x))
        except (ValueError, KeyError, OSError):
            continue
        if (cu["goc"], cu["ten"]) == (da["goc"], da["ten"]):
            return x
    ghi_goc(ds + [duong])
    return duong


def cac_goc() -> list:
    ra = []
    for x in doc_goc():
        try:
            da = loi.mo_duong(Path(x))
            ra.append({"duong": x, "ten": da["ten"], "dang_mo": x == GOC_HIEN, "thu_muc": str(da["goc"]), "cay": loi.cay_du_an(da)})
        except (ValueError, KeyError, OSError):
            ra.append({"duong": x, "ten": Path(x).name or x, "thieu": True, "cay": []})
    return ra


def dong_goc(d: dict) -> dict:
    """Chỉ bỏ khỏi danh sách trong app, không đụng đến file trên máy."""
    ds, x = doc_goc(), d.get("duong")
    if x not in ds:
        raise LoiApp(404, "Thư mục này không còn trong danh sách.")
    if len(ds) == 1:
        raise LoiApp(400, "Cần giữ lại ít nhất một thư mục.")
    ds.remove(x)
    ghi_goc(ds)
    if x != GOC_HIEN:
        return {}
    mo_moi(ds[0])
    return {"doi": True}


def goc_chua(p: Path):
    """Thư mục đã mở có chứa file này. Có thì dùng lại, để bấm đúp nhiều file không làm dài thanh file."""
    if not p.is_file():
        return None
    for x in doc_goc():
        try:
            da = loi.mo_duong(Path(x))
        except (ValueError, KeyError, OSError):
            continue
        if p.is_relative_to(da["goc"]) and any("thu_muc" in m for m in da["cay"]):
            return x
    return None


def mo_moi(duong: str, tep: str = None) -> dict:
    """Chuyển sang dự án, file hoặc thư mục khác ngay khi app đang chạy. Các thư mục đã mở trước đó vẫn giữ trong danh sách."""
    global DA, DM, CHUA_LUU, GOC_HIEN
    p = Path(duong).resolve()
    co = None if tep else goc_chua(p)
    if co:
        return mo_moi(co, str(p))
    da = loi.mo_duong(p)
    if tep:
        t = Path(tep).resolve()
        if not t.is_relative_to(da["goc"]):
            raise LoiApp(403, "File này nằm ngoài thư mục đó.")
        da["tep_dau"] = str(t)
    with KHOA:
        DA, DM, CHUA_LUU = da, loi.DanhMuc(), False
        loi.dat_du_an(DA)
        GOC_HIEN = them_goc(str(p), da)
    if not tep and p.is_dir():
        ghi_gan_day(p, "thu_muc")
    if CUA_SO:
        CUA_SO.set_title(f"{DA['ten']} - Sửa TeX")
    return {}


def thu_muc_bat_dau() -> str:
    """Hộp chọn của Windows mở sẵn ở thư mục đang làm việc, không phải Documents."""
    g = DA and DA.get("goc")
    return str(g) if g and Path(g).is_dir() else ""


def chon_mo(d: dict) -> dict:
    """Hiện hộp chọn của Windows. Không có cửa sổ app thì để trang hỏi đường dẫn."""
    if not CUA_SO:
        return {"khong_co_hop": True}
    import webview
    if d.get("kieu") == "thu_muc":
        ds = CUA_SO.create_file_dialog(webview.FileDialog.FOLDER, directory=thu_muc_bat_dau())
    else:
        ds = CUA_SO.create_file_dialog(webview.FileDialog.OPEN, directory=thu_muc_bat_dau(), file_types=("File LaTeX và PDF (*.tex;*.pdf)", "File dự án (*.json)"))
    if not ds:
        return {"huy": True}
    return pdf_chon({"duong": [ds[0]]}) if ds[0].lower().endswith(".pdf") else mo_moi(ds[0])


def thu_vien(_=None) -> dict:
    return {"ds": loi.cac_mau()["ds"], "duong": str(loi.THU_VIEN)}


def them_mau(d: dict) -> dict:
    """Chọn thư mục mẫu rồi chép vào thư viện. Mẫu trùng tên thì trang hỏi lại mới ghi đè."""
    duong = d.get("duong")
    if not duong:
        if not CUA_SO:
            return {"khong_co_hop": True}
        import webview
        ds = CUA_SO.create_file_dialog(webview.FileDialog.FOLDER)
        if not ds:
            return {"huy": True}
        duong = ds[0]
    return {**bien_dich.them_mau(Path(duong).resolve(), bool(d.get("ghi_de"))), "duong": str(duong)}


def mo_thu_vien(_) -> dict:
    os.startfile(loi.THU_VIEN)
    return {}


def doc_cai_dat() -> dict:
    try:
        return json.loads(CAI_DAT.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def ghi_cai_dat(d: dict) -> dict:
    tam = CAI_DAT.with_name(CAI_DAT.name + ".tam-app")
    tam.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
    tam.replace(CAI_DAT)
    return {}


def thoat(_) -> dict:
    """Đóng cửa sổ như bấm nút X, nên vẫn hỏi nếu còn thay đổi chưa lưu."""
    if not CUA_SO:
        return {"khong_co_cua_so": True}
    threading.Timer(0.1, CUA_SO.destroy).start()
    return {}


def pdf_chon(d: dict) -> dict:
    """Chỉ file vừa chọn mới đọc được qua /api/pdf-tep, để trang web không đọc được file bất kỳ trên máy."""
    ds = d.get("duong")
    if not ds:
        if not CUA_SO:
            return {"khong_co_hop": True}
        import webview
        ds = CUA_SO.create_file_dialog(webview.FileDialog.OPEN, directory=thu_muc_bat_dau(), allow_multiple=True, file_types=("File PDF (*.pdf)",))
        if not ds:
            return {"huy": True}
    tep = []
    for duong in ds:
        p = Path(duong).resolve()
        if not p.is_file():
            raise LoiApp(404, f"Không tìm thấy {p.name}.")
        try:
            tep.append(cong_cu_pdf.thong_tin(p))
        except ValueError as e:
            raise LoiApp(400, str(e))
        PDF_DA_CHON.add(str(p))
        if not p.is_relative_to(Path(tempfile.gettempdir()).resolve()):  # bản tạm của Gộp, Chuyển và mở không phải file của người dùng
            ghi_gan_day(p, "pdf")
    return {"tep": tep}


def pdf_nhap(d: dict) -> dict:
    """Đưa PDF vừa biên dịch vào dãy trang. Chép ra bản riêng vì lần biên dịch sau sẽ ghi đè file nháp."""
    tex = tep_trong_du_an(d.get("duong"))
    ban = ban_xuat(d.get("ban")) or ""
    nguon = loi.duong_nhap(tex, ban)
    if not nguon.is_file():
        raise LoiApp(404, "Chưa có PDF. Bấm Chạy thử (F5) trước.")
    ban_sao = nguon.with_name(f"{nguon.stem}-{time.time_ns()}.pdf")
    shutil.copy(nguon, ban_sao)
    PDF_DA_CHON.add(str(ban_sao))
    ten = f"{tex.stem}_{ban}.pdf" if ban else f"{tex.stem}.pdf"
    return {"tep": [{**cong_cu_pdf.thong_tin(ban_sao), "ten": ten}]}


def pdf_trong(d: dict) -> dict:
    """Trang trắng cùng khổ với trang đang xem, là một file PDF nhỏ trong thư mục tạm."""
    rong, cao = round(float(d.get("rong", 595)), 1), round(float(d.get("cao", 842)), 1)
    p = Path(tempfile.gettempdir()) / "sua-tex-xem" / f"trong-{rong}x{cao}.pdf"
    cong_cu_pdf.trang_trong(rong, cao, p)
    PDF_DA_CHON.add(str(p))
    return {**cong_cu_pdf.thong_tin(p), "ten": "Trang trắng"}


def chon_thu_muc(_) -> dict:
    if not CUA_SO:
        return {"khong_co_hop": True}
    import webview
    ds = CUA_SO.create_file_dialog(webview.FileDialog.FOLDER)
    return {"duong": ds[0]} if ds else {"huy": True}


def anh_ghi(d: dict) -> dict:
    thu_muc = Path(d.get("thu_muc", ""))
    if not thu_muc.is_dir():
        raise LoiApp(404, "Không tìm thấy thư mục lưu ảnh.")
    p = thu_muc / f"{Path(d.get('ten', 'trang')).stem}.png"
    p.write_bytes(base64.b64decode(d.get("png", "")))
    return {"ten": p.name}


def ap_sua_trang(trang: list, thu_muc: Path) -> set:
    """Các trang có sua_dong và/hoặc sua_doi_tuong: chạy doi_tuong_pdf.ap_sua trên file nguồn ra bản tạm (mọi sửa của một file tính trên cùng
    bản nguyên, ghi một lần) rồi đổi đường dẫn trang sang bản tạm (số trang giữ nguyên). Trả tập file nguồn gốc để ghep() vẫn chặn ghi đè lên chúng.
    Dữ liệu mỗi phần tử trang (ngoài duong, so, xoay, anh, ghi_chu, chu, xoa_chu như cũ):
      sua_dong = [{dong_id, chu_moi, thuoc_tinh?}]  (dong_id từ /api/chu-ds-dong hay /api/chu-tim-dong)
      sua_doi_tuong = [{id, viec}]  (id từ /api/dt-ds); viec = {"loai": "doi", "dx", "dy"} | {"loai": "co", "khung_moi": [x0, y0, x1, y1],
      "giu_ti_le"?} | {"loai": "xoa"}. Tọa độ pt, trang đang nhìn thấy (đã tính /Rotate của file nguồn, chưa tính `xoay` thêm lúc lưu), y xuống."""
    theo_tep, goc = {}, set()
    for x in trang:
        if not x.get("sua_dong") and not x.get("sua_doi_tuong"):
            continue
        viec = theo_tep.setdefault(x["duong"], {"dong": {}, "dt": {}})
        for s in x.get("sua_dong") or []:
            k = (x["so"], str(s["dong_id"]))
            mot = {"trang": x["so"], "dong_id": str(s["dong_id"]), "chu_moi": str(s.get("chu_moi", "")), "thuoc_tinh": s.get("thuoc_tinh") or {}}
            if k in viec["dong"] and viec["dong"][k] != mot:
                raise LoiApp(400, f"Trang {x['so']} được nhân bản nhưng hai bản sửa dòng chữ khác nhau. Sửa lại cho giống nhau rồi lưu.")
            viec["dong"][k] = mot
        for s in x.get("sua_doi_tuong") or []:
            k = (x["so"], str(s["id"]))
            mot = {"trang": x["so"], "id": str(s["id"]), "viec": s.get("viec") or {}}
            if k in viec["dt"] and viec["dt"][k] != mot:
                raise LoiApp(400, f"Trang {x['so']} được nhân bản nhưng hai bản sửa đối tượng khác nhau. Sửa lại cho giống nhau rồi lưu.")
            viec["dt"][k] = mot
    for n, (duong, viec) in enumerate(theo_tep.items()):
        goc.add(str(Path(duong).resolve()))
        tam = thu_muc / f"sua-{n}.pdf"
        try:
            doi_tuong_pdf.ap_sua(duong, tam, list(viec["dong"].values()), list(viec["dt"].values()))
        except ValueError as e:
            raise LoiApp(400, str(e))
        for x in trang:
            if x["duong"] == duong:
                x["duong"] = str(tam)
    return goc


ap_sua_dong = ap_sua_trang  # tên cũ


def pdf_ghi(d: dict) -> dict:
    trang = [{**x, "so": int(x["so"]), "anh": base64.b64decode(x["anh"]) if x.get("anh") else None} for x in d.get("trang", [])]
    if any(x["duong"] not in PDF_DA_CHON for x in trang):
        raise LoiApp(403, "Trang này không thuộc file đã mở.")
    with tempfile.TemporaryDirectory(prefix="sua-ghi-") as t:
        goc = ap_sua_trang(trang, Path(t))
        return pdf_ghi_xong(d, trang, goc)


def pdf_ghi_xong(d: dict, trang: list, goc: set) -> dict:
    dich = d.get("dich")
    nguon = d.get("nguon")
    if nguon:  # PDF biên dịch từ .tex: lưu thẳng vào vị trí đã định, không hỏi
        dich = loi.duong_pdf(tep_trong_du_an(nguon.get("duong")), ban_xuat(nguon.get("ban")) or "")
    if not dich:
        if not CUA_SO:
            return {"khong_co_hop": True}
        import webview
        ds = CUA_SO.create_file_dialog(webview.FileDialog.SAVE, directory=d.get("thu_muc") or "", save_filename=d.get("ten", "moi.pdf"), file_types=("File PDF (*.pdf)",))
        if not ds:
            return {"huy": True}
        dich = ds if isinstance(ds, str) else ds[0]
    try:
        dich = Path(dich).resolve().with_suffix(".pdf")
        if dich in {Path(g) for g in goc}:
            raise LoiApp(400, f"{dich.name} đang là file nguồn. Chọn tên khác để không ghi đè file gốc.")
        return cong_cu_pdf.ghep(trang, dich)
    except ValueError as e:
        raise LoiApp(400, str(e))
    except PermissionError:
        raise LoiApp(409, f"File {Path(dich).name} đang mở ở phần mềm khác. Đóng file rồi lưu lại.")


def pdf_in(d: dict) -> dict:
    """Ghép các trang cần in (kèm chú thích) thành PDF tạm rồi in thẳng qua hộp thoại in của Windows, giữ nguyên vector."""
    trang = [{**x, "so": int(x["so"]), "anh": base64.b64decode(x["anh"]) if x.get("anh") else None} for x in d.get("trang", [])]
    if any(x["duong"] not in PDF_DA_CHON for x in trang):
        raise LoiApp(403, "Trang này không thuộc file đã mở.")
    thu_muc = Path(tempfile.gettempdir()) / "sua-tex-in"
    thu_muc.mkdir(exist_ok=True)
    ten = Path(str(d.get("ten") or "in")).stem[:60] or "in"
    try:
        with tempfile.TemporaryDirectory(prefix="sua-in-") as t:
            ap_sua_trang(trang, Path(t))
            p = Path(cong_cu_pdf.ghep(trang, thu_muc / f"{ten}-{time.time_ns()}.pdf")["duong"])
    except ValueError as e:
        raise LoiApp(400, str(e))
    try:
        in_pdf.in_pdf(p, ten, {**(d.get("tuy") or {}), "ra_tep": None})
        return {}
    except (OSError, KeyError, ValueError) as e:
        raise LoiApp(500, f"Không in được: {e}")
    finally:
        p.unlink(missing_ok=True)


def hoi_may_in(ham):
    """Gọi hàm hỏi máy in, lỗi từ trình điều khiển máy in thành lỗi báo được cho người dùng."""
    try:
        return ham()
    except (OSError, KeyError, ValueError) as e:
        raise LoiApp(500, f"Máy in: {e}")


def in_khung(d: dict) -> dict:
    return hoi_may_in(lambda: in_pdf.khung_giay(d["may_in"], d.get("giay"), 2 if d.get("huong") == 2 else 1))


def in_tuy_chon(d: dict) -> dict:
    hien = {k: d[k] for k in ("giay", "huong", "hai_mat", "mau") if d.get(k) is not None}
    return hoi_may_in(lambda: in_pdf.tuy_chon_may_in(d["may_in"], **hien))


def toan_man(d: dict) -> dict:
    """Trang web tự toàn màn hình chỉ phủ kín cửa sổ, nên cửa sổ app phải tự phóng ra cả màn hình."""
    global TOAN_MAN
    if not CUA_SO:
        return {"khong_co_cua_so": True}
    if bool(d.get("bat")) != TOAN_MAN:
        TOAN_MAN = not TOAN_MAN
        CUA_SO.toggle_fullscreen()
    return {}


def chay_ps(lenh: str, loi_bao: str, **bien) -> str:
    """Chạy PowerShell, truyền dữ liệu qua biến môi trường để đường dẫn có dấu cách hay dấu nháy không làm hỏng lệnh."""
    dau = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; "
    try:
        kq = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-STA", "-Command", dau + lenh],
                            env={**os.environ, **bien}, capture_output=True, timeout=30,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except subprocess.TimeoutExpired:
        raise LoiApp(500, loi_bao)
    if kq.returncode:
        raise LoiApp(500, loi_bao)
    return kq.stdout.decode("utf-8", "replace").strip()


LENH_CHEP_ANH = ("Add-Type -AssemblyName System.Windows.Forms,System.Drawing; "
                 "$a=[System.Drawing.Image]::FromFile($env:ANH_CHEP); [System.Windows.Forms.Clipboard]::SetImage($a); $a.Dispose()")


def chep_anh(d: dict) -> dict:
    """Đưa ảnh vào clipboard của Windows ở phía máy chủ, vì quyền clipboard của trình duyệt có thể bị từ chối."""
    with tempfile.TemporaryDirectory(prefix="anh_") as tam:
        anh = Path(tam) / "vung.png"
        anh.write_bytes(base64.b64decode(d.get("png", "")))
        chay_ps(LENH_CHEP_ANH, "Không đưa được ảnh vào clipboard.", ANH_CHEP=str(anh))
    return {}


# ---------- Thao tác file từ thanh file ----------

LENH_CHEP_CHU = "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText($env:CHU_CHEP)"
# Clipboard file của Windows: 2 là cắt, 5 là sao chép. Nhờ vậy dán được cả sang File Explorer.
LENH_CHEP_TEP = ("Add-Type -AssemblyName System.Windows.Forms; $ds=New-Object System.Collections.Specialized.StringCollection; "
                 "[void]$ds.Add($env:TEP_CHEP); $o=New-Object System.Windows.Forms.DataObject; $o.SetFileDropList($ds); "
                 "$m=New-Object IO.MemoryStream(,[byte[]]([int]$env:KIEU_CHEP,0,0,0)); $o.SetData('Preferred DropEffect',$m); "
                 "[System.Windows.Forms.Clipboard]::SetDataObject($o,$true)")
LENH_DOC_TEP = ("Add-Type -AssemblyName System.Windows.Forms; $c=[System.Windows.Forms.Clipboard]; $ds=@($c::GetFileDropList()); $k=5; "
                "$m=$c::GetData('Preferred DropEffect'); if($m){$k=$m.ReadByte()}; "
                "ConvertTo-Json -Compress @{tep=[string[]]$ds; kieu=$k}")
LENH_XOA_CLIP = "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::Clear()"
LENH_XOA_TEP = ("Add-Type -AssemblyName Microsoft.VisualBasic; "
                "[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($env:TEP_XOA,'OnlyErrorDialogs','SendToRecycleBin')")
LENH_PHONG = ("Add-Type -AssemblyName System.Drawing; "
              "ConvertTo-Json -Compress @((New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object Name)")
PHONG_MAY = None


def tep_da_mo(duong: str, ca_goc: bool = False) -> Path:
    """Thao tác file chỉ được làm trong các thư mục đang hiện trên thanh file."""
    p = Path(duong or "").resolve()
    for x in doc_goc():
        try:
            goc = Path(loi.mo_duong(Path(x))["goc"]).resolve()
        except (ValueError, KeyError, OSError):
            continue
        if p.is_relative_to(goc) and (ca_goc or p != goc):
            if not p.exists():
                raise LoiApp(404, f"Không còn {p.name}. Có thể đã bị đổi tên hoặc xoá.")
            return p
    raise LoiApp(403, "Đường dẫn này nằm ngoài các thư mục đang mở.")


def chep_duong(d: dict) -> dict:
    chay_ps(LENH_CHEP_CHU, "Không chép được đường dẫn.", CHU_CHEP=str(tep_da_mo(d.get("duong"), True)))
    return {}


def chep_tep(d: dict) -> dict:
    chay_ps(LENH_CHEP_TEP, "Không chép được file.", TEP_CHEP=str(tep_da_mo(d.get("duong"))), KIEU_CHEP="2" if d.get("cat") else "5")
    return {}


def ten_trong(cho: Path, ten: str) -> Path:
    """Trùng tên thì thêm (2), (3), như File Explorer."""
    p, goc = cho / ten, Path(ten)
    so = 2
    while p.exists():
        p = cho / f"{goc.stem} ({so}){goc.suffix}"
        so += 1
    return p


def dan_tep(d: dict) -> dict:
    cho = tep_da_mo(d.get("duong"), True)
    cho = cho if cho.is_dir() else cho.parent
    kq = json.loads(chay_ps(LENH_DOC_TEP, "Không đọc được clipboard."))
    ds = kq.get("tep") or []
    if isinstance(ds, str):
        ds = [ds]
    if not ds:
        raise LoiApp(400, "Clipboard chưa có file nào để dán.")
    cat, doi = kq.get("kieu") == 2, []
    for f in ds:
        nguon = Path(f)
        if not nguon.exists():
            raise LoiApp(404, f"Không còn {nguon.name}.")
        if nguon.is_dir() and cho.is_relative_to(nguon):
            raise LoiApp(400, "Không dán được một thư mục vào chính nó.")
        if cat and nguon.parent == cho:
            continue
        dich = ten_trong(cho, nguon.name)
        if cat:
            shutil.move(str(nguon), dich)
            doi_nhap(nguon, dich)
        elif nguon.is_dir():
            shutil.copytree(nguon, dich)
        else:
            shutil.copy2(nguon, dich)
        doi.append({"cu": str(nguon), "moi": str(dich)})
    if cat:
        chay_ps(LENH_XOA_CLIP, "Không xoá được clipboard.")
    return {"doi": doi, "cat": cat}


def doi_nhap(cu: Path, moi: Path) -> None:
    """PDF nháp đặt tên theo đường dẫn file .tex, nên đổi tên file thì nháp phải đi theo."""
    if cu.suffix.lower() != ".tex" or moi.suffix.lower() != ".tex":
        return
    for ban in list(DA["xuat"]["ban"]) or [""]:
        nhap = loi.duong_nhap(cu, ban)
        if nhap.is_file():
            nhap.replace(loi.duong_nhap(moi, ban))


def doi_ten(d: dict) -> dict:
    p, ten = tep_da_mo(d.get("duong")), str(d.get("ten", "")).strip()
    if not ten or any(c in ten for c in '\\/:*?"<>|') or ten.endswith("."):
        raise LoiApp(400, 'Tên file không được trống, không chứa các dấu \\ / : * ? " < > |')
    moi = p.with_name(ten if Path(ten).suffix else ten + p.suffix)
    if moi.exists() and not moi.samefile(p):
        raise LoiApp(409, f"Đã có file {moi.name} trong thư mục này.")
    try:
        p.rename(moi)
    except PermissionError:
        raise LoiApp(409, f"File {p.name} đang mở ở phần mềm khác. Đóng file rồi đổi tên lại.")
    doi_nhap(p, moi)
    return {"duong": str(moi), "ten": moi.name}


def xoa_tep(d: dict) -> dict:
    """Chỉ đưa vào Thùng rác của Windows, lấy lại được."""
    chay_ps(LENH_XOA_TEP, "Không xoá được file. Có thể file đang mở ở phần mềm khác.", TEP_XOA=str(tep_da_mo(d.get("duong"))))
    return {}


def hien_tep(d: dict) -> dict:
    p = tep_da_mo(d.get("duong"), True)
    subprocess.Popen(["explorer", f"/select,{p}"])
    return {}


def phong_may(_=None) -> dict:
    """Danh sách phông đã cài trên máy. Đọc một lần vì mất khoảng một giây."""
    global PHONG_MAY
    if PHONG_MAY is None:
        PHONG_MAY = json.loads(chay_ps(LENH_PHONG, "Không đọc được danh sách phông chữ."))
    return {"ds": PHONG_MAY}


def phong_viet(_=None) -> dict:
    """Họ phông máy dùng được cho chữ tiếng Việt (có đủ dấu): [{ho, du_dau, co_dam, co_nghieng, so_kieu}], đã sắp theo tên."""
    return {"ds": phong_chu.ds_phong_viet()}


def chu_tim_phong(d: dict) -> dict:
    """Phông máy ứng với họ + đậm/nghiêng. dam_gia/nghieng_gia = máy không có kiểu đó, sẽ giả lập khi ghi."""
    m = phong_chu.tim_phong(d.get("ho", ""), bool(d.get("dam")), bool(d.get("nghieng")))
    if not m:
        raise LoiApp(404, f"Máy không có phông {d.get('ho', '')}.")
    try:  # độ cao phần trên/dưới đường cơ sở (theo em), để hộp chữ trên màn hình đặt dòng đúng chỗ như trong file
        sf = phong_chu.Sfnt(m["duong"], m["chi_so"])
        (asc, desc, _), _ = sf.hhea()
        asc, desc = asc / sf.upm, -desc / sf.upm
    except (ValueError, OSError, KeyError, struct.error, ZeroDivisionError):
        asc, desc = 0.9, 0.25
    return {"ho": m["ho"], "kieu": m["kieu"], "du_dau": m["du_dau"], "dam_gia": m["dam_gia"], "nghieng_gia": m["nghieng_gia"], "asc": asc, "desc": desc}


def pdf_da_chon(duong) -> str:
    if duong not in PDF_DA_CHON:
        raise LoiApp(403, "Trang này không thuộc file đã mở.")
    return duong


def chu_tim_dong(d: dict) -> dict:
    """Dòng chữ có sẵn ở điểm (x, y) pt, gốc trên-trái, trên trang `trang` (từ 1) đang nhìn thấy của file PDF đã mở. dong = None nếu không có chữ.
    Thêm goi_y_phong: họ phông máy gần giống nhất để ô sửa hiện chữ cũ (chỉ để xem, file vẫn dùng lại phông gốc nếu được)."""
    try:
        dong = chu_pdf.tim_dong(pdf_da_chon(d.get("duong")), int(d["trang"]), float(d["x"]), float(d["y"]))
    except ValueError as e:
        raise LoiApp(400, str(e))
    if dong and dong.get("loai") == "chu-co-san":
        dong["goi_y_phong"] = next((m["ho"] for m in (phong_chu.tim_phong(h, dong["dam"], dong["nghieng"]) for h in chu_pdf._ung_vien_phong(dong["phong"])) if m), "Times New Roman")
    return {"dong": dong}


def chu_ds_dong(d: dict) -> dict:
    """Mọi dòng chữ có sẵn của trang `trang` (từ 1) trong file PDF đã mở: {ds: [{dong_id, id, chu, khung [x0,y0,x1,y1], phong, phong_sach, co, mau,
    tap_con, nhung, dam, nghieng, doi_tuong, trang, sua_duoc, ly_do, goi_y_phong}]}. dong_id dùng được ngay cho sua_dong / chu-sua-thu."""
    try:
        ds = chu_pdf.ds_dong(pdf_da_chon(d.get("duong")), int(d["trang"]))
    except ValueError as e:
        raise LoiApp(400, str(e))
    goi_y = {}
    for dong in ds:
        k = (dong["phong"], dong["dam"], dong["nghieng"])
        if k not in goi_y:
            goi_y[k] = next((m["ho"] for m in (phong_chu.tim_phong(h, dong["dam"], dong["nghieng"]) for h in chu_pdf._ung_vien_phong(dong["phong"])) if m), "Times New Roman")
        dong["goi_y_phong"] = goi_y[k]
    return {"ds": ds}


def dt_ds(d: dict) -> dict:
    """Đối tượng không phải chữ (ảnh, hình, nhóm) của trang `trang` trong file PDF đã mở: {ds: [{id, trang, loai, nguon, khung, sua_duoc, ly_do, so_phan_tu,
    co_chu, nen_trang, ten?, rong_px?, cao_px?, phan_tu?}]}. chi_tiet = true: từng ảnh, từng nét riêng lẻ."""
    try:
        return {"ds": doi_tuong_pdf.ds_doi_tuong(pdf_da_chon(d.get("duong")), int(d["trang"]), bool(d.get("chi_tiet")))}
    except ValueError as e:
        raise LoiApp(400, str(e))


def dt_thu(d: dict) -> dict:
    """Tính thử một việc với đối tượng, không ghi file: {khung_cu, khung_moi (null nếu xóa), sua_duoc, ly_do}. viec như trong ap_sua_trang."""
    try:
        return doi_tuong_pdf.xem_thu(pdf_da_chon(d.get("duong")), int(d["trang"]), str(d["id"]), d.get("viec") or {})
    except ValueError as e:
        raise LoiApp(400, str(e))


def chu_sua_thu(d: dict) -> dict:
    """Chạy thử sửa một dòng ra bản tạm (không giữ) để biết phông sẽ dùng, khung chữ mới và cũ. Lỗi lõi thành lỗi 400 với câu tiếng Việt."""
    nguon = pdf_da_chon(d.get("duong"))
    with tempfile.TemporaryDirectory(prefix="sua-thu-") as t:
        try:
            kq = chu_pdf.sua_dong(nguon, Path(t) / "thu.pdf", int(d["trang"]), str(d["dong_id"]), str(d.get("chu_moi", "")), d.get("thuoc_tinh") or {}, kiem_tra=False)
        except ValueError as e:
            raise LoiApp(400, str(e))
    kq.pop("duong", None)
    return kq


BAN_XEM = {}  # (đường dẫn, mtime, cỡ) -> nội dung PDF đã bỏ chữ do app thêm


def pdf_de_xem(duong: str) -> bytes:
    """Nội dung gửi cho trình xem. Chữ do app thêm trước đó được bỏ ra, vì giao diện đã nạp chúng thành hộp chữ sửa được và tự vẽ."""
    p = Path(duong)
    st = p.stat()
    khoa = (duong, st.st_mtime_ns, st.st_size)
    if khoa not in BAN_XEM:
        try:
            bo = chu_pdf.ban_xem_khong_chu_da_them(duong)[1]
        except ValueError:
            bo = None
        BAN_XEM.clear()  # chỉ nhớ lần gần nhất, tránh giữ nhiều bản lớn
        BAN_XEM[khoa] = bo or p.read_bytes()
    return BAN_XEM[khoa]


def chu_da_them(d: dict) -> dict:
    """Chữ đã thêm bằng app trong file PDF đã mở: [{id, trang, x, y, chu, phong, co, mau, dam, nghieng, gach_chan, gian_dong, rong, cao}]."""
    try:
        return {"ds": chu_pdf.ban_xem_khong_chu_da_them(pdf_da_chon(d.get("duong")))[0]}
    except ValueError as e:
        raise LoiApp(400, str(e))


def mo_ngoai(d: dict) -> dict:
    """Lần mở sau gửi file sang đây. Chạy ở luồng riêng vì evaluate_js đợi trang trả lời."""
    def lam():
        CUA_SO.restore()
        CUA_SO.on_top = True
        CUA_SO.on_top = False
        if d.get("chuyen"):
            CUA_SO.evaluate_js(f"moChuyen({json.dumps(d['chuyen'])})")
        elif d.get("gop"):
            CUA_SO.evaluate_js(f"moGop({json.dumps(d['gop'])})")
        elif d.get("duong"):
            CUA_SO.evaluate_js(f"moTuNgoai({json.dumps(d['duong'])})")
    threading.Thread(target=lam, daemon=True).start()
    return {}


def bao_chua_luu(d: dict) -> dict:
    global CHUA_LUU
    CHUA_LUU = bool(d.get("co"))
    return {}


class XuLy(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def _gui(self, ma: int, than: bytes, kieu: str, them=()):
        self.send_response(ma)
        self.send_header("Content-Type", kieu)
        self.send_header("Content-Length", str(len(than)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in them:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(than)

    def _json(self, ma: int, du_lieu):
        self._gui(ma, json.dumps(du_lieu, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def _tu_may_nay(self) -> bool:
        return self.headers.get("Host") in {f"127.0.0.1:{CONG}", f"localhost:{CONG}"}

    def _chay(self, viec):
        if not self._tu_may_nay():
            return self._json(403, {"loi": "Chỉ mở app từ chính máy này."})
        try:
            viec()
        except LoiApp as e:
            self._json(e.ma, {"loi": e.thong_bao})
        except UnicodeDecodeError:
            self._json(415, {"loi": "File không phải UTF-8 nên app chưa mở được."})
        except (KeyError, ValueError, OSError) as e:
            self._json(500, {"loi": f"Không làm được việc này: {e}"})

    def do_GET(self):
        self._chay(self._get)

    def do_POST(self):
        self._chay(self._post)

    def _get(self):
        url = urlparse(self.path)
        hoi = {k: v[0] for k, v in parse_qs(url.query).items()}
        if url.path == "/api/cai-dat":
            self._json(200, doc_cai_dat())
        elif url.path == "/api/pdf-tep":
            if hoi.get("duong") not in PDF_DA_CHON:
                raise LoiApp(403, "File này chưa được chọn.")
            self._gui(200, pdf_de_xem(hoi["duong"]), "application/pdf")
        elif url.path == "/api/gan-day":
            self._json(200, gan_day())
        elif url.path == "/api/thu-vien":
            self._json(200, thu_vien())
        elif url.path == "/api/phong":
            self._json(200, phong_may())
        elif url.path == "/api/phong-viet":
            self._json(200, phong_viet())
        elif url.path == "/api/du-an":
            self._json(200, thong_tin_du_an())
        elif url.path == "/api/tep":
            self._json(200, doc_tep(hoi.get("duong")))
        elif url.path == "/api/pdf":
            tex = tep_trong_du_an(hoi.get("duong"))
            ban = ban_xuat(hoi.get("ban"))
            ban = next(iter(DA["xuat"]["ban"]), "") if ban is None else ban
            pdf = loi.duong_nhap(tex, ban)
            if not pdf.is_file():
                raise LoiApp(404, "Chưa có PDF")
            cu = pdf.stat().st_mtime_ns < tex.stat().st_mtime_ns
            self._gui(200, pdf.read_bytes(), "application/pdf", [("X-Pdf-Cu", "1")] if cu else ())
        else:
            self._tinh(url.path)

    def _tinh(self, duong: str):
        p = (STATIC / ("index.html" if duong == "/" else duong.removeprefix("/static/"))).resolve()
        if not p.is_relative_to(STATIC) or not p.is_file():
            raise LoiApp(404, "Không có trang này.")
        kieu = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
        if kieu.startswith("text/"):
            kieu += "; charset=utf-8"
        self._gui(200, p.read_bytes(), kieu)

    def _post(self):
        # Trang web lạ không tự gửi được tiêu đề riêng này, nên không ghi file hộ trang khác được.
        if self.headers.get("X-App") != "sua-tex":
            raise LoiApp(403, "Yêu cầu không đến từ app.")
        d = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))).decode("utf-8"))
        viec = {"/api/phan-tich": phan_tich, "/api/luu": luu, "/api/xuat": xuat, "/api/bien-dich": bien_dich_xem, "/api/chua-luu": bao_chua_luu,
                "/api/chon-mo": chon_mo, "/api/cai-dat": ghi_cai_dat, "/api/thoat": thoat, "/api/pdf-chon": pdf_chon, "/api/pdf-ghi": pdf_ghi, "/api/pdf-in": pdf_in, "/api/chu-tim-dong": chu_tim_dong, "/api/chu-ds-dong": chu_ds_dong, "/api/dt-ds": dt_ds, "/api/dt-thu": dt_thu, "/api/chu-sua-thu": chu_sua_thu, "/api/chu-da-them": chu_da_them, "/api/chu-tim-phong": chu_tim_phong, "/api/in-may": lambda _: hoi_may_in(in_pdf.ds_may_in), "/api/in-kha-nang": lambda d: hoi_may_in(lambda: in_pdf.kha_nang(d["may_in"])), "/api/in-khung": in_khung, "/api/in-tuy-chon": in_tuy_chon, "/api/pdf-nhap": pdf_nhap, "/api/pdf-trong": pdf_trong, "/api/chon-thu-muc": chon_thu_muc, "/api/anh-ghi": anh_ghi, "/api/toan-man": toan_man, "/api/them-mau": them_mau, "/api/mo-thu-vien": mo_thu_vien, "/api/dong-goc": dong_goc, "/api/chep-anh": chep_anh, "/api/chep-duong": chep_duong, "/api/chep-tep": chep_tep, "/api/dan-tep": dan_tep, "/api/doi-ten": doi_ten, "/api/xoa-tep": xoa_tep, "/api/hien-tep": hien_tep, "/api/mo-ngoai": mo_ngoai, "/api/mo": lambda d: mo_moi(d.get("duong", ""), d.get("tep"))}.get(urlparse(self.path).path)
        if not viec:
            raise LoiApp(404, "Không có việc này.")
        self._json(200, viec(d))


def mo_cua_so(dia_chi: str, ten: str) -> bool:
    """Mở cửa sổ app riêng. Máy thiếu thư viện cửa sổ thì trả False để mở bằng trình duyệt."""
    global CUA_SO
    try:
        import webview
    except ImportError:
        return False
    CUA_SO = cua_so = webview.create_window(f"{ten} - Sửa TeX", dia_chi, width=1440, height=900, min_size=(1000, 640), text_select=True)

    def khi_dong():
        if not CHUA_LUU:
            return True
        hoi = ctypes.windll.user32.MessageBoxW(0, "File đang mở có thay đổi chưa lưu. Đóng app và bỏ các thay đổi đó?", "Sửa TeX", 0x34)
        return hoi == 6  # 6 là nút Yes

    cua_so.events.closing += khi_dong
    webview.start()
    os._exit(0)  # máy chủ chạy nền không được giữ tiến trình lại sau khi đóng cửa sổ


def gui_sang_cua_so_dang_chay(duong, gop=None, chuyen=None) -> bool:
    try:
        cong = int(CONG_DANG_CHAY.read_text(encoding="utf-8"))
        kn = http.client.HTTPConnection("127.0.0.1", cong, timeout=3)
        try:
            kn.request("POST", "/api/mo-ngoai", json.dumps({"duong": duong, "gop": gop, "chuyen": chuyen}).encode("utf-8"),
                       {"Content-Type": "application/json", "X-App": "sua-tex"})
            if kn.getresponse().status >= 400:
                return False
        finally:
            kn.close()
        return True
    except (OSError, ValueError, http.client.HTTPException):
        return False  # cửa sổ cũ đã tắt, file cổng còn sót lại


def mo_luc_dau(duong) -> None:
    """Không truyền gì, hoặc truyền PDF: dùng thư mục mở gần nhất, chưa có thì app trống."""
    global DA, GOC_HIEN, PDF_DAU
    p = Path(duong).resolve() if duong else None
    if p and p.suffix.lower() == ".pdf":
        PDF_DAU, p = str(p), None
    co = goc_chua(p) if p else None
    if p:
        DA = loi.mo_duong(Path(co) if co else p)
        if co:
            DA["tep_dau"] = str(p)
        GOC_HIEN = co or them_goc(str(p), DA)
    else:
        for x in reversed(doc_goc()):
            try:
                DA, GOC_HIEN = loi.mo_duong(Path(x)), x
                break
            except (ValueError, KeyError, OSError):
                continue
        else:
            DA = loi.lap_du_an({}, Path.home(), "Sửa TeX")
    loi.dat_du_an(DA)


def chuyen_thanh_pdf(ds: list) -> None:
    """Gọi từ menu chuột phải của Explorer. Không mở cửa sổ app, chỉ hiện cửa sổ tiến trình nhỏ."""
    import tien_trinh
    tien_trinh.chay([Path(x) for x in ds])


def chuyen_vao_tam(ds: list, tam: Path, tieu_de: str) -> dict:
    """Chuyển song song sang PDF tạm. Trả về {vị trí trong ds: PDF}; file lỗi thì báo một lần sau khi cả lô xong."""
    import chuyen_pdf
    ps = [Path(x) for x in ds]
    ra, bao_loi = {}, []

    def bao(viec, i, gt):
        if viec == "xong":
            ra[i] = gt
        elif viec == "loi":
            bao_loi.append(f"{ps[i].name}\n\n{gt}")

    chuyen_pdf.chuyen_nhieu([(p, tam / f"{i}" / f"{p.stem}.pdf") for i, p in enumerate(ps)], bao)
    for chu in bao_loi:
        ctypes.windll.user32.MessageBoxW(0, chu, f"Sửa TeX - {tieu_de}", 0x10)
    return ra


def chuyen_de_mo(ds: list) -> list:
    """Chuyển thành PDF tạm để mở trong app, người dùng tự lưu. Không ghi gì vào thư mục của file gốc."""
    ra = chuyen_vao_tam(ds, Path(tempfile.mkdtemp(prefix="SuaTeX-chuyen-")), "Chuyển thành PDF")
    return [{"duong": str(ra[i]), "thu_muc": str(Path(ds[i]).parent)} for i in sorted(ra)]


def cho_gom_file(thu: Path, duong: str) -> list:
    """Explorer chạy một tiến trình cho mỗi file đã chọn. Tiến trình đầu tiên giành được khoá thì đợi các tiến trình kia ghi tên file,
    rồi gom tất cả lại; các tiến trình còn lại chỉ ghi tên rồi thoát. Trả về danh sách rỗng nếu không phải tiến trình gom."""
    thu.mkdir(exist_ok=True)
    # Đồng hồ Windows không đủ mịn, các tiến trình chạy cùng lúc sẽ trùng giờ nên tên file phải có mã tiến trình.
    (thu / f"{time.time_ns():020d}-{os.getpid()}.txt").write_text(duong, encoding="utf-8")
    khoa = thu / "khoa"
    try:
        if khoa.exists() and time.time() - khoa.stat().st_mtime > 30:
            khoa.unlink()  # tiến trình gom trước đó chết giữa chừng
        os.close(os.open(khoa, os.O_CREAT | os.O_EXCL))
    except OSError:
        return []
    time.sleep(1.2)
    khoa.unlink(missing_ok=True)
    ra = []
    for f in sorted(thu.glob("*.txt")):
        try:
            ra.append(f.read_text(encoding="utf-8"))
            f.unlink()
        except OSError:
            pass
    return ra


def gop_thanh_pdf(ds: list) -> list:
    """File không phải PDF được chuyển thành PDF tạm trước, rồi mới đưa vào công cụ gộp. Giữ nguyên thứ tự đã chọn."""
    can_chuyen = [i for i, x in enumerate(ds) if Path(x).suffix.lower() != ".pdf"]
    ra = chuyen_vao_tam([ds[i] for i in can_chuyen], Path(tempfile.mkdtemp(prefix="SuaTeX-gop-")), "Gộp thành PDF")
    moi = {i: str(ra[j]) for j, i in enumerate(can_chuyen) if j in ra}
    return [moi.get(i, str(Path(x))) for i, x in enumerate(ds) if i in moi or i not in can_chuyen]


def main():
    global CONG, GOP_DAU, CHUYEN_DAU
    gop = None
    if "--chuyen-mo" in sys.argv:
        i = sys.argv.index("--chuyen-mo")
        ds = cho_gom_file(Path(tempfile.gettempdir()) / "SuaTeX-chuyen", sys.argv[i + 1])
        del sys.argv[i:i + 2]
        if not ds:
            return
        CHUYEN_DAU = chuyen_de_mo(ds)
        if not CHUYEN_DAU:
            return
    if "--gop" in sys.argv:
        i = sys.argv.index("--gop")
        gop = cho_gom_file(Path(tempfile.gettempdir()) / "SuaTeX-gop", sys.argv[i + 1])
        del sys.argv[i:i + 2]
        if not gop:
            return
        gop = gop_thanh_pdf(gop)
        if not gop:
            return
        GOP_DAU = gop
    if "--chuyen-pdf" in sys.argv:
        return chuyen_thanh_pdf(sys.argv[sys.argv.index("--chuyen-pdf") + 1:])
    if "--go-cai-dat" in sys.argv:
        import cai_dat
        return cai_dat.go("--im" in sys.argv)
    if sys.stdout:
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("du_an", nargs="?", default=str(MAC_DINH) if MAC_DINH else None)
    ap.add_argument("--cong", type=int)
    ap.add_argument("--khong-mo", action="store_true")
    ap.add_argument("--trinh-duyet", action="store_true")
    a = ap.parse_args()
    # Cửa sổ app lấy cổng trống bất kỳ. Bản đã cài chỉ giữ một cửa sổ để file luôn mở thành thẻ trong đó.
    cua_so = not (a.khong_mo or a.trinh_duyet)
    if cua_so and duong_app.DA_DONG_GOI and gui_sang_cua_so_dang_chay(a.du_an, gop, CHUYEN_DAU):
        return
    mo_luc_dau(a.du_an)
    may = ThreadingHTTPServer(("127.0.0.1", a.cong if a.cong is not None else (0 if cua_so else CONG)), XuLy)
    CONG = may.server_address[1]
    dia_chi = f"http://127.0.0.1:{CONG}/"
    if sys.stdout:
        print(f"Đang mở dự án {DA['ten']} tại {dia_chi} (Ctrl+C để tắt)")
    if cua_so:
        threading.Thread(target=may.serve_forever, daemon=True).start()
        CONG_DANG_CHAY.write_text(str(CONG), encoding="utf-8")
        threading.Thread(target=lambda: (_nap_cong_cu_pdf(), _nap_in_pdf()), daemon=True).start()  # nạp nền trong lúc WebView2 khởi động
        if mo_cua_so(dia_chi, DA["ten"]):
            return
        import webbrowser
        webbrowser.open(dia_chi)
        threading.Event().wait()
    if a.trinh_duyet:
        import webbrowser
        threading.Timer(0.3, webbrowser.open, [dia_chi]).start()
    try:
        may.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
