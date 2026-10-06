// 文件功能：独立于 TCP 的指令校验、坐标变换、解析选解和轨迹规划
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-10-06
#pragma once
#include <atomic>
#include <optional>
#include <string>
#include <jsoncons/json.hpp>
#include "comm/motion_config.h"
#include "motion/robot_model.h"
namespace vis_rl_grasp::comm
{
using Json = jsoncons::json;
enum class EErrorCode
{
    SUCCESS = 0, INVALID_PARAM = 1000, INVALID_MESSAGE = 1001,
    NOT_REGISTERED = 1003, MOTION_EXEC_FAILED = 3001
};
// 构造带毫秒级时间戳的标准报文，默认方向 motion -> backend。
Json build_message(const std::string& type, const Json& data,
    EErrorCode code = EErrorCode::SUCCESS, const std::string& description = "success");
class MotionProcessor
{
public:
    MotionProcessor(const MotionConfig& config, const motion::RobotModel& model);
    // 收包后返回规划/错误报文；注册确认及心跳应答返回 nullopt，避免应答回环。
    std::optional<Json> handle_line(const std::string& line);
    bool is_registered() const;
private:
    Json plan_grasp(const Json& data) const;
    MotionConfig m_config;
    motion::RobotModel m_model;
    std::atomic<bool> m_registered{false};
};
}
