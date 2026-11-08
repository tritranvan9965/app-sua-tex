"""Lõi của app sửa .tex: đọc câu, lập danh mục, ghi file có sao lưu. Không phụ thuộc giao diện."""
import hashlib
import json
import re
import shutil
import sys
import tempfile
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import duong_app  # noqa: E402
import sua_rieng  # noqa: E402

# Không có tên thư mục, tên lệnh hay tên mẫu của dự án nào ở đây: mọi thứ riêng nằm trong file dự án (.json).
# Đây là giá trị mặc định cho tài liệu LaTeX thường: không chia bài, một bản PDF, đồ dùng của app để trong .sua-tex.
THU_VIEN = duong_app.THU_VIEN
MO_DAU_MANH = (THU_VIEN / "mo-dau-manh.tex").read_text(encoding="utf-8").strip()
MAC_DINH = {
    "cau": {"moi_truong": "", "nhan": "", "loi_giai": "loigiai", "mau_pdf": r"(Bài|Câu|Ví dụ)\s*(\d+)\s*[.:]"},
    "duong": {"sao_luu": ".sua-tex/sao-luu", "so_sua_rieng": ".sua-tex/sua-rieng",
              "thanh_pham": "{cha}/{ten}{hau_to}.pdf"},
    "xuat": {"mo_dau_manh": MO_DAU_MANH, "ket_manh": r"\end{document}", "ban": {}, "chep_them": []},
    "xem_nhanh": {"macro": {}, "lenh": []},
}
# Dự án không khai bản thì có hai bản: GV (đủ đáp án, tên PDF không hậu tố như trước) và HS (mẫu tritoan hiểu \BANHS).
BAN_MAC_DINH = {"GV": "", "HS": "\\def\\BANHS{1}"}  # không xuống dòng, để số dòng báo lỗi LaTeX vẫn khớp file
DUOI_SUA = {".tex", ".sty", ".md", ".txt", ".json", ".csv"}

# Mọi đường dẫn tính theo gốc của dự án đang mở; chưa mở dự án thì chỉ đọc, sửa file thường.
GOC = SAO_LUU = DA = DUONG = MAU_ID = None
DAU = CUOI = ""


def dat_du_an(da: dict):
    """Gọi khi mở dự án, để dữ liệu thử và dữ liệu thật không bao giờ lẫn nhau."""
    global GOC, SAO_LUU, DA, DUONG, DAU, CUOI, MAU_ID
    GOC, DA, DUONG = da["goc"], da, da["duong"]
    SAO_LUU = GOC / DUONG["sao_luu"]
    ten, nhan = da["cau"]["moi_truong"], da["cau"]["nhan"]
    DAU, CUOI = (f"\\begin{{{ten}}}", f"\\end{{{ten}}}") if ten else ("", "")
    MAU_ID = re.compile(re.escape(nhan) + r"([^ |\r\n]+)") if nhan else None
    sua_rieng.SO = GOC / DUONG["so_sua_rieng"]
    sua_rieng.DAU, sua_rieng.CUOI, sua_rieng.NHAN = DAU, CUOI, nhan


def tach_cau(chu: str) -> list:
    """Mọi khối câu theo thứ tự trong file. stt là thứ tự khối, khớp thứ tự nhãn trong PDF."""
    ds, vt = [], 0
    if not DAU:
        return ds
    while True:
        d = chu.find(DAU, vt)
        if d < 0:
            return ds
        c = chu.find(CUOI, d)
        if c < 0:
            return ds
        c += len(CUOI)
        truoc = chu[:d].rstrip("\n").rsplit("\n", 1)[-1]
        ma = MAU_ID.match(truoc) if MAU_ID else None
        ds.append({"stt": len(ds) + 1, "id": ma.group(1) if ma else None, "nhan": truoc if ma else "",
                   "dau": d, "cuoi": c, "dong": chu.count("\n", 0, d) + 1, "than": chu[d:c]})
        vt = c


def chuan(than: str) -> str:
    return re.sub(r"\s+", " ", than).strip()


def la_file_rap(p: Path) -> bool:
    """File ráp là file nằm trong một mục có vai_tro san-pham của cây dự án."""
    p = p.resolve()
    return any(m.get("vai_tro") == "san-pham" and "thu_muc" in m and p.is_relative_to(GOC / m["thu_muc"]) for m in DA["cay"])


