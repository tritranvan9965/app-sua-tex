"""In PDF thẳng ra máy in: PDFium vẽ từng trang vào máy in qua GDI nên chữ và nét vẫn là vector.
Máy in, khổ giấy, in 2 mặt, màu, số bản đặt qua DEVMODE của trình điều khiển máy in."""
import ctypes
from ctypes import wintypes as w
from pathlib import Path

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_c

g32, k32, u32 = ctypes.windll.gdi32, ctypes.windll.kernel32, ctypes.windll.user32
sp = ctypes.WinDLL("winspool.drv")
DM_OUT_BUFFER, DM_IN_PROMPT, DM_IN_BUFFER = 2, 4, 8
DEVMODE_RIENG = {}  # tên máy in -> cấu hình người dùng đã chọn ở bảng Printing Preferences của driver
DM_ORIENTATION, DM_PAPERSIZE, DM_COPIES, DM_COLOR, DM_DUPLEX, DM_COLLATE = 0x1, 0x2, 0x100, 0x800, 0x1000, 0x8000
DC_PAPERS, DC_PAPERSIZE, DC_DUPLEX, DC_COLORDEVICE, DC_PAPERNAMES = 2, 3, 7, 32, 16
HORZRES, VERTRES, LOGPIXELSX, LOGPIXELSY, PHYSICALWIDTH, PHYSICALHEIGHT, PHYSICALOFFSETX, PHYSICALOFFSETY = 8, 10, 88, 90, 110, 111, 112, 113
CHE_DO = ("khong", "vua", "thu", "tuy_y")


class DEVMODE_DAU(ctypes.Structure):
    """Phần đầu của DEVMODEW, đủ tới dmCollate. Phần còn lại của vùng nhớ do trình điều khiển máy in quản."""
    _fields_ = [("dmDeviceName", w.WCHAR * 32), ("dmSpecVersion", w.WORD), ("dmDriverVersion", w.WORD), ("dmSize", w.WORD),
                ("dmDriverExtra", w.WORD), ("dmFields", w.DWORD), ("dmOrientation", ctypes.c_short), ("dmPaperSize", ctypes.c_short),
                ("dmPaperLength", ctypes.c_short), ("dmPaperWidth", ctypes.c_short), ("dmScale", ctypes.c_short), ("dmCopies", ctypes.c_short),
                ("dmDefaultSource", ctypes.c_short), ("dmPrintQuality", ctypes.c_short), ("dmColor", ctypes.c_short), ("dmDuplex", ctypes.c_short),
                ("dmYResolution", ctypes.c_short), ("dmTTOption", ctypes.c_short), ("dmCollate", ctypes.c_short)]


class DOCINFOW(ctypes.Structure):
    _fields_ = [("cbSize", ctypes.c_int), ("lpszDocName", w.LPCWSTR), ("lpszOutput", w.LPCWSTR), ("lpszDatatype", w.LPCWSTR), ("fwType", w.DWORD)]


class PRINTER_INFO_4(ctypes.Structure):
    _fields_ = [("pPrinterName", w.LPWSTR), ("pServerName", w.LPWSTR), ("Attributes", w.DWORD)]


sp.OpenPrinterW.argtypes = [w.LPWSTR, ctypes.POINTER(w.HANDLE), ctypes.c_void_p]
sp.ClosePrinter.argtypes = [w.HANDLE]
sp.DocumentPropertiesW.argtypes = [w.HWND, w.HANDLE, w.LPWSTR, ctypes.c_void_p, ctypes.c_void_p, w.DWORD]
sp.DocumentPropertiesW.restype = ctypes.c_long
sp.DeviceCapabilitiesW.argtypes = [w.LPCWSTR, w.LPCWSTR, w.WORD, ctypes.c_void_p, ctypes.c_void_p]
sp.DeviceCapabilitiesW.restype = ctypes.c_int
sp.PrinterProperties.argtypes = [w.HWND, w.HANDLE]
sp.EnumPrintersW.argtypes = [w.DWORD, w.LPWSTR, w.DWORD, ctypes.c_void_p, w.DWORD, ctypes.POINTER(w.DWORD), ctypes.POINTER(w.DWORD)]
sp.GetDefaultPrinterW.argtypes = [w.LPWSTR, ctypes.POINTER(w.DWORD)]
g32.CreateDCW.argtypes, g32.CreateDCW.restype = [w.LPCWSTR, w.LPCWSTR, w.LPCWSTR, ctypes.c_void_p], w.HDC
g32.DeleteDC.argtypes = [w.HDC]
g32.GetDeviceCaps.argtypes = [w.HDC, ctypes.c_int]
g32.ResetDCW.argtypes, g32.ResetDCW.restype = [w.HDC, ctypes.c_void_p], w.HDC
g32.StartDocW.argtypes = [w.HDC, ctypes.POINTER(DOCINFOW)]
g32.StartPage.argtypes = g32.EndPage.argtypes = g32.EndDoc.argtypes = g32.AbortDoc.argtypes = [w.HDC]


