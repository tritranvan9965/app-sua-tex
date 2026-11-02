// Mục "Chuyển thành "Tên file".pdf" trong menu chuột phải. Chữ đổi theo file đang chọn nên không đăng ký bằng registry được,
// phải là DLL chạy trong Explorer. Bấm vào thì gọi SuaTeX.exe --chuyen-pdf với tất cả file đã chọn, để app chuyển lần lượt từng file.
// DLL nằm ở ...\Programs\SuaTeX-menu\, exe ở ...\Programs\SuaTeX\.
#define COBJMACROS
#include <windows.h>
#include <shlobj.h>
#include <shellapi.h>
#include <stddef.h>
#include <stdlib.h>
#include <wchar.h>

// {7C3A9E52-4D1B-4E6F-9A21-5B8E0D1F6A33}
static const CLSID CLSID_Menu = {0x7c3a9e52, 0x4d1b, 0x4e6f, {0x9a, 0x21, 0x5b, 0x8e, 0x0d, 0x1f, 0x6a, 0x33}};
#define TEN_TOI_DA 32
#define LENH_TOI_DA 32000

static HMODULE g_dll;
static LONG g_dang_dung;

typedef struct {
  IContextMenu cm;
  IShellExtInit si;
  LONG dem;
  wchar_t **tep;
  UINT so_tep;
  HBITMAP anh;
} Menu;

#define TU_SI(p) ((Menu *)((char *)(p) - offsetof(Menu, si)))

static void duong_exe(wchar_t *o, DWORD co) {
  GetModuleFileNameW(g_dll, o, co);
  for (int i = 0; i < 2; i++) {
    wchar_t *c = wcsrchr(o, L'\\');
    if (c) *c = 0;
  }
  wcsncat(o, L"\\SuaTeX\\SuaTeX.exe", co - wcslen(o) - 1);
}

static HBITMAP anh_bieu_tuong(void) {
  wchar_t exe[MAX_PATH];
  HICON ic = NULL;
  duong_exe(exe, MAX_PATH);
  if (ExtractIconExW(exe, 0, NULL, &ic, 1) != 1 || !ic) return NULL;
  int n = GetSystemMetrics(SM_CXSMICON);
  BITMAPINFO bi = {{sizeof(BITMAPINFOHEADER), n, -n, 1, 32, BI_RGB}};
  void *dl;
  HDC dc = CreateCompatibleDC(NULL);
  HBITMAP a = CreateDIBSection(dc, &bi, DIB_RGB_COLORS, &dl, NULL, 0);
  if (a) {
    HGDIOBJ cu = SelectObject(dc, a);
    DrawIconEx(dc, 0, 0, ic, n, n, 0, NULL, DI_NORMAL);
    SelectObject(dc, cu);
  }
  DeleteDC(dc);
  DestroyIcon(ic);
  return a;
}

// Một file: Chuyển thành "Tên file".pdf, tên dài thì cắt bớt. Nhiều file: Chuyển 3 file thành PDF.
static void lam_chu(const Menu *m, wchar_t *o, size_t co) {
  if (m->so_tep > 1) {
    swprintf(o, co, L"Chuyển %u file thành PDF", m->so_tep);
    return;
  }
  const wchar_t *d = m->tep[0], *c = wcsrchr(d, L'\\'), *ten = c ? c + 1 : d, *cham = wcsrchr(ten, L'.');
  size_t dai = cham ? (size_t)(cham - ten) : wcslen(ten);
  wchar_t goc[TEN_TOI_DA + 8], thoat[2 * (TEN_TOI_DA + 8)];
  if (dai > TEN_TOI_DA) {
    wcsncpy(goc, ten, TEN_TOI_DA - 3);
    wcscpy(goc + TEN_TOI_DA - 3, L"...");
  } else {
    wcsncpy(goc, ten, dai);
    goc[dai] = 0;
  }
  size_t j = 0;
  for (const wchar_t *p = goc; *p; p++) {  // & trong menu là ký hiệu phím tắt
    if (*p == L'&') thoat[j++] = L'&';
    thoat[j++] = *p;
  }
  thoat[j] = 0;
  swprintf(o, co, L"Chuyển thành \"%ls\".pdf", thoat);
}

