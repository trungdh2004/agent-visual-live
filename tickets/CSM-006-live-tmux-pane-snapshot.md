# CSM-006: Xem trực tiếp màn hình Terminal (`tmux capture-pane`) ngay trong Inspector

- **Status**: `DONE`
- **Priority**: P1 (High)
- **Estimate**: M (~2h)
- **Dependencies**: None
- **Files Touched**:
  - `src/csm/panes.py`
  - `src/csm/app.py`
  - `web/style.css`
  - `web/app.js`

---

## 1. Bối cảnh & Vấn đề (Context & Problem)
Khi một phiên báo `▲ Đang chờ` (`permission prompt` hoặc `input needed`), bản preview từ file transcript `.jsonl` nhiều khi chưa ghi nhận khung hội thoại TUI đang vẽ dở trên màn hình terminal (ví dụ: hộp thoại hỏi xác nhận chạy lệnh Bash hoặc câu hỏi nhiều lựa chọn). Người vận hành muốn nhìn thấy ngay màn hình terminal hiện tại của pane đó trong Inspector trước khi bấm `Nhảy tới pane ↗`.

## 2. Giải pháp Kỹ thuật (Technical Design)
1. **Đọc nội dung Pane an toàn trong `src/csm/panes.py`**:
   - Bổ sung hàm `capture(tmux_target: str, lines: int = 45) -> tuple[bool, str]`:
     - Kiểm tra `tmux_target` bằng biểu thức chính quy `TARGET` sẵn có (`^([A-Za-z0-9_.-]{1,64}):(@?\d{1,6})\.(%?\d{1,6})$`) để chống command/argument injection tuyệt đối.
     - Lấy phần `pane` (hoặc `session:window.pane`) và chạy:
       ```python
       done = subprocess.run(
           ("tmux", "capture-pane", "-p", "-J", "-t", pane, "-S", f"-{int(lines)}"),
           capture_output=True, text=True, timeout=3,
       )
       ```
     - Trả về `(True, done.stdout.rstrip())` nếu thành công, hoặc `(False, detail)` nếu lỗi.
2. **Bổ sung API Endpoint trong `src/csm/app.py`**:
   - Thêm route `GET /api/sessions/{session_id}/pane`:
     - Tìm phiên theo `session_id` trong `_fleet.snapshot()["sessions"]`.
     - Nếu không tìm thấy hoặc không có `tmux`, trả về `{"ok": False, "text": "", "detail": "Phiên không chạy trong tmux"}`.
     - Gọi `panes.capture(target["tmux"])` và trả về `{"ok": ok, "text": text, "detail": detail}`.
3. **Hiển thị trong Inspector (`web/app.js`, `web/style.css`)**:
   - Bổ sung tab **`Terminal`** vào thanh Segmented Control của Inspector (`Tổng quan` | `Terminal` | `Tin nhắn` | `Lệnh Bash`).
   - Ngoài ra, nếu phiên đang ở trạng thái `waiting` và có `tmux`, hiển thị luôn một khung **`Màn hình Terminal hiện tại (Live Tmux)`** ngay đầu tab `Tổng quan` để người dùng thấy tức thì hộp thoại đang chặn phiên.
   - Tự động cuộn khung `<pre class="terminal-preview">` xuống dòng cuối cùng (nơi con trỏ và hộp thoại prompt xuất hiện).

## 3. Tiêu chí Nghiệm thu (Acceptance Criteria)
- [ ] Hàm `panes.capture` chỉ đọc dữ liệu (`capture-pane -p`), hoàn toàn không gửi phím hay thay đổi trạng thái của `tmux`.
- [ ] Kiểm tra chặt chẽ `tmux_target` qua regex `TARGET` và có `timeout=3` giây.
- [ ] Khi mở Inspector của một phiên có `tmux`, tab `Terminal` hiển thị chính xác nội dung văn bản đang có trên pane đó và tự cập nhật mỗi nhịp poll.
- [ ] Nếu phiên không chạy trong `tmux`, hiển thị thông báo rõ ràng (`Phiên này được khởi chạy ngoài tmux nên không thể chụp màn hình pane`).
