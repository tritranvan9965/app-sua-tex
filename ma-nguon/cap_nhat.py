"""Tự cập nhật qua GitHub Releases: kiểm tra bản mới, tải bộ cài, chạy bộ cài rồi để app thoát.
Chỉ đọc API công khai, không cần đăng nhập. Mất mạng hay lỗi API thì trả lỗi để giao diện im lặng bỏ qua.

Biến môi trường (để thử với server giả):
  TRITEX_API_CAP_NHAT  địa chỉ trả JSON giống /releases/latest
  TRITEX_LENH_CAI      lệnh chạy thay cho bộ cài, nhận thêm đường dẫn file đã tải và /im /capnhat"""
import hashlib
import json
import os
import re
import shlex
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import cai_dat
import duong_app

REPO = "tritranvan9965/app-sua-tex"
API_MAC_DINH = f"https://api.github.com/repos/{REPO}/releases/latest"
TIEN_TO_TAI = f"https://github.com/{REPO}/releases/download/"
MAU_BO_CAI = re.compile(r"^TriTeX-Setup-.+\.exe$", re.I)
CACH_NGAY = 24 * 3600
TAM = Path(tempfile.gettempdir()) / "TriTeX-cap-nhat"
FILE_GHI_NHO = duong_app.DU_LIEU / "cap-nhat.json"  # tách khỏi cai-dat.json vì file đó do trang ghi đè cả tệp


class LoiCapNhat(Exception):
    pass


def dia_chi_api() -> str:
    return os.environ.get("TRITEX_API_CAP_NHAT") or API_MAC_DINH


def la_may_thu() -> bool:
    """Có đặt địa chỉ API riêng nghĩa là đang thử với server giả, khi đó bỏ các giới hạn của bản thật."""
    return bool(os.environ.get("TRITEX_API_CAP_NHAT"))


def so_phien_ban(chu: str) -> tuple:
    """'v1.2.10' -> (1, 2, 10). So theo số nên 1.2.10 lớn hơn 1.2.9. Không đọc được thì trả ()."""
    m = re.search(r"\d+(?:\.\d+)*", chu or "")
    if not m:
        return ()
    so = [int(x) for x in m.group().split(".")]
    while len(so) > 1 and so[-1] == 0:
        so.pop()  # 1.2.0 bằng 1.2
    return tuple(so)


def la_ban_moi(tag: str, hien_tai: str = None) -> bool:
    moi = so_phien_ban(tag)
    return bool(moi) and moi > so_phien_ban(hien_tai or cai_dat.PHIEN_BAN)


def doc_ban_phat_hanh(du_lieu: dict) -> dict:
    """Rút gọn JSON của GitHub: phiên bản, ghi chú, và bộ cài TriTeX-Setup-*.exe (nếu có)."""
    tag = str(du_lieu.get("tag_name") or "")
    if not so_phien_ban(tag):
        raise LoiCapNhat("Không đọc được số phiên bản của bản phát hành.")
    bo_cai = next((a for a in du_lieu.get("assets") or [] if MAU_BO_CAI.match(str(a.get("name") or ""))), None)
    ket = {"tag": tag, "phien_ban": ".".join(map(str, so_phien_ban(tag))), "ghi_chu": str(du_lieu.get("body") or "").strip(), "url": "", "kich_thuoc": 0, "bam": ""}
    if bo_cai:
        digest = str(bo_cai.get("digest") or "")
        ket.update(ten=bo_cai["name"], url=str(bo_cai.get("browser_download_url") or ""), kich_thuoc=int(bo_cai.get("size") or 0),
                   bam=digest.split(":", 1)[1].lower() if digest.startswith("sha256:") else "")
    return ket


