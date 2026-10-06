// 文件功能：线程安全的 NDJSON TCP 客户端，支持超时、帧上限及主动断开
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-10-06
#pragma once
#include <atomic>
#include <functional>
#include <mutex>
#include <string>
namespace vis_rl_grasp::comm
{
constexpr double REQUEST_TIMEOUT_SEC = 3.0;
constexpr int MAX_RETRY_COUNT = 3;
constexpr double HEARTBEAT_INTERVAL_SEC = 3.0;
constexpr size_t MAX_LINE_BYTES = 1024 * 1024;
using MessageHandler = std::function<void(const std::string&)>;
class TcpClient
{
public:
    TcpClient(const std::string& host, int port);
    ~TcpClient();
    TcpClient(const TcpClient&) = delete;
    TcpClient& operator=(const TcpClient&) = delete;
    // 三秒内尝试连接；失败不保留套接字，返回 false。
    bool connect();
    // 串行发送完整 NDJSON 帧；禁止裸换行及超过上限的报文，失败返回 false。
    bool send_line(const std::string& json_line);
    // 接收完整帧后回调；断开或超长帧结束接收并关闭连接。
    void run_receive_loop(const MessageHandler& handler);
    // shutdown 唤醒阻塞接收/发送，再关闭套接字；可以从心跳线程调用。
    void close();
private:
    std::string m_host;
    int m_port;
    std::atomic<long long> m_socket_fd{-1};
    std::mutex m_send_mutex;
    std::mutex m_lifecycle_mutex;
    std::string m_recv_buffer;
};
}
