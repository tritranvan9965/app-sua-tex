"""Máy chủ cục bộ của app sửa .tex. Chỉ dùng thư viện chuẩn của Python.

Cách dùng: mo-app.bat (dữ liệu thử), hoặc
    python -I ma-nguon/app.py [du-an.json | file.tex | file.pdf | thư mục] [--cong 8765] [--khong-mo] [--trinh-duyet]
Bản đã cài chỉ có một cửa sổ: mở thêm file thì file đó được gửi sang cửa sổ đang chạy.
Mặc định mở cửa sổ app riêng; --trinh-duyet mở bằng trình duyệt, --khong-mo chỉ chạy máy chủ.
"""
import argparse
import base64
import ctypes
import json
import mimetypes
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

GOC_APP = Path(__file__).resolve().parent
sys.path.insert(0, str(GOC_APP))
import bien_dich  # noqa: E402
import cong_cu_pdf  # noqa: E402
import duong_app  # noqa: E402
import loi  # noqa: E402

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
        raise LoiApp(404, "Chưa có PDF. Bấm Biên dịch trước.")
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


def pdf_ghi(d: dict) -> dict:
    trang = [{**x, "so": int(x["so"]), "anh": base64.b64decode(x["anh"]) if x.get("anh") else None} for x in d.get("trang", [])]
    if any(x["duong"] not in PDF_DA_CHON for x in trang):
        raise LoiApp(403, "Trang này không thuộc file đã mở.")
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
        return cong_cu_pdf.ghep(trang, Path(dich).resolve().with_suffix(".pdf"))
    except ValueError as e:
        raise LoiApp(400, str(e))
    except PermissionError:
        raise LoiApp(409, f"File {Path(dich).name} đang mở ở phần mềm khác. Đóng file rồi lưu lại.")


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
            self._gui(200, Path(hoi["duong"]).read_bytes(), "application/pdf")
        elif url.path == "/api/gan-day":
            self._json(200, gan_day())
        elif url.path == "/api/thu-vien":
            self._json(200, thu_vien())
        elif url.path == "/api/phong":
            self._json(200, phong_may())
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
                "/api/chon-mo": chon_mo, "/api/cai-dat": ghi_cai_dat, "/api/thoat": thoat, "/api/pdf-chon": pdf_chon, "/api/pdf-ghi": pdf_ghi, "/api/pdf-nhap": pdf_nhap, "/api/pdf-trong": pdf_trong, "/api/chon-thu-muc": chon_thu_muc, "/api/anh-ghi": anh_ghi, "/api/toan-man": toan_man, "/api/them-mau": them_mau, "/api/mo-thu-vien": mo_thu_vien, "/api/dong-goc": dong_goc, "/api/chep-anh": chep_anh, "/api/chep-duong": chep_duong, "/api/chep-tep": chep_tep, "/api/dan-tep": dan_tep, "/api/doi-ten": doi_ten, "/api/xoa-tep": xoa_tep, "/api/hien-tep": hien_tep, "/api/mo-ngoai": mo_ngoai, "/api/mo": lambda d: mo_moi(d.get("duong", ""), d.get("tep"))}.get(urlparse(self.path).path)
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
        yc = urllib.request.Request(f"http://127.0.0.1:{cong}/api/mo-ngoai", json.dumps({"duong": duong, "gop": gop, "chuyen": chuyen}).encode("utf-8"),
                                    {"Content-Type": "application/json", "X-App": "sua-tex"})
        urllib.request.build_opener(urllib.request.ProxyHandler({})).open(yc, timeout=3).close()
        return True
    except (OSError, ValueError):
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


def chuyen_de_mo(ds: list) -> list:
    """Chuyển thành PDF tạm để mở trong app, người dùng tự lưu. Không ghi gì vào thư mục của file gốc."""
    import chuyen_pdf
    tam = Path(tempfile.mkdtemp(prefix="SuaTeX-chuyen-"))
    ra = []
    for i, x in enumerate(ds):
        p = Path(x)
        try:
            ra.append({"duong": str(chuyen_pdf.chuyen(p, tam / f"{i}" / f"{p.stem}.pdf")), "thu_muc": str(p.parent)})
        except Exception as e:
            ctypes.windll.user32.MessageBoxW(0, f"{p.name}\n\n{e}", "Sửa TeX - Chuyển thành PDF", 0x10)
    return ra


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
    """File không phải PDF được chuyển thành PDF tạm trước, rồi mới đưa vào công cụ gộp."""
    import chuyen_pdf
    tam = Path(tempfile.mkdtemp(prefix="SuaTeX-gop-"))
    ra = []
    for i, x in enumerate(ds):
        p = Path(x)
        if p.suffix.lower() == ".pdf":
            ra.append(str(p))
            continue
        try:
            ra.append(str(chuyen_pdf.chuyen(p, tam / f"{i}" / f"{p.stem}.pdf")))
        except Exception as e:
            ctypes.windll.user32.MessageBoxW(0, f"{p.name}\n\n{e}", "Sửa TeX - Gộp thành PDF", 0x10)
    return ra


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
        if mo_cua_so(dia_chi, DA["ten"]):
            return
        webbrowser.open(dia_chi)
        threading.Event().wait()
    if a.trinh_duyet:
        threading.Timer(0.3, webbrowser.open, [dia_chi]).start()
    try:
        may.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
