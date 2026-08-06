// 文件功能：运动控制服务 TCP 客户端声明，负责与调度服务的 NDJSON 报文收发
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-07-26
#pragma once

#include <functional>
#include <string>

namespace vis_rl_grasp::comm
{

// 通信机制常量，与 docs/api/tcp_communication_spec.md 第 1 章保持一致
constexpr double REQUEST_TIMEOUT_SEC = 3.0;
constexpr int MAX_RETRY_COUNT = 3;
constexpr double HEARTBEAT_INTERVAL_SEC = 3.0;

// 单行报文的业务回调：入参为一行 JSON 文本（不含换行符）
using MessageHandler = std::function<void(const std::string& json_line)>;

class TcpClient
{
public:
    TcpClient(const std::string& host, int port);
    ~TcpClient();

    // 建立连接，成功返回 true
    bool connect();

    // 发送一行 NDJSON 报文（自动追加换行符），成功返回 true
    bool send_line(const std::string& json_line);

    // 阻塞收包循环，每收到一行完整报文回调一次 handler，连接断开后返回
    void run_receive_loop(const MessageHandler& handler);

    // 关闭连接
    void close();

private:
    std::string m_host;
    int m_port;
    long long m_socket_fd;  // 平台原生套接字句柄
    std::string m_recv_buffer;
};

}  // namespace vis_rl_grasp::comm