def hau_to(ban: str) -> str:
    """Bản mặc định (GV khi dự án không khai bản) giữ tên PDF cũ, không hậu tố."""
    return "" if not ban or ban == DA.get("ban_khong_hau_to") else f"_{ban}"


def ra_duong(mau: str, tex: Path, ban: str) -> Path:
    """Mẫu đường dẫn trong file dự án, tính từ gốc. {ban} là tên bản, {hau_to} là _<bản> hoặc rỗng khi chỉ có một bản."""
    cha = tex.parent.resolve()
    return GOC / mau.format(ten=tex.stem, thu_muc=tex.parent.name, ban=ban, hau_to=hau_to(ban),
                            cha=cha.relative_to(GOC).as_posix() if cha.is_relative_to(GOC) else ".")


def duong_pdf(tex: Path, ban: str) -> Path:
    return ra_duong(DUONG["thanh_pham"], tex, ban)


def la_file_manh(chu: str) -> bool:
    """File mảnh chỉ có phần thân LaTeX, muốn xuất PDF phải bọc thêm phần mở đầu."""
    return not re.search(r"(?m)^[^%\n]*\\documentclass", chu)


def boc_manh(chu: str) -> tuple:
    """Trả về bản đã bọc và số dòng bị đẩy xuống, để đổi lại số dòng trong báo lỗi LaTeX."""
    x = DA["xuat"]
    return x["mo_dau_manh"] + "\n" + chu + "\n" + x["ket_manh"] + "\n", x["mo_dau_manh"].count("\n") + 1


def tru_dong(nhat_ky: str, lech: int) -> str:
    return re.sub(r"\bl\.(\d+)", lambda m: f"l.{int(m.group(1)) - lech}", nhat_ky)


def duong_nhap(tex: Path, ban: str) -> Path:
    """PDF để xem khi đang sửa: nằm ở thư mục tạm của máy, không vào dự án và không đồng bộ OneDrive."""
    ma = hashlib.sha1(str(tex.resolve()).lower().encode("utf-8")).hexdigest()[:16]
    return Path(tempfile.gettempdir()) / "tritex-xem" / f"{ma}_{ban}.pdf"


def sao_luu(p: Path, moc: str) -> None:
    try:
        tuong_doi = p.resolve().relative_to(GOC)
    except ValueError:
        tuong_doi = Path("_ngoai-du-an") / p.name
    dich = SAO_LUU / moc / tuong_doi
    dich.parent.mkdir(parents=True, exist_ok=True)
    if not dich.exists():  # cùng một lần lưu thì giữ bản đầu tiên
        shutil.copy2(p, dich)


def moc_gio() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def ghi_file(p: Path, chu: str) -> None:
    """Ghi qua file tạm rồi đổi tên, để mất điện giữa chừng không làm hỏng file."""
    tam = p.with_name(p.name + ".tam-app")
    tam.write_text(chu, encoding="utf-8", newline="\n")
    tam.replace(p)


# ---------- Dự án và danh mục ----------

def lap_du_an(cau_hinh: dict, goc: Path, ten: str, tep_dau: Path = None) -> dict:
    da = {k: {**v, **cau_hinh.get(k, {})} for k, v in MAC_DINH.items()}
    mac_dinh = not da["xuat"].get("ban")
    if mac_dinh:
        da["xuat"] = {**da["xuat"], "ban": dict(BAN_MAC_DINH)}
    da.update(ban_mac_dinh=mac_dinh, ban_khong_hau_to=next(iter(BAN_MAC_DINH)) if mac_dinh else None)
    da.update(ten=ten, goc=goc, cay=cau_hinh.get("cay", []), tep_dau=str(tep_dau) if tep_dau else None)
    da["duong"]["thanh_pham"].format(ten="", thu_muc="", ban="", hau_to="", cha="")  # sai mẫu thì báo ngay lúc mở
    return da


def doc_du_an(p: Path) -> dict:
    da = json.loads(p.read_text(encoding="utf-8"))
    return lap_du_an(da, (p.parent / da.get("goc", ".")).resolve(), da.get("ten", p.stem))


def mo_nhanh(p: Path) -> dict:
    """Mở thẳng một file hay thư mục, không cần file dự án, theo các giá trị mặc định."""
    if p.is_dir():
        return lap_du_an({"cay": [{"ten": p.name or str(p), "thu_muc": "."}]}, p, p.name or str(p))
    return lap_du_an({"cay": [{"tep": p.name}]}, p.parent, p.name, p)


