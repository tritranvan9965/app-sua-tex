"""Nơi để dữ liệu của app. Chạy từ mã nguồn thì để trong thư mục dự án; bản đã cài thì để trong %APPDATA%,
vì thư mục cài bị thay mới mỗi lần cập nhật, gỡ app cũng không làm mất cài đặt và mẫu của người dùng."""
import os
import shutil
import sys
from pathlib import Path

GOC_MA = Path(__file__).resolve().parent
DA_DONG_GOI = getattr(sys, "frozen", False)


def chep_du_lieu_cu(appdata: Path) -> None:
    """Lần chạy đầu sau khi đổi tên từ Sửa TeX (1.0.x) sang TriTeX: chép (không di chuyển, không xoá) dữ liệu cũ sang thư mục mới.
    Bỏ cong-dang-chay.txt vì nó trỏ tới cổng của cửa sổ Sửa TeX cũ."""
    moi, cu = appdata / "TriTeX", appdata / "SuaTeX"
    if moi.exists() or not cu.is_dir():
        return
    try:
        shutil.copytree(cu, moi, ignore=shutil.ignore_patterns("cong-dang-chay.txt"))
    except OSError:
        shutil.rmtree(moi, ignore_errors=True)  # chép dở thì bỏ, lần sau chép lại từ đầu


if DA_DONG_GOI:
    chep_du_lieu_cu(Path(os.environ["APPDATA"]))
DU_LIEU = Path(os.environ["APPDATA"]) / "TriTeX" if DA_DONG_GOI else GOC_MA.parent
THU_VIEN = DU_LIEU / "thu-vien-mau"  # mỗi mẫu một thư mục con, thêm mẫu là thêm thư mục

if DA_DONG_GOI:
    # Chỉ chép file còn thiếu, để không ghi đè mẫu người dùng đã cập nhật.
    GOC_MAU = GOC_MA / "thu-vien-mau"
    for f in GOC_MAU.rglob("*"):
        dich = THU_VIEN / f.relative_to(GOC_MAU)
        if f.is_dir():
            dich.mkdir(parents=True, exist_ok=True)
        elif not dich.exists():
            dich.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(f, dich)
