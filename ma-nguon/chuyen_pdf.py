"""Chuyển file thành PDF từ menu chuột phải của Explorer. Ảnh làm bằng Pillow, chữ và trang web nhờ Edge (máy Windows nào cũng có),
tài liệu Office nhờ chính Word, Excel, PowerPoint nếu máy có cài. Kết quả nằm cạnh file gốc, không ghi đè PDF đã có."""
import os
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageOps

ANH = {".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tif", ".tiff", ".webp"}
CHU = {".txt", ".md", ".csv", ".json", ".tex", ".log"}
WEB = {".html", ".htm", ".svg"}
OFFICE = {".doc": "Word", ".docx": "Word", ".rtf": "Word", ".odt": "Word",
          ".xls": "Excel", ".xlsx": "Excel", ".ppt": "PowerPoint", ".pptx": "PowerPoint"}
DUOI = sorted(ANH | CHU | WEB | OFFICE.keys())
TRANG_A4 = (1654, 2339)  # A4 ở 200 dpi
EDGE = [Path(os.environ.get(b, "")) / r"Microsoft\Edge\Application\msedge.exe" for b in ("ProgramFiles(x86)", "ProgramFiles")]
CUA_SO_AN = subprocess.CREATE_NO_WINDOW


def dich_moi(nguon: Path) -> Path:
    d = nguon.with_suffix(".pdf")
    n = 2
    while d.exists():
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


def tu_office(nguon: Path, dich: Path) -> None:
    ung_dung = OFFICE[nguon.suffix.lower()]
    mo = {"Word": "$d=$a.Documents.Open($env:NGUON,$false,$true); $d.ExportAsFixedFormat($env:DICH,17); $d.Close($false)",
          "Excel": "$d=$a.Workbooks.Open($env:NGUON,0,$true); $d.ExportAsFixedFormat(0,$env:DICH); $d.Close($false)",
          "PowerPoint": "$d=$a.Presentations.Open($env:NGUON,$true,$false,$false); $d.SaveAs($env:DICH,32); $d.Close()"}[ung_dung]
    lenh = f"$ErrorActionPreference='Stop'; $a=New-Object -ComObject {ung_dung}.Application; try {{ {mo} }} finally {{ $a.Quit() }}"
    kq = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", lenh], capture_output=True, creationflags=CUA_SO_AN,
                        env={**os.environ, "NGUON": str(nguon), "DICH": str(dich)}, timeout=300)
    if kq.returncode or not dich.is_file():
        raise RuntimeError(f"Cần cài {ung_dung} để chuyển file {nguon.suffix}.")


def chuyen(nguon: Path) -> Path:
    duoi = nguon.suffix.lower()
    if duoi not in DUOI:
        raise RuntimeError(f"Chưa chuyển được file {duoi or nguon.name} thành PDF.")
    dich = dich_moi(nguon)
    try:
        if duoi in ANH:
            tu_anh(nguon, dich)
        elif duoi in CHU:
            tu_chu(nguon, dich)
        elif duoi in WEB:
            tu_edge(nguon.resolve().as_uri(), dich)
        else:
            tu_office(nguon, dich)
    except BaseException:
        dich.unlink(missing_ok=True)
        raise
    return dich
