"""Chuyển file thành PDF từ menu chuột phải của Explorer. Ảnh làm bằng Pillow, chữ và trang web nhờ Edge (máy Windows nào cũng có),
tài liệu Office nhờ chính Word, Excel, PowerPoint nếu máy có cài. Kết quả nằm cạnh file gốc, không ghi đè PDF đã có."""
import contextlib
import os
import subprocess
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

ANH = {".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tif", ".tiff", ".webp"}
CHU = {".txt", ".md", ".csv", ".json", ".tex", ".log"}
WEB = {".html", ".htm", ".svg"}
OFFICE = {".doc": "Word", ".docx": "Word", ".rtf": "Word", ".odt": "Word",
          ".xls": "Excel", ".xlsx": "Excel", ".ppt": "PowerPoint", ".pptx": "PowerPoint"}
DUOI = sorted(ANH | CHU | WEB | OFFICE.keys())
TRANG_A4 = (1654, 2339)  # A4 ở 200 dpi
EDGE = [Path(os.environ.get(b, "")) / r"Microsoft\Edge\Application\msedge.exe" for b in ("ProgramFiles(x86)", "ProgramFiles")]
CUA_SO_AN = subprocess.CREATE_NO_WINDOW
QUA_GIO = 180  # giây cho mỗi file. Word, Excel có thể treo vì hộp thoại ẩn nên phải có giới hạn.
TIEN_TRINH_OFFICE = {"Word": "WINWORD", "Excel": "EXCEL", "PowerPoint": "POWERPNT"}
SO_LUONG_SONG_SONG = 3  # Word mất 8-10 giây mỗi file, ba file cùng lúc xong sau chừng 12 giây thay vì 27
# Mỗi lần Word mở một bản riêng nên chạy song song được. Excel, PowerPoint dùng chung một bản đang chạy, hai file cùng lúc sẽ đóng nhầm của nhau.
KHOA_OFFICE = {"Excel": threading.Lock(), "PowerPoint": threading.Lock()}


def dich_moi(nguon: Path, da_giu=()) -> Path:
    d = nguon.with_suffix(".pdf")
    n = 2
    while d.exists() or d in da_giu:
        d = nguon.with_name(f"{nguon.stem} ({n}).pdf")
        n += 1
    return d


