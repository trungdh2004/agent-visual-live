# CSM-001: Cảnh báo chủ động khi có phiên `Đang chờ` (Dynamic Title/Favicon, Web Audio & Notification)

- **Status**: `DONE`
- **Priority**: P0 (High)
- **Estimate**: S (~1–2h)
- **Dependencies**: None
- **Files Touched**:
  - `web/index.html`
  - `web/style.css`
  - `web/app.js`

---

## 1. Bối cảnh & Vấn đề (Context & Problem)
Khi người vận hành đang làm việc ở cửa sổ terminal hoặc mở tab trình duyệt khác, nếu một phiên Claude Code bị chặn bởi hộp thoại xin quyền (`status: "waiting"`, `blockedOn: "permission prompt"`), người dùng không nhận được tín hiệu nào cho đến khi tự quay lại nhìn vào tab dashboard.

## 2. Giải pháp Kỹ thuật (Technical Design)
1. **Dynamic `<title>` & SVG Favicon (`web/app.js`)**:
   - Đếm tổng số phiên có `status === 'waiting'` trong mỗi lần `render(state)`.
   - Khi `waitingCount > 0`:
     - Đặt `document.title = \`(\${waitingCount} chờ) Session Monitor\``.
     - Cập nhật `<link rel="icon">` sang biến thể SVG có viền đỏ (`#EF4444`) và chấm tròn cảnh báo nổi bật.
   - Khi `waitingCount === 0`:
     - Khôi phục `document.title = 'Claude Session Monitor — Tactical Telemetry'` và favicon mặc định.
2. **Công tắc Cảnh báo Âm thanh & Desktop Notification (`web/index.html`, `web/app.js`)**:
   - Thêm nút `#alert-toggle` (`🔔 Cảnh báo`) trên `.top-actions` ở thanh Top Bar, lưu trạng thái bật/tắt vào `localStorage.getItem('csm_alerts_enabled')`.
   - Khi người dùng bật nút này lần đầu, gọi `Notification.requestPermission()` nếu `Notification.permission === 'default'`.
   - Duy trì một `Set` tên là `prevWaitingIds` lưu ID các phiên đang ở trạng thái `waiting` của khung hình trước.
   - Khi có một phiên `s` với `s.status === 'waiting'` mà `!prevWaitingIds.has(s.id)` (tức là vừa mới rơi vào trạng thái chờ):
     - Nếu `csm_alerts_enabled` đang bật:
       - Phát một âm báo ngắn 2 nốt (ví dụ: `587.33Hz` D5 → `880Hz` A5 trong `180ms`) bằng Web Audio API (`AudioContext`), tôn trọng cấu hình của người dùng và không cần file `.mp3` ngoài.
       - Gửi `new Notification(\`Phiên \${s.name} đang chờ duyệt\`, { body: \`\${BLOCKED_TEXT[s.blockedOn] || s.blockedOn} (\${s.cwd})\`, tag: \`csm-wait-\${s.id}\` })`.
       - Khi bấm vào Notification, gọi `window.focus()`, chọn phiên `s.id` trên dashboard và mở Inspector.

## 3. Tiêu chí Nghiệm thu (Acceptance Criteria)
- [ ] Khi có ít nhất 1 phiên chuyển sang `waiting`, tiêu đề tab trình duyệt đổi ngay thành `(N chờ) Session Monitor` và favicon đổi sang màu đỏ cảnh báo.
- [ ] Khi toàn bộ phiên hết `waiting`, tiêu đề tab và favicon tự động trở về bình thường.
- [ ] Có nút bật/tắt `🔔 Cảnh báo` trên Top Bar (chiều cao tối thiểu `28px` theo chuẩn HIG), giữ nguyên trạng thái sau khi tải lại trang (`localStorage`).
- [ ] Chỉ phát âm báo và bắn Notification **đúng 1 lần** tại thời điểm phiên chuyển từ trạng thái khác sang `waiting` (không kêu lặp lại mỗi 2 giây khi SSE gửi frame mới).
- [ ] Không phát sinh lỗi Console nếu trình duyệt chặn `AudioContext` (chưa có tương tác người dùng) hoặc từ chối quyền `Notification`.
