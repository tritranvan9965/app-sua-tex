// Xử lý thông điệp cửa sổ không viền bằng mã máy, không qua Python.
// Nếu thủ tục cửa sổ viết bằng Python (ctypes) thì luồng giao diện phải giành GIL cho mỗi thông điệp; lúc một luồng Python khác
// đang giữ GIL và chờ luồng giao diện (pywebview gọi Invoke của .NET, ví dụ restore(), hộp chọn file) thì hai bên chờ nhau, app treo.
// Biên dịch: python -m ziglang cc -shared -Os -s -target x86_64-windows-gnu -o khung_cua_so.dll khung_cua_so.c -luser32
#include <windows.h>

static WNDPROC cu;

static LRESULT CALLBACK thu_tuc(HWND h, UINT tin, WPARAM wp, LPARAM lp) {
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
