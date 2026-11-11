"""Bộ cài: một file exe chứa sẵn app. Giải nén vào thư mục của người dùng rồi đăng ký với Windows.
Chạy với /im để không hiện hộp thoại."""
import ctypes
import shutil
import subprocess
import sys
import time
import winreg
import zipfile
from pathlib import Path

import cai_dat as cd

GOI = Path(getattr(sys, "_MEIPASS", Path(__file__).parent)) / "tritex.zip"
HUONG_DAN = ("Đã cài xong. Có biểu tượng trên màn hình nền và menu Start, chuột phải vào file .tex, .pdf sẽ có mục Mở bằng TriTeX.\n\n"
             "Windows không cho phần mềm tự đặt mình làm app mặc định. Để mở PDF, .tex bằng TriTeX khi bấm đúp:\n"
             "chuột phải vào file > Open with > Choose another app > TriTeX > tích Always use this app.\n\n"
             "Muốn biên dịch .tex thì máy cần có MiKTeX hoặc TeX Live.\n\nMở trang Ứng dụng mặc định của Windows ngay bây giờ?")


def co_webview2() -> bool:
    ma = r"Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    for goc, khoa in [(winreg.HKEY_LOCAL_MACHINE, rf"SOFTWARE\WOW6432Node\{ma}"), (winreg.HKEY_LOCAL_MACHINE, rf"SOFTWARE\{ma}"), (winreg.HKEY_CURRENT_USER, rf"Software\{ma}")]:
        try:
            with winreg.OpenKey(goc, khoa) as k:
                if winreg.QueryValueEx(k, "pv")[0] not in ("", "0.0.0.0"):
                    return True
        except OSError:
            pass
    return False


def cho_app_thoat(giay: int = 30) -> bool:
    """Cài do app gọi (/capnhat): app cũ đang tự thoát, nên thử lại tới khi exe được mở để ghi (nghĩa là không còn chạy)."""
    han = time.monotonic() + giay
    while True:
        try:
            if cd.EXE.is_file():
                open(cd.EXE, "ab").close()
            return True
        except PermissionError:
            if time.monotonic() > han:
                return False
            time.sleep(0.5)


def mo_lai_app() -> None:
    subprocess.Popen([str(cd.EXE)], cwd=str(cd.THU_MUC_CAI), close_fds=True,
                     creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP)


def chinh() -> int:
    im = "/im" in sys.argv
    cap_nhat = im and "/capnhat" in sys.argv  # do app gọi để tự cập nhật: chờ app cũ thoát, cài xong mở lại app
    if not im and cd.hoi(f"Cài {cd.TEN} {cd.PHIEN_BAN} vào máy này?\nChỉ cài cho tài khoản đang dùng, không cần quyền quản trị.", 0x24) != 6:
        return 0
    if cap_nhat and not cho_app_thoat():
        cd.hoi(f"{cd.TEN} chưa thoát hẳn nên chưa cập nhật được. Đóng {cd.TEN} rồi chạy lại bộ cài.", 0x30)
        return 1
    if cd.ban_cu_dang_chay():
        cd.hoi(f"{cd.TEN_CU} (tên cũ của {cd.TEN}) đang chạy. Đóng app rồi chạy lại bộ cài.", 0x30)
        return 1
    try:
        cu = cd.go_ban_cu()  # bản trước 1.1.0 tên Sửa TeX: gỡ đăng ký và thư mục cài, dữ liệu trong %APPDATA% giữ nguyên
        if cd.THU_MUC_CAI.exists():
            shutil.rmtree(cd.THU_MUC_CAI)
        cd.THU_MUC_CAI.mkdir(parents=True)
        with zipfile.ZipFile(GOI) as z:
            z.extractall(cd.THU_MUC_CAI)
        cd.dang_ky()
    except PermissionError:
        cd.hoi(f"{cd.TEN} đang chạy. Đóng app rồi chạy lại bộ cài.", 0x30)
        return 1
    except (OSError, subprocess.SubprocessError) as e:
        cd.hoi(f"Không cài được: {e}", 0x10)
        return 1
    if not cu:
        cd.hoi(f"Chưa xoá hết thư mục cài của {cd.TEN_CU} cũ (có file đang bị giữ). {cd.TEN} vẫn dùng bình thường, bạn có thể xoá thư mục đó sau.", 0x40)
    if cap_nhat:
        mo_lai_app()
    if im:
        return 0
    if not co_webview2():
        cd.hoi("Máy này thiếu Microsoft Edge WebView2 Runtime, app cần nó để hiện cửa sổ.\nTải miễn phí ở trang WebView2 của Microsoft rồi mở lại app.", 0x30)
    if cd.hoi(HUONG_DAN, 0x44) == 6:
        ctypes.windll.shell32.ShellExecuteW(0, "open", "ms-settings:defaultapps", None, None, 1)
    return 0


sys.exit(chinh())
