# Hướng dẫn soạn bài bằng mẫu tritoan

## Mẫu cha và mẫu con

| | Mẫu cha | Mẫu con |
|---|---|---|
| File | `tritoan.sty` | `toan9.sty`, `toan10.sty`, … kèm `danhmuc9.tex`, `danhmuc10.tex`, … |
| Nằm ở | Thư viện mẫu của TriTeX: `%APPDATA%\TriTeX\thu-vien-mau\tritoan` | Trong từng thư mục soạn bài (Tài liệu Toán 9, Tài liệu Toán 10, …) |
| Chứa | Giao diện chung, lệnh soạn câu hỏi, lời giải, đề kiểm tra, bảng đáp án | Tên môn, danh mục chương và chuyên đề, phần riêng của lớp |
| Ai sửa | Chỉ sửa khi thay đổi dùng được cho mọi lớp | Thư mục soạn bài tự làm, tự sửa |

Khi biên dịch, TriTeX tự lấy mẫu cha từ thư viện. Thư mục soạn bài **không cần chép** `tritoan.sty`.

## Phần 1. Quy chuẩn mẫu con (làm một lần cho mỗi thư mục soạn bài)

**1. Chỗ đặt.** Trong thư mục soạn bài, tạo một thư mục mẫu, ví dụ `Tài liệu Toán 10\mau\`. Mẫu con và danh mục để **chung trong thư mục này**.

- TriTeX tìm mẫu con từ thư mục chứa file `.tex` đi ngược lên tối đa 4 cấp, rồi tìm xuống mỗi nhánh tối đa 3 cấp.
- TriTeX bỏ qua các thư mục có tên bắt đầu bằng `.` hoặc `_`, nên đừng đặt thư mục mẫu như vậy.

**2. Danh mục phải nằm cạnh mẫu con.** TriTeX chỉ chép những file nằm cùng thư mục với mẫu con. Danh mục để ở chỗ khác sẽ gây lỗi "File `danhmuc...tex' not found". Không dùng đường dẫn tương đối như `../...` trong mẫu con, vì TriTeX biên dịch trong một thư mục tạm.

**3. Nội dung mẫu con.** Chỉ gồm mấy dòng sau (chép từ `vi-du\toan10.sty` rồi đổi số):

```latex
\NeedsTeXFormat{LaTeX2e}
\ProvidesPackage{toan10}[2026/11/07 Mau tai lieu Toan 10]
\RequirePackage{tritoan}          % gọi mẫu cha
\input{danhmuc10.tex}             % danh mục nằm cạnh file này
\renewcommand{\tenmon}{TOÁN 10}   % tên môn in ở đầu đề kiểm tra
\endinput
```

**4. Muốn khác mẫu cha thì ghi đè trong mẫu con, không sửa mẫu cha:**

```latex
\renewcommand{\chantrang}{Ôn thi Toán 10 - Thầy Trí}   % dòng chân trang
\definecolor{xanh}{HTML}{0B5345}                         % màu chủ đạo
\truong{TRƯỜNG THPT ...}                                 % trường in ở đầu đề
```

- Thêm lệnh riêng thì dùng `\newcommand`. Nếu tên lệnh trùng với mẫu cha, LaTeX sẽ báo lỗi ngay, nhờ vậy không đè nhầm.
- Không định nghĩa lại các môi trường của mẫu cha (`tn`, `ds`, `tln`, `bt`, `vd`).

**5. Danh mục** (`danhmuc10.tex`) theo khuôn sau (chép từ `vi-du\danhmuc10.tex`):

```latex
\dmuc{loai1}{CÁC CHUYÊN ĐỀ CƠ BẢN TOÁN 10}      % tên bộ, in bên phải đầu trang
\dmuc{loai2}{ĐỀ KIỂM TRA TOÁN 10}
\dmuc{loai3}{CHUYÊN ĐỀ ÔN THI TOÁN 10}
\dmuc{chuong1}{Chương I. Mệnh đề và tập hợp}
\dmucngan{chuong1}{Chương I. Mệnh đề, tập hợp}   % tên ngắn cho đầu trang, chỉ cần với tên dài
\dmuc{chuyende1}{Chuyên đề 1. ...}
```

**6. Script riêng của thư mục** (ví dụ `xuat.py` tự biên dịch, không qua TriTeX) phải tự chép `tritoan.sty` từ thư viện mẫu sang chỗ biên dịch.

**7. Lệnh nào hữu ích cho mọi lớp** thì đề nghị đưa vào mẫu cha, đừng chép lệnh đó sang nhiều mẫu con.

## Phần 2. Quy trình soạn bài

**1. Lấy file mẫu.** Mở `%APPDATA%\TriTeX\thu-vien-mau\tritoan\vi-du`, chép file hợp loại sang thư mục soạn bài, rồi đổi tên:

- `mau1-chuyen-de-co-ban.tex`: chương, bài, dạng
- `mau2-de-kiem-tra.tex`: đề kiểm tra 3 phần
- `mau3-on-thi.tex`: chuyên đề ôn thi

**2. Sửa hai dòng đầu file.**

```latex
\usepackage{toan10}      % tên mẫu con của thư mục soạn bài
\loai{1}\chuong{1}       % loại tài liệu + chương (hoặc \chuyende{2}, \de{01})
```

**3. Soạn nội dung.**

| Muốn viết | Gõ |
|---|---|
| Tên bài | `\tieude{\tentailieu}{Bài 1. Mệnh đề}` |
| Mục A, B, C | `\phan{A. Lý thuyết}` |
| Dạng | `\dang{Tên dạng}` |
| Trắc nghiệm | `\begin{tn} đề \pa{..}{\dung{đáp án đúng}}{..}{..} \end{tn}` |
| Đúng sai | `\begin{ds} đề \ydung{..} \ysai{..} \ydung{..} \ysai{..} \end{ds}` |
| Trả lời ngắn | `\begin{tln} đề \traloi{2,5} \end{tln}` |
| Lời giải | `\loigiai{...}` đặt trước `\end{...}` |
| Bảng đáp án | `\bangdapan` ở cuối bài hoặc cuối đề |
| Bài mới trong cùng file | `\baimoi` rồi `\tieude{}{Bài 2. ...}` |
| Đề kiểm tra | `\kythi{..} \thoigian{..} \made{..} \taodaude`, rồi `\phantn`, `\phands`, `\phantln`, cuối cùng `\hetde` |

Mẹo: chép một câu có sẵn trong file mẫu rồi sửa chữ, khỏi phải nhớ lệnh.

**4. Xuất PDF trong TriTeX.**

- Mặc định ra **bản GV** (có lời giải, đáp án).
- Muốn **bản HS**: thêm `\def\BANHS{1}` vào dòng đầu tiên của file, xuất lại, rồi xoá dòng đó đi.

**5. Thiếu tên chương hay chuyên đề?** Thêm một dòng `\dmuc{...}` vào file danh mục **trong thư mục mẫu của thư mục soạn bài**.
