"""Đăng ký và gỡ app với Windows, chỉ trong tài khoản đang dùng nên không cần quyền quản trị.

Windows không cho phần mềm tự đặt mình làm app mặc định cho .pdf: lựa chọn đó do người dùng bấm trong Cài đặt.
App chỉ khai với Windows để hiện trong danh sách đó và trong Open with.
"""
import ctypes
import os
import shutil
import subprocess
import sys
import winreg
from pathlib import Path

TEN = "Sửa TeX"
MA = "SuaTeX"
PHIEN_BAN = "1.0.0"
THU_MUC_CAI = Path(os.environ["LOCALAPPDATA"]) / "Programs" / MA
EXE = THU_MUC_CAI / f"{MA}.exe"
UNINSTALL = rf"Software\Microsoft\Windows\CurrentVersion\Uninstall\{MA}"
LOP = r"Software\Classes"
LOAI = {".tex": ("Tài liệu LaTeX", f"{MA}.tex"), ".pdf": ("Tài liệu PDF", f"{MA}.pdf")}
MENU_FILE = [rf"{LOP}\SystemFileAssociations\{d}\shell\{MA}" for d in LOAI]
MENU_THU_MUC = rf"{LOP}\Directory\shell\{MA}"


def thu_muc_he_thong(ma: int) -> Path:
    """Hỏi Windows chứ không tự ghép đường dẫn, vì Desktop có thể nằm trong OneDrive và mang tên tiếng Việt."""
    o = ctypes.create_unicode_buffer(520)
    ctypes.windll.shell32.SHGetFolderPathW(0, ma, 0, 0, o)
    return Path(o.value)


LOI_TAT = [thu_muc_he_thong(m) / f"{TEN}.lnk" for m in (0x02, 0x10)]  # menu Start, màn hình nền


def hoi(chu: str, kieu: int = 0x40) -> int:
    return ctypes.windll.user32.MessageBoxW(0, chu, TEN, kieu)


def ghi(khoa: str, gia_tri: dict) -> None:
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, khoa, 0, winreg.KEY_SET_VALUE) as k:
        for ten, v in gia_tri.items():
            winreg.SetValueEx(k, ten, 0, winreg.REG_DWORD if isinstance(v, int) else winreg.REG_SZ, v)


def xoa_cay(khoa: str) -> None:
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, khoa, 0, winreg.KEY_READ | winreg.KEY_WRITE) as k:
            while True:
                try:
                    xoa_cay(f"{khoa}\\{winreg.EnumKey(k, 0)}")
                except OSError:
                    break
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, khoa)
    except FileNotFoundError:
        pass


def doc(khoa: str, ten: str = ""):
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, khoa) as k:
            return winreg.QueryValueEx(k, ten)[0]
    except OSError:
        return None


def bao_doi_loai_file() -> None:
    ctypes.windll.shell32.SHChangeNotify(0x08000000, 0, None, None)  # để File Explorer nhận menu và biểu tượng mới ngay


def tao_loi_tat(p: Path) -> None:
    # WScript.Shell không ghi được tên có chữ tiếng Việt, nên tạo bằng tên tạm rồi đổi tên.
    lenh = ("$t=Join-Path $env:TEMP 'suatex-tam.lnk'; $s=(New-Object -ComObject WScript.Shell).CreateShortcut($t); "
            "$s.TargetPath=$env:DICH; $s.WorkingDirectory=$env:CHO; $s.Save(); Move-Item -Force -LiteralPath $t -Destination $env:LOI_TAT")
    subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", lenh], check=True, capture_output=True,
                   env={**os.environ, "LOI_TAT": str(p), "DICH": str(EXE), "CHO": str(THU_MUC_CAI)}, creationflags=subprocess.CREATE_NO_WINDOW)


