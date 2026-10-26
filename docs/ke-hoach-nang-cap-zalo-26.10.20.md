# Đối chiếu NHITZalo với Zalo PC 26.10.20

Ngày khảo sát: 23/10/2026. Bản tham chiếu: `C:\Users\Admin\AppData\Local\Programs\Zalo\Zalo-26.10.20`.

## Phạm vi và mức độ chắc chắn

- Đã kiểm tra cấu trúc cài đặt, metadata và các module trong `resources/app.asar`, các thư viện native ở `resources/app.asar.unpacked`, cùng bảng chuỗi tiếng Việt của Zalo PC. Chưa chạy thử từng luồng trong giao diện Zalo PC; sự hiện diện của module hoặc chuỗi chỉ chứng minh tính năng có trong gói, không chứng minh nó đang khả dụng cho mọi tài khoản.
- Đã đối chiếu với mã nguồn NHITZalo trong `src/main`, `src/renderer` và `package.json`. Đây là khảo sát tĩnh; chưa đăng nhập, gửi tin hay kiểm thử trực tiếp trên tài khoản.
- Không dùng mã nội bộ hoặc cơ sở dữ liệu tài khoản của Zalo PC làm nền cho bản nâng cấp. Mỗi chức năng cần được xác nhận qua khả năng của `zalo-api-final` và kiểm thử end-to-end.

## Kiến trúc hiện tại

- `src/main/index.js`: vòng đời Electron, dashboard, bubble, tray và các IPC handler.
- `src/main/zaloManager.js`: phiên QR, tự đăng nhập, WebSocket listener, đồng bộ lịch sử, cache bạn bè/nhóm, chuẩn hóa tin nhắn và các lệnh gửi.
- `src/main/preload.js`: API cầu nối cho hai renderer. `src/main/bubbleWindow.js`: vị trí, trạng thái và thông báo của bubble.
- `src/renderer/dashboard/app.js`: toàn bộ trạng thái và giao diện dashboard trong một file lớn; `src/renderer/bubble/bubble.js`: hội thoại trong bubble.
- Dữ liệu trong Electron `userData` là các file JSON. Lịch sử bị giới hạn 5.000 tin nhắn. `npm test` hiện chỉ là lệnh placeholder.

Zalo PC 26.10.20 cũng dùng Electron nhưng gói tham chiếu có giao diện React/Redux, các worker riêng cho tìm kiếm, đồng bộ, SQLite và PDF, cùng module native cho SQLite, file, hình ảnh, OCR và gọi điện. Quy mô đó cho thấy nên nâng NHITZalo theo từng năng lực độc lập, không gộp toàn bộ vào `zaloManager.js` và `dashboard/app.js`.

## So sánh chức năng

| Nhóm | Zalo PC 26.10.20: bằng chứng trong gói | NHITZalo hiện tại | Khoảng trống / việc cần làm |
| --- | --- | --- | --- |
| Đăng nhập, hội thoại, thông báo | Giao diện đăng nhập, worker đồng bộ và thông báo | QR, tự đăng nhập, listener, đồng bộ, bubble/tray | Củng cố độ tin cậy khi mất mạng và nhất quán trạng thái giữa dashboard/bubble |
| Tin nhắn cơ bản | Gói giao diện chat và tài nguyên emoji/sticker | Văn bản, ảnh/video/file nhận được, quote, reaction, thu hồi, sticker; chuyển tiếp | Kiểm thử từng loại tin; chuyển tiếp ảnh/file hiện biến thành URL/văn bản, chưa tương đương chuyển tiếp media |
| Gửi file/sticker | Giao diện tệp và sticker | Có UI/API nhưng `sendReply` và `sendSticker` có logic tự đổi người nhận | **Ưu tiên P0:** gửi đúng hội thoại đã chọn; bỏ chuyển hướng ngầm; xác nhận kết quả bằng ID hội thoại thực tế |
| Tìm kiếm | `search-worker` và nhiều chuỗi tìm kiếm toàn cục | Lọc tên hội thoại; tìm trong DOM của hội thoại đang mở | Tìm toàn bộ lịch sử có phân trang, kết quả theo hội thoại và thời gian |
| Tổ chức chat | Chuỗi cho lưu trữ chat, ghim và nhiều tùy chọn chat | Ghim/tắt thông báo hội thoại; ghim tin nhắn cục bộ | Phân biệt trạng thái cục bộ và trạng thái đồng bộ Zalo; bổ sung lưu trữ/ẩn hội thoại nếu API hỗ trợ |
| Danh bạ và nhóm | Bộ chuỗi lớn cho danh bạ, thành viên và quyền nhóm | Danh sách bạn bè/nhóm, thông tin thành viên nhóm, tạo bình chọn/nhắc hẹn | Danh bạ riêng; lời mời kết bạn; quản lý thành viên/quyền nhóm theo khả năng API |
| Công việc, ghi chú | Chuỗi `STR_CREATE_TODO`, `STR_ASSIGN_TASK`, `STR_GROUP_NOTE` | Chưa có luồng tương ứng | Thiết kế module riêng, chỉ triển khai sau khi xác minh API đọc/ghi và quyền truy cập |
| Gọi thoại/video | Chuỗi cuộc gọi và module native `zcall` | Chưa có | Nghiên cứu tính khả thi riêng; cần media stack và giao thức được hỗ trợ, không nên ước lượng như tính năng chat thông thường |
| OCR, phiên âm, dịch | Module OCR; chuỗi voice-to-text và Zalo AI translation | Chưa có | Để giai đoạn mở rộng; cần đánh giá quyền, chi phí, chất lượng và cách xử lý dữ liệu |
| Lưu trữ và sao lưu | Worker SQLite/đồng bộ, nhiều luồng backup/export | JSON đồng bộ, tối đa 5.000 tin; chưa có xuất/nhập có kiểm tra | Chuyển sang SQLite, migration an toàn, phân trang, backup/restore của chính NHITZalo |
| Bảo vệ phiên | Chuỗi khóa ứng dụng và các luồng bảo mật | Cookie phiên nằm trong `zalo_session.json` | Mã hóa phiên bằng `safeStorage` của Electron; làm rõ đăng xuất/xóa dữ liệu |

