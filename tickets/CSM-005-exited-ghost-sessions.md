# CSM-005: Lưu trữ "Bóng mờ" (Ghost Nodes) cho các phiên vừa kết thúc để bảo toàn luồng hội thoại

- **Status**: `DONE`
- **Priority**: P2 (Medium)
- **Estimate**: M (~2.5h)
- **Dependencies**: `CSM-002` (để loại trừ các phiên `exited` khỏi cảnh báo xung đột file đang chạy)
- **Files Touched**:
  - `src/csm/registry.py`
  - `src/csm/fleet.py`
  - `web/index.html`
  - `web/style.css`
  - `web/app.js`

---

## 1. Bối cảnh & Vấn đề (Context & Problem)
Như đã ghi nhận trong mục *Limits* của `README.md`:
> *"A session that has exited leaves no card and no wire, so its conversations disappear from the graph even though the transcripts remain on disk."*

Trong thực tế, khi một phiên điều phối (Coordinator) giao việc cho 3 phiên Worker, ngay khi các Worker hoàn thành công việc và thoát (`exit`), thẻ của chúng biến mất khỏi màn hình. Người vận hành không thể bấm vào dây nối để đọc lại báo cáo cuối cùng mà Worker gửi về cho Coordinator.

## 2. Giải pháp Kỹ thuật (Technical Design)
1. **Đọc các phiên đã thoát gần đây trong `src/csm/registry.py`**:
   - Cập nhật `read_sessions(include_exited_seconds: float = 7200.0) -> list[dict]`:
     - Với mỗi file `~/.claude/sessions/<pid>.json`:
       - Nếu `_alive(pid)` là `True`: giữ nguyên trạng thái `status` hiện tại và đặt `"exited": False`.
       - Nếu `_alive(pid)` là `False`: kiểm tra thời gian cập nhật của file (`stat().st_mtime` hoặc `updatedAt`). Nếu mới kết thúc trong vòng `include_exited_seconds` (mặc định 2 giờ):
         - Đưa vào danh sách với `"status": "exited"`, `"exited": True`, `"tmux": ""`.
2. **Giữ lại các Ghost Nodes có liên kết trong `src/csm/fleet.py`**:
   - Trong `Fleet.snapshot()`:
     - Đăng ký toàn bộ các phiên (cả đang chạy lẫn vừa `exited`) vào `_Directory` để phân giải đầy đủ tên/socket của các đầu dây tin nhắn.
     - Tính toán `edges` trên toàn bộ tập phiên.
     - Chỉ giữ lại các phiên `exited` nếu:
       1. Chúng có ít nhất 1 cạnh nối (`edge`) với một phiên khác trong Fleet, **HOẶC**
       2. Chúng vừa kết thúc trong vòng 30 phút gần nhất.
     - Không tính các phiên `exited` vào bộ đếm `waiting` hay cảnh báo xung đột file (`conflicts`).
3. **Hiển thị & Bộ lọc trên Giao diện (`web/index.html`, `web/app.js`, `web/style.css`)**:
   - Bổ sung trạng thái `exited: { label: 'Đã đóng', glyph: '◌' }` vào `STATUS_META`.
   - Thêm pill lọc `◌ Đã đóng` trên thanh Top Bar (mặc định hiển thị các phiên `exited` có dây nối hội thoại, hoặc cho phép bấm để ẩn/hiện).
   - Thiết kế `.card.exited`:
     - Viền nét đứt (`border: 1px dashed var(--line-strong)`), nền trầm hơn (`opacity: 0.68`), khi hover hoặc chọn (`selected`) thì rõ nét (`opacity: 1`).
     - Người dùng vẫn có thể bấm vào `.card.exited` hoặc dây nối (`wire`) tới nó để đọc toàn bộ lịch sử tin nhắn, lệnh Bash và thống kê Token trong Inspector.

## 3. Tiêu chí Nghiệm thu (Acceptance Criteria)
- [ ] Khi một phiên Worker từng nhắn tin với Coordinator vừa thoát, thẻ và dây nối của nó không bị biến mất đột ngột mà chuyển sang trạng thái `◌ Đã đóng` (Ghost Node).
- [ ] Người dùng bấm vào dây nối giữa Coordinator và phiên `Đã đóng` vẫn đọc được đầy đủ luồng hội thoại (`GET /api/threads/{id}/{peer_id}`).
- [ ] Phiên `Đã đóng` có giao diện phân biệt rõ ràng (viền nét đứt, độ mờ nhẹ) với các phiên đang chạy và không hiển thị nút `Nhảy tới pane`.
- [ ] Bộ nhớ `TranscriptStore` tự động dọn dẹp các phiên đã thoát quá thời hạn để tránh rò rỉ RAM.