def cac_mau() -> dict:
    """{tên mẫu: [các file .sty, .cls]} và {file: thư mục} của thư viện, đọc lại mỗi lần để mẫu mới dùng được ngay."""
    ds, noi = {}, {}
    for tm in sorted(x for x in THU_VIEN.iterdir() if x.is_dir()):
        tep = sorted(f.name for f in tm.iterdir() if f.suffix.lower() in (".sty", ".cls"))
        if tep:
            ds[tm.name] = tep
            for t in tep:
                noi.setdefault(t, tm)
    return {"ds": ds, "noi": noi}


def tim_du_an(p: Path):
    """File hay thư mục nằm trong một dự án đã có cấu hình thì dùng cấu hình đó, để biết mẫu và hình ở đâu."""
    ung_vien = [f for cha in ([p] if p.is_dir() else []) + list(p.parents) for f in sorted(cha.glob("du-an*.json"))]
    ung_vien += sorted(duong_app.DU_LIEU.glob("du-an*.json"))
    for f in ung_vien:
        try:
            da = doc_du_an(f)
        except (ValueError, KeyError, OSError):
            continue
        if da["cay"] and p.is_relative_to(da["goc"]):
            return {**da, "tep_dau": None if p.is_dir() else str(p)}
    return None


def mo_duong(p: Path) -> dict:
    """File .json là file dự án; file sửa được khác và thư mục thì mở nhanh."""
    if not p.exists():
        raise ValueError(f"Không tìm thấy {p}")
    if p.suffix.lower() == ".json":
        return doc_du_an(p)
    if p.is_dir() or p.suffix.lower() in DUOI_SUA:
        return tim_du_an(p) or mo_nhanh(p)
    raise ValueError(f"App chưa mở được loại file {p.suffix}")


THU_MUC_PHU = re.compile(r"_?(sao-luu(-app)?|log|logs|tmp|temp|cache|build|__pycache__)", re.I)  # sao lưu, nhật ký, file tạm: không cần hiện


def quet_thu_muc(thu_muc: Path, duoi=DUOI_SUA) -> dict:
    con = []
    try:
        ds = sorted(thu_muc.iterdir(), key=lambda v: (v.is_file(), v.name.lower()))
    except PermissionError:  # mở nhanh có thể gặp thư mục hệ thống không được đọc
        ds = []
    for x in ds:
        if x.name.startswith((".", "~")) or x.name.endswith("_hinh"):  # thư mục ẩn, file tạm của Word; thư mục "_..." của người dùng vẫn hiện
            continue
        if x.is_dir() and THU_MUC_PHU.fullmatch(x.name):
            continue
        if x.is_dir():
            nut = quet_thu_muc(x, duoi)
            if nut["con"]:
                con.append(nut)
        elif x.suffix.lower() in duoi:
            con.append({"ten": x.name, "duong": str(x)})
    return {"ten": thu_muc.name, "duong": str(thu_muc), "thu_muc": True, "con": con}


def cay_du_an(da: dict) -> list:
    ra = []
    for muc in da["cay"]:
        if "thu_muc" in muc:
            tm = da["goc"] / muc["thu_muc"]
            nut = quet_thu_muc(tm, DUOI_SUA | {".pdf"}) if tm.is_dir() else {"con": [], "duong": str(tm), "thieu": True}
            ra.append({**nut, "ten": muc.get("ten", tm.name), "thu_muc": True})
        elif "tep" in muc:
            tep = da["goc"] / muc["tep"]
            ra.append({"ten": muc.get("ten", tep.name), "duong": str(tep), "thieu": not tep.exists()})
    return ra


class DanhMuc:
    """Câu nào nằm ở file nào. Chỉ đọc lại file đã đổi (theo thời điểm sửa)."""

    def __init__(self):
        self.cache = {}

    def _ids(self, p: Path) -> list:
        tg = p.stat().st_mtime_ns
        cu = self.cache.get(p)
        if cu and cu[0] == tg:
            return cu[1]
        ids = [c["id"] for c in tach_cau(p.read_text(encoding="utf-8", errors="replace")) if c["id"]]
        self.cache[p] = (tg, ids)
        return ids

    def cac_file(self, da: dict, vai_tro: str) -> list:
        ra = []
        for muc in da["cay"]:
            if muc.get("vai_tro") != vai_tro or "thu_muc" not in muc:
                continue
            for p in (da["goc"] / muc["thu_muc"]).rglob("*.tex"):
                if not any(x.startswith("_") or x.endswith("_hinh") for x in p.parts[-4:-1]) and not p.name.startswith("_"):
                    ra.append(p)
        return ra

    def tim(self, da: dict, ma: str, vai_tro: str) -> list:
        return [p for p in self.cac_file(da, vai_tro) if ma in self._ids(p)]


