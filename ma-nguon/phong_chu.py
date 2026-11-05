"""Phông chữ cho PDF: tìm file phông trên Windows, đọc bảng sfnt (TrueType/OpenType), kiểm tra đủ dấu tiếng Việt,
cắt tập con và tạo đối tượng phông PDF (CID, Identity-H, có ToUnicode) để chữ thêm vào tìm và bôi đen được.
Không dùng thư viện ngoài ngoài pikepdf: bảng sfnt đọc trực tiếp bằng struct."""
import bisect
import json
import os
import random
import re
import string
import struct
import zlib
from pathlib import Path

import pikepdf
from pikepdf import Array, Dictionary, Name, String

CHU_VIET = ("àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ")
CHU_VIET += CHU_VIET.upper()
CHU_VIET = "".join(sorted(set(CHU_VIET)))


class LoiChu(ValueError):
    """Lỗi người dùng đọc được (tiếng Việt)."""


# ---------- Đọc sfnt ----------

class Sfnt:
    """Một mặt phông trong file .ttf/.otf/.ttc. Chỉ đọc bảng khi cần."""

    def __init__(self, duong, chi_so: int = 0):
        self.duong = str(duong)
        self.chi_so = chi_so
        self._bang_nho = {}
        with open(self.duong, "rb") as f:
            dau = f.read(4)
            vt = 0
            if dau == b"ttcf":
                f.seek(8)
                n = struct.unpack(">I", f.read(4))[0]
                if not 0 <= chi_so < n:
                    raise LoiChu("Không có mặt phông này trong file.")
                f.seek(12 + 4 * chi_so)
                vt = struct.unpack(">I", f.read(4))[0]
            f.seek(vt)
            h = f.read(12)
            if len(h) < 12 or h[:4] not in (b"\x00\x01\x00\x00", b"true", b"OTTO", b"typ1"):
                raise LoiChu(f"{Path(duong).name} không phải file phông đọc được.")
            self.cff = h[:4] == b"OTTO"
            n = struct.unpack(">H", h[4:6])[0]
            d = f.read(16 * n)
        self.bang = {d[i:i + 4].decode("latin1"): struct.unpack(">II", d[i + 8:i + 16]) for i in range(0, len(d) - 15, 16)}
        self.trong_ttc = dau == b"ttcf"

    @staticmethod
    def so_mat(duong) -> int:
        with open(duong, "rb") as f:
            if f.read(4) != b"ttcf":
                return 1
            f.seek(8)
            return struct.unpack(">I", f.read(4))[0]

    def doc(self, tag: str):
        if tag not in self.bang:
            return None
        if tag not in self._bang_nho:
            vt, dai = self.bang[tag]
            with open(self.duong, "rb") as f:
                f.seek(vt)
                self._bang_nho[tag] = f.read(dai)
        return self._bang_nho[tag]

    # --- số liệu ---
    @property
    def upm(self) -> int:
        h = self.doc("head")
        return struct.unpack(">H", h[18:20])[0] if h else 1000

    @property
    def so_glyph(self) -> int:
        m = self.doc("maxp")
        return struct.unpack(">H", m[4:6])[0]

    def hop_bao(self):
        h = self.doc("head")
        return struct.unpack(">4h", h[36:44])

    def mac_style(self) -> int:
        h = self.doc("head")
        return struct.unpack(">H", h[44:46])[0] if h else 0

    def hhea(self):
        h = self.doc("hhea")
        return struct.unpack(">3h", h[4:10]), struct.unpack(">H", h[34:36])[0]  # (asc, desc, gap), số hmetrics

    def os2(self):
        t = self.doc("OS/2")
        if not t or len(t) < 64:
            return {}
        r = {"trong": struct.unpack(">H", t[4:6])[0], "chon": struct.unpack(">H", t[62:64])[0]}
        return r

    def ten(self) -> dict:
        """Mã tên -> chuỗi. Ưu tiên bản tiếng Anh Mỹ."""
        t = self.doc("name")
        if not t:
            return {}
        _, n, kho = struct.unpack(">HHH", t[:6])
        ra, uu_tien = {}, {}
        for i in range(n):
            nen, ma_hoa, ngon, ma, dai, vt = struct.unpack(">6H", t[6 + 12 * i:18 + 12 * i])
            tho = t[kho + vt:kho + vt + dai]
            try:
                chu = tho.decode("utf-16-be") if nen in (0, 3) else tho.decode("mac_roman")
            except UnicodeDecodeError:
                continue
            diem = (2 if nen == 3 else 1 if nen == 0 else 0) + (2 if ngon == 0x409 else 0)
            if ma not in ra or diem > uu_tien[ma]:
                ra[ma], uu_tien[ma] = chu, diem
        return ra

    def _cmap(self):
        if hasattr(self, "_cm"):
            return self._cm
        self._cm = None
        t = self.doc("cmap")
        if not t:
            return None
        n = struct.unpack(">H", t[2:4])[0]
        ung = []
        for i in range(n):
            nen, ma_hoa, vt = struct.unpack(">HHI", t[4 + 8 * i:12 + 8 * i])
            fm = struct.unpack(">H", t[vt:vt + 2])[0]
            if (nen, ma_hoa) in ((3, 10), (0, 4), (0, 6)) and fm == 12:
                ung.append((0, vt, fm))
            elif (nen, ma_hoa) in ((3, 1), (0, 3), (0, 4), (0, 2), (0, 1), (0, 0)) and fm == 4:
                ung.append((1, vt, fm))
        if not ung:
            return None
        _, vt, fm = min(ung)
        if fm == 12:
            sl = struct.unpack(">I", t[vt + 12:vt + 16])[0]
            nhom = [struct.unpack(">3I", t[vt + 16 + 12 * k:vt + 28 + 12 * k]) for k in range(sl)]
            self._cm = ("12", [g[0] for g in nhom], nhom)
        else:
            sx2 = struct.unpack(">H", t[vt + 6:vt + 8])[0]
            sx = sx2 // 2
            ket = struct.unpack(f">{sx}H", t[vt + 14:vt + 14 + sx2])
            dau = struct.unpack(f">{sx}H", t[vt + 16 + sx2:vt + 16 + 2 * sx2])
            delta = struct.unpack(f">{sx}h", t[vt + 16 + 2 * sx2:vt + 16 + 3 * sx2])
            vt_ro = vt + 16 + 3 * sx2
            rof = struct.unpack(f">{sx}H", t[vt_ro:vt_ro + sx2])
            vt_mang = vt_ro + sx2
            mang = struct.unpack(f">{(len(t) - vt_mang) // 2}H", t[vt_mang:vt_mang + ((len(t) - vt_mang) // 2) * 2])
            self._cm = ("4", ket, (dau, delta, rof, mang, sx))
        return self._cm

    def gid(self, ma: int) -> int:
        """Số glyph của một ký tự Unicode, 0 nếu phông không có."""
        c = self._cmap()
        if not c:
            return 0
        if c[0] == "12":
            i = bisect.bisect_right(c[1], ma) - 1
            if i >= 0 and ma <= c[2][i][1]:
                return c[2][i][2] + ma - c[2][i][0]
            return 0
        ket, (dau, delta, rof, mang, sx) = c[1], c[2]
        i = bisect.bisect_left(ket, ma)
        if i >= sx or dau[i] > ma:
            return 0
        r = rof[i]
        if r == 0:
            return (ma + delta[i]) & 0xFFFF
        k = i + r // 2 + (ma - dau[i]) - sx  # idRangeOffset tính từ chính ô của nó, mảng glyph nằm ngay sau
        if not 0 <= k < len(mang):
            return 0
        g = mang[k]
        return (g + delta[i]) & 0xFFFF if g else 0

    def rong_glyph(self, g: int) -> int:
        """Độ rộng bước tiến (đơn vị upm)."""
        if not hasattr(self, "_hm"):
            self._hm = (self.doc("hmtx"), self.hhea()[1])
        hm, so = self._hm
        if so == 0:
            return 0
        g = min(g, so - 1)
        return struct.unpack(">H", hm[4 * g:4 * g + 2])[0]

    def co_du_dau(self) -> bool:
        return all(self.gid(ord(c)) for c in CHU_VIET)


# ---------- Danh mục phông máy ----------

THU_MUC_PHONG = [Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"]
if os.environ.get("LOCALAPPDATA"):
    THU_MUC_PHONG.append(Path(os.environ["LOCALAPPDATA"]) / "Microsoft" / "Windows" / "Fonts")
TEP_NHO = Path(os.environ["LOCALAPPDATA"]) / "SuaTeX" / "phong-pdf.json" if os.environ.get("LOCALAPPDATA") else None
_DANH_MUC = None


def _file_phong() -> list:
    """Đường dẫn file phông từ registry và các thư mục phông."""
    ra = {}
    try:
        import winreg
        for goc, duong in ((winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts"),
                           (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows NT\CurrentVersion\Fonts")):
            try:
                with winreg.OpenKey(goc, duong) as k:
                    for i in range(winreg.QueryInfoKey(k)[1]):
                        _, gt, _ = winreg.EnumValue(k, i)
                        p = Path(str(gt))
                        if not p.is_absolute():
                            p = THU_MUC_PHONG[0] / p
                        ra[str(p).lower()] = p
            except OSError:
                pass
    except ImportError:
        pass
    for th in THU_MUC_PHONG:
        if th.is_dir():
            for p in th.iterdir():
                ra.setdefault(str(p).lower(), p)
    return [p for p in ra.values() if p.suffix.lower() in (".ttf", ".otf", ".ttc") and p.is_file()]


def _doc_mat(p: Path, i: int):
    sf = Sfnt(p, i)
    ten = sf.ten()
    ho_cu = ten.get(1, "")
    ho = ten.get(16) or ho_cu
    if not ho:
        return None
    o = sf.os2()
    ms = sf.mac_style()
    trong = o.get("trong", 400)
    chon = o.get("chon", 0)
    return {"ho": ho, "ho_cu": ho_cu, "kieu": ten.get(17) or ten.get(2, ""), "ps": ten.get(6, ""), "day_du": ten.get(4, ""),
            "trong": trong, "dam": bool(ms & 1 or chon & 32 or trong >= 600), "nghieng": bool(ms & 2 or chon & 1),
            "duong": str(p), "chi_so": i, "cff": sf.cff, "bien_doi": "fvar" in sf.bang,
            "du_dau": sf.co_du_dau(), "co_unicode": sf._cmap() is not None}


def danh_muc(lam_moi: bool = False) -> list:
    """Mọi mặt phông trên máy. Đọc lần đầu mất vài giây nên nhớ trong bộ nhớ và trong %LOCALAPPDATA%\\SuaTeX."""
    global _DANH_MUC
    if _DANH_MUC is not None and not lam_moi:
        return _DANH_MUC
    nho = {}
    if TEP_NHO and TEP_NHO.is_file() and not lam_moi:
        try:
            nho = json.loads(TEP_NHO.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            nho = {}
    moi, ra = {}, []
    for p in _file_phong():
        try:
            st = p.stat()
        except OSError:
            continue
        khoa = f"{p}|{st.st_mtime_ns}|{st.st_size}"
        if khoa in nho:
            ds = nho[khoa]
        else:
            ds = []
            try:
                for i in range(Sfnt.so_mat(p)):
                    m = _doc_mat(p, i)
                    if m:
                        ds.append(m)
            except (LoiChu, OSError, struct.error, IndexError):
                ds = []
        moi[khoa] = ds
        ra += ds
    if TEP_NHO and moi != nho:
        try:
            TEP_NHO.parent.mkdir(parents=True, exist_ok=True)
            TEP_NHO.write_text(json.dumps(moi, ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass
    _DANH_MUC = ra
    return ra


def ds_phong_viet(chi_du_dau: bool = True) -> list:
    """Họ phông dùng được cho chữ tiếng Việt: [{ho, du_dau, co_dam, co_nghieng, kieu}]. Mỗi họ một dòng."""
    nhom = {}
    for m in danh_muc():
        if not m["co_unicode"]:
            continue
        g = nhom.setdefault(m["ho"], {"ho": m["ho"], "du_dau": False, "co_dam": False, "co_nghieng": False, "so_kieu": 0})
        g["so_kieu"] += 1
        g["du_dau"] = g["du_dau"] or m["du_dau"]
        g["co_dam"] = g["co_dam"] or (m["dam"] and m["du_dau"])
        g["co_nghieng"] = g["co_nghieng"] or (m["nghieng"] and m["du_dau"])
    ra = [g for g in nhom.values() if g["du_dau"] or not chi_du_dau]
    return sorted(ra, key=lambda g: g["ho"].lower())


def tim_phong(ho: str, dam: bool = False, nghieng: bool = False, chi_du_dau: bool = True):
    """File phông cho họ + đậm/nghiêng. Trả mục danh mục kèm cờ dam_gia, nghieng_gia (phải giả lập) hoặc None nếu không có họ này."""
    ho_k = (ho or "").strip().lower()
    ds = [m for m in danh_muc() if m["co_unicode"] and ho_k in (m["ho"].lower(), m["ho_cu"].lower())]
    if chi_du_dau:
        ds = [m for m in ds if m["du_dau"]] or ds
    if not ds:
        return None
    dich = 700 if dam else 400

    def diem(m):
        la = bool(re.search(r"cond|narrow|compressed|light|thin|black|heavy|extra|ultra|display|caption|subhead|semi|demi|medium|small", m["kieu"], re.I))
        return (m["nghieng"] != nghieng) * 2000 + abs(m["trong"] - dich) + la * 500 + m["bien_doi"] * 30 + m["cff"] * 5
    m = min(ds, key=diem)
    return {**m, "dam_gia": bool(dam and not m["dam"]), "nghieng_gia": bool(nghieng and not m["nghieng"])}


# ---------- Tạo phông PDF ----------

def _tong_kiem(b: bytes) -> int:
    b += b"\0" * (-len(b) % 4)
    return sum(struct.unpack(f">{len(b) // 4}I", b)) & 0xFFFFFFFF


def _ghep_sfnt(bang: dict) -> bytes:
    n = len(bang)
    mu = max(i for i in range(8) if 2 ** i <= n)
    ra = bytearray(struct.pack(">IHHHH", 0x00010000, n, 2 ** mu * 16, mu, n * 16 - 2 ** mu * 16))
    vt = 12 + 16 * n
    noi_dung = bytearray()
    for tag in sorted(bang):
        d = bang[tag]
        ra += struct.pack(">4sIII", tag.encode("latin1"), _tong_kiem(d), vt + len(noi_dung), len(d))
        noi_dung += d + b"\0" * (-len(d) % 4)
    return bytes(ra + noi_dung)


def tap_con_ttf(sf: Sfnt, gids: set) -> bytes:
    """Giữ nguyên số thứ tự glyph, chỉ bỏ nét vẽ của glyph không dùng. Nhờ vậy mã chữ trong PDF chính là số glyph."""
    n = sf.so_glyph
    head = bytearray(sf.doc("head"))
    kieu = struct.unpack(">h", head[50:52])[0]
    loca = sf.doc("loca")
    glyf = sf.doc("glyf")
    vt = list(struct.unpack(f">{n + 1}H", loca[:2 * (n + 1)])) if kieu == 0 else list(struct.unpack(f">{n + 1}I", loca[:4 * (n + 1)]))
    if kieu == 0:
        vt = [v * 2 for v in vt]
    can, xong, viec = set(), set(), [0, *gids]
    while viec:
        g = viec.pop()
        if g in xong or g >= n:
            continue
        xong.add(g)
        a, b = vt[g], vt[g + 1]
        if b <= a:
            continue
        can.add(g)
        if struct.unpack(">h", glyf[a:a + 2])[0] < 0:  # glyph ghép: lấy thêm các mảnh
            p = a + 10
            while True:
                co, ch = struct.unpack(">HH", glyf[p:p + 4])
                viec.append(ch)
                p += 4 + (4 if co & 1 else 2)
                p += 2 if co & 8 else 4 if co & 0x40 else 8 if co & 0x80 else 0
                if not co & 0x20:
                    break
    glyf_moi, loca_moi, vi = bytearray(), [], 0
    for g in range(n):
        loca_moi.append(len(glyf_moi))
        if g in can:
            d = glyf[vt[g]:vt[g + 1]]
            glyf_moi += d + b"\0" * (-len(d) % 4)
    loca_moi.append(len(glyf_moi))
    head[8:12] = b"\0\0\0\0"
    head[50:52] = struct.pack(">h", 1)
    bang = {"head": bytes(head), "loca": struct.pack(f">{n + 1}I", *loca_moi), "glyf": bytes(glyf_moi)}
    for t in ("hhea", "maxp", "hmtx", "cvt ", "fpgm", "prep"):
        if sf.doc(t) is not None:
            bang[t] = sf.doc(t)
    return _ghep_sfnt(bang)


def _bang_unicode(cp_gid: dict) -> bytes:
    """ToUnicode: số glyph -> ký tự."""
    dong = []
    muc = sorted(cp_gid.items(), key=lambda kv: kv[1])
    for i in range(0, len(muc), 100):
        khuc = muc[i:i + 100]
        dong.append(f"{len(khuc)} beginbfchar")
        dong += [f"<{g:04X}> <{c.encode('utf-16-be').hex().upper()}>" for c, g in khuc]
        dong.append("endbfchar")
    return ("/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n"
            "/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n"
            + "\n".join(dong) + "\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n").encode("ascii")


class PhongPdf:
    """Một phông máy đã nhúng vào một PDF. ma_hoa() đổi chuỗi thành mã chữ để ghi vào lệnh TJ."""

    def __init__(self, pdf, mat: dict, ky_tu):
        self.mat = mat
        self.sf = Sfnt(mat["duong"], mat["chi_so"])
        self.upm = self.sf.upm
        self.ky_tu = {c for c in ky_tu if c not in "\n\r\t"}
        self.cp_gid = {c: self.sf.gid(ord(c)) for c in self.ky_tu}
        self.thieu = {c for c, g in self.cp_gid.items() if g == 0 and not c.isspace()}
        (asc, desc, gap), _ = self.sf.hhea()
        self.asc, self.desc = asc / self.upm, -desc / self.upm
        self.obj = self._tao(pdf)

    def rong(self, chu: str) -> float:
        """Độ rộng theo em (nhân với cỡ chữ ra pt)."""
        return sum(self.sf.rong_glyph(self.cp_gid.get(c) or self.sf.gid(ord(c))) for c in chu) / self.upm

    def ma_hoa(self, chu: str) -> bytes:
        return b"".join(struct.pack(">H", self.cp_gid.get(c) or self.sf.gid(ord(c))) for c in chu if c not in "\n\r\t")

    def _tao(self, pdf):
        sf, upm = self.sf, self.upm
        gids = {g for g in self.cp_gid.values() if g} | {0}
        if sf.cff:
            if sf.trong_ttc:
                raise LoiChu(f"Phông {self.mat['ho']} (CFF trong file .ttc) chưa nhúng được.")
            du_lieu = Path(sf.duong).read_bytes()
        else:
            du_lieu = tap_con_ttf(sf, gids)
        tien_to = "".join(random.choices(string.ascii_uppercase, k=6))
        ps = re.sub(r"[^A-Za-z0-9\-]", "", self.mat["ps"] or self.mat["ho"].replace(" ", "")) or "Phong"
        bb = [round(v * 1000 / upm) for v in sf.hop_bao()]
        o2 = sf.os2()
        co_dinh = 1 if self.mat.get("kieu", "").lower().startswith("mono") else 0
        flags = 4 | (64 if self.mat["nghieng"] else 0) | co_dinh
        fd = Dictionary(Type=Name.FontDescriptor, FontName=Name("/" + tien_to + "+" + ps), Flags=flags, FontBBox=bb,
                        ItalicAngle=-12 if self.mat["nghieng"] else 0, Ascent=round(self.asc * 1000), Descent=-round(self.desc * 1000),
                        CapHeight=round(self.asc * 700), StemV=120 if self.mat["dam"] else 80)
        if sf.cff:
            f = pdf.make_stream(zlib.compress(du_lieu), Subtype=Name.OpenType, Filter=Name.FlateDecode)
            fd.FontFile3 = f
        else:
            f = pdf.make_stream(zlib.compress(du_lieu), Length1=len(du_lieu), Filter=Name.FlateDecode)
            fd.FontFile2 = f
        fd = pdf.make_indirect(fd)
        w = []
        for g in sorted(gids):
            w += [g, Array([round(sf.rong_glyph(g) * 1000 / upm)])]
        cid = pdf.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.CIDFontType0 if sf.cff else Name.CIDFontType2,
                                           BaseFont=fd.FontName, CIDSystemInfo=Dictionary(Registry=String("Adobe"), Ordering=String("Identity"), Supplement=0),
                                           FontDescriptor=fd, DW=1000, W=Array(w)))
        if not sf.cff:
            cid.CIDToGIDMap = Name.Identity
        tu = pdf.make_stream(_bang_unicode({c: g for c, g in self.cp_gid.items() if g}))
        return pdf.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.Type0, BaseFont=fd.FontName, Encoding=Name("/Identity-H"),
                                            DescendantFonts=Array([cid]), ToUnicode=tu))