def ds_may_in() -> dict:
    """Tên các máy in và máy in mặc định."""
    can, so = w.DWORD(), w.DWORD()
    sp.EnumPrintersW(6, None, 4, None, 0, ctypes.byref(can), ctypes.byref(so))
    ten = []
    if can.value:
        buf = ctypes.create_string_buffer(can.value)
        if sp.EnumPrintersW(6, None, 4, buf, can, ctypes.byref(can), ctypes.byref(so)):
            ds = ctypes.cast(buf, ctypes.POINTER(PRINTER_INFO_4))
            ten = [ds[i].pPrinterName for i in range(so.value)]
    n = w.DWORD(256)
    dem = ctypes.create_unicode_buffer(256)
    mac_dinh = dem.value if sp.GetDefaultPrinterW(dem, ctypes.byref(n)) else ""
    return {"ds": sorted(ten, key=str.lower), "mac_dinh": mac_dinh if mac_dinh in ten else (ten[0] if ten else "")}


def kha_nang(may_in: str) -> dict:
    """Khổ giấy, in 2 mặt, in màu mà trình điều khiển máy in báo."""
    n = sp.DeviceCapabilitiesW(may_in, None, DC_PAPERS, None, None)
    giay = []
    if n > 0:
        ma = (w.WORD * n)()
        ten = ctypes.create_unicode_buffer(64 * n)
        co = (ctypes.c_long * (2 * n))()
        sp.DeviceCapabilitiesW(may_in, None, DC_PAPERS, ma, None)
        sp.DeviceCapabilitiesW(may_in, None, DC_PAPERNAMES, ten, None)
        sp.DeviceCapabilitiesW(may_in, None, DC_PAPERSIZE, co, None)
        for i in range(n):
            giay.append({"id": ma[i], "ten": ten[64 * i:64 * i + 64].split("\0")[0], "w": co[2 * i] / 10 / 25.4 * 72, "h": co[2 * i + 1] / 10 / 25.4 * 72})
    return {"giay": giay, "hai_mat": sp.DeviceCapabilitiesW(may_in, None, DC_DUPLEX, None, None) == 1,
            "mau": sp.DeviceCapabilitiesW(may_in, None, DC_COLORDEVICE, None, None) == 1}