def tu_anh(nguon: Path, dich: Path) -> None:
    """Mỗi ảnh (hay mỗi khung của ảnh nhiều khung) là một trang A4, ảnh vừa khít trong trang."""
    trang = []
    with Image.open(nguon) as im:
        n = getattr(im, "n_frames", 1)
        for i in range(n):
            im.seek(i)
            a = ImageOps.exif_transpose(im).convert("RGBA")
            nen = Image.new("RGB", a.size, "white")
            nen.paste(a, mask=a.getchannel("A"))
            rong, cao = TRANG_A4 if nen.width <= nen.height else TRANG_A4[::-1]
            nen = ImageOps.contain(nen, (rong - 120, cao - 120), Image.LANCZOS)
            t = Image.new("RGB", (rong, cao), "white")
            t.paste(nen, ((rong - nen.width) // 2, (cao - nen.height) // 2))
            trang.append(t)
    trang[0].save(dich, "PDF", resolution=200.0, save_all=True, append_images=trang[1:])


def tu_edge(url: str, dich: Path) -> None:
    edge = next((p for p in EDGE if p.is_file()), None)
    if not edge:
        raise RuntimeError("Máy không có Microsoft Edge để chuyển file này.")
    with tempfile.TemporaryDirectory() as tam:
        # Hồ sơ riêng để không đụng vào Edge người dùng đang mở.
        subprocess.run([str(edge), "--headless=new", "--disable-gpu", "--no-pdf-header-footer", f"--user-data-dir={tam}",
                        f"--print-to-pdf={dich}", url], check=False, capture_output=True, timeout=120, creationflags=CUA_SO_AN)
    if not dich.is_file():
        raise RuntimeError("Edge không tạo được PDF.")


def tu_chu(nguon: Path, dich: Path) -> None:
    import html
    chu = nguon.read_bytes().decode("utf-8-sig", errors="replace")
    with tempfile.TemporaryDirectory() as tam:
        f = Path(tam) / "chu.html"
        f.write_text('<meta charset="utf-8"><style>@page{margin:18mm}body{margin:0}'
                     'pre{font:11pt/1.45 Consolas,"Cascadia Mono",monospace;white-space:pre-wrap;word-break:break-word}</style>'
                     f"<pre>{html.escape(chu)}</pre>", encoding="utf-8")
        tu_edge(f.as_uri(), dich)


def tat_ban_treo(ung_dung: str) -> None:
    """Tắt powershell thì Word chạy ẩn vẫn còn. Chỉ tắt bản do tự động hoá mở trong lúc vừa rồi, không đụng Word người dùng đang soạn."""
    lenh = (f"Get-CimInstance Win32_Process -Filter \"name='{TIEN_TRINH_OFFICE[ung_dung]}.EXE'\" | Where-Object {{ $_.CommandLine -match 'Automation|Embedding' "
            f"-and $_.CreationDate -ge (Get-Date).AddSeconds(-{QUA_GIO + 10}) }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force }}")
    subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", lenh], capture_output=True, creationflags=CUA_SO_AN, timeout=30, check=False)


def tu_office(nguon: Path, dich: Path) -> None:
    ung_dung = OFFICE[nguon.suffix.lower()]
    # Word đôi khi báo lỗi ở bước đóng tài liệu dù PDF đã xuất xong, nên để Word tự đóng khi thoát. Lỗi lúc đóng, thoát không tính là hỏng.
    mo, thoat = {"Word": ("$d=$a.Documents.Open($env:NGUON,$false,$true); $d.ExportAsFixedFormat($env:DICH,17)", "$a.Quit([ref]0)"),
                 "Excel": ("$d=$a.Workbooks.Open($env:NGUON,0,$true); $d.ExportAsFixedFormat(0,$env:DICH); $d.Close($false)", "$a.Quit()"),
                 "PowerPoint": ("$d=$a.Presentations.Open($env:NGUON,$true,$false,$false); $d.SaveAs($env:DICH,32); $d.Close()", "$a.Quit()")}[ung_dung]
    lenh = (f"$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; try {{ $a=New-Object -ComObject {ung_dung}.Application; "
            f"try {{ {mo} }} finally {{ try {{ {thoat} }} catch {{ }} }} }} catch {{ [Console]::Out.WriteLine($_.Exception.Message); exit 1 }}")
    try:
        with KHOA_OFFICE.get(ung_dung) or contextlib.nullcontext():
            kq = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", lenh], capture_output=True, creationflags=CUA_SO_AN,
                                env={**os.environ, "NGUON": str(nguon), "DICH": str(dich)}, timeout=QUA_GIO)
    except subprocess.TimeoutExpired:
        tat_ban_treo(ung_dung)
        raise RuntimeError(f"Quá {QUA_GIO} giây {ung_dung} vẫn chưa xong nên đã dừng. File có thể đang hiện hộp thoại, thử mở bằng {ung_dung} xem sao.")
    if kq.returncode or not dich.is_file():
        chu = kq.stdout.decode("utf-8", "replace").strip()
        raise RuntimeError(f"Cần cài {ung_dung} để chuyển file {nguon.suffix}." if "80040154" in chu else f"{ung_dung} không chuyển được file này:\n{chu}")


def chuyen(nguon: Path, dich: Path = None) -> Path:
    """dich để trống thì ghi cạnh file gốc."""
    duoi = nguon.suffix.lower()
    if duoi not in DUOI:
        raise RuntimeError(f"Chưa chuyển được file {duoi or nguon.name} thành PDF.")
    dich = dich or dich_moi(nguon)
    dich.parent.mkdir(parents=True, exist_ok=True)
    try:
        if duoi in ANH:
            tu_anh(nguon, dich)
        elif duoi in CHU:
            tu_chu(nguon, dich)
        elif duoi in WEB:
            tu_edge(nguon.resolve().as_uri(), dich)
        else:
            tu_office(nguon, dich)
    except subprocess.TimeoutExpired:
        dich.unlink(missing_ok=True)
        raise RuntimeError("Edge quá lâu chưa xong nên đã dừng.")
    except UnidentifiedImageError:
        dich.unlink(missing_ok=True)
        raise RuntimeError("File ảnh bị hỏng hoặc không đọc được.")
    except BaseException:
        dich.unlink(missing_ok=True)
        raise
    return dich


def chuyen_nhieu(viec: list, bao) -> None:
    """viec là danh sách (nguồn, đích hoặc None). Chuyển song song vài file một lúc; bao(loại, vị trí, giá trị) được gọi từ luồng con:
    "bat" khi bắt đầu file, "xong" kèm đường PDF, "loi" kèm thông báo lỗi. Tên đích được chọn trước để hai file cùng tên không giành nhau."""
    giu, dich = set(), []
    for nguon, d in viec:
        d = d or dich_moi(nguon, giu)
        giu.add(d)
        dich.append(d)

    def lam(i):
        bao("bat", i, None)
        try:
            bao("xong", i, chuyen(viec[i][0], dich[i]))
        except Exception as e:
            bao("loi", i, str(e))

    with ThreadPoolExecutor(SO_LUONG_SONG_SONG) as ho:
        list(ho.map(lam, range(len(viec))))
