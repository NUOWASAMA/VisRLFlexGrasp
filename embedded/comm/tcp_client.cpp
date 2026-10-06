// 文件功能：Winsock/POSIX TCP 连接超时、完整帧互斥发送、限长收包及断开唤醒
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-10-06
#include <cerrno>
#include <stdexcept>
#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
using socket_t = SOCKET;
#else
#include <arpa/inet.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
using socket_t = int;
#endif
#include "comm/tcp_client.hpp"
namespace vis_rl_grasp::comm
{
namespace
{
constexpr long long INVALID_FD = -1;
constexpr int RECV_CHUNK_BYTES = 4096;
void close_native(socket_t fd)
{
#ifdef _WIN32
    closesocket(fd);
#else
    ::close(fd);
#endif
}
bool set_nonblocking(socket_t fd, bool enabled)
{
#ifdef _WIN32
    u_long mode = enabled ? 1 : 0;
    return ioctlsocket(fd, FIONBIO, &mode) == 0;
#else
    const int flags = fcntl(fd, F_GETFL, 0);
    return flags >= 0 && fcntl(fd, F_SETFL, enabled ? flags | O_NONBLOCK : flags & ~O_NONBLOCK) == 0;
#endif
}
bool connect_ready(socket_t fd, const sockaddr_in& address)
{
    if (!set_nonblocking(fd, true))
    {
        return false;
    }
    if (::connect(fd, reinterpret_cast<const sockaddr*>(&address), sizeof(address)) != 0)
    {
#ifdef _WIN32
        const int error = WSAGetLastError();
        if (error != WSAEWOULDBLOCK && error != WSAEINPROGRESS)
#else
        if (errno != EINPROGRESS)
#endif
        {
            return false;
        }
        fd_set writable, failed;
        FD_ZERO(&writable);
        FD_ZERO(&failed);
        FD_SET(fd, &writable);
        FD_SET(fd, &failed);
        timeval timeout{static_cast<long>(REQUEST_TIMEOUT_SEC), 0};
        if (select(static_cast<int>(fd + 1), nullptr, &writable, &failed, &timeout) <= 0
            || FD_ISSET(fd, &failed))
        {
            return false;
        }
        int error_code = 0;
#ifdef _WIN32
        int length = sizeof(error_code);
#else
        socklen_t length = sizeof(error_code);
#endif
        if (getsockopt(fd, SOL_SOCKET, SO_ERROR, reinterpret_cast<char*>(&error_code), &length) != 0
            || error_code != 0)
        {
            return false;
        }
    }
    return set_nonblocking(fd, false);
}
}
TcpClient::TcpClient(const std::string& host, int port) : m_host(host), m_port(port)
{
    if (port < 1 || port > 65535)
    {
        throw std::invalid_argument("TCP 端口必须在 1 到 65535 之间");
    }
#ifdef _WIN32
    WSADATA data;
    if (WSAStartup(MAKEWORD(2, 2), &data) != 0)
    {
        throw std::runtime_error("Winsock 初始化失败");
    }
#endif
}
TcpClient::~TcpClient()
{
    close();
#ifdef _WIN32
    WSACleanup();
#endif
}
bool TcpClient::connect()
{
    std::lock_guard<std::mutex> lifecycle(m_lifecycle_mutex);
    if (m_socket_fd.load() != INVALID_FD)
    {
        return true;
    }
    const socket_t fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (static_cast<long long>(fd) == INVALID_FD)
    {
        return false;
    }
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_port = htons(static_cast<unsigned short>(m_port));
    if (inet_pton(AF_INET, m_host.c_str(), &address.sin_addr) != 1 || !connect_ready(fd, address))
    {
        close_native(fd);
        return false;
    }
#ifdef _WIN32
    const DWORD timeout = static_cast<DWORD>(REQUEST_TIMEOUT_SEC * 1000.0);
#else
    const timeval timeout{static_cast<long>(REQUEST_TIMEOUT_SEC), 0};
#endif
    if (setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, reinterpret_cast<const char*>(&timeout), sizeof(timeout)) != 0)
    {
        close_native(fd);
        return false;
    }
    m_socket_fd.store(static_cast<long long>(fd));
    return true;
}
bool TcpClient::send_line(const std::string& json_line)
{
    if (json_line.size() > MAX_LINE_BYTES || json_line.find('\n') != std::string::npos
        || json_line.find('\r') != std::string::npos)
    {
        return false;
    }
    std::lock_guard<std::mutex> sending(m_send_mutex);
    const long long fd = m_socket_fd.load();
    if (fd == INVALID_FD)
    {
        return false;
    }
    const std::string payload = json_line + "\n";
    size_t offset = 0;
    while (offset < payload.size())
    {
#ifdef MSG_NOSIGNAL
        constexpr int SEND_FLAGS = MSG_NOSIGNAL;
#else
        constexpr int SEND_FLAGS = 0;
#endif
        const int sent = static_cast<int>(::send(static_cast<socket_t>(fd), payload.data() + offset,
            static_cast<int>(payload.size() - offset), SEND_FLAGS));
        if (sent <= 0)
        {
            return false;
        }
        offset += static_cast<size_t>(sent);
    }
    return true;
}
void TcpClient::run_receive_loop(const MessageHandler& handler)
{
    m_recv_buffer.clear();
    char chunk[RECV_CHUNK_BYTES];
    while (true)
    {
        const long long fd = m_socket_fd.load();
        if (fd == INVALID_FD)
        {
            break;
        }
        const int count = static_cast<int>(::recv(static_cast<socket_t>(fd), chunk, RECV_CHUNK_BYTES, 0));
        if (count <= 0)
        {
            break;
        }
        m_recv_buffer.append(chunk, static_cast<size_t>(count));
        size_t newline = m_recv_buffer.find('\n');
        while (newline != std::string::npos)
        {
            if (newline > MAX_LINE_BYTES)
            {
                close();
                return;
            }
            std::string line = m_recv_buffer.substr(0, newline);
            m_recv_buffer.erase(0, newline + 1);
            if (!line.empty() && line.back() == '\r')
            {
                line.pop_back();
            }
            if (!line.empty() && handler)
            {
                handler(line);
            }
            newline = m_recv_buffer.find('\n');
        }
        if (m_recv_buffer.size() > MAX_LINE_BYTES)
        {
            break;
        }
    }
    close();
}
void TcpClient::close()
{
    std::lock_guard<std::mutex> lifecycle(m_lifecycle_mutex);
    const long long old = m_socket_fd.exchange(INVALID_FD);
    if (old == INVALID_FD)
    {
        return;
    }
    const socket_t fd = static_cast<socket_t>(old);
#ifdef _WIN32
    shutdown(fd, SD_BOTH);
#else
    shutdown(fd, SHUT_RDWR);
#endif
    // 先唤醒发送，再等待完整帧发送退出；防止关闭期间句柄被复用。
    std::lock_guard<std::mutex> sending(m_send_mutex);
    close_native(fd);
}
}
