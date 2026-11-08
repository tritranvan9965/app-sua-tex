"""Nơi để dữ liệu của app. Chạy từ mã nguồn thì để trong thư mục dự án; bản đã cài thì để trong %APPDATA%,
vì thư mục cài bị thay mới mỗi lần cập nhật, gỡ app cũng không làm mất cài đặt và mẫu của người dùng."""
import hashlib
import json
import os
import shutil
import sys
import time
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

def bam(f: Path) -> str:
    return hashlib.sha256(f.read_bytes()).hexdigest()


def cap_nhat_thu_vien(goc: Path, thu_vien: Path, sao_luu: Path) -> None:
    """Đưa mẫu đi kèm bản cài vào thư viện. File app chép lần trước mà người dùng chưa sửa thì thay bằng bản mới;
    file người dùng đã sửa (hoặc chép từ bản cũ chưa ghi dấu) thì cất vào sao_luu/<ngày>/ rồi mới thay, để không mất gì.
    Dấu của bản app đã chép nằm ở thu_vien/.ban-app.json."""
    so = thu_vien / ".ban-app.json"
    try:
        da_chep = json.loads(so.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        da_chep = {}
    for f in goc.rglob("*"):
        ten = f.relative_to(goc).as_posix()
        dich = thu_vien / ten
        if f.is_dir():
            dich.mkdir(parents=True, exist_ok=True)
            continue
        moi = bam(f)
        if dich.exists() and da_chep.get(ten) == moi:
            continue  # bản app không đổi từ lần chép trước: giữ nguyên file, kể cả khi người dùng đã sửa
        try:
            if dich.exists():
                cu = bam(dich)
                if cu == moi:
                    da_chep[ten] = moi
                    continue
                if da_chep.get(ten) != cu:  # người dùng đã sửa, hoặc bản cũ chưa ghi dấu: cất lại trước khi thay
                    cat = sao_luu / time.strftime("%Y%m%d-%H%M%S") / ten
                    cat.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(dich, cat)
            dich.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(f, dich)
            da_chep[ten] = moi
        except OSError:
            continue  # file đang mở hay bị khoá thì để lần chạy sau
    try:
        so.write_text(json.dumps(da_chep, ensure_ascii=False, indent=1), encoding="utf-8")
    except OSError:
        pass


if DA_DONG_GOI:
    cap_nhat_thu_vien(GOC_MA / "thu-vien-mau", THU_VIEN, DU_LIEU / "sao-luu-mau")
