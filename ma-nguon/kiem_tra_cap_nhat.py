"""Kiểm thử cap_nhat.py. Chạy: .venv\\Scripts\\python.exe ma-nguon\\kiem_tra_cap_nhat.py
Có thể chạy server giả để thử giao diện: kiem_tra_cap_nhat.py --may-chu <cổng> [phiên bản]
(rồi đặt TRITEX_API_CAP_NHAT=http://127.0.0.1:<cổng>/api và TRITEX_LENH_CAI=<lệnh giả> khi chạy app)."""
import hashlib
import json
import os
import sys
import tempfile
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
GOC = Path(__file__).resolve().parent
sys.path.insert(0, str(GOC))
import cai_dat  # noqa: E402
import cap_nhat  # noqa: E402
import duong_app  # noqa: E402

KET_QUA = []
EXE_GIA = b"MZ" + bytes(range(256)) * 4000  # ~1 MB, đủ để thanh tiến độ nhích vài lần


def kiem(ten, dieu_kien, chi_tiet=""):
    KET_QUA.append((ten, bool(dieu_kien), chi_tiet))
    print(("ĐẠT " if dieu_kien else "LỖI ") + ten + (f" — {chi_tiet}" if chi_tiet and not dieu_kien else ""))


def release_mau(tag, kich_thuoc=len(EXE_GIA), url="", bam=None, ten="TriTeX-Setup-9.9.9.exe") -> dict:
    return {"tag_name": tag, "name": f"TriTeX {tag[1:]}", "body": "- Thêm tự cập nhật\n- Sửa lỗi nhỏ", "draft": False, "prerelease": False,
            "assets": [{"name": "ghi-chu.txt", "size": 5, "browser_download_url": "http://x/ghi-chu.txt"},
                       {"name": ten, "size": kich_thuoc, "browser_download_url": url,
                        **({"digest": f"sha256:{bam}"} if bam else {})}]}


