"""Tạo bộ cài: phat-hanh/TriTeX-Setup-<phiên bản>.exe. Chạy: .venv\\Scripts\\python.exe -I phat-hanh\\dong_goi.py
Thêm --phat-hanh để đăng bộ cài lên GitHub Releases (cần gh đã đăng nhập), ghi chú lấy từ --ghi-chu <file> (mặc định phat-hanh/ghi-chu.md).
Mặc định chỉ đóng gói, không đăng gì."""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

GOC = Path(__file__).resolve().parents[1]
MA = GOC / "ma-nguon"
PH = GOC / "phat-hanh"
TAM = PH / "tam"
sys.path.insert(0, str(MA))
import cai_dat  # noqa: E402


def tao_bieu_tuong(p: Path) -> None:
    n = 512
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    v = ImageDraw.Draw(im)
    v.rounded_rectangle((16, 16, n - 16, n - 16), 96, fill="#1d4238")
    v.rectangle((16, 372, n - 16, 400), fill="#c0262d")
    co = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 196)
    v.text((n / 2, 212), "TeX", font=co, fill="#e8efe9", anchor="mm")
    im.save(p, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])


def tao_bieu_tuong_loai(p: Path, nhan: str, chu: str, nen: str) -> None:
    """Biểu tượng file .pdf, .tex: cùng kiểu nhãn màu như thanh file trong app."""
    n = 512
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    v = ImageDraw.Draw(im)
    v.rounded_rectangle((16, 96, n - 16, n - 96), 72, fill=nen)
    v.text((n / 2, n / 2 + 6), nhan, font=ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 190), fill=chu, anchor="mm")
    im.save(p, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])


def pyinstaller(*ts) -> None:
    subprocess.run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--log-level", "WARN", "--workpath", str(TAM / "lam"),
                    "--specpath", str(TAM), "--windowed", "--paths", str(MA), "--icon", str(TAM / "tritex.ico"), *ts], check=True)


def bien_dich_menu(dich: Path) -> None:
    """DLL cho menu chuột phải. Trình biên dịch lấy từ gói ziglang, không cần cài Visual Studio."""
    subprocess.run([sys.executable, "-m", "ziglang", "cc", "-shared", "-Os", "-s", "-target", "x86_64-windows-gnu", "-o", str(dich),
                    str(PH / "menu_chuot_phai.c"), "-lshell32", "-lole32", "-luuid", "-lgdi32", "-luser32"], check=True)


def bien_dich_khung(dich: Path) -> None:
    """DLL xử lý thông điệp cửa sổ không viền (xem ma-nguon/khung_cua_so.c), nằm cạnh TriTeX.exe."""
    subprocess.run([sys.executable, "-m", "ziglang", "cc", "-shared", "-Os", "-s", "-target", "x86_64-windows-gnu", "-o", str(dich),
                    str(MA / "khung_cua_so.c"), "-luser32"], check=True)


def phat_hanh(exe: Path, file_ghi_chu: Path) -> None:
    """Tạo release v<phiên bản> trên GitHub kèm bộ cài. App đã cài hỏi release này để tự cập nhật."""
    if not file_ghi_chu.is_file():
        sys.exit(f"Chưa có file ghi chú {file_ghi_chu}. Viết vài dòng về thay đổi rồi chạy lại (bộ cài đã đóng gói xong, chưa đăng).")
    subprocess.run(["gh", "release", "create", f"v{cai_dat.PHIEN_BAN}", str(exe), "--title", f"{cai_dat.TEN} {cai_dat.PHIEN_BAN}",
                    "--notes-file", str(file_ghi_chu)], check=True, cwd=GOC)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--phat-hanh", action="store_true", help="đăng bộ cài lên GitHub Releases sau khi đóng gói")
    ap.add_argument("--ghi-chu", type=Path, default=PH / "ghi-chu.md", help="file ghi chú cho release")
    a = ap.parse_args()
    if a.phat_hanh and not a.ghi_chu.is_file():
        sys.exit(f"Chưa có file ghi chú {a.ghi_chu}. Viết ghi chú trước rồi chạy lại.")
    shutil.rmtree(TAM, ignore_errors=True)
    TAM.mkdir(parents=True)
    tao_bieu_tuong(TAM / "tritex.ico")
    pyinstaller("--name", cai_dat.MA, "--distpath", str(TAM / "app"), "--add-data", f"{MA / 'static'};static",
                "--add-data", f"{GOC / 'thu-vien-mau'};thu-vien-mau", str(MA / "app.py"))
    tao_bieu_tuong_loai(TAM / "app" / cai_dat.MA / "pdf.ico", "PDF", "#ff9d94", "#4b2f2f")
    tao_bieu_tuong_loai(TAM / "app" / cai_dat.MA / "tex.ico", "TEX", "#86d0ff", "#25415a")
    bien_dich_menu(TAM / "app" / cai_dat.MA / "menu.dll")
    bien_dich_khung(TAM / "app" / cai_dat.MA / "khung_cua_so.dll")
    shutil.make_archive(str(TAM / "tritex"), "zip", TAM / "app" / cai_dat.MA)
    ten = f"TriTeX-Setup-{cai_dat.PHIEN_BAN}"
    pyinstaller("--onefile", "--name", ten, "--distpath", str(PH), "--add-data", f"{TAM / 'tritex.zip'};.", str(PH / "bo_cai.py"))
    shutil.rmtree(TAM)
    print(PH / f"{ten}.exe")
    if a.phat_hanh:
        phat_hanh(PH / f"{ten}.exe", a.ghi_chu)


if __name__ == "__main__":
    main()
