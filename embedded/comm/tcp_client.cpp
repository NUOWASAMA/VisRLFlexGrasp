// 文件功能：运动控制服务 TCP 客户端实现（Windows Winsock / POSIX 双平台阻塞式收发）
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-07-26
#include "comm/tcp_client.hpp"

#include <cstring>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
using socket_t = SOCKET;
constexpr socket_t INVALID_SOCKET_FD = INVALID_SOCKET;
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
using socket_t = int;
constexpr socket_t INVALID_SOCKET_FD = -1;
#endif

namespace vis_rl_grasp::comm
{

// 单次 recv 缓冲区大小（字节）
constexpr int RECV_CHUNK_BYTES = 4096;

TcpClient::TcpClient(const std::string& host, int port)
    : m_host(host), m_port(port), m_socket_fd(static_cast<long long>(INVALID_SOCKET_FD))
{
#ifdef _WIN32
    WSADATA wsa_data;
    WSAStartup(MAKEWORD(2, 2), &wsa_data);
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
    socket_t fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (fd == INVALID_SOCKET_FD)
    {
        return false;
    }
    sockaddr_in server_addr{};
    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(static_cast<unsigned short>(m_port));
    if (inet_pton(AF_INET, m_host.c_str(), &server_addr.sin_addr) != 1)
    {
        return false;
    }
    if (::connect(fd, reinterpret_cast<sockaddr*>(&server_addr), sizeof(server_addr)) != 0)
    {
        return false;
    }
    m_socket_fd = static_cast<long long>(fd);
    return true;
}

bool TcpClient::send_line(const std::string& json_line)
{
    if (m_socket_fd == static_cast<long long>(INVALID_SOCKET_FD))
    {
        return false;
    }
    const std::string payload = json_line + "\n";
    const char* data = payload.c_str();
    size_t remaining = payload.size();
    while (remaining > 0)
    {
        const int sent = ::send(static_cast<socket_t>(m_socket_fd), data, static_cast<int>(remaining), 0);
        if (sent <= 0)
        {
            return false;
        }
        data += sent;
        remaining -= static_cast<size_t>(sent);
    }
    return true;
}

void TcpClient::run_receive_loop(const MessageHandler& handler)
{
    char chunk[RECV_CHUNK_BYTES];
    while (m_socket_fd != static_cast<long long>(INVALID_SOCKET_FD))
    {
        const int received = ::recv(static_cast<socket_t>(m_socket_fd), chunk, RECV_CHUNK_BYTES, 0);
        if (received <= 0)
        {
            break;  // 连接断开，由上层按 1s/3s/5s 递增间隔重连
        }
        m_recv_buffer.append(chunk, static_cast<size_t>(received));
        size_t newline_pos = m_recv_buffer.find('\n');
        while (newline_pos != std::string::npos)
        {
            const std::string line = m_recv_buffer.substr(0, newline_pos);
            m_recv_buffer.erase(0, newline_pos + 1);
            if (!line.empty() && handler)
            {
                handler(line);
            }
            newline_pos = m_recv_buffer.find('\n');
        }
    }
}

void TcpClient::close()
{
    if (m_socket_fd != static_cast<long long>(INVALID_SOCKET_FD))
    {
#ifdef _WIN32
        closesocket(static_cast<socket_t>(m_socket_fd));
#else
        ::close(static_cast<socket_t>(m_socket_fd));
#endif
        m_socket_fd = static_cast<long long>(INVALID_SOCKET_FD);
    }
}

}  // namespace vis_rl_grasp::comm
