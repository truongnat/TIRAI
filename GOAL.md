Xây dựng một **Agent-driven Test Orchestration Tool** có khả năng tự động hóa quy trình kiểm thử khép kín từ việc tiếp nhận tài liệu đặc tả từ nhiều nguồn, chuẩn hóa thành mô hình dữ liệu trung gian thống nhất, lập kế hoạch và sinh test, thực thi trên nhiều nền tảng kiểm thử, thu thập bằng chứng và đánh giá kết quả, đến việc xuất báo cáo hoặc đồng bộ kết quả tới nhiều hệ thống bên ngoài.

TIRAI là **tool-only**: công cụ không chứa bất kỳ lời gọi model nào. Host agent chịu trách nhiệm phân tích ngữ nghĩa, xây dựng requirement, lập kế hoạch test và đánh giá, rồi bàn giao canonical artifact cho TIRAI để validate, import, thực thi và báo cáo một cách xác định (deterministic) và fail-closed.

Công cụ được thiết kế theo kiến trúc **Connector / Canonical JSON IR / Artifact Protocol**, cho phép linh hoạt mở rộng nguồn đầu vào như Excel, PDF, Google Drive, Jira, Confluence, GitHub; công cụ thực thi như Playwright, Selenium, API, Database, CLI; cũng như các đầu ra như Report, Jira, Slack, Email, Dashboard mà không làm thay đổi Core Engine.

Hệ thống có thể vận hành dưới nhiều hình thức như **CLI, Desktop App, Web Server, CI/CD, Webhook, Bot hoặc Remote Agent**, qua đó tích hợp trực tiếp vào quy trình phát triển phần mềm hiện có.

Mục tiêu cuối cùng là tạo ra một nền tảng kiểm thử **tool-only, agent-driven** — source-agnostic, execution-agnostic và output-agnostic — giúp giảm công sức kiểm thử thủ công, tăng khả năng truy vết từ yêu cầu đến kết quả, mở rộng phạm vi tự động hóa và nâng cao đồng thời năng suất lẫn chất lượng phần mềm.
