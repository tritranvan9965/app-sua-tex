## TriTeX 1.2.14

Mẫu tritoan:

- **Đề `kiem_tra_thpt`, `thptqg` viết lại**: dùng chung lõi với `toan_thpt`, kéo câu từ ngân hàng hay file bài tập sang đề là dùng được.
  Câu `bt` trong PHẦN I, II, III tự in "Câu n"; `\dapso` ở PHẦN III vào bảng đáp án; `\muctn`, `\phan{PHẦN I. ...}` tự thành phần đề;
  `\dang`, `\tieude`, `\loai`, `\chuong` không in gì.
- **Đầu đề mới**: ô trái GIỎI TOÁN CÙNG TRÍ TRÍ, dưới là nguồn đề (`\nguon`) hoặc khung tên đề (`thptqg`: `\tende{Đề thi thử 01}`);
  ô phải tên đề, năm học (tự tính), môn, thời gian.
- **Chân trang như tài liệu**, trang cuối tự có "— HẾT —".
- Đầu đề không còn gãy dòng "không kể thời gian phát đề".
- Ý a), b) dưới dòng đề có phân số, hệ cao không còn đè chữ; gạch đầu dòng trong hộp lý thuyết sát lại.
- Hướng dẫn soạn bài: bỏ cũ "thêm \def\BANHS", dùng nút Ẩn đáp án; mục đề THPT viết lại.
