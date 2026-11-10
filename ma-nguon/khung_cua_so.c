// Xử lý thông điệp cửa sổ không viền bằng mã máy, không qua Python.
// Nếu thủ tục cửa sổ viết bằng Python (ctypes) thì luồng giao diện phải giành GIL cho mỗi thông điệp; lúc một luồng Python khác
// đang giữ GIL và chờ luồng giao diện (pywebview gọi Invoke của .NET, ví dụ restore(), hộp chọn file) thì hai bên chờ nhau, app treo.
// Biên dịch: python -m ziglang cc -shared -Os -s -target x86_64-windows-gnu -o khung_cua_so.dll khung_cua_so.c -luser32
#include <windows.h>

static WNDPROC cu;

static LRESULT CALLBACK thu_tuc(HWND h, UINT tin, WPARAM wp, LPARAM lp) {
    if (tin == WM_GETMINMAXINFO) {
        // Phóng to đúng bằng vùng làm việc. Mặc định Windows cho cửa sổ phóng to tràn ra mỗi bên một khung dày, khung ngoài
        // phủ hết màn hình nên Windows coi app là toàn màn hình và hạ taskbar xuống dưới: chỗ taskbar thành dải đen.
        LRESULT kq = CallWindowProcW(cu, h, tin, wp, lp);
        MONITORINFO mi = {sizeof mi};
        if (GetMonitorInfoW(MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST), &mi)) {
            MINMAXINFO *m = (MINMAXINFO *)lp;
            m->ptMaxPosition.x = mi.rcWork.left - mi.rcMonitor.left;
            m->ptMaxPosition.y = mi.rcWork.top - mi.rcMonitor.top;
            m->ptMaxSize.x = mi.rcWork.right - mi.rcWork.left;
            m->ptMaxSize.y = mi.rcWork.bottom - mi.rcWork.top;
        }
        return kq;
    }
    if (tin == WM_NCCALCSIZE && wp) {
        // Không có vùng ngoài vùng làm việc. Phóng to thì cửa sổ tràn ra ngoài màn hình một khung dày, nên thu về vùng làm việc.
        if (IsZoomed(h)) {
            MONITORINFO mi = {sizeof mi};
            if (GetMonitorInfoW(MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST), &mi))
                ((NCCALCSIZE_PARAMS *)lp)->rgrc[0] = mi.rcWork;
        }
        return 0;
    }
    return CallWindowProcW(cu, h, tin, wp, lp);
}

// Gắn một lần cho cửa sổ app (app chỉ có một cửa sổ). Gọi được từ luồng khác vì SetWindowLongPtr không cần luồng giao diện.
__declspec(dllexport) int gan_khung(HWND h) {
    if (!cu)
        cu = (WNDPROC)SetWindowLongPtrW(h, GWLP_WNDPROC, (LONG_PTR)thu_tuc);
    return cu != 0;
}