static HRESULT STDMETHODCALLTYPE cm_qi(IContextMenu *t, REFIID r, void **o) {
  Menu *m = (Menu *)t;
  if (IsEqualIID(r, &IID_IUnknown) || IsEqualIID(r, &IID_IContextMenu)) *o = &m->cm;
  else if (IsEqualIID(r, &IID_IShellExtInit)) *o = &m->si;
  else { *o = NULL; return E_NOINTERFACE; }
  InterlockedIncrement(&m->dem);
  return S_OK;
}

static ULONG STDMETHODCALLTYPE cm_addref(IContextMenu *t) { return InterlockedIncrement(&((Menu *)t)->dem); }

static ULONG STDMETHODCALLTYPE cm_release(IContextMenu *t) {
  Menu *m = (Menu *)t;
  LONG n = InterlockedDecrement(&m->dem);
  if (!n) {
    for (UINT i = 0; i < m->so_tep; i++) free(m->tep[i]);
    free(m->tep);
    if (m->anh) DeleteObject(m->anh);
    free(m);
    InterlockedDecrement(&g_dang_dung);
  }
  return n;
}

static HRESULT STDMETHODCALLTYPE cm_them(IContextMenu *t, HMENU menu, UINT vi_tri, UINT dau, UINT cuoi, UINT co) {
  Menu *m = (Menu *)t;
  (void)cuoi;
  if ((co & CMF_DEFAULTONLY) || !m->so_tep) return MAKE_HRESULT(SEVERITY_SUCCESS, 0, 0);
  wchar_t chu[128];
  lam_chu(m, chu, 128);
  if (!m->anh) m->anh = anh_bieu_tuong();
  MENUITEMINFOW mi = {sizeof(mi)};
  mi.fMask = MIIM_ID | MIIM_STRING | (m->anh ? MIIM_BITMAP : 0);
  mi.wID = dau;
  mi.dwTypeData = chu;
  mi.hbmpItem = m->anh;
  if (!InsertMenuItemW(menu, vi_tri, TRUE, &mi)) return HRESULT_FROM_WIN32(GetLastError());
  return MAKE_HRESULT(SEVERITY_SUCCESS, 0, 1);
}

static HRESULT STDMETHODCALLTYPE cm_bam(IContextMenu *t, CMINVOKECOMMANDINFO *ci) {
  Menu *m = (Menu *)t;
  if (HIWORD(ci->lpVerb) || LOWORD(ci->lpVerb)) return E_FAIL;
  wchar_t exe[MAX_PATH], *lenh = malloc(LENH_TOI_DA * sizeof(wchar_t));
  if (!lenh) return E_OUTOFMEMORY;
  duong_exe(exe, MAX_PATH);
  int n = swprintf(lenh, LENH_TOI_DA, L"\"%ls\" --chuyen-pdf", exe);
  for (UINT i = 0; i < m->so_tep; i++) {
    if (n + wcslen(m->tep[i]) + 4 >= LENH_TOI_DA) break;
    n += swprintf(lenh + n, LENH_TOI_DA - n, L" \"%ls\"", m->tep[i]);
  }
  STARTUPINFOW si = {sizeof(si)};
  PROCESS_INFORMATION pi;
  BOOL ok = CreateProcessW(exe, lenh, NULL, NULL, FALSE, 0, NULL, NULL, &si, &pi);
  free(lenh);
  if (!ok) return HRESULT_FROM_WIN32(GetLastError());
  CloseHandle(pi.hThread);
  CloseHandle(pi.hProcess);
  return S_OK;
}

static HRESULT STDMETHODCALLTYPE cm_chu(IContextMenu *t, UINT_PTR id, UINT loai, UINT *r, CHAR *o, UINT co) {
  (void)t; (void)id; (void)loai; (void)r; (void)o; (void)co;
  return E_NOTIMPL;
}

static IContextMenuVtbl CM = {cm_qi, cm_addref, cm_release, cm_them, cm_bam, cm_chu};