def goi_api() -> dict:
    req = urllib.request.Request(dia_chi_api(), headers={"User-Agent": f"TriTeX/{cai_dat.PHIEN_BAN}", "Accept": "application/vnd.github+json"})
    try:
        with urllib.request.urlopen(req, timeout=8) as tl:
            return json.loads(tl.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {}  # chưa có bản phát hành nào
        raise LoiCapNhat("GitHub chưa trả lời được (có thể đang giới hạn lượt). Thử lại sau.")
    except (OSError, ValueError):
        raise LoiCapNhat("Không kết nối được máy chủ cập nhật. Kiểm tra mạng rồi thử lại.")


def doc_ghi_nho() -> dict:
    try:
        return json.loads(FILE_GHI_NHO.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def ghi_ghi_nho(d: dict) -> None:
    try:
        FILE_GHI_NHO.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
    except OSError:
        pass


def tra_loi(ban: dict) -> dict:
    ban = ban or {}
    return {"hien_tai": cai_dat.PHIEN_BAN, "ban_ma_nguon": not duong_app.DA_DONG_GOI, "co_ban_moi": la_ban_moi(ban.get("tag", "")) if ban else False,
            "co_the_cap_nhat": bool(ban.get("url")) and (duong_app.DA_DONG_GOI or bool(os.environ.get("TRITEX_LENH_CAI"))),
            "ban": ban}


def kiem_tra(tu_dong: bool) -> dict:
    """Tự động: chỉ khi đã đóng gói, tối đa một lần mỗi ngày (giữa các lần dùng kết quả đã nhớ). Thủ công: luôn hỏi GitHub."""
    if tu_dong:
        if not (duong_app.DA_DONG_GOI or la_may_thu()):
            return {"bo_qua": True}
        gn = doc_ghi_nho()
        if not la_may_thu() and time.time() - gn.get("luc", 0) < CACH_NGAY:
            return tra_loi(gn.get("ban")) if gn.get("ban") else {"bo_qua": True}
    ban = doc_ban_phat_hanh(d) if (d := goi_api()) else {}
    if not la_may_thu():
        ghi_ghi_nho({"luc": time.time(), "ban": ban})
    return tra_loi(ban)


# ---------- Tải và cài ----------

TIEN_DO = {"trang_thai": "ranh", "da": 0, "tong": 0, "loi": "", "duong": ""}
_khoa = threading.Lock()
_huy = threading.Event()


def tien_do() -> dict:
    with _khoa:
        return dict(TIEN_DO)


def _dat(**kw) -> None:
    with _khoa:
        TIEN_DO.update(kw)


def bat_dau_tai() -> dict:
    """Hỏi lại API để lấy đúng bản mới nhất rồi tải trong luồng riêng. Giao diện đọc tien_do()."""
    if not (duong_app.DA_DONG_GOI or os.environ.get("TRITEX_LENH_CAI")):
        raise LoiCapNhat("Bản chạy từ mã nguồn không tự cập nhật.")
    with _khoa:
        if TIEN_DO["trang_thai"] == "tai":
            return dict(TIEN_DO)
        TIEN_DO.update(trang_thai="tai", da=0, tong=0, loi="", duong="")
    _huy.clear()
    try:
        ban = doc_ban_phat_hanh(goi_api() or {})
    except LoiCapNhat as e:
        _dat(trang_thai="loi", loi=str(e))
        raise
    if not la_ban_moi(ban["tag"]) or not ban["url"]:
        _dat(trang_thai="loi", loi="Không có bản mới để tải.")
        raise LoiCapNhat("Không có bản mới để tải.")
    if not (ban["url"].startswith(TIEN_TO_TAI) or la_may_thu()):
        _dat(trang_thai="loi", loi="Địa chỉ tải không đúng nguồn.")
        raise LoiCapNhat("Địa chỉ tải không đúng nguồn.")
    _dat(tong=ban["kich_thuoc"])
    threading.Thread(target=_tai, args=(ban,), daemon=True).start()
    return tien_do()


def _tai(ban: dict) -> None:
    try:
        TAM.mkdir(parents=True, exist_ok=True)
        for cu in TAM.glob("*"):
            try:
                cu.unlink()
            except OSError:
                pass
        dich = TAM / Path(ban["ten"]).name
        tam = dich.with_name(dich.name + ".part")
        h = hashlib.sha256()
        req = urllib.request.Request(ban["url"], headers={"User-Agent": f"TriTeX/{cai_dat.PHIEN_BAN}"})
        with urllib.request.urlopen(req, timeout=20) as tl, open(tam, "wb") as f:
            while chunk := tl.read(256 * 1024):
                if _huy.is_set():
                    raise LoiCapNhat("Đã hủy tải.")
                f.write(chunk)
                h.update(chunk)
                _dat(da=f.tell())
        kich_thuoc = tam.stat().st_size
        if ban["kich_thuoc"] and kich_thuoc != ban["kich_thuoc"]:
            raise LoiCapNhat("File tải về không đủ dung lượng. Thử lại.")
        if ban["bam"] and h.hexdigest() != ban["bam"]:
            raise LoiCapNhat("File tải về không khớp mã kiểm tra. Thử lại.")
        tam.replace(dich)
        _dat(trang_thai="xong", da=kich_thuoc, duong=str(dich))
    except LoiCapNhat as e:
        _dat(trang_thai="loi", loi=str(e))
    except (OSError, ValueError):
        _dat(trang_thai="loi", loi="Tải bộ cài không được. Kiểm tra mạng rồi thử lại.")


def huy_tai() -> None:
    _huy.set()


def lenh_bo_cai(duong: str) -> list:
    gia = [t.strip('"') for t in shlex.split(os.environ.get("TRITEX_LENH_CAI", ""), posix=False)]  # posix=False để giữ dấu \ của đường dẫn Windows
    return [*gia, duong, "/im", "/capnhat"]


def chay_bo_cai() -> None:
    """Chạy bộ cài đã tải, tách khỏi app để app thoát được. Bộ cài tự chờ app thoát rồi mở lại TriTeX."""
    td = tien_do()
    duong = td["duong"]
    if td["trang_thai"] != "xong" or not duong or not Path(duong).is_file() or Path(duong).parent != TAM:
        raise LoiCapNhat("Chưa tải xong bộ cài.")
    env = {k: v for k, v in os.environ.items() if not k.startswith(("_PYI", "_MEIPASS"))}  # không để bộ cài thừa hưởng môi trường của PyInstaller
    subprocess.Popen(lenh_bo_cai(duong), cwd=str(TAM), env=env, close_fds=True,
                     creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP)
