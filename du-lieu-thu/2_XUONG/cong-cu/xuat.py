"""Xuất một file .tex thành 2 bản PDF: học sinh (HS) và giáo viên (GV).

Cách dùng (từ thư mục gốc dự án):
    python -I 2_XUONG/cong-cu/xuat.py "<file.tex>" [--chi HS|GV]
Kết quả: 3_THANH-PHAM/<loại>/HS/<ten>_HS.pdf và 3_THANH-PHAM/<loại>/GV/<ten>_GV.pdf
  <loại> theo thư mục chứa file .tex: 1-theo-bai -> 1_Theo-bai, 2-chuyen-de -> 2_Chuyen-de, 3-de-thi -> 3_De-thi.
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

XUONG = Path(__file__).resolve().parents[1]
MAU = XUONG / "03_mau"
THANH_PHAM = XUONG.parent / "3_THANH-PHAM"
LOAI = {"1-theo-bai": "1_Theo-bai", "2-chuyen-de": "2_Chuyen-de", "3-de-thi": "3_De-thi"}


def chep_hinh(chu: str, tam: Path):
    """Chép các file hình \\hinhgoc{...} (đường dẫn tính từ 2_XUONG/02_ngan-hang/) vào thư mục biên dịch tạm."""
    for duong in re.findall(r"\\hinhgoc\{([^}]+)\}", chu):
        nguon = XUONG / "02_ngan-hang" / duong
        if nguon.exists():
            (tam / duong).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(nguon, tam / duong)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("tex")
    ap.add_argument("--chi", choices=["HS", "GV"])
    a = ap.parse_args()

    tex = Path(a.tex).resolve()
    ten = tex.stem
    loi = False
    for ban in [a.chi] if a.chi else ["HS", "GV"]:
        # MiKTeX trên máy này hỏng khi đường dẫn có dấu tiếng Việt (thư mục OneDrive),
        # nên chép file .tex, các file cạnh nó (hình...) và mẫu sang thư mục tạm không dấu.
        tam = Path(tempfile.mkdtemp(prefix="xuat_"))
        shutil.copytree(tex.parent, tam, dirs_exist_ok=True,
                        ignore=lambda d, ds: [x for x in ds if x.endswith((".pdf", ".log", ".aux"))])
        for f in MAU.iterdir():
            if f.is_file():
                shutil.copy(f, tam / f.name)
        chep_hinh(tex.read_text(encoding="utf-8"), tam)
        # File bọc riêng cho từng bản (MiKTeX cũng hỏng khi nạp lệnh \input từ dòng lệnh)
        boc = f"{ten}_{ban}"
        dau = r"\def\BANHS{1}" if ban == "HS" else ""
        (tam / f"{boc}.tex").write_text(dau + r"\input{" + tex.name + "}\n", encoding="utf-8")
        for _ in range(2):
            subprocess.run(["xelatex", "-interaction=nonstopmode", "-halt-on-error", f"{boc}.tex"],
                           cwd=tam, capture_output=True)
        pdf, log = tam / f"{boc}.pdf", tam / f"{boc}.log"
        chu_log = log.read_text(encoding="utf-8", errors="replace") if log.exists() else ""
        # Kiểm tra "Output written": MiKTeX có lúc đổ vỡ mà vẫn để lại một PDF hỏng
        if pdf.exists() and "Output written" in chu_log and not re.search(r"^! ", chu_log, re.M):
            dich = THANH_PHAM / LOAI.get(tex.parent.name, "9_Khac") / ban
            dich.mkdir(parents=True, exist_ok=True)
            try:
                shutil.copy(pdf, dich / f"{ten}_{ban}.pdf")
            except PermissionError:
                loi = True
                print(f"LOI {ban}: file {ten}_{ban}.pdf đang mở trong trình đọc PDF. Đóng file rồi xuất lại.")
                shutil.rmtree(tam, ignore_errors=True)
                continue
            print(f"OK  {ban} -> {(dich / f'{ten}_{ban}.pdf').relative_to(XUONG.parent).as_posix()}")
            thieu = re.findall(r"Missing character: There is no (.) in font", chu_log)
            if thieu:
                print(f"    Cảnh báo: phông thiếu kí tự {''.join(sorted(set(thieu)))}")
        else:
            loi = True
            print(f"LOI {ban} — trích log:")
            for m in list(re.finditer(r"^! .*(?:\n.*){0,4}", chu_log, re.M))[:3]:
                print(m.group(0))
        shutil.rmtree(tam, ignore_errors=True)
    sys.exit(1 if loi else 0)


if __name__ == "__main__":
    main()
