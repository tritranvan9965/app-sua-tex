"""Biên dịch bằng xelatex.

MiKTeX trên máy này hỏng khi đường dẫn hay tên file có dấu tiếng Việt, nên luôn biên dịch trong
thư mục tạm không dấu, với file chính mang tên không dấu.
"""
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import loi

CHEP_KEM = {".tex", ".sty", ".cls", ".bib", ".bbl", ".bst", ".def", ".cfg", ".clo", ".fd", ".ltx", ".tikz", ".pgf",
            ".png", ".jpg", ".jpeg", ".pdf", ".eps", ".mps", ".ttf", ".otf", ".csv", ".dat", ".txt"}
GIOI_HAN = 300 * 1024 * 1024  # mở nhanh file nằm trong thư mục lớn như Downloads thì không chép cả thư mục
TEN_CHINH = "suatexchinh"
MOI_LUOT = 150  # giây
MAX_THU_MUC = 3000
MAX_MAU = 50 * 1024 * 1024


def chep_nguon(nguon: Path, tam: Path) -> bool:
    """Chép file nguồn cạnh file .tex, gần trước xa sau. Trả về False nếu thư mục quá lớn, phải bỏ bớt."""
    tong = 0
    for noi, con, tep in os.walk(nguon):
        con[:] = sorted(x for x in con if not x.startswith("."))
        for ten in tep:
            f = Path(noi) / ten
            if f.suffix.lower() not in CHEP_KEM:
                continue
            tong += f.stat().st_size
            if tong > GIOI_HAN:
                return False
            dich = tam / f.relative_to(nguon)
            dich.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(f, dich)
    return True


def chep_them(da: dict, tam: Path):
    """Các thư mục mẫu dùng chung của dự án, chép phẳng vào chỗ biên dịch."""
    for ten in da["xuat"]["chep_them"]:
        for f in (da["goc"] / ten).iterdir():
            if f.is_file():
                shutil.copy(f, tam / f.name)


def tim_mau(thu_muc: Path) -> dict:
    """Các file .sty, .cls gần file .tex: tìm từ thư mục chứa nó đi ngược lên, mỗi nấc xuống tối đa 3 tầng."""
    thay, da_qua, so_thu_muc = {}, set(), 0
    for cha in [thu_muc, *list(thu_muc.parents)[:4]]:
        for noi, con, tep in os.walk(cha):
            so_thu_muc += 1
            if so_thu_muc > MAX_THU_MUC or noi in da_qua:
                con[:] = []
                continue
            da_qua.add(noi)
            con[:] = [] if len(Path(noi).relative_to(cha).parts) >= 3 else [x for x in con if not x.startswith((".", "_"))]
            for ten in tep:
                if ten.lower().endswith((".sty", ".cls")):
                    thay.setdefault(ten, Path(noi))
    return thay


def chep_mau(tex: Path, chu: str, tam: Path):
    """Mở nhanh không có cấu hình dự án: lấy mẫu gần file nhất, không có thì lấy trong thư viện mẫu.
    Chép kèm các file nằm cạnh mẫu."""
    goi = re.findall(r"(?m)^[^%\n]*\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{([^}]+)\}", chu)
    lop = re.findall(r"(?m)^[^%\n]*\\documentclass(?:\[[^\]]*\])?\{([^}]+)\}", chu)
    can = {f"{x.strip()}.sty" for g in goi for x in g.split(",")} | {f"{x.strip()}.cls" for x in lop}
    thay = {**loi.cac_mau()["noi"], **tim_mau(tex.parent)}
    for ten in can - {f.name for f in tam.iterdir()}:
        if ten in thay:
            for f in thay[ten].iterdir():
                if f.is_file() and f.suffix.lower() in CHEP_KEM and not (tam / f.name).exists():
                    shutil.copy(f, tam / f.name)