static HRESULT STDMETHODCALLTYPE si_qi(IShellExtInit *t, REFIID r, void **o) { return cm_qi(&TU_SI(t)->cm, r, o); }
static ULONG STDMETHODCALLTYPE si_addref(IShellExtInit *t) { return cm_addref(&TU_SI(t)->cm); }
static ULONG STDMETHODCALLTYPE si_release(IShellExtInit *t) { return cm_release(&TU_SI(t)->cm); }

static HRESULT STDMETHODCALLTYPE si_init(IShellExtInit *t, PCIDLIST_ABSOLUTE thu_muc, IDataObject *dl, HKEY khoa) {
  Menu *m = TU_SI(t);
  (void)thu_muc; (void)khoa;
  if (!dl) return E_INVALIDARG;
  FORMATETC f = {CF_HDROP, NULL, DVASPECT_CONTENT, -1, TYMED_HGLOBAL};
  STGMEDIUM s;
  HRESULT h = IDataObject_GetData(dl, &f, &s);
  if (FAILED(h)) return h;
  HDROP tha = (HDROP)GlobalLock(s.hGlobal);
  if (tha) {
    UINT n = DragQueryFileW(tha, 0xFFFFFFFF, NULL, 0);
    m->tep = calloc(n, sizeof(wchar_t *));
    for (UINT i = 0; m->tep && i < n; i++) {
      UINT dai = DragQueryFileW(tha, i, NULL, 0) + 1;
      wchar_t *p = malloc(dai * sizeof(wchar_t));
      if (!p) break;
      DragQueryFileW(tha, i, p, dai);
      m->tep[m->so_tep++] = p;
    }
    GlobalUnlock(s.hGlobal);
  }
  ReleaseStgMedium(&s);
  return m->so_tep ? S_OK : E_FAIL;
}

static IShellExtInitVtbl SI = {si_qi, si_addref, si_release, si_init};

static HRESULT STDMETHODCALLTYPE cf_qi(IClassFactory *t, REFIID r, void **o) {
  if (IsEqualIID(r, &IID_IUnknown) || IsEqualIID(r, &IID_IClassFactory)) { *o = t; return S_OK; }
  *o = NULL;
  return E_NOINTERFACE;
}
static ULONG STDMETHODCALLTYPE cf_addref(IClassFactory *t) { (void)t; return 2; }
static ULONG STDMETHODCALLTYPE cf_release(IClassFactory *t) { (void)t; return 1; }

static HRESULT STDMETHODCALLTYPE cf_tao(IClassFactory *t, IUnknown *ngoai, REFIID r, void **o) {
  (void)t;
  *o = NULL;
  if (ngoai) return CLASS_E_NOAGGREGATION;
  Menu *m = calloc(1, sizeof(Menu));
  if (!m) return E_OUTOFMEMORY;
  m->cm.lpVtbl = &CM;
  m->si.lpVtbl = &SI;
  m->dem = 1;
  InterlockedIncrement(&g_dang_dung);
  HRESULT h = cm_qi(&m->cm, r, o);
  cm_release(&m->cm);
  return h;
}

static HRESULT STDMETHODCALLTYPE cf_khoa(IClassFactory *t, BOOL k) { (void)t; (void)k; return S_OK; }

static IClassFactoryVtbl CF = {cf_qi, cf_addref, cf_release, cf_tao, cf_khoa};
static IClassFactory g_cf = {&CF};

__declspec(dllexport) HRESULT __stdcall DllGetClassObject(REFCLSID c, REFIID r, void **o) {
  if (!IsEqualCLSID(c, &CLSID_Menu)) { *o = NULL; return CLASS_E_CLASSNOTAVAILABLE; }
  return cf_qi(&g_cf, r, o);
}

__declspec(dllexport) HRESULT __stdcall DllCanUnloadNow(void) { return g_dang_dung ? S_FALSE : S_OK; }

BOOL WINAPI DllMain(HINSTANCE h, DWORD ly_do, void *r) {
  (void)r;
  if (ly_do == DLL_PROCESS_ATTACH) {
    g_dll = h;
    DisableThreadLibraryCalls(h);
  }
  return TRUE;
}