def dang_ky() -> None:
    mo = f'"{EXE}" "%1"'
    for duoi, (mo_ta, lop) in LOAI.items():
        ghi(rf"{LOP}\{lop}", {"": mo_ta})
        ghi(rf"{LOP}\{lop}\DefaultIcon", {"": f"{EXE},0"})
        ghi(rf"{LOP}\{lop}\shell\open\command", {"": mo})
        ghi(rf"{LOP}\{duoi}\OpenWithProgids", {lop: ""})
        ghi(rf"{LOP}\{duoi}", {"": lop})
    for k in MENU_FILE:
        ghi(k, {"": f"Mở bằng {TEN}", "Icon": f"{EXE},0"})
        ghi(rf"{k}\command", {"": mo})
    ghi(MENU_THU_MUC, {"": f"Mở thư mục bằng {TEN}", "Icon": f"{EXE},0"})
    ghi(rf"{MENU_THU_MUC}\command", {"": mo})
    # Khai với Windows để app hiện trong Cài đặt > Ứng dụng mặc định.
    ghi(rf"{LOP}\Applications\{MA}.exe", {"FriendlyAppName": TEN})
    ghi(rf"{LOP}\Applications\{MA}.exe\shell\open\command", {"": mo})
    ghi(rf"{LOP}\Applications\{MA}.exe\SupportedTypes", {d: "" for d in LOAI})
    nang_luc = rf"Software\{MA}\Capabilities"
    ghi(nang_luc, {"ApplicationName": TEN, "ApplicationDescription": "Sửa file .tex và xem, tách, gộp, in PDF"})
    ghi(rf"{nang_luc}\FileAssociations", {d: lop for d, (_, lop) in LOAI.items()})
    ghi(r"Software\RegisteredApplications", {MA: nang_luc})
    ghi(UNINSTALL, {"DisplayName": TEN, "DisplayVersion": PHIEN_BAN, "Publisher": TEN, "DisplayIcon": f"{EXE},0",
                    "InstallLocation": str(THU_MUC_CAI), "UninstallString": f'"{EXE}" --go-cai-dat', "NoModify": 1, "NoRepair": 1,
                    "EstimatedSize": sum(f.stat().st_size for f in THU_MUC_CAI.rglob("*") if f.is_file()) // 1024})
    for p in LOI_TAT:
        tao_loi_tat(p)
    bao_doi_loai_file()


def bo_dang_ky() -> None:
    for d, (_, lop) in LOAI.items():
        xoa_cay(rf"{LOP}\{lop}")
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, rf"{LOP}\{d}\OpenWithProgids", 0, winreg.KEY_SET_VALUE) as k:
                winreg.DeleteValue(k, lop)
        except OSError:
            pass
        if doc(rf"{LOP}\{d}") == lop:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, rf"{LOP}\{d}", 0, winreg.KEY_SET_VALUE) as k:
                winreg.DeleteValue(k, "")
    for k in [*MENU_FILE, MENU_THU_MUC, rf"{LOP}\Applications\{MA}.exe", rf"Software\{MA}", UNINSTALL]:
        xoa_cay(k)
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\RegisteredApplications", 0, winreg.KEY_SET_VALUE) as k:
            winreg.DeleteValue(k, MA)
    except OSError:
        pass
    for p in LOI_TAT:
        p.unlink(missing_ok=True)
    bao_doi_loai_file()


def go(im_lang: bool = False) -> None:
    """Gọi từ chính file exe đang cài, nên phải để cmd xoá thư mục sau khi exe đã thoát.
    Cài đặt và mẫu trong %APPDATA% được giữ lại."""
    if not im_lang and hoi(f"Gỡ {TEN} khỏi máy? File .tex, .pdf và mẫu của bạn không bị xoá.", 0x34) != 6:
        return
    bo_dang_ky()
    subprocess.Popen(f'cmd /c ping -n 3 127.0.0.1 >nul & rmdir /s /q "{THU_MUC_CAI}"', cwd=os.environ["TEMP"],
                     creationflags=subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS)
    sys.exit(0)
