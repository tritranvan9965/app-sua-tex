"""Giữ các chỗ người dùng sửa "chỉ trong file này" khi ráp lại file sản phẩm.

Mỗi file ráp có một sổ <so_sua_rieng>/<tên file>.json dạng {id: thân câu}.
Công cụ ráp của dự án gọi ap_dung() ngay trước khi ghi file ráp.
"""
import json
import re
from pathlib import Path

SO = None  # loi.dat_du_an() đặt các giá trị này theo dự án đang mở
DAU = CUOI = NHAN = ""


def duong_so(ten_file: str) -> Path:
    return SO / f"{Path(ten_file).stem}.json"


def doc(ten_file: str) -> dict:
    p = duong_so(ten_file)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def ghi(ten_file: str, so: dict):
    p = duong_so(ten_file)
    if so:
        SO.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(so, ensure_ascii=False, indent=1), encoding="utf-8")
    elif p.exists():
        p.unlink()


def ap_dung(ten_file: str, chu: str) -> str:
    """Thay thân các câu có trong sổ. Câu không còn trong file thì bỏ qua."""
    so = doc(ten_file)
    for ma, than in so.items():
        m = re.search(rf"(?m)^{re.escape(NHAN)}{re.escape(ma)}\b[^\n]*\n", chu)
        if not m:
            continue
        dau = chu.find(DAU, m.end())
        cuoi = chu.find(CUOI, dau)
        if dau < 0 or cuoi < 0:
            continue
        chu = chu[:dau] + than + chu[cuoi + len(CUOI):]
    return chu
