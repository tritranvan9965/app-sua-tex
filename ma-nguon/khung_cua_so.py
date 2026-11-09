"""Cửa sổ app không viền: hàng tab của ribbon làm thanh tiêu đề.

pywebview tạo cửa sổ không viền thì mất luôn khung đổi cỡ, Snap và nút hệ thống. Ở đây bù lại bằng WinAPI:
- thêm kiểu WS_THICKFRAME / MINIMIZEBOX / MAXIMIZEBOX để Win+mũi tên, phóng to đúng vùng làm việc (không đè thanh taskbar);
- chặn WM_NCCALCSIZE để vùng làm việc phủ kín cửa sổ (không còn viền tiêu đề hay viền dày). Việc này làm trong khung_cua_so.dll
  (mã C, khung_cua_so.c), không làm bằng ctypes: thủ tục cửa sổ viết bằng Python bắt luồng giao diện giành GIL nên treo app khi một
  luồng Python khác chờ luồng giao diện (restore(), hộp chọn file của pywebview);
- kéo cửa sổ và đổi cỡ bằng mép do giao diện báo (mousedown), rồi một luồng đọc vị trí chuột đến khi nhả nút.
  Cách này không dùng WM_NCLBUTTONDOWN vì WebView2 giữ chuột nên kéo xong lần đầu thì các lần sau không còn nhận mousedown.
"""
import ctypes
import sys
import threading
import time
from ctypes import wintypes
from pathlib import Path

u = ctypes.windll.user32
u.SetForegroundWindow.argtypes = [wintypes.HWND]
u.IsIconic.argtypes = [wintypes.HWND]
u.GetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int]
u.GetWindowLongW.restype = ctypes.c_long
u.SetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_long]
u.GetDpiForWindow.argtypes = [wintypes.HWND]
u.MonitorFromWindow.argtypes = [wintypes.HWND, wintypes.DWORD]
u.MonitorFromWindow.restype = wintypes.HANDLE
u.MonitorFromPoint.argtypes = [wintypes.POINT, wintypes.DWORD]
u.MonitorFromPoint.restype = wintypes.HANDLE
u.GetMonitorInfoW.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
u.IsZoomed.argtypes = [wintypes.HWND]
u.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
u.GetWindowPlacement.argtypes = [wintypes.HWND, ctypes.c_void_p]
u.SetWindowPlacement.argtypes = [wintypes.HWND, ctypes.c_void_p]
u.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]

GWL_STYLE = -16
WS_MAXIMIZE, WS_THICKFRAME, WS_MINIMIZEBOX, WS_MAXIMIZEBOX = 0x1000000, 0x40000, 0x20000, 0x10000
SWP_NOSIZE, SWP_NOMOVE, SWP_NOZORDER, SWP_NOACTIVATE, SWP_FRAMECHANGED = 0x1, 0x2, 0x4, 0x10, 0x20
SWP_NOOWNERZORDER = 0x200
SW_SHOWNORMAL, SW_MAXIMIZE, SW_MINIMIZE, SW_RESTORE = 1, 3, 6, 9
MONITOR_NEAREST = 2
VK_LBUTTON = 1
CHAM = 0.008  # giây giữa hai lần đọc vị trí chuột


def _nap_dll():
    """Bản cài: DLL nằm cạnh TriTeX.exe. Chạy từ mã nguồn: nằm cạnh file này (biên dịch từ khung_cua_so.c)."""
    cho = Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).parent
    try:
        dll = ctypes.WinDLL(str(cho / "khung_cua_so.dll"))
    except OSError:
        return None  # thiếu DLL thì cửa sổ còn viền Windows, vẫn hơn treo app
    dll.gan_khung.argtypes = [wintypes.HWND]
    return dll


DLL = _nap_dll()


class _WindowPlacement(ctypes.Structure):
    _fields_ = [("length", wintypes.UINT), ("flags", wintypes.UINT), ("showCmd", wintypes.UINT),
                ("ptMin", wintypes.POINT), ("ptMax", wintypes.POINT), ("rcNormal", wintypes.RECT)]


class _MonitorInfo(ctypes.Structure):
    _fields_ = [("cb", wintypes.DWORD), ("man_hinh", wintypes.RECT), ("lam_viec", wintypes.RECT), ("co", wintypes.DWORD)]


def _vung_lam_viec(man_hinh) -> wintypes.RECT:
    mi = _MonitorInfo()
    mi.cb = ctypes.sizeof(_MonitorInfo)
    u.GetMonitorInfoW(man_hinh, ctypes.byref(mi))
    return mi.lam_viec