class MayIn:
    """Một lần in: mở máy in, đặt DEVMODE theo lựa chọn, lấy thiết bị vẽ (DC)."""

    def __init__(self, ten: str):
        self.ten, self.h, self.hdc = ten, w.HANDLE(), None
        if not sp.OpenPrinterW(ten, ctypes.byref(self.h), None):
            self.h = None
            raise OSError(f"Không mở được máy in {ten}.")
        n = sp.DocumentPropertiesW(None, self.h, ten, None, None, 0)
        if n <= 0:
            self.dong()
            raise OSError(f"Máy in {ten} không trả cấu hình.")
        self.buf = ctypes.create_string_buffer(n)
        sp.DocumentPropertiesW(None, self.h, ten, self.buf, None, DM_OUT_BUFFER)
        rieng = DEVMODE_RIENG.get(ten)
        if rieng and len(rieng) == n:
            ctypes.memmove(self.buf, rieng, n)
        self.dm = DEVMODE_DAU.from_buffer(self.buf)

    def dat(self, giay=None, huong=None, hai_mat=None, mau=None, so_ban=None, ghep=None) -> None:
        """hai_mat: 1 một mặt, 2 lật cạnh dài, 3 lật cạnh ngắn. mau: True màu, False đen trắng."""
        dm = self.dm
        if giay:
            dm.dmFields |= DM_PAPERSIZE
            dm.dmPaperSize = int(giay)
        if huong:
            dm.dmFields |= DM_ORIENTATION
            dm.dmOrientation = int(huong)
        if hai_mat:
            dm.dmFields |= DM_DUPLEX
            dm.dmDuplex = int(hai_mat)
        if mau is not None:
            dm.dmFields |= DM_COLOR
            dm.dmColor = 2 if mau else 1
        if so_ban:
            dm.dmFields |= DM_COPIES | DM_COLLATE
            dm.dmCopies = int(so_ban)
            dm.dmCollate = 1 if ghep else 0
        # Cho trình điều khiển gộp lựa chọn vào cấu hình hợp lệ của nó.
        sp.DocumentPropertiesW(None, self.h, self.ten, self.buf, self.buf, DM_IN_BUFFER | DM_OUT_BUFFER)
        if self.hdc:
            g32.ResetDCW(self.hdc, ctypes.addressof(self.buf))

    def mo_dc(self):
        if not self.hdc:
            self.hdc = g32.CreateDCW("WINSPOOL", self.ten, None, ctypes.addressof(self.buf))
            if not self.hdc:
                raise OSError(f"Không mở được thiết bị in của {self.ten}.")
        return self.hdc

    def dong(self) -> None:
        if self.hdc:
            g32.DeleteDC(self.hdc)
            self.hdc = None
        if self.h:
            sp.ClosePrinter(self.h)
            self.h = None


def khung_giay(may_in: str, giay=None, huong=1) -> dict:
    """Khổ tờ giấy và vùng máy in in được, đơn vị pt, gốc ở góc trên trái tờ giấy. Dùng để vẽ bản xem trước."""
    m = MayIn(may_in)
    try:
        m.dat(giay=giay, huong=huong)
        dc = m.mo_dc()
        dx, dy = g32.GetDeviceCaps(dc, LOGPIXELSX), g32.GetDeviceCaps(dc, LOGPIXELSY)
        pw, ph = g32.GetDeviceCaps(dc, PHYSICALWIDTH) / dx * 72, g32.GetDeviceCaps(dc, PHYSICALHEIGHT) / dy * 72
        ox, oy = g32.GetDeviceCaps(dc, PHYSICALOFFSETX) / dx * 72, g32.GetDeviceCaps(dc, PHYSICALOFFSETY) / dy * 72
        vw, vh = g32.GetDeviceCaps(dc, HORZRES) / dx * 72, g32.GetDeviceCaps(dc, VERTRES) / dy * 72
        return {"giay": [pw, ph], "vung": [ox, oy, ox + vw, oy + vh]}
    finally:
        m.dong()


def tuy_chon_may_in(may_in: str, **hien) -> dict:
    """Bảng Printing Preferences của chính driver máy in (khay giấy, chất lượng, 2 mặt... riêng từng hãng).
    Nhận lựa chọn đang có trong hộp thoại để nạp sẵn, trả lại lựa chọn sau khi người dùng bấm OK. Hủy thì trả {}."""
    m = MayIn(may_in)
    try:
        m.dat(**hien)
        if sp.DocumentPropertiesW(u32.GetForegroundWindow(), m.h, may_in, m.buf, m.buf, DM_IN_PROMPT | DM_IN_BUFFER | DM_OUT_BUFFER) != 1:
            return {}
        DEVMODE_RIENG[may_in] = bytes(m.buf)
        d = m.dm
        return {"giay": d.dmPaperSize, "hai_mat": d.dmDuplex, "mau": d.dmColor == 2, "huong": d.dmOrientation}
    finally:
        m.dong()