def them_mau(nguon: Path, ghi_de: bool = False) -> dict:
    """Chép mẫu vào thư viện, không lấy thư mục con. Tên mẫu theo file .sty, .cls đầu tiên trong thư mục."""
    if not nguon.is_dir():
        raise ValueError(f"Không tìm thấy thư mục {nguon}")
    tep = [f for f in sorted(nguon.iterdir()) if f.is_file() and f.suffix.lower() in CHEP_KEM]
    chinh = [f for f in tep if f.suffix.lower() in (".sty", ".cls")]
    if not chinh:
        raise ValueError(f"Thư mục {nguon.name} không có file .sty hay .cls nào nên không phải là mẫu.")
    if sum(f.stat().st_size for f in tep) > MAX_MAU:
        raise ValueError(f"Thư mục {nguon.name} quá lớn. Chọn thư mục chỉ chứa mẫu.")
    ten = chinh[0].stem
    dich = loi.THU_VIEN / ten
    if dich.exists() and not ghi_de:
        return {"trung": ten}
    dich.mkdir(exist_ok=True)
    for f in tep:
        shutil.copy(f, dich / f.name)
    return {"ten": ten}


def chep_hinh(da: dict, chu: str, tam: Path):
    """Hình của dự án ghi đường dẫn tính từ một thư mục chung, không nằm cạnh file .tex."""
    hinh = da["xuat"].get("hinh")
    if not hinh:
        return
    for duong in re.findall(rf"\\{hinh['lenh']}\{{([^}}]+)\}}", chu):
        nguon = da["goc"] / hinh["goc"] / duong
        if nguon.is_file():
            (tam / duong).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(nguon, tam / duong)


def trich_log(chu_log: str) -> str:
    loi_tex = [m.group(0) for m in re.finditer(r"^! .*(?:\n.*){0,4}", chu_log, re.M)][:3]
    return "\n".join(loi_tex) or "LaTeX dừng mà không ghi lý do."


def bien_dich(tex: Path, chu: str, ban: str, dich: Path = None) -> tuple:
    """Trả về (được hay không, nhật ký). File có documentclass thì dịch thẳng, file mảnh thì bọc trước.
    dich là nơi ghi PDF; không nêu thì ghi vào đường thành phẩm, mặc định là cạnh file .tex."""
    da = loi.DA
    manh = loi.la_file_manh(chu)
    than, lech = loi.boc_manh(chu) if manh else (chu, 0)
    dich = dich or loi.duong_pdf(tex, ban)
    with tempfile.TemporaryDirectory(prefix="xuat_", ignore_cleanup_errors=True) as ten_tam:
        tam = Path(ten_tam)
        du = chep_nguon(tex.parent, tam)
        chep_them(da, tam)
        chep_hinh(da, chu, tam)
        if not da["xuat"]["chep_them"]:
            chep_mau(tex, than, tam)
        # Lệnh chọn bản để cùng dòng đầu, để số dòng trong báo lỗi vẫn khớp file gốc.
        (tam / f"{TEN_CHINH}.tex").write_text(da["xuat"]["ban"].get(ban, "") + than, encoding="utf-8")
        try:
            for _ in range(2):  # lượt hai để mục lục và tham chiếu đúng
                subprocess.run(["xelatex", "-interaction=nonstopmode", "-halt-on-error", f"{TEN_CHINH}.tex"], cwd=tam,
                               capture_output=True, timeout=MOI_LUOT, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except FileNotFoundError:
            return False, "Máy này chưa cài xelatex nên chưa xuất được PDF."
        except subprocess.TimeoutExpired:
            return False, "xelatex chạy quá lâu nên đã dừng. Kiểm tra file .tex rồi xuất lại."
        pdf, log = tam / f"{TEN_CHINH}.pdf", tam / f"{TEN_CHINH}.log"
        chu_log = log.read_text(encoding="utf-8", errors="replace") if log.exists() else ""
        # Kiểm tra "Output written": MiKTeX có lúc đổ vỡ mà vẫn để lại một PDF hỏng.
        if not (pdf.exists() and "Output written" in chu_log and not re.search(r"^! ", chu_log, re.M)):
            ghi_chu = "" if du else "\nThư mục quá lớn nên app không chép hết file kèm theo sang chỗ biên dịch."
            return False, loi.tru_dong(trich_log(chu_log), lech) + ghi_chu
        dich.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.copy(pdf, dich)
        except PermissionError:
            return False, f"File {dich.name} đang mở trong trình đọc PDF. Đóng file rồi xuất lại."
    return True, f"OK -> {dich}"
