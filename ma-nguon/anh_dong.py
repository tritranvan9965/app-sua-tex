"""Ảnh của một file .tex: nằm ở hinh/<tên file>/ cạnh file, tên h001, h002... Phần thuần (không biết gì về app) để dễ thử riêng."""
import re
import unicodedata
from pathlib import Path

DUOI_ANH = {".png", ".jpg", ".jpeg", ".pdf", ".gif", ".webp"}  # phục vụ cho trang xem
DUOI_THU_MUC = {".png", ".jpg", ".jpeg", ".pdf", ".gif", ".webp", ".bmp"}  # coi là ảnh khi dọn thư mục ảnh
DUOI_THEM = {"png": b"\x89PNG", "jpg": b"\xff\xd8\xff", "pdf": b"%PDF"}
GIOI_HAN_ANH = 40 * 1024 * 1024
KIEU = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".pdf": "application/pdf"}


def ten_thu_muc(tex: Path) -> str:
    """Tên file .tex bỏ dấu, dấu cách thành '-': 'Buổi 01 Hàm số.tex' -> 'Buoi-01-Ham-so'."""
    s = unicodedata.normalize("NFD", tex.stem.replace("đ", "d").replace("Đ", "D"))
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"-{2,}", "-", re.sub(r"[^A-Za-z0-9._-]+", "-", re.sub(r"\s+", "-", s))).strip("-.")
    return s or "tai-lieu"


def thu_muc_anh(tex: Path) -> Path:
    return tex.parent / "hinh" / ten_thu_muc(tex)


def tim_anh(tex: Path, ref: str, duong_do: list, goc: Path):
    """Tìm file ảnh theo cách \includegraphics tìm: cạnh file .tex rồi các thư mục \graphicspath, tự thêm đuôi khi lệnh không ghi.
    Chỉ nhận file nằm trong thư mục dự án `goc`."""
    ref = (ref or "").strip().replace("\\", "/")
    if not ref or "\0" in ref:
        return None
    duoi = [""] if Path(ref).suffix.lower() in DUOI_ANH else [".png", ".jpg", ".jpeg", ".pdf"]
    goc = goc.resolve()
    for nen in [tex.parent, *(tex.parent / g for g in duong_do if g)]:
        for d in duoi:
            try:
                p = (nen / (ref + d)).resolve()
            except (OSError, ValueError):
                continue
            if p.is_file() and p.suffix.lower() in DUOI_ANH and p.is_relative_to(goc):
                return p
    return None


def so_tiep(thu_muc: Path, chu: str) -> int:
    """Số h tiếp theo: lớn hơn mọi số đang có trong thư mục và đang được nhắc tới trong văn bản (ảnh vừa xoá chưa lưu)."""
    so = [int(m.group(1)) for f in (thu_muc.iterdir() if thu_muc.is_dir() else []) if (m := re.fullmatch(r"h(\d+)", f.stem))]
    so += [int(m.group(1)) for m in re.finditer(r"(?<![\w])h(\d+)(?=\.(?:png|jpe?g|pdf)\b|[}\s])", chu or "")]
    return max(so, default=0) + 1


def luu_anh(tex: Path, chu: str, du_lieu: bytes, duoi: str) -> str:
    """Ghi ảnh mới vào hinh/<tên file>/h00N.<đuôi>, trả về đường dẫn tương đối với file .tex (dấu /)."""
    duoi = {"jpeg": "jpg"}.get(duoi.lower().lstrip("."), duoi.lower().lstrip("."))
    if duoi not in DUOI_THEM or not du_lieu.startswith(DUOI_THEM[duoi]):
        raise ValueError("Chỉ nhận ảnh PNG, JPG hoặc PDF.")
    if len(du_lieu) > GIOI_HAN_ANH:
        raise ValueError("Ảnh lớn quá 40 MB.")
    tm = thu_muc_anh(tex)
    tm.mkdir(parents=True, exist_ok=True)
    p = tm / f"h{so_tiep(tm, chu):03d}.{duoi}"
    p.write_bytes(du_lieu)
    return f"hinh/{tm.name}/{p.name}"


def anh_khong_dung(tex: Path, chu: str) -> list:
    """Ảnh trong hinh/<tên file>/ mà văn bản không còn nhắc tới (tính cả dòng ghi chú, cho chắc)."""
    tm = thu_muc_anh(tex)
    if not tm.is_dir():
        return []
    return [f for f in sorted(tm.iterdir())
            if f.is_file() and f.suffix.lower() in DUOI_THU_MUC and not re.search(r"(?<![\w])" + re.escape(f.stem) + r"(?![\w])", chu)]