## Lỗi và rủi ro phải xử lý trước khi mở rộng

1. `src/main/zaloManager.js` tại `sendSticker` và `sendReply`: khi gửi sticker/file tới hội thoại khác, mã có thể đổi `threadId` sang ID cố định hoặc tài khoản hiện tại. UI có thể báo đã gửi tới người được chọn dù lệnh thực tế đi nơi khác. Cần bỏ chuyển hướng ngầm, dùng tài khoản thử nghiệm ở cấu hình test riêng và kiểm tra ID đích trước/sau gửi.
2. `src/renderer/dashboard/app.js` tại luồng chuyển tiếp: ảnh/file đang được chuyển thành link hoặc chuỗi mô tả rồi gửi như tin văn bản. Cần hiển thị đúng loại nội dung và chỉ cho phép “chuyển tiếp media” khi API hỗ trợ thực sự.
3. Lịch sử hiện dùng mảng JSON, tìm trùng bằng `findIndex`, sắp xếp khi thêm và ghi lại cả file. Cần lưu theo khóa `(threadId, messageId)` và truy vấn phân trang trước khi tăng giới hạn lịch sử.
4. `src/main/index.js` có nhiều IPC handler thao tác mạng/file. Khi mở rộng, cần kiểm tra đầu vào và kết quả nhất quán, đồng thời giảm logic nghiệp vụ trong handler.
5. Chưa có bộ test thực thi (`package.json` vẫn dùng placeholder). Cần ít nhất test chuẩn hóa tin nhắn, định tuyến người nhận, migration dữ liệu và một vòng gửi/nhận có tài khoản thử nghiệm.

## Lộ trình đề xuất

### P0 — Độ đúng và nền kiểm thử

- Sửa định tuyến gửi sticker/file; kiểm tra UI báo đúng người nhận. Dùng mock API để kiểm thử không gửi nhầm tin thật.
- Định nghĩa model tin nhắn thống nhất (`threadId`, `isGroup`, `messageId`, `cliMsgId`, loại nội dung, thời gian, trạng thái gửi) cho main/dashboard/bubble.
- Thêm test cho gửi/nhận, thu hồi, reaction, đồng bộ và chuyển tiếp văn bản; ghi lại ma trận khả năng thật của `zalo-api-final`.
- Tiêu chí hoàn thành: không có luồng nào tự đổi người nhận; test tự động bắt được trường hợp đổi ID; UI thể hiện thất bại thay vì báo thành công sai.

### P1 — Lịch sử và trải nghiệm chat

- Chuyển lịch sử sang SQLite với migration từ JSON, backup trước migration, giao dịch và chỉ mục theo hội thoại/thời gian.
- Tải tin phân trang, tìm kiếm toàn cục, tiếp tục vị trí đọc; đồng bộ trạng thái đọc giữa dashboard/bubble.
- Hoàn thiện gửi/nhận ảnh, file và chuyển tiếp theo khả năng API; bổ sung trạng thái gửi, lỗi và thử lại có kiểm soát.
- Tiêu chí hoàn thành: mở lịch sử lớn không cần nạp toàn bộ vào DOM; dữ liệu cũ còn nguyên sau migration; kết quả tìm kiếm dẫn tới đúng tin.

