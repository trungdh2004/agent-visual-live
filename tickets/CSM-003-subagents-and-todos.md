# CSM-003: Trích xuất tiến độ công việc (`TodoWrite`) và lịch sử gọi Subagent (`Agent` / `Task`)

- **Status**: `DONE`
- **Priority**: P1 (Medium)
- **Estimate**: M (~2h)
- **Dependencies**: None
- **Files Touched**:
  - `src/csm/transcript.py`
  - `src/csm/fleet.py`
  - `web/style.css`
  - `web/app.js`

---

## 1. Bối cảnh & Vấn đề (Context & Problem)
Các phiên Claude Code thường xuyên sử dụng `TodoWrite` để lập danh sách bước thực hiện và gọi `Agent` / `Task` để chạy các subagent nội bộ. Hiện tại `claude-session-monitor` chỉ hiển thị các phiên độc lập có mặt trong `~/.claude/sessions/<pid>.json` và bỏ qua toàn bộ tiến độ `TodoWrite` cũng như các subagent nội bộ của từng phiên.

## 2. Giải pháp Kỹ thuật (Technical Design)
1. **Trích xuất dữ liệu trong `src/csm/transcript.py`**:
   - Khởi tạo trong `SessionTranscript.__init__`:
     - `self.todos: list[dict] = []`
     - `self.subagents: deque = deque(maxlen=20)`
   - Trong `SessionTranscript._tool_use(self, block: dict, stamp: str)`:
     - Khi `name == "TodoWrite"`:
       - Đọc `raw_todos = args.get("todos")`. Nếu là `list`, trích xuất an toàn danh sách `[{"content": str(t.get("content") or ""), "status": str(t.get("status") or "pending")}]` và gán vào `self.todos` (vì mỗi lần gọi `TodoWrite` là bản cập nhật toàn bộ danh sách todo hiện tại của phiên).
     - Khi `name in ("Agent", "Task")`:
       - Lưu vào `self.subagents`:
         ```python
         self.subagents.append({
             "type": str(args.get("subagent_type") or args.get("name") or "subagent"),
             "description": str(args.get("description") or args.get("prompt") or "")[:160],
             "at": stamp,
         })
         ```
2. **Đưa vào Snapshot trong `src/csm/fleet.py`**:
   - Đính kèm vào mỗi `card`:
     - `"todos": state.todos`
     - `"subagents": list(state.subagents)`
3. **Hiển thị trên Giao diện (`web/app.js`, `web/style.css`)**:
   - **Trên Card (`.card`)**:
     - Nếu `s.todos && s.todos.length > 0`, hiển thị một chip nhỏ gọn ở `.card-foot`: `☑ ${done}/${total}` (trong đó `done` là số mục có `status === 'completed'`).
   - **Trong Inspector (`Tổng quan`)**:
     - Hiển thị khối **`Tiến độ công việc (done/total)`** với danh sách checklist:
       - `✓` (màu xanh `--busy`) cho `completed`.
       - `●` (màu xanh dương `--accent`) cho `in_progress`.
       - `○` (màu xám `--ink-dim`) cho `pending`.
     - Hiển thị khối **`Subagents đã gọi (${s.subagents.length})`** liệt kê loại subagent, mô tả ngắn và thời gian gọi.

## 3. Tiêu chí Nghiệm thu (Acceptance Criteria)
- [ ] Đọc chính xác trạng thái `todos` mới nhất của mỗi phiên từ các lệnh `TodoWrite` trong transcript.
- [ ] Đọc được danh sách các lượt gọi `Agent` / `Task` kèm mô tả ngắn.
- [ ] Trên Card hiển thị chỉ số tiến độ `☑ X/Y` gọn gàng, không làm vỡ bố cục 4 vùng của Card.
- [ ] Trong Inspector hiển thị đầy đủ checklist công việc và danh sách subagent với độ tương phản chữ đạt chuẩn WCAG AA ($\ge 4.5:1$).