def tim_trong(chu: str, ma: str):
    for c in tach_cau(chu):
        if c["id"] == ma:
            return c
    return None


def thay_than(chu: str, ma: str, moi: str) -> str:
    c = tim_trong(chu, ma)
    if not c:
        raise KeyError(ma)
    return chu[:c["dau"]] + moi + chu[c["cuoi"]:]


def so_sanh(cu: str, moi: str) -> dict:
    """Các câu có id bị đổi, bị xoá; các khối chưa có id."""
    a = {c["id"]: c for c in tach_cau(cu) if c["id"]}
    b_ds = tach_cau(moi)
    b = {c["id"]: c for c in b_ds if c["id"]}
    return {"doi": [{"id": k, "cu": a[k]["than"], "moi": b[k]["than"], "dong": b[k]["dong"]}
                    for k in b if k in a and a[k]["than"] != b[k]["than"]],
            "xoa": [k for k in a if k not in b],
            "moi": [c["dong"] for c in b_ds if not c["id"]] if MAU_ID else []}


def phan_tich_luu(da, dm: DanhMuc, p: Path, moi: str) -> dict:
    """Nói trước việc sẽ xảy ra khi lưu, chưa ghi gì."""
    cu = p.read_text(encoding="utf-8")
    kq = so_sanh(cu, moi)
    for x in kq["doi"]:
        x["ngan_hang"], x["file_khac"], x["ngan_hang_lech"] = None, [], False
        if not da:
            continue
        nh = dm.tim(da, x["id"], "ngan-hang")
        if nh:
            x["ngan_hang"] = str(nh[0])
            c = tim_trong(nh[0].read_text(encoding="utf-8"), x["id"])
            x["ngan_hang_lech"] = bool(c) and chuan(c["than"]) != chuan(x["cu"])
        x["file_khac"] = [str(f) for f in dm.tim(da, x["id"], "san-pham") if f.resolve() != p.resolve()]
    return kq


def luu(da, dm: DanhMuc, p: Path, moi: str, lua_chon: dict) -> dict:
    """lua_chon = {id: {"pham_vi": "file"|"ngan-hang", "file_khac": [đường dẫn]}}.
    Trình tự: sao lưu mọi file liên quan -> ghi ngân hàng và file khác -> ghi file đang mở."""
    moc = moc_gio()
    cu = p.read_text(encoding="utf-8")
    kq = so_sanh(cu, moi)
    ghi_nhan, canh_bao = {"ngan_hang": 0, "file_khac": 0}, []
    so = sua_rieng.doc(p.name) if la_file_rap(p) else {}
    for x in kq["doi"]:
        lc = lua_chon.get(x["id"], {"pham_vi": "file", "file_khac": []})
        if lc.get("pham_vi") == "ngan-hang":
            nh = dm.tim(da, x["id"], "ngan-hang") if da else []
            if not nh:
                canh_bao.append(f"{x['id']}: không tìm thấy trong ngân hàng, chỉ sửa file này.")
                so[x["id"]] = x["moi"]
            else:
                chu = nh[0].read_text(encoding="utf-8")
                sao_luu(nh[0], moc)
                ghi_file(nh[0], thay_than(chu, x["id"], x["moi"]))
                ghi_nhan["ngan_hang"] += 1
                so.pop(x["id"], None)
        elif la_file_rap(p):
            so[x["id"]] = x["moi"]
        for f in lc.get("file_khac", []):
            f = Path(f)
            chu = f.read_text(encoding="utf-8")
            if not tim_trong(chu, x["id"]):
                continue
            sao_luu(f, moc)
            ghi_file(f, thay_than(chu, x["id"], x["moi"]))
            if la_file_rap(f) and lc.get("pham_vi") != "ngan-hang":
                so_k = sua_rieng.doc(f.name)
                so_k[x["id"]] = x["moi"]
                sua_rieng.ghi(f.name, so_k)
            ghi_nhan["file_khac"] += 1
    sao_luu(p, moc)
    ghi_file(p, moi)
    if la_file_rap(p):
        sua_rieng.ghi(p.name, so)
    return {**ghi_nhan, "canh_bao": canh_bao, "moc": moc}