### P2 — Danh bạ, nhóm và tổ chức

- Tách màn danh bạ/nhóm khỏi màn chat, thêm thông tin chi tiết và thao tác quản lý có API hỗ trợ.
- Phân biệt ghim tin cục bộ với ghim phía Zalo; hoàn thiện trạng thái tắt thông báo, hội thoại lưu trữ nếu khả thi.
- Nâng bình chọn/nhắc hẹn thành danh sách và trạng thái có thể theo dõi, thay vì chỉ có thao tác tạo.
- Tiêu chí hoàn thành: trạng thái hiển thị khớp dữ liệu Zalo sau khởi động lại và sau đồng bộ.

### P3 — Năng lực mở rộng

- Đánh giá riêng công việc/ghi chú, backup/export, cuộc gọi, OCR, phiên âm và dịch. Với mỗi hạng mục: xác nhận API, bản mẫu, quyền truy cập và chi phí trước khi đưa vào kế hoạch phát hành.
- Giữ bubble là luồng thao tác nhanh; các màn quản trị và chức năng nặng chạy trong dashboard.

## Thứ tự kỹ thuật

1. Trích `ZaloManager` thành các service phiên, đồng bộ, tin nhắn, media và danh bạ; đặt interface nhỏ cho API Zalo để mock/test.
2. Tách `dashboard/app.js` theo các module trạng thái, hội thoại, composer, tìm kiếm và modal; giữ renderer chỉ gọi preload API.
3. Thêm schema và migration SQLite, rồi mới tăng dung lượng lịch sử và làm tìm kiếm.
4. Bổ sung log có cấu trúc, trạng thái lỗi/retry và đóng gói phát hành; mã hóa phiên bằng Electron `safeStorage`.

Mốc P0 cần hoàn thành trước khi phát hành bản nâng cấp tiếp theo. P1/P2 có thể chia thành các bản nhỏ theo chức năng; P3 phụ thuộc khả năng của API và thử nghiệm thực tế.

## Tiến độ triển khai trong mã nguồn

Đã thực hiện trong đợt này:

- P0: bỏ chuyển hướng người nhận cố định khi gửi file/sticker; kiểm tra hội thoại đích; chuyển tiếp văn bản qua `forwardMessage`; báo lỗi rõ khi chuyển tiếp media chưa được hỗ trợ. Bỏ thông báo gửi thành công giả ở các luồng đã chỉnh sửa.
- P0: thêm bộ kiểm thử mock cho định tuyến gửi, chuyển tiếp, trạng thái mute/ghim, phản ứng và thu hồi khi hai hội thoại có cùng ID tin nhắn. Chưa có kiểm thử với tài khoản Zalo thật.
- P1: chuyển lịch sử sang `zalo_messages.sqlite`, sao lưu JSON cũ thành `.bak` trước migration, khóa `(thread_id, message_id)`, truy vấn phân trang và tìm kiếm toàn bộ lịch sử. Dashboard chỉ dựng một cửa sổ tin nhắn thay vì toàn bộ lịch sử hội thoại; kết quả tìm kiếm có thể mở đến tin tương ứng.
- P1: phiên đăng nhập mới được mã hóa bằng Electron `safeStorage`; phiên JSON cũ được chuyển đổi sau khi đọc thành công nếu mã hóa hệ điều hành khả dụng.
- P2: màn Danh bạ & Nhóm riêng; kiểm tra kết quả server trước khi lưu trạng thái tắt thông báo/ghim; bảng thông tin hội thoại tải danh sách bình chọn, ghi chú, tin ghim và nhắc hẹn qua `getListBoard`/`getListReminder`.

Cần làm ở các đợt tiếp theo:

- Kiểm thử gửi/nhận, đồng bộ, ảnh/file, bình chọn/nhắc hẹn, trạng thái đọc và khởi động lại trên tài khoản thử nghiệm. Bộ kiểm thử hiện tại chỉ dùng mock; chưa xác nhận đầy đủ hành vi server Zalo.
- Hoàn thiện model tin nhắn và trạng thái gửi/thử lại; chuyển tiếp media thực sự; phân trang phía server và vị trí đọc liên thông dashboard/bubble. Cải thiện tìm kiếm tiếng Việt, xuất/nhập và phục hồi cơ sở dữ liệu.
- Xác minh rồi triển khai lời mời bạn bè, quản lý nhóm, lưu trữ hội thoại, tạo ghi chú nhóm và trạng thái đồng bộ. Ghim tin cục bộ vẫn khác ghim phía Zalo.
- P3: gọi thoại/video, OCR, phiên âm, dịch và công việc chưa có triển khai. Cần API/giao thức được hỗ trợ, thử nghiệm và đánh giá quyền dữ liệu trước khi lên lịch phát hành.

