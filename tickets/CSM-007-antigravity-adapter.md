# CSM-007: Bộ thu thập Telemetry cho Antigravity (`src/csm/antigravity.py`)

- **Status**: `DONE`
- **Priority**: P0 (High)
- **Estimate**: M (~2h)
- **Dependencies**: None
- **Files Touched**:
  - `src/csm/antigravity.py` (new)
  - `tests/test_multi_agent.py` (new)

---

## 1. Bối cảnh & Vấn đề (Context & Problem)
Người dùng sử dụng song song Antigravity IDE cùng với Claude Code và muốn giám sát tất cả các phiên Antigravity đang mở (cùng các Subagent con do `invoke_subagent` sinh ra) ngay trên cùng một bảng điều khiển theo nguyên tắc **Zero-Config & 100% Read-Only**.

## 2. Giải pháp Kỹ thuật (Technical Design)
1. **Phát hiện Phiên đang mở (`Live Presence Lock`)**:
   - Quét `/proc/[0-9]*/fd/*` bằng `os.readlink()` để tìm các file descriptor đang mở trỏ tới `~/.gemini/antigravity/presence/<conversation-id>.lock`.
   - Mọi `conversation_id` có lock đang mở được đánh dấu `live_lock = True`.
2. **Đọc Metadata & Cây Subagent từ SQLite (`conversation_summaries.db`)**:
   - Kết nối `file:~/.gemini/antigravity/conversation_summaries.db?mode=ro` (read-only).
   - Truy vấn bảng `conversation_summaries` lấy các trường: `conversation_id`, `title`, `step_count`, `last_modified_time`, `workspace_uris`, `status`, `agent_name`, `parent_conversation_id`, `not_fully_idle`, `killed`.
   - Lọc lấy các phiên có `live_lock == True`, hoặc `status == 'CASCADE_RUN_STATUS_RUNNING'`, hoặc có tương tác trong vòng **2 giờ gần nhất (`7200s`)**, cùng toàn bộ các phiên con có `parent_conversation_id` thuộc tập phiên này.
   - Giải mã `workspace_uris` (JSON array các URI `file:///...`) thành đường dẫn `cwd` chuẩn trên hệ thống.
3. **Đọc Incremental Transcript (`brain/<id>/.system_generated/logs/transcript.jsonl`) & Artifacts**:
   - Lưu cache theo đường dẫn file và byte offset tương tự `TranscriptStore`.
   - Trích xuất:
     - `USER_INPUT` $\rightarrow$ `last_user_text`.
     - `PLANNER_RESPONSE` $\rightarrow$ `last_assistant_text` và duyệt `tool_calls`:
       - `run_command` $\rightarrow$ ghi vào lịch sử `bash` (`CommandLine`, `toolSummary`).
       - `edit_file`, `write_file` $\rightarrow$ ghi đường dẫn `Path` vào `files_edited` để phát hiện đụng độ file xuyên công cụ.
       - `invoke_subagent`, `send_message` $\rightarrow$ ghi vào `subagents` và `messages` để nối dây Cha ──▶ Con.
       - `ask_question` ở bước cuối cùng $\rightarrow$ đánh dấu `status = "waiting"`, `blockedOn = "user input"`.
   - Quét các file `*.md` trong `~/.gemini/antigravity/brain/<id>/` để trả về danh sách `artifacts`.

## 3. Tiêu chí Nghiệm thu (Acceptance Criteria)
- [ ] Mở kết nối SQLite ở chế độ `mode=ro`, tuyệt đối không gây lock database của Antigravity.
- [ ] Nhận diện chính xác các phiên Antigravity đang mở qua `/proc/*/fd/*` (`presence/*.lock`) và các phiên vừa đóng trong 2 giờ qua (`exited = True`).
- [ ] Trích xuất đầy đủ `cwd` từ `workspace_uris`, `parent_conversation_id`, danh sách `files_edited`, `bash`, và `artifacts`.
- [ ] Có unit test kiểm thử với SQLite giả lập và file `transcript.jsonl` mẫu trong `tests/test_multi_agent.py`.