def _chuot() -> tuple[int, int]:
    p = wintypes.POINT()
    u.GetCursorPos(ctypes.byref(p))
    return p.x, p.y


def _dang_nhan() -> bool:
    return bool(u.GetAsyncKeyState(VK_LBUTTON) & 0x8000)


class KhungCuaSo:
    def __init__(self, cua_so, nho_nhat: tuple[int, int]):
        self.cua_so = cua_so
        self.nho_nhat = nho_nhat
        self._hwnd = None
        self._dang_keo = threading.Lock()
        self._truoc_toan_man = None  # (kiểu, vị trí) của cửa sổ trước khi toàn màn hình

    @property
    def hwnd(self) -> int:
        # Lấy một lần rồi nhớ: đọc thuộc tính .NET từ luồng khác mỗi lần kéo chuột là không cần thiết.
        if self._hwnd is None:
            self._hwnd = self.cua_so.native.Handle.ToInt64()
        return self._hwnd

    # ---------- Kiểu cửa sổ ----------

    def ap_dung(self) -> None:
        """Gọi sau khi cửa sổ hiện, và gọi lại sau khi WinForms đặt lại kiểu (vào, ra toàn màn hình)."""
        h = self.hwnd
        kieu = (u.GetWindowLongW(h, GWL_STYLE) & 0xFFFFFFFF) | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX
        u.SetWindowLongW(h, GWL_STYLE, ctypes.c_long(kieu).value)  # c_long tự đổi sang số âm khi bit cao bật
        if DLL:
            DLL.gan_khung(h)
        u.SetWindowPos(h, 0, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED)

    # ---------- Nút hệ thống ----------

    def trang_thai(self) -> dict:
        return {"phong_to": bool(u.IsZoomed(self.hwnd))}

    def dua_len(self) -> None:
        """Đưa cửa sổ lên trước khi lần mở sau gửi file sang. Dùng WinAPI thay cho restore()/on_top của pywebview,
        vì các hàm đó gọi Invoke của .NET từ luồng này và chờ luồng giao diện."""
        h = self.hwnd
        if u.IsIconic(h):
            u.ShowWindow(h, SW_RESTORE)
        u.SetForegroundWindow(h)

    def thu_nho(self) -> None:
        u.ShowWindow(self.hwnd, SW_MINIMIZE)

    def doi_phong_to(self) -> dict:
        h = self.hwnd
        u.ShowWindow(h, SW_RESTORE if u.IsZoomed(h) else SW_MAXIMIZE)
        return self.trang_thai()

    # ---------- Toàn màn hình ----------

    def toan_man(self, bat: bool) -> None:
        """Phủ khít cả màn hình, che luôn taskbar. Không dùng toggle_fullscreen() của pywebview: hàm đó để cửa sổ ở trạng thái
        phóng to, khung_cua_so.dll thấy phóng to thì thu vùng làm việc về trừ taskbar, nên chỗ taskbar thành dải trắng."""
        h = self.hwnd
        if bat == (self._truoc_toan_man is not None):
            return
        if bat:
            vi_tri = _WindowPlacement()
            vi_tri.length = ctypes.sizeof(_WindowPlacement)
            u.GetWindowPlacement(h, ctypes.byref(vi_tri))
            kieu = u.GetWindowLongW(h, GWL_STYLE) & 0xFFFFFFFF
            self._truoc_toan_man = (kieu, vi_tri)
            mi = _MonitorInfo()
            mi.cb = ctypes.sizeof(_MonitorInfo)
            u.GetMonitorInfoW(u.MonitorFromWindow(h, MONITOR_NEAREST), ctypes.byref(mi))
            m = mi.man_hinh
            if u.IsZoomed(h):
                # Đang phóng to thì khung_cua_so.dll thu vùng làm việc về trừ taskbar, nên phải về cỡ thường trước.
                # ShowWindow(SW_RESTORE) từ luồng này không có tác dụng, bỏ cờ WS_MAXIMIZE thì WinForms trả về cỡ cũ.
                thuong = _WindowPlacement.from_buffer_copy(vi_tri)
                thuong.showCmd, thuong.rcNormal = SW_SHOWNORMAL, m
                u.SetWindowPlacement(h, ctypes.byref(thuong))
            # Bỏ khung đổi cỡ để Windows coi đây là cửa sổ toàn màn hình (taskbar tự lùi xuống dưới).
            u.SetWindowLongW(h, GWL_STYLE, ctypes.c_long(kieu & ~(WS_MAXIMIZE | WS_THICKFRAME | WS_MAXIMIZEBOX)).value)
            u.SetWindowPos(h, 0, m.left, m.top, m.right - m.left, m.bottom - m.top, SWP_NOOWNERZORDER | SWP_FRAMECHANGED)
            u.SetForegroundWindow(h)
        else:
            kieu, vi_tri = self._truoc_toan_man
            self._truoc_toan_man = None
            # Cờ phóng to để SetWindowPlacement tự bật lại, nếu bật sẵn thì nó coi như đã phóng to và không đổi cỡ.
            u.SetWindowLongW(h, GWL_STYLE, ctypes.c_long(kieu & ~WS_MAXIMIZE).value)
            u.SetWindowPos(h, 0, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED)
            u.SetWindowPlacement(h, ctypes.byref(vi_tri))  # trả lại cỡ cũ, kể cả đang phóng to

    # ---------- Kéo, đổi cỡ ----------

    def keo(self) -> None:
        """Giao diện báo vừa nhấn chuột lên thanh tiêu đề. Luồng này theo chuột đến khi nhả."""
        self._chay(self._lap_keo)

    def doi_co(self, huong: str) -> None:
        """huong: tổ hợp t (trên), d (dưới), l (trái), r (phải)."""
        if huong and set(huong) <= set("tdlr"):
            self._chay(lambda: self._lap_co(huong))

    def _chay(self, viec) -> None:
        def chay():
            if not self._dang_keo.acquire(blocking=False):
                return
            try:
                viec()
            finally:
                self._dang_keo.release()
        threading.Thread(target=chay, daemon=True).start()

    def _lap_keo(self) -> None:
        h = self.hwnd
        if not _dang_nhan():
            return
        x0, y0 = _chuot()
        r = wintypes.RECT()
        u.GetWindowRect(h, ctypes.byref(r))
        lech = [x0 - r.left, y0 - r.top]
        phong_to, da_di = bool(u.IsZoomed(h)), False
        while _dang_nhan():
            x, y = _chuot()
            if phong_to:
                if abs(x - x0) < 6 and abs(y - y0) < 6:
                    time.sleep(CHAM)
                    continue
                # Kéo cửa sổ đang phóng to ra thì khôi phục, con trỏ giữ nguyên tỉ lệ ngang trên thanh như Windows.
                ti_le = (x0 - r.left) / max(1, r.right - r.left)
                u.ShowWindow(h, SW_RESTORE)
                u.GetWindowRect(h, ctypes.byref(r))
                lech = [int(ti_le * (r.right - r.left)), min(y0 - r.top, 30)]
                phong_to = False
            u.SetWindowPos(h, 0, x - lech[0], y - lech[1], 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE)
            da_di = True
            time.sleep(CHAM)
        if not da_di:
            return
        # Nhả sát mép màn hình thì dán vào như Snap của Windows: mép trên là phóng to, mép trái hoặc phải là nửa màn hình.
        p = wintypes.POINT(*_chuot())
        lv = _vung_lam_viec(u.MonitorFromPoint(p, MONITOR_NEAREST))
        if p.y <= lv.top + 1:
            u.ShowWindow(h, SW_MAXIMIZE)
        elif p.x <= lv.left + 1 or p.x >= lv.right - 2:
            rong = (lv.right - lv.left) // 2
            u.SetWindowPos(h, 0, lv.left if p.x <= lv.left + 1 else lv.right - rong, lv.top, rong, lv.bottom - lv.top, SWP_NOZORDER | SWP_NOACTIVATE)

    def _lap_co(self, huong: str) -> None:
        h = self.hwnd
        if not _dang_nhan() or u.IsZoomed(h):
            return
        x0, y0 = _chuot()
        g = wintypes.RECT()
        u.GetWindowRect(h, ctypes.byref(g))
        ti_le = u.GetDpiForWindow(h) / 96
        rong_min, cao_min = int(self.nho_nhat[0] * ti_le), int(self.nho_nhat[1] * ti_le)
        while _dang_nhan():
            x, y = _chuot()
            trai, tren, phai, duoi = g.left, g.top, g.right, g.bottom
            if "l" in huong:
                trai = min(g.left + x - x0, g.right - rong_min)
            if "r" in huong:
                phai = max(g.right + x - x0, g.left + rong_min)
            if "t" in huong:
                tren = min(g.top + y - y0, g.bottom - cao_min)
            if "d" in huong:
                duoi = max(g.bottom + y - y0, g.top + cao_min)
            u.SetWindowPos(h, 0, trai, tren, phai - trai, duoi - tren, SWP_NOZORDER | SWP_NOACTIVATE)
            time.sleep(CHAM)
