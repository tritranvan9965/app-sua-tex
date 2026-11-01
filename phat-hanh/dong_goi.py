"""Tạo bộ cài: phat-hanh/SuaTeX-Setup-<phiên bản>.exe. Chạy: .venv\\Scripts\\python.exe -I phat-hanh\\dong_goi.py"""
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


def pyinstaller(*ts) -> None:
    subprocess.run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--log-level", "WARN", "--workpath", str(TAM / "lam"),
                    "--specpath", str(TAM), "--windowed", "--paths", str(MA), "--icon", str(TAM / "sua-tex.ico"), *ts], check=True)


def main():
    shutil.rmtree(TAM, ignore_errors=True)
    TAM.mkdir(parents=True)
    tao_bieu_tuong(TAM / "sua-tex.ico")
    pyinstaller("--name", cai_dat.MA, "--distpath", str(TAM / "app"), "--add-data", f"{MA / 'static'};static",
                "--add-data", f"{GOC / 'thu-vien-mau'};thu-vien-mau", str(MA / "app.py"))
    shutil.make_archive(str(TAM / "sua-tex"), "zip", TAM / "app" / cai_dat.MA)
    ten = f"SuaTeX-Setup-{cai_dat.PHIEN_BAN}"
    pyinstaller("--onefile", "--name", ten, "--distpath", str(PH), "--add-data", f"{TAM / 'sua-tex.zip'};.", str(PH / "bo_cai.py"))
    shutil.rmtree(TAM)
    print(PH / f"{ten}.exe")


if __name__ == "__main__":
    main()