def chay_may_chu(cong: int, tag: str, sai_kich_thuoc=False, cham=0.0):
    """Server giả: /api trả release, /bo-cai.exe trả file exe giả (chậm lại để thấy tiến độ)."""
    class H(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            if self.path == "/api":
                d = release_mau(tag, kich_thuoc=len(EXE_GIA) + (7 if sai_kich_thuoc else 0), url=f"http://127.0.0.1:{cong}/bo-cai.exe",
                                bam=None if sai_kich_thuoc else hashlib.sha256(EXE_GIA).hexdigest())
                than = json.dumps(d).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Length", str(len(than)))
                self.end_headers()
                self.wfile.write(than)
            elif self.path == "/bo-cai.exe":
                self.send_response(200)
                self.send_header("Content-Length", str(len(EXE_GIA)))
                self.end_headers()
                for i in range(0, len(EXE_GIA), 131072):
                    self.wfile.write(EXE_GIA[i:i + 131072])
                    self.wfile.flush()
                    time.sleep(cham)
            else:
                self.send_response(404)
                self.end_headers()
    may = ThreadingHTTPServer(("127.0.0.1", cong), H)
    threading.Thread(target=may.serve_forever, daemon=True).start()
    return may


def cho_tai(giay=15) -> dict:
    han = time.time() + giay
    while time.time() < han:
        td = cap_nhat.tien_do()
        if td["trang_thai"] != "tai":
            return td
        time.sleep(0.05)
    return cap_nhat.tien_do()


def thu_so_sanh():
    s = cap_nhat.so_phien_ban
    kiem("so_phien_ban v1.2.13", s("v1.2.13") == (1, 2, 13))
    kiem("1.2.10 lớn hơn 1.2.9", s("1.2.10") > s("1.2.9"))
    kiem("1.2 bằng 1.2.0", s("1.2") == s("1.2.0"))
    kiem("tag không có số", s("moi") == ())
    kiem("la_ban_moi: bản cao hơn", cap_nhat.la_ban_moi("v1.2.13", "1.2.12"))
    kiem("la_ban_moi: 1.2.10 so 1.2.9", cap_nhat.la_ban_moi("v1.2.10", "1.2.9"))
    kiem("la_ban_moi: cùng bản", not cap_nhat.la_ban_moi("v1.2.12", "1.2.12"))
    kiem("la_ban_moi: bản thấp hơn", not cap_nhat.la_ban_moi("v1.1.0", "1.2.12"))
    kiem("la_ban_moi: tag hỏng", not cap_nhat.la_ban_moi("", "1.2.12"))


def thu_doc_release():
    r = cap_nhat.doc_ban_phat_hanh(release_mau("v1.2.13", 12345, "https://github.com/x/y.exe", "ab" * 32))
    kiem("đọc release: phiên bản", r["phien_ban"] == "1.2.13")
    kiem("đọc release: lấy đúng asset exe", r["ten"] == "TriTeX-Setup-9.9.9.exe" and r["url"] == "https://github.com/x/y.exe" and r["kich_thuoc"] == 12345)
    kiem("đọc release: ghi chú và mã sha256", r["ghi_chu"].startswith("- Thêm") and r["bam"] == "ab" * 32)
    kh = release_mau("v1.2.13")
    kh["assets"] = [kh["assets"][0]]
    kiem("đọc release: không có bộ cài thì url rỗng", cap_nhat.doc_ban_phat_hanh(kh)["url"] == "")
    try:
        cap_nhat.doc_ban_phat_hanh({"tag_name": "abc"})
        kiem("tag hỏng báo lỗi", False)
    except cap_nhat.LoiCapNhat:
        kiem("tag hỏng báo lỗi", True)


def thu_luong(tmp: Path):
    cu = (duong_app.DA_DONG_GOI, cap_nhat.FILE_GHI_NHO, cap_nhat.TAM)
    cap_nhat.FILE_GHI_NHO = tmp / "cap-nhat.json"
    cap_nhat.TAM = tmp / "tai"
    os.environ.pop("TRITEX_API_CAP_NHAT", None)
    os.environ.pop("TRITEX_LENH_CAI", None)
    cong = 18911
    may = chay_may_chu(cong, "v9.9.9", cham=0.03)
    try:
        duong_app.DA_DONG_GOI = False
        kiem("tự kiểm tra bị bỏ qua khi chạy mã nguồn", cap_nhat.kiem_tra(True).get("bo_qua") is True)
        os.environ["TRITEX_API_CAP_NHAT"] = f"http://127.0.0.1:{cong}/api"
        kq = cap_nhat.kiem_tra(False)
        kiem("thủ công trên bản mã nguồn: có bản mới", kq["co_ban_moi"] and kq["ban_ma_nguon"] and kq["ban"]["phien_ban"] == "9.9.9")
        kiem("bản mã nguồn không được tự cập nhật", not kq["co_the_cap_nhat"])
        try:
            cap_nhat.bat_dau_tai()
            kiem("bản mã nguồn không tải bộ cài", False)
        except cap_nhat.LoiCapNhat:
            kiem("bản mã nguồn không tải bộ cài", True)

        # giới hạn mỗi ngày (với API thật, tức khi không đặt địa chỉ riêng)
        os.environ.pop("TRITEX_API_CAP_NHAT")
        duong_app.DA_DONG_GOI = True
        dem = []
        goc = cap_nhat.goi_api
        cap_nhat.goi_api = lambda: dem.append(1) or release_mau("v9.9.9", url="https://github.com/tritranvan9965/app-sua-tex/releases/download/v9.9.9/a.exe")
        try:
            kq1 = cap_nhat.kiem_tra(True)
            kq2 = cap_nhat.kiem_tra(True)
            kiem("tự kiểm tra: lần hai trong ngày không gọi API", len(dem) == 1 and kq1["co_ban_moi"] and kq2["co_ban_moi"])
            gn = cap_nhat.doc_ghi_nho()
            gn["luc"] -= 25 * 3600
            cap_nhat.ghi_ghi_nho(gn)
            cap_nhat.kiem_tra(True)
            kiem("tự kiểm tra: qua một ngày thì gọi lại", len(dem) == 2)
            cap_nhat.goi_api = lambda: (_ for _ in ()).throw(cap_nhat.LoiCapNhat("mất mạng"))
            gn["luc"] = 0
            cap_nhat.ghi_ghi_nho(gn)
            try:
                cap_nhat.kiem_tra(True)
                kiem("mất mạng báo LoiCapNhat", False)
            except cap_nhat.LoiCapNhat:
                kiem("mất mạng báo LoiCapNhat", True)
        finally:
            cap_nhat.goi_api = goc

        # tải và chạy bộ cài giả
        os.environ["TRITEX_API_CAP_NHAT"] = f"http://127.0.0.1:{cong}/api"
        ghi = tmp / "lenh-da-goi.txt"
        gia = tmp / "cai_gia.py"
        gia.write_text(f"import sys\nopen(r'{ghi}', 'w', encoding='utf-8').write(' '.join(sys.argv[1:]))\n", encoding="utf-8")
        os.environ["TRITEX_LENH_CAI"] = f'"{sys.executable}" "{gia}"'
        td = cap_nhat.bat_dau_tai()
        kiem("bắt đầu tải", td["trang_thai"] == "tai" and td["tong"] == len(EXE_GIA))
        time.sleep(0.15)
        giua = cap_nhat.tien_do()
        td = cho_tai()
        kiem("tải xong, file đủ dung lượng", td["trang_thai"] == "xong" and Path(td["duong"]).stat().st_size == len(EXE_GIA), str(td))
        kiem("có tiến độ giữa chừng", 0 < giua["da"] <= td["da"], str(giua))
        cap_nhat.chay_bo_cai()
        for _ in range(100):
            if ghi.exists() and ghi.read_text(encoding="utf-8"):
                break
            time.sleep(0.1)
        noi = ghi.read_text(encoding="utf-8") if ghi.exists() else ""
        kiem("gọi bộ cài với /im /capnhat", noi.endswith("TriTeX-Setup-9.9.9.exe /im /capnhat"), noi)
    finally:
        may.shutdown()
        duong_app.DA_DONG_GOI, cap_nhat.FILE_GHI_NHO, cap_nhat.TAM = cu

    # kích thước không khớp
    cap_nhat.TAM = tmp / "tai2"
    may = chay_may_chu(cong + 1, "v9.9.9", sai_kich_thuoc=True)
    try:
        os.environ["TRITEX_API_CAP_NHAT"] = f"http://127.0.0.1:{cong + 1}/api"
        cap_nhat.bat_dau_tai()
        td = cho_tai()
        kiem("kích thước không khớp thì báo lỗi, không cho cài", td["trang_thai"] == "loi" and "dung lượng" in td["loi"], str(td))
        try:
            cap_nhat.chay_bo_cai()
            kiem("không chạy bộ cài khi tải lỗi", False)
        except cap_nhat.LoiCapNhat:
            kiem("không chạy bộ cài khi tải lỗi", True)
    finally:
        may.shutdown()
    # bản hiện tại đã mới nhất
    may = chay_may_chu(cong + 2, f"v{cai_dat.PHIEN_BAN}")
    try:
        os.environ["TRITEX_API_CAP_NHAT"] = f"http://127.0.0.1:{cong + 2}/api"
        kiem("cùng phiên bản thì không báo bản mới", not cap_nhat.kiem_tra(False)["co_ban_moi"])
    finally:
        may.shutdown()


def main():
    if "--may-chu" in sys.argv:
        i = sys.argv.index("--may-chu")
        cong = int(sys.argv[i + 1])
        chay_may_chu(cong, f"v{sys.argv[i + 2] if len(sys.argv) > i + 2 else '9.9.9'}", cham=0.25)
        print(f"Server giả ở http://127.0.0.1:{cong}/api", flush=True)
        threading.Event().wait()
    with tempfile.TemporaryDirectory() as t:
        for ham in (thu_so_sanh, thu_doc_release, lambda: thu_luong(Path(t))):
            try:
                ham()
            except Exception:
                kiem(getattr(ham, "__name__", "luồng"), False, traceback.format_exc())
    loi = [k for k in KET_QUA if not k[1]]
    print(f"\n{len(KET_QUA) - len(loi)}/{len(KET_QUA)} đạt")
    for ten, _, ct in loi:
        print("LỖI:", ten, ct)
    sys.exit(1 if loi else 0)


if __name__ == "__main__":
    main()