Giới hạn kỹ thuật hiện tại: SQLite dùng `node:sqlite` của Electron 44/Node 24; tìm kiếm là `LIKE` nên chưa có chỉ mục toàn văn; bộ nhớ dashboard vẫn nạp tối đa 5.000 tin gần nhất nhưng chỉ dựng tối đa 100 tin mỗi hội thoại ban đầu. Nếu `safeStorage` không khả dụng, ứng dụng không ghi phiên mới dưới dạng văn bản thuần; phiên cũ vẫn được giữ để tránh mất quyền đăng nhập và cần người dùng đăng nhập lại trên hệ thống hỗ trợ mã hóa.

### Sửa luồng đồng bộ tin nhắn

Khảo sát bổ sung gói Zalo PC cho thấy có `sync-v2-sub-worker`, module cơ sở dữ liệu native và tài nguyên giao diện cho các trạng thái chờ, truyền, thành công và lỗi đồng bộ. Worker chứa đường dẫn yêu cầu sao lưu, tải thông tin bản sao lưu và trạng thái đồng bộ cơ sở dữ liệu. Sự hiện diện này **không** đủ để suy ra chính xác giao thức hoặc cho phép NHITZalo nhập bản sao lưu Zalo PC.

Lỗi đã xác nhận trong NHITZalo: đường yêu cầu đồng bộ điện thoại gọi `crypto` khi chưa import; quan trọng hơn, trình nghe của `zalo-api-final` chỉ phát metadata `sync_event`. Mã cũ đếm các gói sự kiện, hết thời gian chờ rồi báo hoàn tất 100% dù chưa tải, giải mã và nhập nội dung sao lưu. Khi gửi yêu cầu thất bại, `syncOldMessages()` vẫn trả `success: true` và giữ `isSyncing = true`.

Sau phản hồi rằng nút đồng bộ chưa gửi thông báo lên điện thoại, đã tách hai luồng: **Đồng bộ nhanh** tải các trang lịch sử WebSocket (`requestOldMessages`) và lưu vào SQLite; **Đồng bộ từ điện thoại** gửi `pull_mobile_msg`, chỉ đánh thức điện thoại sau khi máy chủ chấp nhận, rồi chờ xác nhận và sự kiện truyền. Gửi yêu cầu thành công trả trạng thái `requestAccepted` và `completed: false`, không còn được coi là đồng bộ hoàn tất. Từ chối, lỗi máy chủ, mất kết nối hoặc hết thời gian chờ đều kết thúc với trạng thái lỗi để có thể thử lại.

Khi điện thoại báo truyền xong, ứng dụng quét và lưu tin nhắn WebSocket lúc đó. Nếu có bản ghi mới, giao diện ghi rõ kết quả **một phần** và số tin thực sự lưu; nếu không có, giao diện báo chưa nhập được tin. Không có trạng thái “đồng bộ hoàn tất 100%” cho bản sao lưu điện thoại vì `zalo-api-final` hiện chỉ phát metadata `sync_event`, chưa cung cấp nội dung sao lưu để giải mã và nhập. Cơ chế sao lưu/khôi phục đầy đủ vẫn cần API có tài liệu và kiểm thử bằng tài khoản thật. Các bài kiểm thử hiện dùng mock, chưa xác nhận máy chủ Zalo thực tế sẽ gửi thông báo tới điện thoại.

Nhật ký thực tế ngày 23/10/2026 xác nhận điện thoại gửi `syncmsg_info` kèm URL, kích thước, checksum và khóa mã hóa của `ZaloDB_2`. Trong Zalo PC 26.10.20, sự kiện này xác nhận **điện thoại đã tạo bản sao lưu**, còn `transfer_error` chỉ được xem là lỗi khi `error_code` khác 0. `syncmsg_info` không chứa tin nhắn đã giải mã. Vì vậy ứng dụng không được đếm nó như gói tin cần chờ thêm hoặc dùng số `msg_total` trong metadata làm số tin đã nhập. Kết quả chỉ dựa trên số bản ghi thực sự lưu vào SQLite; nhập đầy đủ bản sao lưu vẫn là phần việc chưa hoàn thành.