def _hinh_trang(rong, cao, dc, tuy):
    """Vị trí và cỡ trang trên máy in (điểm ảnh máy in): x, y, rộng, cao."""
    dx, dy = g32.GetDeviceCaps(dc, LOGPIXELSX), g32.GetDeviceCaps(dc, LOGPIXELSY)
    vx, vy = g32.GetDeviceCaps(dc, HORZRES), g32.GetDeviceCaps(dc, VERTRES)
    che_do = tuy.get("che_do", "vua")
    if che_do == "vua":
        he = min(vx / rong, vy / cao)
        sw, sh = rong * he, cao * he
    else:
        he = float(tuy.get("ti_le", 100)) / 100 if che_do == "tuy_y" else 1.0
        sw, sh = rong * he * dx / 72, cao * he * dy / 72
        if che_do == "thu":  # thu nhỏ khi trang tràn vùng in được, không phóng to
            nho = min(1.0, vx / sw, vy / sh)
            sw, sh = sw * nho, sh * nho
    if che_do == "vua" or tuy.get("can_giua", True):
        return round((vx - sw) / 2), round((vy - sh) / 2), round(sw), round(sh)
    return 0, 0, round(sw), round(sh)


def _in_mot_luot(m: MayIn, pdf, ten: str, tuy: dict) -> None:
    hdc = m.mo_dc()
    doc = DOCINFOW(ctypes.sizeof(DOCINFOW), ten, tuy.get("ra_tep"), None, 0)
    if g32.StartDocW(hdc, ctypes.byref(doc)) <= 0:
        raise OSError("Máy in không nhận lệnh in.")
    try:
        huong_dat = tuy.get("huong", "tu_dong")  # tu_dong: trang ngang in giấy ngang
        huong = m.dm.dmOrientation
        for i in range(len(pdf)):
            trang = pdf[i]
            rong, cao = trang.get_size()  # pt, đã tính xoay
            moi = {"doc": 1, "ngang": 2}.get(huong_dat) or (2 if rong > cao else 1)
            if moi != huong:  # chỉ đổi khi cần, vì ResetDC mỗi trang dễ làm rối thứ tự 2 mặt
                huong = moi
                m.dat(huong=moi)
            # Toạ độ tính từ góc vùng in được, nên khi in 2 mặt trình điều khiển tự đảo mặt sau và lề hai mặt đều nhau.
            x, y, sw, sh = _hinh_trang(rong, cao, hdc, tuy)
            if g32.StartPage(hdc) <= 0:
                raise OSError("Máy in không nhận trang.")
            pdfium_c.FPDF_RenderPage(hdc, trang.raw, x, y, sw, sh, 0, pdfium_c.FPDF_PRINTING)
            if g32.EndPage(hdc) <= 0:
                raise OSError("Máy in không nhận trang.")
        g32.EndDoc(hdc)
    except BaseException:
        g32.AbortDoc(hdc)
        raise


def in_pdf(duong: Path, ten: str, tuy: dict) -> None:
    """tuy: may_in, giay (mã khổ giấy), huong (tu_dong|doc|ngang), hai_mat (1|2|3), mau, so_ban,
    che_do (vua|thu|khong|tuy_y), ti_le, can_giua. ra_tep chỉ dùng khi thử."""
    if tuy.get("che_do", "vua") not in CHE_DO:
        raise OSError("Kiểu co trang không hợp lệ.")
    pdf = pdfium.PdfDocument(str(duong))
    m = None
    try:
        m = MayIn(tuy["may_in"])
        so_ban = max(1, min(999, int(tuy.get("so_ban", 1))))
        huong_dau = {"doc": 1, "ngang": 2}.get(tuy.get("huong", "tu_dong"))
        m.dat(giay=tuy.get("giay"), huong=huong_dau, hai_mat=tuy.get("hai_mat"), mau=tuy.get("mau"), so_ban=so_ban, ghep=True)
        con_lai = 1 if m.dm.dmCopies >= so_ban else so_ban  # trình điều khiển không làm nhiều bản thì app in lặp lại
        if con_lai > 1:
            m.dat(so_ban=1)
        for _ in range(con_lai):
            _in_mot_luot(m, pdf, ten, tuy)
    finally:
        if m:
            m.dong()
        pdf.close()
